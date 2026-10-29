import { createFetcher, type FetchLogEntry, type Transport } from "./fetch";
import { applyGates } from "./gates";
import { repairDraft } from "./repair";
import { RateLimitError, type Message, type ModelAdapter, type ToolCall, type ToolDef } from "./model";
import { addTask, draftFieldsSchema, recheckTask, systemPrompt } from "./prompt";
import { providerEndpoints, type SearchAdapter } from "./search";

// One research run, executed in chunks short enough for a serverless function (Vercel Hobby
// stops at 300 s). All state lives in RunState, which the job row stores between chunks.

export type RunLimits = {
  maxMs: number;
  /** No new model call starts after this long in a chunk. */
  chunkMs: number;
  /** After this long in a chunk, tool calls not yet run are skipped and the model is asked to repeat them. */
  toolCutoffMs?: number;
  maxFetches: number;
  maxTokens: number;
  maxTurns: number;
  maxSearches?: number;
  /** Web search is offered only once a run is slow: after this much working time or this many
   * turns, whichever comes first. Leave both unset to offer it from the start. */
  searchAfterMs?: number;
  searchAfterTurns?: number;
  /** Docs pages code reads before the first model call (0 or unset: none). */
  prefetchPages?: number;
};

export const DEFAULT_LIMITS: RunLimits = {
  maxMs: 15 * 60_000,
  // A chunk must end inside the 290 s lease. The last model call starts by 2 min and can take
  // up to 2 min (Gemini's request timeout); tools then get until 250 s, plus one fetch timeout.
  chunkMs: 2 * 60_000,
  toolCutoffMs: 250_000,
  maxFetches: 80,
  maxTokens: 2_000_000,
  maxTurns: 80,
  // Search is a fallback with a small free monthly quota: keep it to a few calls per guide.
  maxSearches: 6,
  // Quick runs finish in under a minute from the provider's own docs. Search (a small free
  // monthly quota) is held back for the slower ones.
  searchAfterMs: 60_000,
  searchAfterTurns: 10,
  // Reading the likely OAuth pages up front saves the model several fetch turns.
  prefetchPages: 4,
};

export type RunState = {
  mode: "add" | "recheck";
  appName: string;
  slug: string;
  messages: Message[];
  draft: Record<string, unknown>;
  fetchLog: FetchLogEntry[];
  fetchCount: number;
  searchCount?: number;
  /** Set once provider_endpoints or fetch has been used; search is a fallback after that. */
  docsChecked?: boolean;
  /** Set once the run is slow enough for web search to be offered (see RunLimits). */
  searchUnlocked?: boolean;
  tokens: number;
  turns: number;
  elapsedMs: number;
  submitted: Record<string, unknown> | null;
  limitReason: string | null;
};

export type ChunkDeps = {
  model: ModelAdapter;
  transport?: Transport;
  search: SearchAdapter | null;
  onEvent: (message: string) => void | Promise<void>;
  now?: () => number;
};

export type ChunkOutcome = {
  state: RunState;
  outcome: "continue" | "submitted" | "limit" | "rate_limited";
  retryAfterMs?: number | null;
  /** With rate_limited: the model's daily allowance is used up. */
  daily?: boolean;
};

const MAX_QUERY_WORDS = 8;
const MAX_URLS_PER_FETCH = 5;
const CLEAN = "No problems.";
const SKIPPED = "not run: this step ran out of time; call it again";
const SEARCH_UNLOCKED =
  "Note: this research is taking longer than usual, so a web search tool is now available. Use it if the official pages you need are hard to reach, or to find community reports on review times and problems.";

const DRAFT_KEYS = new Set([
  "app", "oauthSupport", "technical", "profiles", "defaultProfileId", "steps", "requirements",
  "limits", "blockers", "nuances", "notFound", "claims", "version",
]);

export function newRunState(
  mode: "add" | "recheck",
  appName: string,
  slug: string,
  recheck?: { previousGuide: unknown; reports: { target: string; type: string; detail: string | null }[] },
): RunState {
  const task = mode === "add" ? addTask(appName, slug) : recheckTask(appName, slug, recheck?.previousGuide, recheck?.reports ?? []);
  const base: Record<string, unknown> = { version: 1 };
  const draft = mode === "recheck" && recheck?.previousGuide ? structuredClone(recheck.previousGuide as Record<string, unknown>) : base;
  return {
    mode, appName, slug, messages: [{ role: "user", content: task }], draft,
    fetchLog: [], fetchCount: 0, searchCount: 0, tokens: 0, turns: 0, elapsedMs: 0, submitted: null, limitReason: null,
  };
}

function tools(withSearch: boolean): ToolDef[] {
  const list: ToolDef[] = [
    {
      name: "provider_endpoints",
      description: "List pages the provider's docs host publishes about itself: /llms.txt links, auth-related sitemap URLs and OAuth discovery documents. Use the docs hostname, e.g. docs.example.com.",
      parameters: { type: "object", properties: { host: { type: "string" } }, required: ["host"] },
    },
    {
      name: "fetch",
      description: `Read https pages and get their text: "url" for one page, or "urls" for up to ${MAX_URLS_PER_FETCH} at once (cheaper than several calls). This is the only way a page counts as read.`,
      parameters: {
        type: "object",
        properties: { url: { type: "string" }, urls: { type: "array", items: { type: "string" }, maxItems: MAX_URLS_PER_FETCH } },
      },
    },
    {
      name: "set_draft",
      description: "Set top-level fields of the guide draft (shallow merge). Allowed keys: app, oauthSupport, technical, profiles, defaultProfileId, steps, requirements, limits, blockers, nuances, notFound, claims. The reply checks the whole draft exactly as the publish gates will and lists every problem, so fix them in your next set_draft.",
      parameters: { type: "object", properties: { fields: draftFieldsSchema() }, required: ["fields"] },
    },
    {
      name: "submit_guide",
      description: "Finish the run with the current draft.",
      parameters: { type: "object", properties: {} },
    },
  ];
  if (withSearch) {
    list.unshift({
      name: "search",
      description: "Web search, offered because this research is taking longer than usual. Use it to find the official docs pages you haven't reached, or community reports (forums, issues) about review times and problems. Results only point to pages; fetch a page before relying on it.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    });
  }
  return list;
}

const OAUTH_PAGE = /oauth|authoriz/i;
const AUTH_DETAIL_PAGE = /scope|token|auth|permission|redirect/i;
const STAGE2_PAGE = /review|production|verif|publish|pric|rate-?limit|quota|approv/i;

/** The pages most worth reading first: OAuth flow pages, then scopes/tokens, plus one Stage 2 page. */
export function pickDocsPages(urls: string[], max: number): string[] {
  const unique = [...new Set(urls)].filter((u) => /^https:\/\//.test(u) && !/\/\.well-known\//.test(u));
  const stage2 = unique.find((u) => STAGE2_PAGE.test(u) && !OAUTH_PAGE.test(u));
  const auth = [...unique.filter((u) => OAUTH_PAGE.test(u)), ...unique.filter((u) => !OAUTH_PAGE.test(u) && AUTH_DETAIL_PAGE.test(u))];
  const picked = auth.filter((u) => u !== stage2).slice(0, stage2 ? max - 1 : max);
  return stage2 && max > 0 ? [...picked, stage2] : picked;
}

const short = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
};

export async function runChunk(input: RunState, deps: ChunkDeps, limits: RunLimits = DEFAULT_LIMITS): Promise<ChunkOutcome> {
  const state: RunState = structuredClone(input);
  const now = deps.now ?? Date.now;
  const chunkStart = now();
  const startElapsed = state.elapsedMs;
  const fetcher = createFetcher({ transport: deps.transport, maxFetches: limits.maxFetches, seed: { log: state.fetchLog, count: state.fetchCount } });
  const slow = () =>
    (limits.searchAfterMs === undefined && limits.searchAfterTurns === undefined) ||
    (limits.searchAfterMs !== undefined && state.elapsedMs >= limits.searchAfterMs) ||
    (limits.searchAfterTurns !== undefined && state.turns >= limits.searchAfterTurns);
  const system = systemPrompt();
  const sync = () => {
    state.fetchLog = [...fetcher.log];
    state.fetchCount = fetcher.count;
    state.elapsedMs = startElapsed + (now() - chunkStart);
  };

  async function checkDraft(): Promise<string> {
    sync();
    const g = applyGates(state.draft, state.fetchLog, { slug: state.slug, model: deps.model.name, jobId: "draft", today: new Date().toISOString().slice(0, 10) });
    await deps.onEvent(`Checking the draft: ${g.status === "publish" ? "ready" : `${g.reasons.length} issue(s)`}`);
    if (g.status === "publish" && g.reasons.length === 0) return `${CLEAN} The draft would be published; call submit_guide.`;
    const shown = g.reasons.slice(0, 40);
    const more = g.reasons.length > shown.length ? `\n- …and ${g.reasons.length - shown.length} more` : "";
    return `${g.status === "publish" ? "Would publish, with notes" : "Would NOT be published"}:\n- ${shown.join("\n- ")}${more}`;
  }

  async function readPage(url: string, single = false): Promise<string> {
    await deps.onEvent(`Reading ${short(url)}`);
    const r = await fetcher.fetch(url);
    if (!r.ok) return single ? `error: ${r.error}` : `<page_error url="${url}">${r.error}</page_error>`;
    const note = r.contentFound ? "" : " no_readable_content=\"true\"";
    return `<untrusted_page url="${r.finalUrl}" status="${r.status}"${r.truncated ? ' truncated="true"' : ""}${note}>\n${r.text}\n</untrusted_page>`;
  }

  // Before the first model call: find the docs host, read the likely OAuth pages and hand them
  // to the model with its task. The model can still fetch anything else it needs.
  async function prefetchDocs(max: number) {
    const base = state.slug.split("-")[0];
    for (const host of [`developer.${base}.com`, `developers.${base}.com`, `docs.${base}.com`]) {
      const hits = await providerEndpoints(host, fetcher).catch(() => []);
      if (hits.length === 0) continue;
      await deps.onEvent(`Found the docs index on ${host}`);
      state.docsChecked = true;
      const picked = pickDocsPages(hits.map((h) => h.url), max);
      const pages: string[] = [];
      for (const url of picked) pages.push(await readPage(url));
      const index = hits.slice(0, 40).map((h) => `- ${h.title}: ${h.url}${h.snippet ? ` (${h.snippet.slice(0, 160)})` : ""}`).join("\n");
      state.messages[0].content += [
        "",
        "",
        `Code already looked up the docs host ${host} (provider_endpoints) and read the pages below for you.`,
        "They count as read. Fetch anything else you need; don't re-fetch these.",
        "<untrusted_search_results>",
        index,
        "</untrusted_search_results>",
        ...pages,
      ].join("\n");
      return;
    }
  }

  async function runTool(tc: ToolCall): Promise<string> {
    const args = tc.args ?? {};
    switch (tc.name) {
      case "search": {
        if (!deps.search || !state.searchUnlocked) return "error: no search tool is available";
        const q = String(args.query ?? "").trim().slice(0, 300);
        if (q.split(/\s+/).length > MAX_QUERY_WORDS) return `error: keep search queries short (3-6 words), e.g. "${state.appName} OAuth app"`;
        // One search may find the docs host; after that, the provider's own docs come first.
        if (!state.docsChecked && (state.searchCount ?? 0) >= 1) {
          return "error: check the provider's own docs first (provider_endpoints, then fetch); search is a fallback";
        }
        const max = limits.maxSearches ?? DEFAULT_LIMITS.maxSearches!;
        if ((state.searchCount ?? 0) >= max) return `error: search limit (${max}) reached for this run; use provider_endpoints and fetch`;
        state.searchCount = (state.searchCount ?? 0) + 1;
        await deps.onEvent(`Searching: ${q}`);
        const hits = await deps.search.search(q);
        return `<untrusted_search_results>\n${JSON.stringify(hits.slice(0, 10))}\n</untrusted_search_results>`;
      }
      case "provider_endpoints": {
        state.docsChecked = true;
        const host = String(args.host ?? "");
        await deps.onEvent(`Looking up the docs index on ${host}`);
        return JSON.stringify(await providerEndpoints(host, fetcher));
      }
      case "fetch": {
        state.docsChecked = true;
        const urls = Array.isArray(args.urls) ? args.urls.map(String) : [String(args.url ?? "")];
        if (urls.length > MAX_URLS_PER_FETCH) return `error: at most ${MAX_URLS_PER_FETCH} urls per fetch`;
        if (urls.length === 1) return readPage(urls[0], true);
        const pages: string[] = [];
        for (const url of urls) pages.push(outOfTime() ? `<page_error url="${url}">${SKIPPED}</page_error>` : await readPage(url));
        return pages.join("\n\n");
      }
      case "set_draft": {
        const fields = args.fields;
        if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "error: fields must be an object";
        const rejected = Object.keys(fields).filter((k) => !DRAFT_KEYS.has(k));
        for (const [k, v] of Object.entries(fields)) if (DRAFT_KEYS.has(k)) state.draft[k] = v;
        state.draft = repairDraft(state.draft).draft; // formatting only, never facts
        await deps.onEvent(`Drafting: ${Object.keys(fields).filter((k) => DRAFT_KEYS.has(k)).join(", ")}`);
        // Check on every save, so the model never spends a request just to ask "is it OK?".
        const note = rejected.length ? ` Ignored keys set by code: ${rejected.join(", ")}.` : "";
        const check = await checkDraft();
        // A new guide that passes every check is submitted right away, saving a submit_guide turn.
        // Re-checks start from a passing guide, so they still finish with submit_guide.
        if (state.mode === "add" && check.startsWith(CLEAN)) {
          state.submitted = structuredClone(state.draft);
          await deps.onEvent("Submitting the guide");
          return `Saved. ${CLEAN} Submitted automatically.`;
        }
        return `Saved.${note} ${check}`;
      }
      case "validate_draft":
        // No longer offered; kept so runs saved before the change can still finish.
        return checkDraft();
      case "submit_guide":
        state.submitted = structuredClone(state.draft);
        await deps.onEvent("Submitting the guide");
        return "submitted";
      default:
        return `error: unknown tool ${tc.name}`;
    }
  }

  const outOfTime = () => limits.toolCutoffMs !== undefined && now() - chunkStart >= limits.toolCutoffMs;

  const prefetch = limits.prefetchPages ?? 0;
  if (state.mode === "add" && state.turns === 0 && state.fetchCount === 0 && prefetch > 0) await prefetchDocs(prefetch);

  while (true) {
    sync();
    if (state.elapsedMs >= limits.maxMs) return { state: { ...state, limitReason: "time limit reached" }, outcome: "limit" };
    if (state.tokens >= limits.maxTokens) return { state: { ...state, limitReason: "token limit reached" }, outcome: "limit" };
    if (state.turns >= limits.maxTurns) return { state: { ...state, limitReason: "turn limit reached" }, outcome: "limit" };
    if (now() - chunkStart >= limits.chunkMs) return { state, outcome: "continue" };

    // Search is offered from the turn the run becomes slow; the model is told why in the last reply.
    if (deps.search && !state.searchUnlocked && slow()) {
      state.searchUnlocked = true;
      const last = state.messages.at(-1);
      if (state.turns > 0 && last) last.content += `\n\n${SEARCH_UNLOCKED}`;
      if (state.turns > 0) await deps.onEvent("Taking longer than usual: web search is now available");
    }

    let turn;
    try {
      turn = await deps.model.complete(system, state.messages, tools(Boolean(deps.search && state.searchUnlocked)));
    } catch (e) {
      sync();
      if (e instanceof RateLimitError) return { state, outcome: "rate_limited", retryAfterMs: e.retryAfterMs, daily: e.daily };
      throw e;
    }
    state.turns++;
    state.tokens += turn.usage.inputTokens + turn.usage.outputTokens;
    state.messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls, raw: turn.raw });

    if (turn.toolCalls.length === 0) {
      state.messages.push({ role: "user", content: "Please continue using the tools. Finish with submit_guide." });
      continue;
    }
    for (const tc of turn.toolCalls) {
      let result: string;
      try {
        result = outOfTime() ? `error: ${SKIPPED}` : await runTool(tc);
      } catch (e) {
        result = `error: ${(e as Error).message}`;
      }
      state.messages.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: result });
      if (state.submitted) {
        sync();
        return { state, outcome: "submitted" };
      }
    }
  }
}

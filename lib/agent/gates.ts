import { validateGuideJson } from "../guides";
import type { Guide } from "../schema";
import type { FetchLogEntry } from "./fetch";
import { findStyleIssues, formatStyleIssue } from "../style";
import { closestSentence, numberOnPage, numbersIn, quoteOnPage } from "./evidence";

// Run after the agent submits. Nothing the agent says about how it read a page is trusted:
// read status comes from this run's fetch log, and labels are corrected to match.

export const PUBLISH_MIN_VERIFIED_SHARE = 0.5;

export type GateContext = { slug: string; model: string; jobId: string; today: string };
export type GateResult = {
  status: "publish" | "requester_only";
  guide: any; // a valid Guide when status is "publish"; best-effort draft otherwise
  reasons: string[];
};

// Same page, different spelling: docs sites serve Markdown twins (page.md), and agents cite
// with or without trailing slashes, fragments or www. Normalise both sides before comparing.
// Deliberately page-level: another page on the same site doesn't count as reading this one.
export function pageKey(url: string): string {
  return url
    .trim()
    .replace(/#.*$/, "") // fragment
    .replace(/^https?:\/\//i, "") // scheme
    .replace(/^([^/?]+)/, (host) => host.toLowerCase().replace(/^www\./, "")) // host case, www.
    .replace(/\/index\.(html?|mdx?)(?=$|\?)/i, "") // .../index.html
    .replace(/\.(mdx?|html?)(?=$|\?)/i, "") // .md, .mdx, .html twins
    .replace(/\/+(?=$|\?)/, ""); // trailing slash
}

const readPages = (url: string, log: FetchLogEntry[]) =>
  log.filter((e) => e.contentFound && (pageKey(e.url) === pageKey(url) || (e.finalUrl !== null && pageKey(e.finalUrl) === pageKey(url))));
const pageText = (url: string, log: FetchLogEntry[]) => readPages(url, log).map((e) => e.text ?? "").join("\n");
const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").slice(0, 80);

// A page counts as Stage 2 research when its address is about review, production access, limits or cost.
const STAGE2_PAGE = /review|production|verif|pric|limit|quota|publish|approv|go-?live|launch|distribut|partner|marketplace|polic|terms|billing|plans?\b|tier/i;

// Checks that can't be fixed by downgrading a label: the guide is held back until they pass.
function structuralIssues(g: any, log: FetchLogEntry[]): string[] {
  const issues: string[] = [];
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const claims = new Map(arr(g.claims).map((c: any) => [c?.id, c]));

  // A limit's numbers must appear on a page its claims cite (when any of those pages was read).
  for (const [i, l] of arr(g.limits).entries()) {
    const texts = arr(l?.claimIds)
      .flatMap((id: string) => arr(claims.get(id)?.sources))
      .map((s: any) => (typeof s?.url === "string" ? pageText(s.url, log) : ""))
      .filter(Boolean);
    if (texts.length === 0 || typeof l?.value !== "string") continue;
    for (const n of numbersIn(l.value)) {
      if (!texts.some((t) => numberOnPage(n, t))) {
        issues.push(`limits[${i}] (${l.id}): "${n}" isn't on any page its claims cite; cite the claim whose page states it, or remove the number`);
      }
    }
  }

  if (!log.some((e) => e.contentFound && STAGE2_PAGE.test(e.finalUrl ?? e.url))) {
    issues.push("Stage 2 isn't backed by any page read about review, production access, limits or pricing; fetch one before submitting");
  }

  const requiresReview = arr(g.profiles).some((p: any) => p?.facts?.requiresAppReview?.value === true);
  for (const [i, s] of arr(g.steps).entries()) {
    if (s?.owner === "agent" && s?.humanGate) {
      issues.push(`steps[${i}] (${s.id}): owner "agent" can't have humanGate "${s.humanGate}"; either a person does it (owner "developer") or no gate`);
    }
    if (s?.humanGate === "review_submission" && !requiresReview) {
      issues.push(`steps[${i}] (${s.id}): humanGate "review_submission" but requiresAppReview isn't true`);
    }
    for (const [j, link] of arr(s?.links).entries()) {
      if (typeof link?.url === "string" && readPages(link.url, log).length === 0) {
        issues.push(`steps[${i}].links[${j}]: ${shortUrl(link.url)} wasn't read this run; link only to pages you fetched`);
      }
    }
  }
  return issues;
}

function readStatus(url: string, log: FetchLogEntry[]): "full" | "snippet" | "unfetchable" {
  const key = pageKey(url);
  const hits = log.filter((e) => pageKey(e.url) === key || (e.finalUrl !== null && pageKey(e.finalUrl) === key));
  if (hits.some((e) => e.contentFound)) return "full";
  return hits.length > 0 ? "unfetchable" : "snippet";
}

export function applyGates(draft: unknown, log: FetchLogEntry[], ctx: GateContext): GateResult {
  const reasons: string[] = [];
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { status: "requester_only", guide: draft, reasons: ["The agent didn't produce a guide object."] };
  }
  const g = structuredClone(draft) as any;

  // 1. Code owns identity and provenance.
  g.slug = ctx.slug;
  g.source = "generated";
  g.lastVerified = ctx.today;
  g.generator = { model: ctx.model, jobId: ctx.jobId, generatedAt: ctx.today };

  // 2-3. Read status from the log, then labels that match it.
  if (Array.isArray(g.claims)) {
    for (const c of g.claims) {
      if (!c || typeof c !== "object") continue;
      const sources = Array.isArray(c.sources) ? c.sources : (c.sources = []);
      for (const s of sources) {
        if (!s || typeof s.url !== "string") continue;
        s.read = readStatus(s.url, log);
        s.retrievedAt = ctx.today;
      }
      if (c.label === "tested") {
        c.label = "uncertain";
        delete c.testedHow;
        reasons.push(`Claim ${c.id}: "tested" can only come from a person, set to uncertain.`);
      }
      if (c.label === "verified") {
        // Verified means: an official page read this run says it, and the quote proves where.
        const official = sources.filter((s: any) => s?.kind === "official" && s?.read === "full");
        const quoted = official.filter((s: any) => typeof s?.quote === "string" && s.quote.trim());
        let problem: string | null = null;
        if (official.length === 0) problem = "no official page was read in full this run";
        else if (quoted.length === 0) problem = "no quote from its official page; add 3-14 words copied exactly from the page";
        else if (!quoted.some((s: any) => quoteOnPage(s.quote, pageText(s.url, log)))) {
          const hint = closestSentence(quoted[0].quote, pageText(quoted[0].url, log), String(c.statement ?? ""));
          problem = `the quote isn't on ${shortUrl(quoted[0].url)}; copy the words exactly as the page has them`;
          // Give the agent the page's own wording so it can fix the quote (or the claim) in one round.
          if (hint) problem += `; closest sentence on the page: "${hint.replace(/"/g, "'").slice(0, 300)}"`;
        }
        if (problem) {
          c.label = "uncertain";
          reasons.push(`Claim ${c.id}: ${problem}. Downgraded to uncertain.`);
        }
      }
      if (sources.length === 0 && c.label !== "uncertain") c.label = "uncertain";
      if (sources.length === 0) c.unsourced = true;
    }
  }

  // 4. Writing rule (lib/style.ts) and structural evidence checks; both hold the guide back.
  const style = [...findStyleIssues(g).map(formatStyleIssue), ...structuralIssues(g, log)];

  // 5. Schema and rubric.
  const result = validateGuideJson(`store/${ctx.slug}.json`, g);
  if (result.errors.length > 0) {
    return { status: "requester_only", guide: g, reasons: [...reasons, ...result.errors, ...style] };
  }
  const guide = result.guide as Guide;
  if (style.length > 0) return { status: "requester_only", guide, reasons: [...reasons, ...style] };

  // 6. Publish bar.
  const verified = guide.claims.filter((c) => c.label === "verified").length;
  const share = verified / guide.claims.length;
  if (share < PUBLISH_MIN_VERIFIED_SHARE) {
    return {
      status: "requester_only",
      guide,
      reasons: [...reasons, `Only ${verified} of ${guide.claims.length} claims are verified from pages read this run (need ${PUBLISH_MIN_VERIFIED_SHARE * 100}%).`],
    };
  }
  return { status: "publish", guide, reasons };
}

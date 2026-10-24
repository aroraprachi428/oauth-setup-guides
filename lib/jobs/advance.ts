import type { Transport } from "../agent/fetch";
import { applyGates } from "../agent/gates";
import type { ModelAdapter } from "../agent/model";
import { DEFAULT_LIMITS, newRunState, runChunk, type RunLimits, type RunState } from "../agent/runner";
import type { SearchAdapter } from "../agent/search";
import type { Store } from "../store/types";
import type { Archive } from "./archive";

// Runs one chunk of one job. Called repeatedly (each call fits in one serverless invocation)
// until the job publishes, is held back for the requester, or fails.

export const LEASE_MS = 290_000; // just under Vercel Hobby's 300 s function limit
export const RECHECK_REPORT_WINDOW_MS = 30 * 24 * 3600_000;
const BACKOFF_MS = [30_000, 60_000, 120_000];
const LONG_WAIT_MS = 10 * 60_000;
// A chunk the host killed (its lease ran out while still running) restarts from the last saved
// state. After this many, the job fails instead of spending model quota on the same step forever.
const MAX_KILLED_CHUNKS = 3;

export type AdvanceDeps = {
  store: Store;
  /** Models to try in order; when one's daily free allowance runs out, the next takes over. */
  models?: ModelAdapter[];
  /** Single-model shorthand (tests, demo). */
  model?: ModelAdapter;
  transport?: Transport;
  search: SearchAdapter | null;
  limits?: RunLimits;
  now?: () => Date;
  maxActive?: number;
  /** Optional file copies of published guides and finished runs. */
  archive?: Archive;
};

export type AdvanceStatus = "idle" | "busy" | "continue" | "waiting" | "published" | "requester_only" | "failed";
export type JobResult = {
  outcome: "published" | "requester_only" | "incomplete" | "error";
  reasons: string[];
  guide?: unknown;
};

type JobState = { run: RunState; reportIds: string[]; rateLimitRetries: number; model?: string };

// After this many short rate limits in a row, treat the model as used up for the day.
const MAX_SHORT_RETRIES = 3;
const exhaustedKey = (model: string) => `model-exhausted:${model}`;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const nextUtcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();

// Fields code rewrites on every run; ignored when deciding whether a re-check changed anything.
function comparable(guide: any): string {
  const g = structuredClone(guide);
  delete g.lastVerified;
  delete g.generator;
  for (const c of g.claims ?? []) for (const s of c.sources ?? []) delete s.retrievedAt;
  return JSON.stringify(g);
}

export async function advanceJob(jobId: string | null, deps: AdvanceDeps): Promise<{ jobId: string | null; status: AdvanceStatus }> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const leaseUntil = new Date(now().getTime() + LEASE_MS).toISOString();
  const before = jobId ? await store.getJob(jobId) : null;
  const job = jobId ? await store.leaseJob(jobId, leaseUntil) : await store.leaseNextJob(leaseUntil, deps.maxActive ?? 2);
  if (!job) return { jobId, status: jobId ? "busy" : "idle" };
  const wasKilled = before?.status === "running" && before.leaseUntil !== null && before.leaseUntil <= now().toISOString();

  let js = job.state as JobState | null;
  const saveRun = async (name: string, run: RunState | undefined, extra: Record<string, unknown>) => {
    if (!deps.archive || !run) return;
    const events = (await store.getJob(job.id))?.events ?? [];
    await deps.archive.saveRun(name, { jobId: job.id, slug: job.slug, appName: job.appName, kind: job.kind, ...extra, events, run });
  };
  const finish = async (status: "done" | "failed", result: JobResult, outcome: AdvanceStatus) => {
    await store.finishJob(job.id, status, result);
    await saveRun(`${job.slug}-${job.id}`, js?.run, { model: js?.model, status, result });
    return { jobId: job.id, status: outcome };
  };

  try {
    if (wasKilled) {
      const killed = await store.incrementCounter(`killed-chunks:${job.id}`, utcDay(now()));
      if (killed >= MAX_KILLED_CHUNKS) {
        await store.appendEvent(job.id, "Stopped: a step kept running out of time");
        return finish("failed", { outcome: "incomplete", reasons: ["a step kept running out of time"], guide: js?.run.draft }, "failed");
      }
      await store.appendEvent(job.id, "The last step ran out of time; retrying it");
    }

    const models = deps.models ?? (deps.model ? [deps.model] : []);
    const usedUp = async (name: string) => (await store.getCounter(exhaustedKey(name), utcDay(now()))) > 0;
    const firstAvailable = async (skip?: string) => {
      for (const m of models) if (m.name !== skip && !(await usedUp(m.name))) return m;
      return null;
    };
    const freshRun = async (): Promise<Pick<JobState, "run" | "reportIds">> => {
      if (job.kind !== "recheck") return { run: newRunState("add", job.appName, job.slug), reportIds: [] };
      const current = await store.getGuide(job.slug);
      if (!current) throw new Error("No published guide to re-check.");
      const since = new Date(now().getTime() - RECHECK_REPORT_WINDOW_MS).toISOString();
      const reports = await store.openReports(job.slug, since);
      return {
        run: newRunState("recheck", job.appName, job.slug, {
          previousGuide: current.guide,
          reports: reports.map((r) => ({ target: r.target, type: r.type, detail: r.detail })),
        }),
        reportIds: reports.map((r) => r.id),
      };
    };
    const waitForTomorrow = async (state: JobState) => {
      await store.saveJobState(job.id, state);
      await store.requeueJob(job.id, nextUtcMidnight(now()));
      await store.appendEvent(job.id, "All free models have used up today's requests; continuing tomorrow (UTC)");
      return { jobId: job.id, status: "waiting" as const };
    };

    if (!js) {
      if (job.kind === "recheck" && !(await store.getGuide(job.slug))) {
        return finish("failed", { outcome: "error", reasons: ["No published guide to re-check."] }, "failed");
      }
      js = { ...(await freshRun()), rateLimitRetries: 0 };
      await store.appendEvent(job.id, job.kind === "recheck" ? "Re-checking reported parts of the guide" : `Started researching ${job.appName}`);
    }

    // One model per run: Gemini replies carry model-specific signatures, so a run can't switch midway.
    let model = models.find((m) => m.name === js!.model && models.length > 0) ?? null;
    if (!model || (await usedUp(model.name))) {
      const next = await firstAvailable();
      if (!next) return waitForTomorrow(js);
      if (js.model && js.model !== next.name && js.run.turns > 0) js = { ...js, ...(await freshRun()) };
      model = next;
      js.model = next.name;
    }

    let out = await runChunk(js.run, {
      model,
      transport: deps.transport,
      search: deps.search,
      onEvent: (m) => store.appendEvent(job.id, m),
      now: () => now().getTime(),
    }, deps.limits ?? DEFAULT_LIMITS);
    js = { ...js, run: out.state };

    if (out.outcome === "continue") {
      await store.saveJobState(job.id, js);
      return { jobId: job.id, status: "continue" };
    }

    const gateCtx = { slug: job.slug, model: model.name, jobId: job.id, today: now().toISOString().slice(0, 10) };

    if (out.outcome === "rate_limited" && (out.daily || js.rateLimitRetries + 1 >= MAX_SHORT_RETRIES)) {
      await store.incrementCounter(exhaustedKey(model.name), utcDay(now()));
      // A draft that already passes the gates is submitted rather than thrown away by a restart.
      const g = applyGates(out.state.draft, out.state.fetchLog, gateCtx);
      if (g.status === "publish" && g.reasons.length === 0) {
        await store.appendEvent(job.id, `${model.name} has used up today's free requests; submitting the finished draft`);
        out = { state: { ...out.state, submitted: structuredClone(out.state.draft) }, outcome: "submitted" };
        js = { ...js, run: out.state };
      }
    }

    if (out.outcome === "rate_limited") {
      if (out.daily || js.rateLimitRetries + 1 >= MAX_SHORT_RETRIES) {
        const next = await firstAvailable(model.name);
        if (!next) return waitForTomorrow({ ...js, rateLimitRetries: 0 });
        const restart = out.state.turns > 0;
        if (restart) await saveRun(`${job.slug}-${job.id}-${model.name}`, out.state, { model: model.name, status: "restarted" });
        js = { ...js, ...(restart ? await freshRun() : {}), model: next.name, rateLimitRetries: 0 };
        await store.saveJobState(job.id, js);
        await store.requeueJob(job.id, now().toISOString());
        await store.appendEvent(
          job.id,
          `${model.name} has used up today's free requests; switching to ${next.name}${restart ? " and restarting the research" : ""}`,
        );
        return { jobId: job.id, status: "waiting" };
      }
      const wait = Math.max(out.retryAfterMs ?? 0, BACKOFF_MS[js.rateLimitRetries] ?? LONG_WAIT_MS);
      js.rateLimitRetries++;
      await store.saveJobState(job.id, js);
      await store.requeueJob(job.id, new Date(now().getTime() + wait).toISOString());
      await store.appendEvent(job.id, `Waiting ${Math.round(wait / 1000)} s before retrying the model`);
      return { jobId: job.id, status: "waiting" };
    }

    if (out.outcome === "limit") {
      await store.appendEvent(job.id, `Stopped: ${out.state.limitReason}`);
      return finish("failed", { outcome: "incomplete", reasons: [out.state.limitReason ?? "limit reached"], guide: out.state.draft }, "failed");
    }

    // Submitted: the gates decide.
    const gated = applyGates(out.state.submitted, out.state.fetchLog, gateCtx);
    if (gated.status === "requester_only") {
      await store.appendEvent(job.id, "Finished, but the guide didn't meet the bar for the gallery");
      return finish("done", { outcome: "requester_only", reasons: gated.reasons, guide: gated.guide }, "requester_only");
    }

    const previous = job.kind === "recheck" ? await store.getGuide(job.slug) : null;
    if (previous && comparable(previous.guide) === comparable(gated.guide)) {
      await store.touchChecked(job.slug);
      await store.appendEvent(job.id, "Re-check found no changes");
    } else {
      await store.saveGuide(job.slug, gated.guide, model.name, job.kind === "recheck" ? "report_recheck" : "add");
      await deps.archive?.saveGuide(job.slug, gated.guide);
      await store.appendEvent(job.id, job.kind === "recheck" ? "Updated the guide" : "Published to the gallery");
    }
    await store.resolveReports(js.reportIds);
    return finish("done", { outcome: "published", reasons: gated.reasons }, "published");
  } catch (e) {
    await store.appendEvent(job.id, "Something went wrong; the run stopped");
    return finish("failed", { outcome: "error", reasons: [(e as Error).message] }, "failed");
  }
}

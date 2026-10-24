import { beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { call, fakeModel, type FakeStep } from "./fakes/fake-model";
import { advanceJob } from "../lib/jobs/advance";
import { RateLimitError } from "../lib/agent/model";
import { createSqliteStore } from "../lib/store/sqlite";
import type { TransportResponse } from "../lib/agent/fetch";
import type { Store } from "../lib/store/types";
import { pageHtml, urlsToRead, withQuotes } from "./fakes/evidence";

const page = (): TransportResponse => ({
  status: 200,
  headers: { "content-type": "text/html" },
  body: pageHtml(),
  truncated: false,
});
const transport = async (u: URL): Promise<TransportResponse> =>
  u.pathname === "/robots.txt" ? { status: 404, headers: {}, body: "", truncated: false } : page();

// Every page the fixture cites or links to, plus a Stage 2 page; claims carry quotes from them.
const SOURCE_URLS = urlsToRead();
const { slug: _slug, ...body } = withQuotes(fixture) as any;

// A full, honest run: read every source the fixture cites, draft it, submit.
const goodRun = (draft: object = body): FakeStep[] => [
  { toolCalls: SOURCE_URLS.map((url) => call("fetch", { url })) },
  { toolCalls: [call("set_draft", { fields: draft })] },
  { toolCalls: [call("submit_guide")] },
];

let clock: Date;
let store: Store;
const deps = (steps: FakeStep[]) => ({ store, model: fakeModel(steps), transport, search: null, now: () => clock });

beforeEach(async () => {
  clock = new Date("2026-10-24T10:00:00Z");
  store = createSqliteStore(":memory:", { now: () => clock });
  await store.migrate();
});

describe("advanceJob", () => {
  it("publishes a passing guide to the gallery and finishes the job", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const r = await advanceJob(job.id, deps(goodRun()));
    expect(r.status).toBe("published");
    const saved = await store.getGuide("sample-guide");
    expect(saved?.model).toBe("fake-model");
    expect((saved?.guide as any).source).toBe("generated");
    const done = await store.getJob(job.id);
    expect(done?.status).toBe("done");
    expect(done?.resultJson).toMatchObject({ outcome: "published" });
    expect(done?.events.some((e) => /Reading/.test(e.message))).toBe(true);
  });

  it("keeps a weak guide out of the gallery but returns it to the requester", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const lazy: FakeStep[] = [{ toolCalls: [call("set_draft", { fields: body })] }, { toolCalls: [call("submit_guide")] }];
    const r = await advanceJob(job.id, deps(lazy));
    expect(r.status).toBe("requester_only");
    expect(await store.getGuide("sample-guide")).toBeNull();
    const done = await store.getJob(job.id);
    expect(done?.resultJson).toMatchObject({ outcome: "requester_only", guide: { app: { name: fixture.app.name } } });
    expect((done?.resultJson as any).reasons.join()).toMatch(/no official page was read in full/);
  });

  it("saves state between chunks and resumes", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const slow: FakeStep[] = [
      () => {
        clock = new Date(clock.getTime() + 3 * 60_000); // past chunkMs, but tools still have time
        return { toolCalls: SOURCE_URLS.map((url) => call("fetch", { url })) };
      },
      { toolCalls: [call("set_draft", { fields: body })] },
      { toolCalls: [call("submit_guide")] },
    ];
    const d = deps(slow);
    expect((await advanceJob(job.id, d)).status).toBe("continue");
    expect((await store.getJob(job.id))?.state).not.toBeNull();
    expect((await advanceJob(job.id, d)).status).toBe("published");
  });

  it("backs off on rate limits, keeping progress", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const steps: FakeStep[] = [{ toolCalls: [call("set_draft", { fields: { oauthSupport: "public" } })] }, new RateLimitError("429", null)];
    const r = await advanceJob(job.id, deps(steps));
    expect(r.status).toBe("waiting");
    const j = await store.getJob(job.id);
    expect(j?.status).toBe("queued");
    expect(j?.nextAttemptAt).toBe(new Date(clock.getTime() + 30_000).toISOString());
    expect((j?.state as any).run.draft).toMatchObject({ oauthSupport: "public" });
  });

  describe("model fallback", () => {
    const named = (name: string, steps: FakeStep[]) => fakeModel(steps, name);
    const daily = () => new RateLimitError("429 per day", 33_000_000, true);

    it("switches to the next model before the run starts, without waiting", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const models = [named("flash", [daily()]), named("flash-lite", goodRun())];
      const d = { store, models, transport, search: null, now: () => clock };
      expect((await advanceJob(job.id, d)).status).toBe("waiting");
      const j = await store.getJob(job.id);
      expect(j?.nextAttemptAt).toBe(clock.toISOString()); // ready again at once
      expect(j?.events.at(-1)?.message).toMatch(/flash.*used up.*switching to flash-lite/i);
      expect((await advanceJob(job.id, d)).status).toBe("published");
      expect((await store.getGuide("sample-guide"))?.model).toBe("flash-lite");
    });

    it("restarts with the next model when the quota runs out mid-run", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const first = named("flash", [{ toolCalls: [call("set_draft", { fields: { oauthSupport: "public" } })] }, daily()]);
      const d = { store, models: [first, named("flash-lite", goodRun())], transport, search: null, now: () => clock };
      expect((await advanceJob(job.id, d)).status).toBe("waiting");
      expect(((await store.getJob(job.id))?.state as any).run.turns).toBe(0); // fresh run for the new model
      expect((await advanceJob(job.id, d)).status).toBe("published");
    });

    it("publishes a passing draft at once, so a later quota error never costs a restart", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const [read, draft] = goodRun();
      const first = named("flash", [read, draft, daily()]);
      const lite = named("flash-lite", []); // would throw if called
      const d = { store, models: [first, lite], transport, search: null, now: () => clock };
      expect((await advanceJob(job.id, d)).status).toBe("published");
      expect((await store.getGuide("sample-guide"))?.model).toBe("flash");
      expect(first.seen).toHaveLength(2); // no submit_guide request, and the quota error is never reached
      expect(lite.seen).toHaveLength(0);
      expect((await store.getJob(job.id))?.events.map((e) => e.message)).toContain("Submitting the guide");
    });

    it("skips models already used up today on later jobs", async () => {
      const a = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const flash = named("flash", [daily()]);
      await advanceJob(a.job.id, { store, models: [flash, named("flash-lite", goodRun())], transport, search: null, now: () => clock });
      await store.finishJob(a.job.id, "failed");
      const b = await store.createOrJoinJob("other-app", "add", "Other");
      const flash2 = named("flash", []); // would throw "ran out of scripted steps" if called
      const lite = named("flash-lite", goodRun());
      await advanceJob(b.job.id, { store, models: [flash2, lite], transport, search: null, now: () => clock });
      expect(lite.seen.length).toBeGreaterThan(0);
      expect(flash2.seen).toHaveLength(0);
    });

    it("waits until tomorrow when every model is used up", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const d = { store, models: [named("flash", [daily()]), named("flash-lite", [daily()])], transport, search: null, now: () => clock };
      await advanceJob(job.id, d);
      expect((await advanceJob(job.id, d)).status).toBe("waiting");
      const j = await store.getJob(job.id);
      expect(j?.nextAttemptAt).toBe("2026-10-25T00:00:00.000Z");
      expect(j?.events.at(-1)?.message).toMatch(/all free models.*tomorrow/i);
    });

    it("treats repeated short rate limits as a used-up day after 3 tries", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const busy = () => new RateLimitError("503", null, false);
      const d = { store, models: [named("flash", Array.from({ length: 6 }, busy)), named("flash-lite", goodRun())], transport, search: null, now: () => clock };
      for (let i = 0; i < 3; i++) {
        expect((await advanceJob(job.id, d)).status).toBe("waiting");
        clock = new Date(clock.getTime() + 11 * 60_000);
      }
      expect((await store.getJob(job.id))?.events.at(-1)?.message).toMatch(/switching to flash-lite/i);
    });
  });

  describe("archive", () => {
    const fileArchive = () => {
      const guides: Record<string, unknown> = {};
      const runs: Record<string, any> = {};
      return { guides, runs, saveGuide: async (slug: string, g: unknown) => void (guides[slug] = g), saveRun: async (n: string, r: unknown) => void (runs[n] = r) };
    };

    it("writes the published guide and the full run", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const archive = fileArchive();
      await advanceJob(job.id, { ...deps(goodRun()), archive });
      expect(archive.guides["sample-guide"]).toEqual((await store.getGuide("sample-guide"))?.guide);
      const run = archive.runs[`sample-guide-${job.id}`];
      expect(run).toMatchObject({ status: "done", result: { outcome: "published" } });
      expect(run.run.messages.length).toBeGreaterThan(0);
      expect(run.run.fetchLog.length).toBeGreaterThan(0);
      expect(run.events.at(-1).message).toMatch(/published/i);
    });

    it("keeps the abandoned run when a model switch restarts the research", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const archive = fileArchive();
      const first = fakeModel([{ toolCalls: [call("set_draft", { fields: { oauthSupport: "public" } })] }, new RateLimitError("429 per day", null, true)], "flash");
      await advanceJob(job.id, { store, models: [first, fakeModel(goodRun(), "flash-lite")], transport, search: null, now: () => clock, archive });
      expect(archive.runs[`sample-guide-${job.id}-flash`]).toMatchObject({ status: "restarted", run: { draft: { oauthSupport: "public" } } });
    });

    it("writes failed runs too", async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      const archive = fileArchive();
      await advanceJob(job.id, { ...deps([{ toolCalls: [call("set_draft", { fields: { oauthSupport: "public" } })] }, new Error("provider exploded")]), archive });
      expect(archive.runs[`sample-guide-${job.id}`]).toMatchObject({ status: "failed", result: { outcome: "error" } });
    });
  });

  it("marks a run that hits its limits as incomplete", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const loop: FakeStep[] = Array.from({ length: 5 }, () => ({ toolCalls: [call("validate_draft")] }));
    const r = await advanceJob(job.id, { ...deps(loop), limits: { maxMs: 60 * 60_000, chunkMs: 60 * 60_000, maxFetches: 80, maxTokens: 1e9, maxTurns: 3 } });
    expect(r.status).toBe("failed");
    expect((await store.getJob(job.id))?.resultJson).toMatchObject({ outcome: "incomplete" });
  });

  it("records a crash as failed instead of throwing", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const r = await advanceJob(job.id, deps([new Error("provider exploded")]));
    expect(r.status).toBe("failed");
    expect((await store.getJob(job.id))?.resultJson).toMatchObject({ outcome: "error" });
  });

  it("retries a chunk the host killed, then fails the job if it keeps happening", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    // Simulate a host kill: the job is leased, and the lease runs out without the chunk finishing.
    const kill = async () => {
      await store.leaseJob(job.id, new Date(clock.getTime() + 1000).toISOString());
      clock = new Date(clock.getTime() + 2000);
    };
    // Each retry here ends at once on a rate limit, which requeues the job for the next kill.
    for (let i = 0; i < 2; i++) {
      await kill();
      expect((await advanceJob(job.id, deps([new RateLimitError("429", null)]))).status).toBe("waiting");
      await store.requeueJob(job.id);
    }
    expect((await store.getJob(job.id))?.events.map((e) => e.message)).toContain("The last step ran out of time; retrying it");
    await kill();
    const r = await advanceJob(job.id, deps([]));
    expect(r.status).toBe("failed");
    expect((await store.getJob(job.id))?.resultJson).toMatchObject({ outcome: "incomplete", reasons: ["a step kept running out of time"] });
  });

  it("doesn't count a normal chunk hand-off as a kill", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    const slow: FakeStep[] = [
      () => {
        clock = new Date(clock.getTime() + 3 * 60_000);
        return { toolCalls: [call("validate_draft")] };
      },
      { toolCalls: [call("submit_guide")] },
    ];
    const d = deps(slow);
    expect((await advanceJob(job.id, d)).status).toBe("continue");
    clock = new Date(clock.getTime() + 10 * 60_000);
    await advanceJob(job.id, d);
    expect((await store.getJob(job.id))?.events.map((e) => e.message)).not.toContain("The last step ran out of time; retrying it");
  });

  it("returns busy when the job is leased elsewhere, idle when nothing is queued", async () => {
    const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
    await store.leaseJob(job.id, new Date(clock.getTime() + 60_000).toISOString());
    expect((await advanceJob(job.id, deps([]))).status).toBe("busy");
    expect((await advanceJob(null, deps([]))).status).toBe("idle");
  });

  describe("recheck", () => {
    const published = async () => {
      const { job } = await store.createOrJoinJob("sample-guide", "add", "Sample Provider");
      await advanceJob(job.id, deps(goodRun()));
      await store.finishJob(job.id, "done");
    };
    const report = (visitorHash: string) =>
      store.addReport({ slug: "sample-guide", target: "create-app", type: "label_different", detail: "Button renamed", minutesTaken: null, visitorHash });

    it("replaces the guide when the re-check changes it, and resolves the reports", async () => {
      await published();
      await report("v1");
      await report("v2");
      const { job } = await store.createOrJoinJob("sample-guide", "recheck", "Sample Provider");
      const changed = { ...body, nuances: [...body.nuances, { id: "new-note", text: "Fixture: button renamed.", claimIds: ["c-create"] }] };
      expect((await advanceJob(job.id, deps(goodRun(changed)))).status).toBe("published");
      expect((await store.getGuide("sample-guide"))?.guide).toMatchObject({ nuances: expect.arrayContaining([expect.objectContaining({ id: "new-note" })]) });
      expect(await (store as any).historyFor("sample-guide")).toHaveLength(1);
      expect(await store.openReports("sample-guide", "1970-01-01T00:00:00Z")).toHaveLength(0);
    });

    it("only updates the checked date when nothing changed", async () => {
      await published();
      await report("v1");
      clock = new Date(clock.getTime() + 24 * 3600_000);
      const { job } = await store.createOrJoinJob("sample-guide", "recheck", "Sample Provider");
      await advanceJob(job.id, deps(goodRun()));
      expect(await (store as any).historyFor("sample-guide")).toHaveLength(0);
      expect((await store.getGuide("sample-guide"))?.lastChecked).toBe(clock.toISOString());
    });

    it("keeps the published guide when the re-check misses the bar", async () => {
      await published();
      await report("v1");
      const { job } = await store.createOrJoinJob("sample-guide", "recheck", "Sample Provider");
      const lazy: FakeStep[] = [{ toolCalls: [call("submit_guide")] }]; // re-checked nothing
      expect((await advanceJob(job.id, deps(lazy))).status).toBe("requester_only");
      expect(await (store as any).historyFor("sample-guide")).toHaveLength(0);
      expect(await store.openReports("sample-guide", "1970-01-01T00:00:00Z")).toHaveLength(1);
    });
  });
});

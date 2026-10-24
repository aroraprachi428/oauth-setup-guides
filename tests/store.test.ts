import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteStore } from "../lib/store/sqlite";
import type { Store } from "../lib/store/types";

let clock = new Date("2026-10-23T10:00:00Z");
const tick = (ms = 1000) => (clock = new Date(clock.getTime() + ms));
let store: Store;

beforeEach(async () => {
  clock = new Date("2026-10-23T10:00:00Z");
  store = createSqliteStore(":memory:", { now: () => clock });
  await store.migrate();
});

describe("guides", () => {
  it("saves, reads and lists published guides", async () => {
    await store.saveGuide("calendly", { slug: "calendly" }, "free-model");
    expect((await store.getGuide("calendly"))?.guide).toEqual({ slug: "calendly" });
    expect((await store.listPublished()).map((g) => g.slug)).toEqual(["calendly"]);
    expect(await store.getGuide("missing")).toBeNull();
  });

  it("moves the previous version to history on resave", async () => {
    await store.saveGuide("calendly", { v: 1 }, "m");
    tick();
    await store.saveGuide("calendly", { v: 2 }, "m", "report_recheck");
    expect((await store.getGuide("calendly"))?.guide).toEqual({ v: 2 });
    const history = await (store as any).historyFor("calendly");
    expect(history).toHaveLength(1);
    expect(history[0].guide).toEqual({ v: 1 });
    expect(history[0].reason).toBe("report_recheck");
  });

  it("updates last checked", async () => {
    await store.saveGuide("calendly", {}, "m");
    tick(60_000);
    await store.touchChecked("calendly");
    expect((await store.getGuide("calendly"))?.lastChecked).toBe(clock.toISOString());
  });
});

describe("jobs", () => {
  it("joins an existing queued or running job instead of duplicating", async () => {
    const a = await store.createOrJoinJob("calendly", "add");
    const b = await store.createOrJoinJob("calendly", "add");
    expect(a.joined).toBe(false);
    expect(b.joined).toBe(true);
    expect(b.job.id).toBe(a.job.id);
  });

  it("starts a new job once the old one has finished", async () => {
    const a = await store.createOrJoinJob("calendly", "add");
    await store.finishJob(a.job.id, "failed");
    const b = await store.createOrJoinJob("calendly", "add");
    expect(b.joined).toBe(false);
    expect(b.job.id).not.toBe(a.job.id);
  });

  it("leases add jobs before recheck jobs, oldest first", async () => {
    const r = await store.createOrJoinJob("old-app", "recheck");
    tick();
    const a1 = await store.createOrJoinJob("app-one", "add");
    tick();
    const a2 = await store.createOrJoinJob("app-two", "add");
    expect((await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10))?.id).toBe(a1.job.id);
    expect((await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10))?.id).toBe(a2.job.id);
    expect((await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10))?.id).toBe(r.job.id);
    expect(await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10)).toBeNull();
  });

  it("reports queue position", async () => {
    const a = await store.createOrJoinJob("app-one", "add");
    tick();
    const b = await store.createOrJoinJob("app-two", "add");
    expect(await store.queuePosition(a.job.id)).toBe(1);
    expect(await store.queuePosition(b.job.id)).toBe(2);
    await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10);
    expect(await store.queuePosition(a.job.id)).toBe(0);
    expect(await store.queuePosition(b.job.id)).toBe(1);
  });

  it("records events, results and requeues", async () => {
    const { job } = await store.createOrJoinJob("calendly", "add");
    await store.appendEvent(job.id, "Reading OAuth docs");
    await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 10);
    await store.requeueJob(job.id);
    expect((await store.getJob(job.id))?.status).toBe("queued");
    await store.finishJob(job.id, "failed", { partial: true });
    const done = await store.getJob(job.id);
    expect(done?.events.map((e) => e.message)).toEqual(["Reading OAuth docs"]);
    expect(done?.resultJson).toEqual({ partial: true });
    expect(done?.status).toBe("failed");
  });
});

describe("job leases and state", () => {
  it("leases a job once, and again only after the lease expires", async () => {
    const { job } = await store.createOrJoinJob("calendly", "add", "Calendly");
    const until = (ms: number) => new Date(clock.getTime() + ms).toISOString();
    expect((await store.leaseJob(job.id, until(60_000)))?.appName).toBe("Calendly");
    expect(await store.leaseJob(job.id, until(60_000))).toBeNull(); // still leased
    tick(61_000);
    expect(await store.leaseJob(job.id, until(60_000))).not.toBeNull();
  });

  it("saves state and releases the lease", async () => {
    const { job } = await store.createOrJoinJob("calendly", "add", "Calendly");
    await store.leaseJob(job.id, new Date(clock.getTime() + 60_000).toISOString());
    await store.saveJobState(job.id, { step: 3 });
    const j = await store.getJob(job.id);
    expect(j?.state).toEqual({ step: 3 });
    expect(await store.leaseJob(job.id, new Date(clock.getTime() + 60_000).toISOString())).not.toBeNull();
  });

  it("delays a requeued job until its retry time", async () => {
    const { job } = await store.createOrJoinJob("calendly", "add", "Calendly");
    await store.requeueJob(job.id, new Date(clock.getTime() + 30_000).toISOString());
    expect(await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 5)).toBeNull();
    tick(31_000);
    expect((await store.leaseNextJob(new Date(clock.getTime() + 60_000).toISOString(), 5))?.id).toBe(job.id);
  });

  it("caps how many jobs run at once", async () => {
    await store.createOrJoinJob("a", "add", "A");
    await store.createOrJoinJob("b", "add", "B");
    const until = new Date(clock.getTime() + 60_000).toISOString();
    expect(await store.leaseNextJob(until, 1)).not.toBeNull();
    expect(await store.leaseNextJob(until, 1)).toBeNull();
  });
});

describe("reports", () => {
  const base = { slug: "calendly", target: "verdict", type: "took_longer" as const, detail: null, minutesTaken: 60, visitorHash: "v1" };

  it("stores reports and filters open ones by date", async () => {
    const r1 = await store.addReport(base);
    tick(10 * 24 * 3600 * 1000);
    const since = clock.toISOString();
    const r2 = await store.addReport({ ...base, visitorHash: "v2" });
    expect((await store.openReports("calendly", "1970-01-01T00:00:00Z")).map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect((await store.openReports("calendly", since)).map((r) => r.id)).toEqual([r2.id]);
    await store.resolveReports([r1.id]);
    expect((await store.openReports("calendly", "1970-01-01T00:00:00Z")).map((r) => r.id)).toEqual([r2.id]);
  });
});

describe("counters", () => {
  it("counts per key and day", async () => {
    expect(await store.incrementCounter("add:v1", "2026-10-23")).toBe(1);
    expect(await store.incrementCounter("add:v1", "2026-10-23")).toBe(2);
    expect(await store.getCounter("add:v1", "2026-10-24")).toBe(0);
    expect(await store.incrementCounter("add:v1", "2026-10-24")).toBe(1);
  });
});

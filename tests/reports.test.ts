import { beforeEach, describe, expect, it } from "vitest";
import { experienceSummary, submitReport } from "../lib/reports";
import { createSqliteStore } from "../lib/store/sqlite";
import type { Report, Store } from "../lib/store/types";

let store: Store;
let now: Date;
const limits = { addPerVisitor: 3, reportsPerVisitor: 5, runsPerDay: 50 };
const base = (over: Partial<Parameters<typeof submitReport>[0]> = {}) => ({
  store,
  slug: "calendly",
  appName: "Calendly",
  isCurated: false,
  target: "create-app",
  type: "label_different",
  detail: "Button is now called New app",
  minutesTaken: null,
  visitor: "v1",
  limits,
  now,
  ...over,
});

beforeEach(async () => {
  now = new Date("2026-10-24T10:00:00Z");
  store = createSqliteStore(":memory:", { now: () => now });
  await store.migrate();
});

describe("submitReport", () => {
  it("stores a report without touching the guide", async () => {
    await store.saveGuide("calendly", { v: 1 }, "m");
    expect((await submitReport(base())).status).toBe("recorded");
    expect((await store.getGuide("calendly"))?.guide).toEqual({ v: 1 });
    expect(await store.openReports("calendly", "1970-01-01T00:00:00Z")).toHaveLength(1);
  });

  it("queues exactly one re-check once 2 reports arrive within 30 days", async () => {
    expect((await submitReport(base())).status).toBe("recorded");
    const second = await submitReport(base({ visitor: "v2" }));
    expect(second).toMatchObject({ status: "recheck_queued" });
    const third = await submitReport(base({ visitor: "v3", target: "verdict" }));
    expect(third).toMatchObject({ status: "recorded" }); // re-check already queued
    expect((await store.findActiveJob("calendly", "recheck"))?.id).toBe((second as any).jobId);
  });

  it("doesn't count reports older than 30 days toward the trigger", async () => {
    await submitReport(base());
    now = new Date(now.getTime() + 31 * 24 * 3600_000);
    expect((await submitReport(base({ visitor: "v2" }))).status).toBe("recorded");
  });

  it("never queues a re-check for a curated guide", async () => {
    await submitReport(base({ slug: "dropbox", isCurated: true }));
    expect((await submitReport(base({ slug: "dropbox", isCurated: true, visitor: "v2" }))).status).toBe("recorded");
    expect(await store.findActiveJob("dropbox", "recheck")).toBeNull();
  });

  it("ignores a duplicate from the same visitor on the same step", async () => {
    await submitReport(base());
    expect((await submitReport(base())).status).toBe("duplicate");
    expect(await store.openReports("calendly", "1970-01-01T00:00:00Z")).toHaveLength(1);
  });

  it("validates input and rate-limits per visitor", async () => {
    expect((await submitReport(base({ type: "hack" }))).status).toBe("invalid");
    expect((await submitReport(base({ target: "../../etc" }))).status).toBe("invalid");
    expect((await submitReport(base({ detail: "x".repeat(1001) }))).status).toBe("invalid");
    expect((await submitReport(base({ type: "took_longer", minutesTaken: -5 }))).status).toBe("invalid");
    for (let i = 0; i < 5; i++) await submitReport(base({ target: `step-${i}` }));
    expect((await submitReport(base({ target: "step-9" }))).status).toBe("rate_limited");
  });
});

describe("experienceSummary", () => {
  const r = (minutes: number, daysAgo: number, type: Report["type"] = "took_longer"): Report => ({
    id: String(Math.random()),
    slug: "calendly",
    target: "verdict",
    type,
    detail: null,
    minutesTaken: minutes,
    visitorHash: "v",
    createdAt: new Date(now.getTime() - daysAgo * 24 * 3600_000).toISOString(),
    status: "open",
  });

  it("needs at least 3 agreeing reports", () => {
    expect(experienceSummary([r(60, 1), r(120, 2)], now)).toBeNull();
    expect(experienceSummary([r(60, 1), r(120, 2), r(4320, 3)], now)).toEqual({ count: 3, minMinutes: 60, maxMinutes: 4320 });
  });

  it("ignores reports older than 6 months and other report types", () => {
    expect(experienceSummary([r(60, 1), r(120, 2), r(90, 200)], now)).toBeNull();
    expect(experienceSummary([r(60, 1), r(120, 2), r(90, 3, "got_error")], now)).toBeNull();
  });
});

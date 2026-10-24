import { beforeEach, describe, expect, it } from "vitest";
import { requestAdd } from "../lib/jobs/add";
import { createSqliteStore } from "../lib/store/sqlite";
import type { Store } from "../lib/store/types";

describe("requestAdd", () => {
  let store: Store;
  const limits = { addPerVisitor: 3, reportsPerVisitor: 5, runsPerDay: 50 };
  const base = () => ({ store, curatedSlugs: ["dropbox"], visitor: "v1", agentConfigured: true, limits });

  beforeEach(async () => {
    store = createSqliteStore(":memory:");
    await store.migrate();
  });

  it("queues a new job for an unknown app", async () => {
    const r = await requestAdd({ ...base(), name: "Calendly" });
    expect(r).toMatchObject({ status: "queued", slug: "calendly", joined: false });
    expect((await store.getJob((r as any).jobId))?.appName).toBe("Calendly");
  });

  it("sends people to an existing curated or generated guide instead", async () => {
    expect(await requestAdd({ ...base(), name: "Dropbox" })).toEqual({ status: "exists", slug: "dropbox" });
    await store.saveGuide("calendly", {}, "m");
    expect(await requestAdd({ ...base(), name: "calendly" })).toEqual({ status: "exists", slug: "calendly" });
  });

  it("joins a run already in progress without using the visitor's quota", async () => {
    const first = await requestAdd({ ...base(), name: "Calendly" });
    for (let i = 0; i < 5; i++) {
      const again = await requestAdd({ ...base(), name: "Calendly", visitor: "v2" });
      expect(again).toMatchObject({ status: "queued", jobId: (first as any).jobId, joined: true });
    }
  });

  it("refuses bad names and the 4th new app in a day", async () => {
    expect(await requestAdd({ ...base(), name: "<script>" })).toMatchObject({ status: "refused", reason: "invalid_name" });
    for (const n of ["A1", "A2", "A3"]) expect((await requestAdd({ ...base(), name: n })).status).toBe("queued");
    expect(await requestAdd({ ...base(), name: "A4" })).toMatchObject({ status: "refused", reason: "visitor_limit" });
  });

  it("says when the agent isn't configured", async () => {
    expect(await requestAdd({ ...base(), name: "Calendly", agentConfigured: false })).toMatchObject({ status: "refused", reason: "unavailable" });
  });
});

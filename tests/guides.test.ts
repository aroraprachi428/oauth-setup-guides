import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { mergeGuides } from "../lib/guides";
import { createSqliteStore } from "../lib/store/sqlite";
import type { Guide } from "../lib/schema";
import type { Store } from "../lib/store/types";

const curated = structuredClone(fixture) as unknown as Guide;
const generated = (slug: string) => ({
  ...structuredClone(fixture),
  slug,
  source: "generated",
  generator: { model: "free-model", jobId: "job-1", generatedAt: "2026-10-23" },
});

let store: Store;
beforeEach(async () => {
  store = createSqliteStore(":memory:");
  await store.migrate();
});

describe("mergeGuides", () => {
  it("returns curated guides alone when there is no store", async () => {
    expect((await mergeGuides([curated], null)).map((g) => g.slug)).toEqual(["sample-guide"]);
  });

  it("adds published generated guides, sorted by app name", async () => {
    await store.saveGuide("calendly", { ...generated("calendly"), app: { ...fixture.app, name: "Calendly" } }, "free-model");
    const slugs = (await mergeGuides([curated], store)).map((g) => g.slug);
    expect(slugs).toEqual(["calendly", "sample-guide"]);
  });

  it("lets a curated guide win over a generated one with the same slug", async () => {
    await store.saveGuide("sample-guide", generated("sample-guide"), "free-model");
    const merged = await mergeGuides([curated], store);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("curated");
  });

  it("skips and logs a stored guide that no longer validates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.saveGuide("broken", { slug: "broken" }, "free-model");
    expect((await mergeGuides([curated], store)).map((g) => g.slug)).toEqual(["sample-guide"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to curated guides when the store fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { listPublished: () => Promise.reject(new Error("db down")) } as unknown as Store;
    expect((await mergeGuides([curated], failing)).map((g) => g.slug)).toEqual(["sample-guide"]);
    warn.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { validateGuideJson } from "../lib/guides";

const FILE = "tests/fixtures/sample-guide.json";
const clone = () => structuredClone(fixture) as any;
const errorsFor = (g: unknown) => validateGuideJson(FILE, g).errors.join("\n");

describe("guide schema", () => {
  it("accepts the fixture", () => {
    expect(validateGuideJson(FILE, fixture).errors).toEqual([]);
  });

  it("rejects verified without a full read of an official page", () => {
    const g = clone();
    g.claims[0].sources[0].read = "snippet";
    expect(errorsFor(g)).toMatch(/verified needs an official source read in full/);

    const h = clone();
    h.claims[0].sources[0].kind = "vendor";
    expect(errorsFor(h)).toMatch(/verified needs an official source/);
  });

  it("allows unsourced only on uncertain claims", () => {
    const g = clone();
    g.claims.at(-1).label = "reported";
    expect(errorsFor(g)).toMatch(/only uncertain claims may be unsourced/);
  });

  it("requires a source unless marked unsourced", () => {
    const g = clone();
    g.claims[3].sources = [];
    expect(errorsFor(g)).toMatch(/needs at least one source/);
  });

  it("requires retrieval dates on sources", () => {
    const g = clone();
    delete g.claims[0].sources[0].retrievedAt;
    expect(errorsFor(g)).toMatch(/retrievedAt/);
  });

  it("rejects quotes of 15 words or more", () => {
    const g = clone();
    g.claims[1].sources[0].quote = Array(15).fill("word").join(" ");
    expect(errorsFor(g)).toMatch(/under 15 words/);
  });

  it("rejects references to unknown claims", () => {
    const g = clone();
    g.steps[0].claimIds.push("c-missing");
    expect(errorsFor(g)).toMatch(/unknown claim c-missing/);
  });

  it("requires tested claims to say how", () => {
    const g = clone();
    g.claims[0].label = "tested";
    expect(errorsFor(g)).toMatch(/tested needs testedHow/);
  });

  it("requires a Stage 1 done-when check", () => {
    const g = clone();
    delete g.profiles[0].stage1DoneWhen;
    expect(errorsFor(g)).toMatch(/stage1DoneWhen/);
  });

  it("rejects numeric bands and unknown band names", () => {
    const g = clone();
    g.profiles[0].verdict.stage1.band = 3;
    expect(errorsFor(g)).not.toBe("");
    const h = clone();
    h.profiles[0].verdict.stage1.band = "None documented"; // Stage 2 only
    expect(errorsFor(h)).not.toBe("");
  });

  it("requires generator info on generated guides only", () => {
    const g = clone();
    g.source = "generated";
    expect(errorsFor(g)).toMatch(/generated guides need generator/);

    g.generator = { model: "test-model", jobId: "job-1", generatedAt: "2026-10-23" };
    expect(errorsFor(g)).toBe("");

    const h = clone();
    h.generator = { model: "test-model", jobId: "job-1", generatedAt: "2026-10-23" };
    expect(errorsFor(h)).toMatch(/curated guides must not have generator/);
  });

  it("requires the slug to match the file name", () => {
    const g = clone();
    g.slug = "other";
    expect(errorsFor(g)).toMatch(/must match file name/);
  });
});

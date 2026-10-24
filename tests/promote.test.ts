import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { getCuratedGuides } from "../lib/guides";
import { promoteGuide } from "../lib/promote";

const generated = {
  ...structuredClone(fixture),
  source: "generated",
  generator: { model: "free-model", jobId: "job-1", generatedAt: "2026-10-23" },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "promote-"));
});

describe("promoteGuide", () => {
  it("writes a valid generated guide where curated guides are loaded from", () => {
    const r = promoteGuide(generated, dir);
    expect(r).toEqual({ file: path.join(dir, "sample-guide.json"), written: true, errors: [] });
    process.env.GUIDES_DIR = dir;
    try {
      const loaded = getCuratedGuides();
      expect(loaded.map((g) => g.slug)).toEqual(["sample-guide"]);
      expect(loaded[0]).toMatchObject({ source: "generated", generator: { model: "free-model" } });
    } finally {
      delete process.env.GUIDES_DIR;
    }
  });

  it("won't replace an existing file unless forced", () => {
    promoteGuide(generated, dir);
    const again = promoteGuide(generated, dir);
    expect(again.written).toBe(false);
    expect(again.errors[0]).toMatch(/already exists/);
    expect(promoteGuide(generated, dir, { force: true }).written).toBe(true);
  });

  it("refuses a guide that fails validation, and writes nothing", () => {
    const broken = { ...generated, generator: undefined };
    const r = promoteGuide(broken, dir);
    expect(r.written).toBe(false);
    expect(r.errors.join()).toMatch(/generated guides need generator info/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses a guide without a usable slug", () => {
    expect(promoteGuide({ ...generated, slug: "../escape" }, dir).errors).toEqual(["guide has no valid slug"]);
  });
});

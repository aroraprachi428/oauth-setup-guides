import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { createGitHubLibrary, createLocalLibrary, getArchive } from "../lib/jobs/archive";

const generated = {
  ...structuredClone(fixture),
  source: "generated",
  generator: { model: "free-model", jobId: "job-1", generatedAt: "2026-10-23" },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "library-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("local guide library", () => {
  it("writes a published guide into the guides folder", async () => {
    await createLocalLibrary(dir).saveGuide("sample-guide", generated);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "sample-guide.json"), "utf8"));
    expect(saved).toMatchObject({ slug: "sample-guide", source: "generated" });
  });

  it("keeps a guide that would fail validation out of the folder", async () => {
    await createLocalLibrary(dir).saveGuide("sample-guide", { ...generated, generator: undefined });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("GitHub guide library", () => {
  const github = (existingSha?: string) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init?.method) return existingSha ? Response.json({ sha: existingSha }) : new Response("", { status: 404 });
      return Response.json({}, { status: existingSha ? 200 : 201 });
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  };

  it("commits a new guide to content/guides on the branch", async () => {
    const gh = github();
    await createGitHubLibrary({ token: "t", repo: "me/guides", fetch: gh.fetch }).saveGuide("sample-guide", generated);
    const put = gh.calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("https://api.github.com/repos/me/guides/contents/content/guides/sample-guide.json");
    const body = JSON.parse(String(put.init!.body));
    expect(body).toMatchObject({ message: "Add generated guide: sample-guide", branch: "main" });
    expect(body.sha).toBeUndefined();
    expect(JSON.parse(Buffer.from(body.content, "base64").toString())).toMatchObject({ slug: "sample-guide" });
  });

  it("replaces an existing file using its sha", async () => {
    const gh = github("abc123");
    await createGitHubLibrary({ token: "t", repo: "me/guides", branch: "prod", fetch: gh.fetch }).saveGuide("sample-guide", generated);
    expect(gh.calls[0].url).toMatch(/\?ref=prod$/);
    const body = JSON.parse(String(gh.calls[1].init!.body));
    expect(body).toMatchObject({ message: "Update generated guide: sample-guide", sha: "abc123", branch: "prod" });
  });

  it("never throws when GitHub fails", async () => {
    const fetch = (async () => new Response("", { status: 500 })) as typeof globalThis.fetch;
    await expect(createGitHubLibrary({ token: "t", repo: "me/guides", fetch }).saveGuide("sample-guide", generated)).resolves.toBeUndefined();
  });
});

describe("getArchive", () => {
  it("saves nothing in production without GitHub settings", () => {
    expect(getArchive({ NODE_ENV: "production" })).toBeUndefined();
  });

  it("uses the local folder outside production and GitHub when configured", () => {
    expect(getArchive({ NODE_ENV: "development" })).toBeDefined();
    expect(getArchive({ NODE_ENV: "production", GITHUB_TOKEN: "t", GITHUB_REPO: "me/guides" })).toBeDefined();
  });
});

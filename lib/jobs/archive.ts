import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { guidesDir } from "../guides";
import { checkGuideFile, guideFileText } from "../promote";

// Copies of what the store holds, outside the database. Every save is best effort: a failed
// write never fails the job, because the store already has the guide.
//
// The guide library: each published guide also goes to content/guides, next to the curated
// ones, so all guides live in one place and ship with the repo.
//   - GITHUB_TOKEN + GITHUB_REPO set: committed to that repo (GITHUB_BRANCH, default main).
//     This is how a hosted deploy does it, since its own filesystem is read-only.
//   - otherwise, outside production: written to the local content/guides folder.
// A guide that would fail `npm run validate` stays in the store only, because one bad file in
// content/guides takes the whole library down.
//
// Run logs (optional): ARCHIVE_DIR (e.g. ./data) keeps <dir>/guides/<slug>.json and
// <dir>/runs/<slug>-<jobId>.json with the full run: model output, pages fetched, draft, events.

export type Archive = {
  saveGuide(slug: string, guide: unknown): Promise<void>;
  saveRun(name: string, data: unknown): Promise<void>;
};

const safe = (name: string) => name.replace(/[^a-z0-9._-]/gi, "_");

export function createFileArchive(dir: string): Archive {
  const write = async (sub: string, name: string, data: unknown) => {
    try {
      await mkdir(path.join(dir, sub), { recursive: true });
      await writeFile(path.join(dir, sub, `${safe(name)}.json`), JSON.stringify(data, null, 2) + "\n");
    } catch (e) {
      console.warn(`Couldn't archive ${sub}/${name}: ${(e as Error).message}`);
    }
  };
  return {
    saveGuide: (slug, guide) => write("guides", slug, guide),
    saveRun: (name, data) => write("runs", name, data),
  };
}

/** Saves guides that pass the library checks; `put` writes content/guides/<slug>.json somewhere. */
function libraryArchive(put: (slug: string, text: string) => Promise<void>): Archive {
  return {
    async saveGuide(slug, guide) {
      const checked = checkGuideFile(guide);
      if (!checked.guide || checked.slug !== slug) {
        console.warn(`Not adding ${slug} to content/guides: ${checked.errors.join("; ") || "slug mismatch"}`);
        return;
      }
      try {
        await put(slug, guideFileText(checked.guide));
      } catch (e) {
        console.warn(`Couldn't add ${slug} to content/guides: ${(e as Error).message}`);
      }
    },
    async saveRun() {},
  };
}

export function createLocalLibrary(dir: string): Archive {
  return libraryArchive(async (slug, text) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${slug}.json`), text);
  });
}

type GitHubOpts = { token: string; repo: string; branch?: string; fetch?: typeof fetch };

export function createGitHubLibrary(opts: GitHubOpts): Archive {
  const doFetch = opts.fetch ?? fetch;
  const branch = opts.branch || "main";
  const headers = {
    authorization: `Bearer ${opts.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  return libraryArchive(async (slug, text) => {
    const url = `https://api.github.com/repos/${opts.repo}/contents/content/guides/${slug}.json`;
    // An existing file needs its sha to be replaced (a re-check updating the guide).
    const current = await doFetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (current.status !== 200 && current.status !== 404) throw new Error(`GitHub ${current.status} reading ${slug}.json`);
    const sha = current.status === 200 ? ((await current.json()) as { sha?: string }).sha : undefined;
    const res = await doFetch(url, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        message: `${sha ? "Update" : "Add"} generated guide: ${slug}`,
        content: Buffer.from(text).toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} writing ${slug}.json`);
  });
}

function combine(archives: Archive[]): Archive | undefined {
  if (archives.length === 0) return undefined;
  return {
    saveGuide: async (slug, guide) => void (await Promise.all(archives.map((a) => a.saveGuide(slug, guide)))),
    saveRun: async (name, data) => void (await Promise.all(archives.map((a) => a.saveRun(name, data)))),
  };
}

export function getArchive(env: NodeJS.ProcessEnv = process.env): Archive | undefined {
  const archives: Archive[] = [];
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    archives.push(createGitHubLibrary({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH }));
  } else if (env.NODE_ENV !== "production") {
    archives.push(createLocalLibrary(guidesDir()));
  }
  if (env.ARCHIVE_DIR) archives.push(createFileArchive(env.ARCHIVE_DIR));
  return combine(archives);
}

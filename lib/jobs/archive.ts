import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Optional file copies of what the store holds, for reading outside the app:
//   <dir>/guides/<slug>.json          the published guide
//   <dir>/runs/<slug>-<jobId>.json    the full run: model output, pages fetched, draft, events, outcome
// Enabled with ARCHIVE_DIR (e.g. ./data) for local runs; hosted filesystems are read-only or
// ephemeral, so it's off by default. A failed write never fails the job.

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

export function getArchive(): Archive | undefined {
  const dir = process.env.ARCHIVE_DIR;
  return dir ? createFileArchive(dir) : undefined;
}

import fs from "node:fs";
import path from "node:path";
import { GuideSchema, type Guide } from "./schema";
import { guideRubricIssues } from "./bands";
import { getStore, type Store } from "./store";

// GUIDES_DIR lets previews and tests point at fixtures; real content lives in content/guides.
export const guidesDir = () =>
  process.env.GUIDES_DIR
    ? path.resolve(/*turbopackIgnore: true*/ process.env.GUIDES_DIR)
    : path.join(process.cwd(), "content", "guides");

export type LoadResult = { file: string; guide?: Guide; errors: string[] };

export function validateGuideJson(file: string, raw: unknown): LoadResult {
  const parsed = GuideSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      file,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const errors = guideRubricIssues(parsed.data);
  const expectedSlug = path.basename(file, ".json");
  if (parsed.data.slug !== expectedSlug) errors.push(`slug "${parsed.data.slug}" must match file name "${expectedSlug}"`);
  return { file, guide: parsed.data, errors };
}

export function loadAll(dir = guidesDir()): LoadResult[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      try {
        return validateGuideJson(file, JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (e) {
        return { file, errors: [`invalid JSON: ${(e as Error).message}`] };
      }
    });
}

// Curated guides: an invalid file fails the build instead of rendering half-right.
export function getCuratedGuides(): Guide[] {
  const results = loadAll();
  const bad = results.filter((r) => r.errors.length > 0);
  if (bad.length > 0) {
    const detail = bad.map((r) => `${r.file}\n  - ${r.errors.join("\n  - ")}`).join("\n");
    throw new Error(`Invalid guide content:\n${detail}`);
  }
  return results.map((r) => r.guide!);
}

// Generated guides are re-validated on every read. One bad row, or the store being down,
// must never take the curated library with it.
export async function mergeGuides(curated: Guide[], store: Store | null): Promise<Guide[]> {
  if (!store) return curated;
  let stored;
  try {
    stored = await store.listPublished();
  } catch (e) {
    console.warn(`Guide store unavailable, serving curated guides only: ${(e as Error).message}`);
    return curated;
  }
  const taken = new Set(curated.map((g) => g.slug));
  const generated: Guide[] = [];
  for (const row of stored) {
    if (taken.has(row.slug)) continue;
    const result = validateGuideJson(`store/${row.slug}.json`, row.guide);
    if (result.errors.length > 0) {
      console.warn(`Skipping stored guide ${row.slug}: ${result.errors.join("; ")}`);
      continue;
    }
    generated.push(result.guide!);
  }
  return [...curated, ...generated].sort((a, b) => a.app.name.localeCompare(b.app.name));
}

export async function getAllGuides(): Promise<Guide[]> {
  return mergeGuides(getCuratedGuides(), await getStore());
}

export async function getGuide(slug: string): Promise<Guide | undefined> {
  return (await getAllGuides()).find((g) => g.slug === slug);
}

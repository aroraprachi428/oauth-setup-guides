import fs from "node:fs";
import path from "node:path";
import type { Guide } from "./schema";
import { validateGuideJson } from "./guides";
import { findStyleIssues, formatStyleIssue } from "./style";

// A generated guide can live in content/guides next to the curated ones. It keeps source
// "generated" and its generator info, so the page still says it's AI-generated. A bad file there
// fails the whole library, so it gets the same checks `npm run validate` applies to that folder.

export const guideFileText = (guide: Guide) => JSON.stringify(guide, null, 2) + "\n";

export function checkGuideFile(raw: unknown): { slug: string; guide?: Guide; errors: string[] } {
  const slug = typeof (raw as any)?.slug === "string" ? (raw as any).slug : "";
  if (!/^[a-z0-9-]+$/.test(slug)) return { slug, errors: ["guide has no valid slug"] };
  const r = validateGuideJson(`${slug}.json`, raw);
  const errors = r.guide ? [...r.errors, ...findStyleIssues(r.guide).map(formatStyleIssue)] : r.errors;
  return errors.length > 0 ? { slug, errors } : { slug, guide: r.guide, errors: [] };
}

export type PromoteResult = { file: string; written: boolean; errors: string[] };

export function promoteGuide(raw: unknown, dir: string, opts: { force?: boolean } = {}): PromoteResult {
  const checked = checkGuideFile(raw);
  const file = path.join(dir, `${checked.slug || "unknown"}.json`);
  if (!checked.guide) return { file, written: false, errors: checked.errors };
  if (fs.existsSync(file) && !opts.force) return { file, written: false, errors: [`${file} already exists (use --force to replace it)`] };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, guideFileText(checked.guide));
  return { file, written: true, errors: [] };
}

import fs from "node:fs";
import { loadAll, guidesDir, validateGuideJson } from "../lib/guides";
import { evidenceCounts, defaultProfile } from "../lib/bands";
import { findStyleIssues, formatStyleIssue } from "../lib/style";

// Usage: npm run validate [-- <dir | file.json>]   (defaults to content/guides or $GUIDES_DIR)
const target = process.argv[2] ?? guidesDir();
const results = target.endsWith(".json")
  ? [validateGuideJson(target, JSON.parse(fs.readFileSync(target, "utf8")))]
  : loadAll(target);

if (results.length === 0) {
  console.log(`No guides found in ${target}`);
  process.exit(0);
}

let failed = 0;
for (const r of results) {
  // Curated guides follow the same writing rule as agent-written ones (lib/style.ts).
  const errors = r.guide ? [...r.errors, ...findStyleIssues(r.guide).map(formatStyleIssue)] : r.errors;
  if (errors.length > 0) {
    failed++;
    console.log(`FAIL ${r.file}`);
    for (const e of errors) console.log(`  - ${e}`);
    continue;
  }
  const g = r.guide!;
  const p = defaultProfile(g);
  const c = evidenceCounts(g);
  console.log(
    `ok   ${g.slug.padEnd(20)} S1=${p.verdict.stage1.band} | S2=${p.verdict.stage2.band} | tags=${p.blockerTags.join(",")} | ` +
      `verified=${c.verified} reported=${c.reported} uncertain=${c.uncertain} tested=${c.tested}`,
  );
}

console.log(`\n${results.length - failed}/${results.length} guides valid`);
process.exit(failed > 0 ? 1 : 0);

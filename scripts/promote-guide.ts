import fs from "node:fs";
import { guidesDir } from "../lib/guides";
import { promoteGuide } from "../lib/promote";
import { getStore } from "../lib/store";

// Usage: npm run promote -- <slug | file.json> [...] [--force]
//   slug       read the published guide from the store (STORE_URL, e.g. from .env.local)
//   file.json  read a guide file, e.g. an archived copy in data/guides
// Writes content/guides/<slug>.json. Commit it, and it ships with the next deploy.
const args = process.argv.slice(2);
const force = args.includes("--force");
const targets = args.filter((a) => a !== "--force");

if (targets.length === 0) {
  console.log("Usage: npm run promote -- <slug | file.json> [...] [--force]");
  process.exit(1);
}

let failed = 0;
for (const target of targets) {
  let raw: unknown;
  if (target.endsWith(".json")) {
    raw = JSON.parse(fs.readFileSync(target, "utf8"));
  } else {
    const store = await getStore();
    if (!store) {
      console.log(`FAIL ${target}\n  - STORE_URL isn't set, so there's no store to read from`);
      failed++;
      continue;
    }
    raw = (await store.getGuide(target))?.guide;
    if (!raw) {
      console.log(`FAIL ${target}\n  - no published guide with this slug in the store`);
      failed++;
      continue;
    }
  }
  const r = promoteGuide(raw, guidesDir(), { force });
  if (r.written) {
    console.log(`ok   ${target} -> ${r.file}`);
  } else {
    failed++;
    console.log(`FAIL ${target}`);
    for (const e of r.errors) console.log(`  - ${e}`);
  }
}

process.exit(failed > 0 ? 1 : 0);

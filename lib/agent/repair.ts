// Formatting-only repairs applied to the agent's draft before it's checked, so Gemini requests
// aren't spent on mechanical mistakes. Rule: never touch a fact. Labels, statements, sources,
// bands, fact values and claim references are left exactly as written; only missing empty lists,
// fact-free defaults, id spelling (renamed consistently everywhere) and over-long quotes are fixed.

const MAX_QUOTE_WORDS = 14;
const ID_LIST_KEYS = new Set(["claimIds", "stepIds", "requirementIds", "limitIds", "blockerIds"]);

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown) => (Array.isArray(v) ? v : null);

export function normalizeId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function repairDraft<T>(input: T): { draft: T; fixes: string[] } {
  if (!isObj(input)) return { draft: input, fixes: [] };
  const g: Record<string, any> = structuredClone(input);
  const fixes: string[] = [];
  const ensureList = (obj: Record<string, any>, key: string, where: string) => {
    if (obj[key] === undefined) {
      obj[key] = [];
      fixes.push(`${where}.${key}: added empty list`);
    }
  };

  // Top level.
  if (typeof g.version !== "number") {
    g.version = 1;
    fixes.push("version: set to 1");
  }
  for (const k of ["requirements", "limits", "blockers", "nuances", "notFound"]) ensureList(g, k, "guide");

  // Ids: collect every id-bearing item, rename to kebab-case, then rewrite references.
  const renames = new Map<string, string>();
  for (const k of ["claims", "steps", "requirements", "limits", "blockers", "nuances", "profiles"]) {
    for (const item of arr(g[k]) ?? []) {
      if (!isObj(item) || typeof item.id !== "string") continue;
      const fixed = normalizeId(item.id);
      if (fixed && fixed !== item.id) {
        renames.set(item.id, fixed);
        fixes.push(`id "${item.id}" → "${fixed}"`);
        item.id = fixed;
      }
    }
  }
  if (renames.size > 0) {
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isObj(node)) return;
      for (const [k, v] of Object.entries(node)) {
        if (ID_LIST_KEYS.has(k) && Array.isArray(v)) node[k] = v.map((x) => (typeof x === "string" && renames.has(x) ? renames.get(x) : x));
        else if (k === "defaultProfileId" && typeof v === "string" && renames.has(v)) node[k] = renames.get(v);
        else walk(v);
      }
    };
    walk(g);
  }

  // Default profile: only when there's exactly one candidate.
  const profiles = arr(g.profiles) ?? [];
  if (g.defaultProfileId === undefined && profiles.length === 1 && isObj(profiles[0]) && typeof profiles[0].id === "string") {
    g.defaultProfileId = profiles[0].id;
    fixes.push("defaultProfileId: set to the only profile");
  }

  for (const [i, p] of profiles.entries()) {
    if (!isObj(p)) continue;
    const where = `profiles[${i}]`;
    for (const k of ["blockedBy", "requirementIds", "limitIds", "blockerIds", "topRisks"]) ensureList(p, k, where);
    if (Array.isArray(p.topRisks) && p.topRisks.length > 3) {
      p.topRisks = p.topRisks.slice(0, 3);
      fixes.push(`${where}.topRisks: kept the first 3`);
    }
    if (isObj(p.facts)) ensureList(p.facts, "configGotchas", `${where}.facts`);
  }

  for (const [i, s] of (arr(g.steps) ?? []).entries()) {
    if (!isObj(s)) continue;
    const where = `steps[${i}]`;
    ensureList(s, "links", where);
    ensureList(s, "claimIds", where);
    if (typeof s.instructions === "string") {
      s.instructions = [s.instructions];
      fixes.push(`${where}.instructions: wrapped text in a list`);
    }
    if (s.agentMarkBasis === undefined) {
      s.agentMarkBasis = "expected_from_docs";
      fixes.push(`${where}.agentMarkBasis: set to expected_from_docs`);
    }
  }

  if (isObj(g.technical)) {
    ensureList(g.technical, "redirectUriRules", "technical");
    ensureList(g.technical, "claimIds", "technical");
  }
  for (const k of ["nuances", "notFound", "requirements", "limits", "blockers"]) {
    for (const [i, item] of (arr(g[k]) ?? []).entries()) if (isObj(item)) ensureList(item, "claimIds", `${k}[${i}]`);
  }

  for (const c of arr(g.claims) ?? []) {
    if (!isObj(c)) continue;
    ensureList(c, "sources", `claim ${c.id}`);
    for (const s of arr(c.sources) ?? []) {
      if (isObj(s) && typeof s.quote === "string" && s.quote.trim().split(/\s+/).length > MAX_QUOTE_WORDS) {
        delete s.quote;
        fixes.push(`claim ${c.id}: removed a quote of 15+ words`);
      }
    }
  }

  return { draft: g as T, fixes };
}

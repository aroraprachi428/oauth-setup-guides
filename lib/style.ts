// Writing rule for everything a reader sees in a guide: state facts plainly and don't say who
// said them. Sources live in claims[].sources and the claim's label carries the uncertainty,
// so "Linear says…", "per Google…" or "developers report…" is noise once evidence is hidden.
// One list, used by the agent prompt, the publish gates, `npm run validate` and the tests.

export const STYLE_RULE =
  "State each fact plainly. Don't name who said it (\"X says…\", \"per X…\", \"X's docs…\", \"a vendor guide…\", \"developers report…\", \"according to…\"). " +
  "Sources belong only in claims. When sources conflict, give the safe action. Put undocumented items in notFound.";

const NAME = String.raw`(?:[A-Z][\w.&-]*|the provider|the vendor)`;
const DOC = String.raw`(?:docs|documentation|own docs|page|pages|guide|guides|reference|help center|changelog|FAQ)`;

// "<Name> says…": the one pattern where a capitalised sentence opener ("The", "This"…) isn't a source.
const NAME_SAYS = new RegExp(String.raw`\b${NAME}\s+(?:says|said|documents|documented|states|stated|notes|warns|recommends|claims)\b`, "g");

const PATTERNS: RegExp[] = [
  // "per" is mostly a unit ("per user", "per Google Cloud project"). Attribution is "Per X, …" at the
  // start of a sentence, "per X," before a comma, or "per the docs" anywhere.
  new RegExp(String.raw`(?:^|[.;:!?]\s+|\(\s*)Per\s+(?:the\s+)?[A-Z][\w.&-]*(?:'s)?(?:\s+[A-Z][\w.&-]*)*`, "g"),
  new RegExp(String.raw`\bper\s+(?:the\s+)?[A-Z][\w.&-]*(?:'s)?(?:\s+[A-Z][\w.&-]*)*(?=\s*,)`, "g"),
  /\bper\s+(?:the\s+)?(?:docs?|documentation|guide|reference)\b/gi,
  new RegExp(String.raw`\b${NAME}'s\s+${DOC}\b`, "g"),
  /\bthe\s+(?:docs?|documentation|reference|guide)\s+(?:says?|states?|shows?|notes?|lists?|mentions?)\b/gi,
  /\bvendor\s+guides?\b/gi,
  /\b(?:developers|users|people|teams)\s+(?:report|reported|say|said)\b/gi,
  /\bcommunity\s+reports?\b/gi,
  /\bthe\s+docs\s+(?:are|were)\s+silent\b/gi,
  /\baccording\s+to\b/gi,
  /\bis\s+documented\s+as\b/gi,
];

// Words that start a sentence with a capital but aren't a source being cited.
const NOT_A_SOURCE = /^(?:The|This|That|It|Each|Every|Any|A|An|Your|Our|Its|Not|No|Also|Then|Only)$/;

export function styleIssuesInText(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(NAME_SAYS)) if (!NOT_A_SOURCE.test(m[0].split(/\s+/)[0])) found.push(m[0]);
  for (const re of PATTERNS) for (const m of text.matchAll(re)) found.push(m[0]);
  return found;
}

export type StyleIssue = { path: string; phrase: string };

// User-facing text fields, as [path pattern, getter]. claims[] and notFound[] are evidence,
// not reader-facing prose, so they're deliberately not checked.
function* userText(g: any): Generator<[string, unknown]> {
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  yield ["technical.clientSecretHandling", g?.technical?.clientSecretHandling];
  for (const [i, r] of arr(g?.technical?.redirectUriRules).entries()) yield [`technical.redirectUriRules[${i}]`, r];
  yield ["technical.accessTokenLifetime", g?.technical?.accessTokenLifetime];
  yield ["technical.refreshTokens.expiry", g?.technical?.refreshTokens?.expiry];
  yield ["technical.refreshTokens.notes", g?.technical?.refreshTokens?.notes];
  for (const [i, p] of arr(g?.profiles).entries()) {
    const at = `profiles[${i}]`;
    yield [`${at}.intent`, p?.intent];
    yield [`${at}.bottomLine`, p?.bottomLine];
    for (const [j, r] of arr(p?.topRisks).entries()) yield [`${at}.topRisks[${j}]`, r];
    for (const [j, s] of arr(p?.scopes).entries()) yield [`${at}.scopes[${j}].purpose`, s?.purpose];
    for (const st of ["stage1", "stage2"]) {
      yield [`${at}.verdict.${st}.summary`, p?.verdict?.[st]?.summary];
      yield [`${at}.verdict.${st}.time.range`, p?.verdict?.[st]?.time?.range];
      yield [`${at}.verdict.${st}.time.startsWhen`, p?.verdict?.[st]?.time?.startsWhen];
    }
    yield [`${at}.stage1DoneWhen.text`, p?.stage1DoneWhen?.text];
    yield [`${at}.facts.testModeLimits.text`, p?.facts?.testModeLimits?.text];
    for (const [j, c] of arr(p?.facts?.configGotchas).entries()) yield [`${at}.facts.configGotchas[${j}].text`, c?.text];
    for (const [j, b] of arr(p?.blockedBy).entries()) yield [`${at}.blockedBy[${j}].how`, b?.how];
  }
  for (const [i, s] of arr(g?.steps).entries()) {
    yield [`steps[${i}].title`, s?.title];
    for (const [j, line] of arr(s?.instructions).entries()) yield [`steps[${i}].instructions[${j}]`, line];
  }
  for (const [i, r] of arr(g?.requirements).entries()) {
    for (const k of ["label", "detail", "howToPrepare"]) yield [`requirements[${i}].${k}`, r?.[k]];
  }
  for (const [i, l] of arr(g?.limits).entries()) {
    for (const k of ["what", "value", "whenHit"]) yield [`limits[${i}].${k}`, l?.[k]];
  }
  for (const [i, b] of arr(g?.blockers).entries()) {
    for (const k of ["symptom", "cause", "fix"]) yield [`blockers[${i}].${k}`, b?.[k]];
  }
  for (const [i, n] of arr(g?.nuances).entries()) yield [`nuances[${i}].text`, n?.text];
}

export function findStyleIssues(guide: unknown): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (const [path, value] of userText(guide)) {
    if (typeof value !== "string") continue;
    for (const phrase of styleIssuesInText(value)) issues.push({ path, phrase });
  }
  return issues.sort((a, b) => a.path.localeCompare(b.path));
}

export const formatStyleIssue = (i: StyleIssue) =>
  `${i.path}: remove attribution "${i.phrase}" (state the fact plainly; sources belong in claims)`;

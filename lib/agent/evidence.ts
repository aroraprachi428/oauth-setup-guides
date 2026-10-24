// Text matching for the gates: does a page the agent read actually say what a claim says?
// Lenient on formatting (case, whitespace, Markdown symbols, curly quotes), strict on words.

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[*_`#>|[\]]/g, " ")
    .replace(/\]\([^)]*\)/g, " ") // leftover Markdown link targets
    .replace(/\s+/g, " ")
    .trim();
}

export const MIN_QUOTE_WORDS = 3;

const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** True when `quote` (at least 3 words) appears in `pageText`, ignoring formatting and edge punctuation. */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const q = normalizeForMatch(quote).replace(/^["'.,;:()\s-]+|["'.,;:()\s-]+$/g, "");
  if (wordsIn(q) < MIN_QUOTE_WORDS) return false;
  return normalizeForMatch(pageText).includes(q);
}

/** Numbers in a piece of text, without thousands separators: "1,000 per 15 min" -> ["1000", "15"]. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, "").replace(/,$/, ""));
}

/** True when the number appears in the page as a standalone number (with or without separators). */
export function numberOnPage(n: string, pageText: string): boolean {
  return numbersIn(pageText).includes(n);
}

// ---------- hint for a failed quote ----------

const STOPWORDS = new Set(["the", "a", "an", "is", "are", "be", "for", "to", "of", "and", "or", "on", "in", "with", "by", "it", "this", "that", "as", "at"]);
const MAX_HINT_WORDS = 30;

const keyWords = (s: string) =>
  new Set(normalizeForMatch(s).split(/[^a-z0-9]+/).filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOPWORDS.has(w)));

/** Page sentences, with Markdown emphasis, headings and list markers removed but wording kept. */
function sentences(pageText: string): string[] {
  return pageText
    .split(/\n+/)
    .map((line) => line.replace(/[*_`]+/g, "").replace(/^\s*(?:[-+>#|]+|\d+[.)])\s*/, "").trim())
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").length >= 3);
}

/**
 * The page sentence that best matches what a claim was trying to quote, so the agent can copy
 * exact words in one round instead of guessing. Long sentences are trimmed around the match.
 * Returns null when no sentence shares at least two key words.
 */
export function closestSentence(quote: string, pageText: string, statement = ""): string | null {
  const wanted = new Set([...keyWords(quote), ...keyWords(statement)]);
  if (wanted.size === 0) return null;
  let best: { s: string; score: number } | null = null;
  for (const s of sentences(pageText)) {
    const words = keyWords(s);
    let score = 0;
    for (const w of wanted) if (words.has(w)) score++;
    if (score >= 2 && (!best || score > best.score || (score === best.score && s.length < best.s.length))) best = { s, score };
  }
  if (!best) return null;
  const tokens = best.s.split(" ");
  if (tokens.length <= MAX_HINT_WORDS) return best.s;
  const first = tokens.findIndex((t) => wanted.has(normalizeForMatch(t).replace(/[^a-z0-9]/g, "")));
  const start = Math.max(0, Math.min(first - 8, tokens.length - MAX_HINT_WORDS));
  const window = tokens.slice(start, start + MAX_HINT_WORDS).join(" ");
  return `${start > 0 ? "…" : ""}${window}${start + MAX_HINT_WORDS < tokens.length ? "…" : ""}`;
}

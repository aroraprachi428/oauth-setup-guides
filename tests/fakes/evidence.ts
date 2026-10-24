import fixture from "../fixtures/sample-guide.json";
import type { FetchLogEntry } from "../../lib/agent/fetch";

// A fixture guide whose evidence passes the gates: every source carries a quote that appears
// on the fetched page, the page text contains the numbers the fixture's limits use, and one
// read page is about production access (Stage 2).

export const QUOTE = "the fixture page states this exact sentence";
export const PAGE_TEXT = `Intro. ${QUOTE}. Linking is capped at 50 users before review. More text.`;
export const STAGE2_URL = "https://example.com/docs/production-review";

export function withQuotes<T>(guide: T): T {
  const g = structuredClone(guide) as any;
  for (const c of g.claims ?? []) for (const s of c.sources ?? []) s.quote = QUOTE;
  return g;
}

/** Every URL the fixture cites or links to, plus a Stage 2 page. */
export function urlsToRead(guide: any = fixture): string[] {
  const sources = (guide.claims ?? []).flatMap((c: any) => (c.sources ?? []).map((s: any) => s.url));
  const links = (guide.steps ?? []).flatMap((s: any) => (s.links ?? []).map((l: any) => l.url));
  return [...new Set([...sources, ...links, STAGE2_URL])];
}

export const readEntry = (url: string, contentFound = true): FetchLogEntry => ({
  url,
  finalUrl: url,
  status: contentFound ? 200 : 404,
  bytes: 1000,
  contentFound,
  ...(contentFound ? { text: PAGE_TEXT } : {}),
});

export const pageHtml = () => `<html><body><main><p>${PAGE_TEXT}</p><p>${"Official documentation content. ".repeat(20)}</p></main></body></html>`;

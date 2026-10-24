import type { SearchAdapter, SearchHit } from "./search";

// Tavily web search, used only as a fallback when the provider's own endpoints and known
// docs addresses don't lead to the pages the agent needs. Free plan: 1,000 credits a month,
// 1 credit per basic search (docs.tavily.com, checked 2026-10-24).

const URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5; // most of the value is in the top few; saves free-tier tokens
// Never a source for provider facts (research rule); excluded at the search API, not just in the prompt.
const EXCLUDE_DOMAINS = ["composio.dev"];
const MAX_SNIPPET = 500;

export function createTavilySearch(opts: { apiKey: string; fetch?: typeof fetch }): SearchAdapter {
  const doFetch = opts.fetch ?? fetch;
  const scrub = (s: string) => s.split(opts.apiKey).join("[redacted]");
  let quotaExhausted = false;

  return {
    async search(query: string): Promise<SearchHit[]> {
      if (quotaExhausted) throw new Error("search quota exhausted for this period; continue without search");
      const res = await doFetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          query: query.slice(0, 300),
          search_depth: "basic",
          max_results: MAX_RESULTS,
          topic: "general",
          include_answer: false,
          include_raw_content: false,
          exclude_domains: EXCLUDE_DOMAINS,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.status === 432 || res.status === 433) {
        quotaExhausted = true;
        throw new Error("search quota exhausted for this period; continue without search");
      }
      if (!res.ok) throw new Error(scrub(`search failed (${res.status}): ${JSON.stringify(json?.detail ?? json).slice(0, 200)}`));

      return (Array.isArray(json.results) ? json.results : [])
        .filter((r: any) => typeof r?.url === "string" && r.url.startsWith("https://"))
        .map((r: any) => ({ title: String(r.title ?? ""), url: r.url, snippet: String(r.content ?? "").slice(0, MAX_SNIPPET) }));
    },
  };
}

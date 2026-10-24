import { describe, expect, it } from "vitest";
import { createTavilySearch } from "../lib/agent/tavily";

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = async (url: string, init: any) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { fn: fn as unknown as typeof fetch, requests };
}

describe("createTavilySearch", () => {
  it("sends a basic search with the bearer key and maps results", async () => {
    const f = fakeFetch([
      { status: 200, body: { results: [{ title: "OAuth guide", url: "https://developer.calendly.com/oauth", content: "How to register an OAuth app…", score: 0.9 }] } },
    ]);
    const s = createTavilySearch({ apiKey: "tvly-k", fetch: f.fn });
    const hits = await s.search("calendly oauth app review");
    expect(f.requests[0].url).toBe("https://api.tavily.com/search");
    expect(f.requests[0].headers.authorization).toBe("Bearer tvly-k");
    expect(f.requests[0].body).toMatchObject({
      query: "calendly oauth app review",
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      exclude_domains: ["composio.dev"],
    });
    expect(hits).toEqual([{ title: "OAuth guide", url: "https://developer.calendly.com/oauth", snippet: "How to register an OAuth app…" }]);
  });

  it("drops non-https results and trims long snippets", async () => {
    const f = fakeFetch([
      { status: 200, body: { results: [{ title: "a", url: "http://insecure.example", content: "x" }, { title: "b", url: "https://ok.example", content: "y".repeat(2000) }] } },
    ]);
    const hits = await createTavilySearch({ apiKey: "k", fetch: f.fn }).search("q");
    expect(hits.map((h) => h.url)).toEqual(["https://ok.example"]);
    expect(hits[0].snippet.length).toBeLessThanOrEqual(500);
  });

  it("stops searching for the rest of the run once quota is exhausted", async () => {
    const f = fakeFetch([{ status: 432, body: { detail: { error: "usage limit exceeded" } } }]);
    const s = createTavilySearch({ apiKey: "k", fetch: f.fn });
    await expect(s.search("q1")).rejects.toThrow(/quota/);
    await expect(s.search("q2")).rejects.toThrow(/quota/);
    expect(f.requests).toHaveLength(1);
  });

  it("reports invalid keys and rate limits as errors without the key", async () => {
    const f = fakeFetch([
      { status: 401, body: { detail: { error: "bad key tvly-secret" } } },
      { status: 429, body: {} },
    ]);
    const s = createTavilySearch({ apiKey: "tvly-secret", fetch: f.fn });
    const e1 = await s.search("q").catch((e) => e);
    expect(String(e1.message)).toMatch(/401/);
    expect(String(e1.message)).not.toContain("tvly-secret");
    await expect(s.search("q")).rejects.toThrow(/429/);
  });
});

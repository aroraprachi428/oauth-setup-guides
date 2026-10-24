import type { Fetcher } from "./fetch";

// Search results only point the agent at pages. A hit is never evidence by itself:
// unless the page is then fetched, the gates record any claim citing it as "snippet".

export type SearchHit = { url: string; title: string; snippet: string };

export interface SearchAdapter {
  search(query: string): Promise<SearchHit[]>;
}

const AUTH_WORDS = /oauth|auth|scope|token|consent|redirect|app-review|verification|permission|developer|getting-started|quickstart|rate-limit|pricing/i;
const MAX_SITEMAP_HITS = 40;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;

/** Asks the provider's own docs host where its pages are: llms.txt, sitemap.xml, OIDC discovery. */
export async function providerEndpoints(host: string, fetcher: Fetcher): Promise<SearchHit[]> {
  if (/[/:]/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new Error("expected a bare hostname");
  if (!HOSTNAME.test(host)) return [];
  const base = `https://${host}`;
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const add = (url: string, title: string, snippet = "") => {
    if (seen.has(url)) return;
    seen.add(url);
    hits.push({ url, title, snippet });
  };

  const llms = await fetcher.fetch(`${base}/llms.txt`);
  if (llms.ok && llms.contentFound) {
    for (const m of llms.text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)(?::\s*([^\n]*))?/g)) {
      try {
        add(new URL(m[2], base).toString(), m[1], m[3] ?? "");
      } catch {
        // skip malformed links
      }
    }
  }

  const sitemap = await fetcher.fetch(`${base}/sitemap.xml`);
  if (sitemap.ok && sitemap.contentFound) {
    let n = 0;
    for (const m of sitemap.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      if (n >= MAX_SITEMAP_HITS) break;
      if (AUTH_WORDS.test(m[1])) {
        add(m[1], new URL(m[1]).pathname, "from sitemap.xml");
        n++;
      }
    }
  }

  for (const path of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"]) {
    const r = await fetcher.fetch(`${base}${path}`);
    if (!r.ok || !r.contentFound) continue;
    try {
      const meta = JSON.parse(r.text);
      const keys = ["authorization_endpoint", "token_endpoint", "code_challenge_methods_supported", "scopes_supported"];
      const summary = keys.filter((k) => meta[k]).map((k) => `${k}: ${JSON.stringify(meta[k])}`).join("; ");
      add(`${base}${path}`, `${host} ${path}`, summary);
    } catch {
      // not JSON: ignore
    }
  }
  return hits;
}

import { describe, expect, it } from "vitest";
import { createFetcher, type TransportResponse } from "../lib/agent/fetch";
import { providerEndpoints } from "../lib/agent/search";

const res = (status: number, body: string, type = "text/plain"): TransportResponse => ({
  status,
  headers: { "content-type": type },
  body,
  truncated: false,
});

function fetcherWith(routes: Record<string, TransportResponse>) {
  return createFetcher({ transport: async (u) => routes[u.toString()] ?? res(404, "") });
}

describe("providerEndpoints", () => {
  it("collects links from llms.txt, auth-related sitemap URLs and OIDC discovery", async () => {
    const f = fetcherWith({
      "https://docs.acme.dev/llms.txt": res(200, "# Acme\n- [OAuth guide](https://docs.acme.dev/oauth.md): how to auth\n- [Pricing](/pricing.md)"),
      "https://docs.acme.dev/sitemap.xml": res(
        200,
        "<urlset><url><loc>https://docs.acme.dev/authentication/scopes</loc></url><url><loc>https://docs.acme.dev/blog/launch</loc></url></urlset>",
        "application/xml",
      ),
      "https://docs.acme.dev/.well-known/openid-configuration": res(
        200,
        JSON.stringify({ authorization_endpoint: "https://acme.dev/oauth/authorize", token_endpoint: "https://acme.dev/oauth/token" }),
        "application/json",
      ),
    });
    const hits = await providerEndpoints("docs.acme.dev", f);
    const urls = hits.map((h) => h.url);
    expect(urls).toContain("https://docs.acme.dev/oauth.md");
    expect(urls).toContain("https://docs.acme.dev/pricing.md");
    expect(urls).toContain("https://docs.acme.dev/authentication/scopes");
    expect(urls).not.toContain("https://docs.acme.dev/blog/launch");
    const oidc = hits.find((h) => h.url.endsWith("openid-configuration"));
    expect(oidc?.snippet).toContain("https://acme.dev/oauth/authorize");
  });

  it("returns nothing, without throwing, when no endpoint exists", async () => {
    expect(await providerEndpoints("nothing.example", fetcherWith({}))).toEqual([]);
  });

  it("rejects anything that isn't a bare hostname", async () => {
    await expect(providerEndpoints("https://x.example/path", fetcherWith({}))).rejects.toThrow(/hostname/);
    await expect(providerEndpoints("127.0.0.1", fetcherWith({}))).resolves.toEqual([]);
  });
});

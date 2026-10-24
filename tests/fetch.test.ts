import { describe, expect, it } from "vitest";
import {
  createFetcher,
  isBlockedAddress,
  makeSafeLookup,
  parseRobots,
  robotsAllows,
  type Transport,
  type TransportResponse,
} from "../lib/agent/fetch";

const page = (status: number, body: string, headers: Record<string, string> = {}): TransportResponse => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
  body,
  truncated: false,
});

const long = (s: string) => `<html><body><main><p>${s}</p><p>${"Plenty of real documentation text. ".repeat(20)}</p></main></body></html>`;

// A transport that serves canned responses by URL and records what was requested.
function fakeTransport(routes: Record<string, TransportResponse | Error>) {
  const requested: string[] = [];
  const transport: Transport = async (url) => {
    requested.push(url.toString());
    const r = routes[url.toString()];
    if (!r) return page(404, "not found");
    if (r instanceof Error) throw r;
    return r;
  };
  return { transport, requested };
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1",
    "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("makeSafeLookup", () => {
  const lookupWith = (addresses: { address: string; family: number }[]) =>
    makeSafeLookup(((_host: string, _opts: unknown, cb: any) => cb(null, addresses)) as any);

  it("rejects a host that resolves to any private address", async () => {
    const lookup = lookupWith([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    const err = await new Promise((resolve) => lookup("evil.example", {}, (e: unknown) => resolve(e)));
    expect(String(err)).toMatch(/blocked address/);
  });

  it("passes a public address through", async () => {
    const lookup = lookupWith([{ address: "93.184.216.34", family: 4 }]);
    const addr = await new Promise((resolve) => lookup("ok.example", {}, (_e: unknown, a: unknown) => resolve(a)));
    expect(addr).toBe("93.184.216.34");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(
    ["User-agent: *", "Disallow: /private", "Allow: /private/ok", "", "User-agent: OtherBot", "Disallow: /"].join("\n"),
  );
  it("applies the * group with longest-match Allow", () => {
    expect(robotsAllows(rules, "/docs/oauth")).toBe(true);
    expect(robotsAllows(rules, "/private/secret")).toBe(false);
    expect(robotsAllows(rules, "/private/ok/page")).toBe(true);
  });
});

describe("fetcher", () => {
  it("refuses non-https URLs and IP literals in private ranges", async () => {
    const { transport, requested } = fakeTransport({});
    const f = createFetcher({ transport });
    expect((await f.fetch("http://example.com/")).ok).toBe(false);
    expect((await f.fetch("https://127.0.0.1/")).ok).toBe(false);
    expect((await f.fetch("https://[::1]/")).ok).toBe(false);
    expect(requested).toEqual([]);
    expect(f.log.every((e) => !e.contentFound)).toBe(true);
  });

  it("follows up to 5 https redirects and logs the final URL", async () => {
    const { transport } = fakeTransport({
      "https://a.example/robots.txt": page(404, ""),
      "https://a.example/old": page(301, "", { location: "/new" }),
      "https://a.example/new": page(200, long("OAuth guide")),
    });
    const f = createFetcher({ transport });
    const r = await f.fetch("https://a.example/old");
    expect(r.ok && r.finalUrl).toBe("https://a.example/new");
    expect(r.ok && r.text).toContain("OAuth guide");
    expect(f.log.at(-1)).toMatchObject({ url: "https://a.example/old", finalUrl: "https://a.example/new", status: 200, contentFound: true });
  });

  it("refuses a redirect to http or a private IP literal", async () => {
    const { transport } = fakeTransport({
      "https://a.example/robots.txt": page(404, ""),
      "https://a.example/to-http": page(302, "", { location: "http://a.example/x" }),
      "https://a.example/to-meta": page(302, "", { location: "https://169.254.169.254/latest/meta-data" }),
    });
    const f = createFetcher({ transport });
    expect((await f.fetch("https://a.example/to-http")).ok).toBe(false);
    expect((await f.fetch("https://a.example/to-meta")).ok).toBe(false);
  });

  it("stops after too many redirects", async () => {
    const routes: Record<string, TransportResponse> = { "https://a.example/robots.txt": page(404, "") };
    for (let i = 0; i < 7; i++) routes[`https://a.example/r${i}`] = page(302, "", { location: `/r${i + 1}` });
    const f = createFetcher({ transport: fakeTransport(routes).transport });
    const r = await f.fetch("https://a.example/r0");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/too many redirects/);
  });

  it("respects robots.txt and caches it per host", async () => {
    const { transport, requested } = fakeTransport({
      "https://b.example/robots.txt": page(200, "User-agent: *\nDisallow: /admin", { "content-type": "text/plain" }),
      "https://b.example/docs": page(200, long("docs")),
    });
    const f = createFetcher({ transport });
    expect((await f.fetch("https://b.example/admin/x")).ok).toBe(false);
    expect((await f.fetch("https://b.example/docs")).ok).toBe(true);
    expect(requested.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("marks near-empty pages (JS shells) as no content", async () => {
    const { transport } = fakeTransport({
      "https://c.example/robots.txt": page(404, ""),
      "https://c.example/app": page(200, "<html><body><div id=root></div><script>x()</script></body></html>"),
      "https://c.example/llms.txt": page(200, "# Docs\n- /oauth", { "content-type": "text/plain" }),
    });
    const f = createFetcher({ transport });
    const shell = await f.fetch("https://c.example/app");
    expect(shell.ok && shell.contentFound).toBe(false);
    const txt = await f.fetch("https://c.example/llms.txt");
    expect(txt.ok && txt.contentFound).toBe(true);
  });

  it("treats a 200 'Page Not Found' page as no content", async () => {
    const { transport } = fakeTransport({
      "https://g.example/robots.txt": page(404, ""),
      "https://g.example/missing.md": page(200, "# Page Not Found\n\nThe page you requested doesn't exist.", { "content-type": "text/markdown" }),
      "https://g.example/real.md": page(200, "# OAuth\n\nThis page explains why a page not found error happens.", { "content-type": "text/markdown" }),
    });
    const f = createFetcher({ transport });
    const missing = await f.fetch("https://g.example/missing.md");
    expect(missing.ok && missing.contentFound).toBe(false);
    const real = await f.fetch("https://g.example/real.md");
    expect(real.ok && real.contentFound).toBe(true);
  });

  it("keeps page text in the log only for pages with content", async () => {
    const { transport } = fakeTransport({
      "https://h.example/robots.txt": page(404, ""),
      "https://h.example/doc": page(200, long("Tokens last one hour")),
      "https://h.example/gone": page(404, "nope"),
    });
    const f = createFetcher({ transport });
    await f.fetch("https://h.example/doc");
    await f.fetch("https://h.example/gone");
    expect(f.log[0].text).toContain("Tokens last one hour");
    expect(f.log[1].text).toBeUndefined();
  });

  it("marks truncated and non-2xx responses correctly", async () => {
    const { transport } = fakeTransport({
      "https://d.example/robots.txt": page(404, ""),
      "https://d.example/big": { ...page(200, long("big")), truncated: true },
      "https://d.example/gone": page(410, long("gone")),
    });
    const f = createFetcher({ transport });
    const big = await f.fetch("https://d.example/big");
    expect(big.ok && big.truncated).toBe(true);
    const gone = await f.fetch("https://d.example/gone");
    expect(gone.ok && gone.contentFound).toBe(false);
  });

  it("enforces the per-run fetch limit", async () => {
    const { transport } = fakeTransport({ "https://e.example/robots.txt": page(404, ""), "https://e.example/": page(200, long("x")) });
    const f = createFetcher({ transport, maxFetches: 2 });
    expect((await f.fetch("https://e.example/")).ok).toBe(true);
    expect((await f.fetch("https://e.example/")).ok).toBe(true);
    const third = await f.fetch("https://e.example/");
    expect(!third.ok && third.error).toMatch(/fetch limit/);
  });

  it("records transport errors without throwing", async () => {
    const { transport } = fakeTransport({
      "https://f.example/robots.txt": page(404, ""),
      "https://f.example/": new Error("connect ETIMEDOUT"),
    });
    const f = createFetcher({ transport });
    const r = await f.fetch("https://f.example/");
    expect(r.ok).toBe(false);
    expect(f.log.at(-1)).toMatchObject({ contentFound: false, error: expect.stringMatching(/ETIMEDOUT/) });
  });
});

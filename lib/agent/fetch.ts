import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { convert } from "html-to-text";

// The agent's only way to read the web. Public tool, so this is locked down:
// https only, GET only, no cookies, private and local addresses refused at DNS time
// (so redirects and DNS rebinding can't reach internal hosts), size and time caps,
// robots.txt respected. Every call is logged; the gates trust this log, not the agent.

const USER_AGENT = "OAuthSetupGuidesBot/0.1 (+research agent; read-only)";
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 60_000; // what the model gets back per page
const MIN_HTML_TEXT = 200; // below this an HTML page is treated as a JS shell, not content
// Docs sites often answer a missing page (or a missing .md twin) with 200 and a "not found" page.
const SOFT_404 = /^[\s#>*_-]*(?:page\s+not\s+found|404\b|not\s+found\b|(?:this|the)\s+page\s+(?:does\s*n[o']t|could\s*n[o']t\s+be|can\s*n[o']t\s+be)\s+(?:exist|found))/i;

export type TransportResponse = { status: number; headers: Record<string, string>; body: string; truncated: boolean };
export type Transport = (url: URL) => Promise<TransportResponse>;

export type FetchLogEntry = {
  url: string;
  finalUrl: string | null;
  status: number | null;
  bytes: number;
  contentFound: boolean;
  error?: string;
  /** Page text (capped), kept only when content was found. The gates check quotes and numbers against it. */
  text?: string;
};

export type FetchResult =
  | { ok: true; url: string; finalUrl: string; status: number; contentFound: boolean; truncated: boolean; text: string }
  | { ok: false; url: string; error: string };

// ---------- address checks ----------

const ipv4ToInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
};
const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
];

function expandV6(ip: string): number[] | null {
  const [head, tail = ""] = ip.split("::");
  const part = (s: string) => (s ? s.split(":") : []);
  let left = part(head);
  let right = part(tail);
  const lastRaw = ip.includes("::") ? right : left;
  const last = lastRaw[lastRaw.length - 1];
  if (last && last.includes(".")) {
    // Embedded IPv4, e.g. ::ffff:127.0.0.1
    const n = ipv4ToInt(last);
    const words = [(n >>> 16).toString(16), (n & 0xffff).toString(16)];
    if (ip.includes("::")) right = [...right.slice(0, -1), ...words];
    else left = [...left.slice(0, -1), ...words];
  }
  const fill = ip.includes("::") ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array(fill).fill("0"), ...right].map((w) => Number.parseInt(w, 16));
  return words.length === 8 && words.every((w) => Number.isFinite(w)) ? words : null;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return BLOCKED_V4.some((c) => inV4(ip, c));
  if (kind !== 6) return true;
  const w = expandV6(ip.toLowerCase());
  if (!w) return true;
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    // IPv4-mapped: judge the IPv4 address
    return isBlockedAddress(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  }
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void;

/** A dns.lookup replacement that refuses hosts resolving to any blocked address. */
export function makeSafeLookup(resolve: typeof dns.lookup = dns.lookup) {
  return (hostname: string, options: any, callback: LookupCb) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options ?? {};
    (resolve as any)(hostname, { ...opts, all: true }, (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => {
      if (err) return cb(err);
      const bad = addresses.find((a) => isBlockedAddress(a.address));
      if (bad || addresses.length === 0) {
        return cb(Object.assign(new Error(`blocked address for ${hostname}`), { code: "EBLOCKED" }));
      }
      if (opts.all) return cb(null, addresses);
      cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

// ---------- robots.txt ----------

export type RobotsRules = { allow: string[]; disallow: string[] };

export function parseRobots(text: string, agent = "oauthsetupguidesbot"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], allow: [], disallow: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = mine ?? star;
  return { allow: g?.allow ?? [], disallow: g?.disallow ?? [] };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) => Math.max(-1, ...list.filter((p) => path.startsWith(p)).map((p) => p.length));
  return longest(rules.allow) >= longest(rules.disallow);
}

// ---------- transport ----------

export const httpsTransport: Transport = (url) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        lookup: makeSafeLookup() as any,
        timeout: TIMEOUT_MS,
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,application/json;q=0.9,*/*;q=0.5", "accept-encoding": "identity" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          if (truncated) return;
          bytes += c.length;
          if (bytes > MAX_BYTES) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (bytes - MAX_BYTES)));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")])),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        res.on("end", done);
        res.on("close", done);
        res.on("error", (e) => (truncated ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });

// ---------- fetcher ----------

function toText(body: string, contentType: string): { text: string; isHtml: boolean } {
  if (/html/i.test(contentType)) {
    const text = convert(body, {
      wordwrap: false,
      selectors: [
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
      ],
    });
    return { text, isHtml: true };
  }
  if (/(text\/|markdown|json|xml)/i.test(contentType) || contentType === "") return { text: body, isHtml: false };
  return { text: "", isHtml: false }; // PDFs, images and the like: not readable here
}

const urlError = (u: URL): string | null => {
  if (u.protocol !== "https:") return "only https URLs are allowed";
  if (u.username || u.password) return "URLs with credentials are not allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) return "blocked address";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "blocked host";
  return null;
};

export function createFetcher(
  opts: { transport?: Transport; maxFetches?: number; seed?: { log: FetchLogEntry[]; count: number } } = {},
) {
  const transport = opts.transport ?? httpsTransport;
  const maxFetches = opts.maxFetches ?? Number.POSITIVE_INFINITY;
  // A run spans several short function invocations; seed carries the log and count across them.
  const log: FetchLogEntry[] = opts.seed ? [...opts.seed.log] : [];
  const robots = new Map<string, RobotsRules>();
  let count = opts.seed?.count ?? 0;

  const robotsFor = async (origin: URL): Promise<RobotsRules> => {
    const cached = robots.get(origin.host);
    if (cached) return cached;
    let rules: RobotsRules = { allow: [], disallow: [] };
    try {
      const r = await transport(new URL("/robots.txt", origin));
      if (r.status >= 200 && r.status < 300) rules = parseRobots(r.body);
    } catch {
      // Unreachable robots.txt: treat as no rules.
    }
    robots.set(origin.host, rules);
    return rules;
  };

  const fail = (url: string, error: string, extra: Partial<FetchLogEntry> = {}): FetchResult => {
    log.push({ url, finalUrl: null, status: null, bytes: 0, contentFound: false, error, ...extra });
    return { ok: false, url, error };
  };

  async function fetchPage(input: string): Promise<FetchResult> {
    let current: URL;
    try {
      current = new URL(input);
    } catch {
      return fail(input, "invalid URL");
    }
    if (count >= maxFetches) return fail(input, "fetch limit reached for this run");
    count++;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const bad = urlError(current);
      if (bad) return fail(input, bad);
      if (!robotsAllows(await robotsFor(current), current.pathname)) return fail(input, "disallowed by robots.txt");

      let res: TransportResponse;
      try {
        res = await transport(current);
      } catch (e) {
        return fail(input, (e as Error).message);
      }

      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        current = new URL(res.headers.location, current);
        continue;
      }

      const { text, isHtml } = toText(res.body, res.headers["content-type"] ?? "");
      const trimmed = text.trim();
      const contentFound =
        res.status >= 200 && res.status < 300 && trimmed.length >= (isHtml ? MIN_HTML_TEXT : 1) && !SOFT_404.test(trimmed.slice(0, 300));
      log.push({
        url: input,
        finalUrl: current.toString(),
        status: res.status,
        bytes: res.body.length,
        contentFound,
        ...(contentFound ? { text: trimmed.slice(0, MAX_TEXT_CHARS) } : {}),
      });
      return {
        ok: true,
        url: input,
        finalUrl: current.toString(),
        status: res.status,
        contentFound,
        truncated: res.truncated || trimmed.length > MAX_TEXT_CHARS,
        text: trimmed.slice(0, MAX_TEXT_CHARS),
      };
    }
    return fail(input, "too many redirects");
  }

  return { fetch: fetchPage, log, get count() { return count; } };
}

export type Fetcher = ReturnType<typeof createFetcher>;

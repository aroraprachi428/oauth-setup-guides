import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { applyGates } from "../lib/agent/gates";
import type { FetchLogEntry } from "../lib/agent/fetch";
import { readEntry, urlsToRead, withQuotes, STAGE2_URL } from "./fakes/evidence";

const ctx = { slug: "sample-guide", model: "fake-model", jobId: "job-1", today: "2026-10-24" };
const draft = () => {
  const g = withQuotes(fixture) as any;
  // What an agent might claim: every source "read in full".
  for (const c of g.claims) for (const s of c.sources) s.read = "full";
  return g;
};
const fetched = readEntry;

// Fetch log in which every fixture URL (sources, step links) and a Stage 2 page were really read.
const allRead = (): FetchLogEntry[] => urlsToRead().map((u) => fetched(u));

describe("applyGates", () => {
  it("sets read status from the fetch log, not from the agent", () => {
    const log = allRead().filter((e) => e.url !== "https://example.com/docs/scopes" && e.url !== "https://example.com/blocked");
    log.push(fetched("https://example.com/blocked", false));
    const { guide } = applyGates(draft(), log, ctx);
    const src = (id: string) => guide.claims.find((c: any) => c.id === id).sources[0];
    expect(src("c-create").read).toBe("full");
    expect(src("c-scopes").read).toBe("snippet"); // never fetched this run
    expect(src("c-cap").read).toBe("unfetchable"); // fetched, no content
    expect(src("c-create").retrievedAt).toBe("2026-10-24");
  });

  it("counts a redirect target as a read of the cited URL", () => {
    const log = allRead().map((e) =>
      e.url === "https://example.com/docs/oauth" ? { ...e, url: "https://example.com/old-oauth", finalUrl: "https://example.com/docs/oauth" } : e,
    );
    const { guide } = applyGates(draft(), log, ctx);
    expect(guide.claims.find((c: any) => c.id === "c-create").sources[0].read).toBe("full");
  });

  it.each([
    ["https://example.com/docs/oauth.md", "markdown twin"],
    ["https://example.com/docs/oauth.mdx", "mdx twin"],
    ["https://example.com/docs/oauth.html", "html twin"],
    ["https://example.com/docs/oauth/", "trailing slash"],
    ["https://example.com/docs/oauth/index.html", "index.html"],
    ["https://example.com/docs/oauth#scopes", "fragment"],
    ["https://WWW.Example.com/docs/oauth", "www and host case"],
  ])("counts %s as a read of the cited page (%s)", (fetchedUrl) => {
    const log = allRead().map((e) => (e.url === "https://example.com/docs/oauth" ? { ...e, url: fetchedUrl, finalUrl: fetchedUrl } : e));
    const { guide } = applyGates(draft(), log, ctx);
    expect(guide.claims.find((c: any) => c.id === "c-create").sources[0].read).toBe("full");
  });

  it("does not count a different page on the same site as a read", () => {
    const log = allRead().map((e) =>
      e.url === "https://example.com/docs/oauth" ? { ...e, url: "https://example.com/docs/oauth-v2", finalUrl: "https://example.com/docs/oauth-v2" } : e,
    );
    const { guide } = applyGates(draft(), log, ctx);
    expect(guide.claims.find((c: any) => c.id === "c-create").sources[0].read).toBe("snippet");
  });

  it("downgrades verified claims whose official source wasn't read in full", () => {
    const log = allRead().filter((e) => e.url !== "https://example.com/docs/scopes");
    const { guide, reasons } = applyGates(draft(), log, ctx);
    expect(guide.claims.find((c: any) => c.id === "c-scopes").label).toBe("uncertain");
    expect(reasons.join()).toMatch(/c-scopes/);
  });

  it("never accepts a tested label from the agent", () => {
    const d = draft();
    d.claims[0].label = "tested";
    d.claims[0].testedHow = "trust me";
    const { guide } = applyGates(d, allRead(), ctx);
    expect(guide.claims[0].label).toBe("uncertain");
    expect(guide.claims[0].testedHow).toBeUndefined();
  });

  it("stamps generator, source, slug and date regardless of the draft", () => {
    const d = draft();
    d.source = "curated";
    d.slug = "something-else";
    d.lastVerified = "1999-01-01";
    const { guide } = applyGates(d, allRead(), ctx);
    expect(guide.source).toBe("generated");
    expect(guide.slug).toBe("sample-guide");
    expect(guide.lastVerified).toBe("2026-10-24");
    expect(guide.generator).toEqual({ model: "fake-model", jobId: "job-1", generatedAt: "2026-10-24" });
  });

  it("publishes at 50% verified and holds back below it", () => {
    // Fixture: 6 claims, 3 verified when everything is read.
    expect(applyGates(draft(), allRead(), ctx).status).toBe("publish");
    const log = allRead().filter((e) => e.url !== "https://example.com/docs/tokens"); // 2 of 6 verified
    const below = applyGates(draft(), log, ctx);
    expect(below.status).toBe("requester_only");
    expect(below.reasons.join()).toMatch(/verified/);
  });

  it("holds back a draft that fails the schema, with the reasons", () => {
    const d = draft();
    delete d.profiles[0].stage1DoneWhen;
    const r = applyGates(d, allRead(), ctx);
    expect(r.status).toBe("requester_only");
    expect(r.reasons.join()).toMatch(/stage1DoneWhen/);
  });

  it("holds back a guide whose reader-facing text attributes sources", () => {
    const d = draft();
    d.steps[0].instructions[0] = "Per the docs, open the console.";
    const r = applyGates(d, allRead(), ctx);
    expect(r.status).toBe("requester_only");
    expect(r.reasons.join()).toMatch(/steps\[0\]\.instructions\[0\]: remove attribution "Per the docs"/);
  });

  it("doesn't police attribution inside claims", () => {
    const d = draft();
    d.claims[0].statement = "Per the docs, apps are self-serve.";
    expect(applyGates(d, allRead(), ctx).status).toBe("publish");
  });

  describe("evidence checks", () => {
    const reasonsFor = (d: any, log = allRead()) => applyGates(d, log, ctx).reasons.join("\n");

    it("downgrades a verified claim with no quote", () => {
      const d = draft();
      delete d.claims[0].sources[0].quote;
      const r = applyGates(d, allRead(), ctx);
      expect(r.guide.claims[0].label).toBe("uncertain");
      expect(r.reasons.join()).toMatch(/c-create: no quote/);
    });

    it("downgrades a verified claim whose quote isn't on the page", () => {
      const d = draft();
      d.claims[0].sources[0].quote = "PKCE is required for every application";
      const r = applyGates(d, allRead(), ctx);
      expect(r.guide.claims[0].label).toBe("uncertain");
      expect(r.reasons.join()).toMatch(/c-create: the quote isn't on/);
    });

    it("suggests the closest sentence from the page when a quote doesn't match", () => {
      const d = draft();
      d.claims[0].sources[0].quote = "Linking is limited to 50 users";
      const r = applyGates(d, allRead(), ctx);
      expect(r.reasons.join()).toMatch(/closest sentence on the page: "Linking is capped at 50 users before review\."/);
    });

    it("matches quotes despite case, spacing, Markdown and edge punctuation", () => {
      const d = draft();
      d.claims[0].sources[0].quote = "“The  Fixture page **states** this exact sentence.”";
      expect(applyGates(d, allRead(), ctx).guide.claims[0].label).toBe("verified");
    });

    it("holds back a limit whose number isn't on its cited pages", () => {
      const d = draft();
      d.limits[0].value = "8 tokens per minute";
      const r = applyGates(d, allRead(), ctx);
      expect(r.status).toBe("requester_only");
      expect(r.reasons.join()).toMatch(/limits\[0\].*8.*isn't on any page/);
    });

    it("holds back a guide with no Stage 2 page read", () => {
      const r = applyGates(draft(), allRead().filter((e) => e.url !== STAGE2_URL), ctx);
      expect(r.status).toBe("requester_only");
      expect(r.reasons.join()).toMatch(/Stage 2/);
    });

    it("holds back agent-owned steps that claim to need a human", () => {
      const d = draft();
      d.steps[0].owner = "agent";
      expect(reasonsFor(d)).toMatch(/steps\[0\].*owner "agent".*humanGate/);
    });

    it("holds back a review_submission gate when no review is required", () => {
      const d = draft();
      d.profiles[0].facts.requiresAppReview.value = false;
      d.profiles[0].blockerTags = ["user_cap"];
      d.profiles[0].verdict.stage2.band = "Days";
      expect(reasonsFor(d)).toMatch(/steps\[1\].*review_submission/);
    });

    it("holds back step links to pages that weren't read", () => {
      const log = allRead().filter((e) => e.url !== "https://example.com/developers/apps");
      const r = applyGates(draft(), log, ctx);
      expect(r.status).toBe("requester_only");
      expect(r.reasons.join()).toMatch(/steps\[0\]\.links\[0\].*wasn't read/);
    });
  });

  it("holds back garbage without throwing", () => {
    expect(applyGates("not a guide", [], ctx).status).toBe("requester_only");
    expect(applyGates({ claims: "x" }, [], ctx).status).toBe("requester_only");
  });
});

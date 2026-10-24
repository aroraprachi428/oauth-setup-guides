import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { findStyleIssues, styleIssuesInText } from "../lib/style";

describe("styleIssuesInText", () => {
  it.each([
    "Linear says refresh tokens rotate.",
    "Dropbox documents a 50-user limit.",
    "Google states the review takes weeks.",
    "Per Google, verification takes weeks.",
    "Verification takes weeks (per Google, 2025).",
    "Review is fast. Per Shopify staff the queue is short.",
    "per the docs, tokens last an hour",
    "Shopify's docs list the scopes.",
    "See the provider's guide for details.",
    "A vendor guide says this is required.",
    "Vendor guides describe a toggle.",
    "Developers report 2-week waits.",
    "Community reports suggest delays.",
    "The docs are silent on team apps.",
    "According to Microsoft, admins must consent.",
    "The token lifetime is documented as 1 hour.",
    "The documentation says PKCE is optional.",
  ])("flags %s", (text) => expect(styleIssuesInText(text)).not.toEqual([]));

  it.each([
    "Refresh tokens rotate on every use.",
    "Production approval is required after 50 linked users.",
    "Send client_id with code_verifier.",
    "Open the Dropbox App Console and click Create app.",
    "Under Status, click Apply for Production.",
    "Add the per-shop authorize URL.",
    "Reports never change a guide.",
    "Limit is 100 requests per user per hour.",
    "One app per Google Cloud project.",
    "Pay once per Partner account.",
    "Not documented.",
    "Per x_refresh_token_expires_in, refresh before expiry.",
    "The App Console's Settings tab lists the App key.",
  ])("allows %s", (text) => expect(styleIssuesInText(text)).toEqual([]));
});

describe("findStyleIssues", () => {
  const clone = () => structuredClone(fixture) as any;

  it("reports the field path and the phrase", () => {
    const g = clone();
    g.steps[0].instructions[1] = "Per the docs, click Create app.";
    g.profiles[0].bottomLine = "Developers report quick approval.";
    expect(findStyleIssues(g)).toEqual([
      { path: "profiles[0].bottomLine", phrase: "Developers report" },
      { path: "steps[0].instructions[1]", phrase: "Per the docs" },
    ]);
  });

  it("checks every user-facing field type", () => {
    const g = clone();
    const bad = "Linear says so.";
    g.profiles[0].intent = bad;
    g.profiles[0].verdict.stage1.summary = bad;
    g.profiles[0].verdict.stage2.time.range = bad;
    g.profiles[0].stage1DoneWhen.text = bad;
    g.profiles[0].blockedBy[0].how = bad;
    g.profiles[0].topRisks[0] = bad;
    g.profiles[0].facts.testModeLimits.text = bad;
    g.profiles[0].scopes[0].purpose = bad;
    g.steps[0].title = bad;
    g.requirements[0].howToPrepare = bad;
    g.limits[0].whenHit = bad;
    g.blockers[0].fix = bad;
    g.nuances[0].text = bad;
    g.technical.clientSecretHandling = bad;
    expect(findStyleIssues(g)).toHaveLength(14);
  });

  it("ignores claims, sources and notFound", () => {
    const g = clone();
    g.claims[0].statement = "Linear says refresh tokens rotate.";
    g.claims[0].sources[0].title = "Per Google";
    g.notFound[0].why = "The docs are silent on this.";
    expect(findStyleIssues(g)).toEqual([]);
  });

  it("tolerates partial drafts", () => {
    expect(findStyleIssues({})).toEqual([]);
    expect(findStyleIssues({ steps: [{ title: 3 }], profiles: "x" })).toEqual([]);
  });
});

// Curated guides are held to the same rule as agent-written ones.
describe("curated guides", () => {
  const dir = path.join(process.cwd(), "content", "guides");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${f} has no attribution phrasing`, () => {
      const issues = findStyleIssues(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      expect(issues.map((i) => `${i.path}: "${i.phrase}"`)).toEqual([]);
    });
  }
});

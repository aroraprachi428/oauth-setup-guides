import type { Transport, TransportResponse } from "./fetch";
import type { Message, ModelAdapter, ModelTurn } from "./model";

// LOCAL DEMO ONLY (AGENT_MODEL=demo). A scripted model and canned pages, so the whole
// add flow can be exercised end to end without network access or API quota.
// It does no research: every guide it writes says so in its name, intent and claims.

const DEMO_HOST = "demo-docs.invalid";
const pageUrl = (slug: string, p: string) => `https://${DEMO_HOST}/${slug}/${p}`;

export const demoTransport: Transport = async (url): Promise<TransportResponse> => {
  if (url.pathname === "/robots.txt") return { status: 404, headers: {}, body: "", truncated: false };
  return {
    status: 200,
    headers: { "content-type": "text/html" },
    body: `<html><body><main><h1>Demo page ${url.pathname}</h1><p>${"Canned demo text, not real documentation. ".repeat(20)}</p></main></body></html>`,
    truncated: false,
  };
};

function demoGuide(appName: string, slug: string) {
  const src = (p: string) => ({ url: pageUrl(slug, p), title: `Demo page ${p}`, kind: "official", read: "full", retrievedAt: "2026-01-01" });
  const claim = (id: string, statement: string, p: string) => ({ id, statement: `DEMO: ${statement}`, label: "verified", sources: [src(p)] });
  return {
    app: {
      name: `${appName} (demo, not researched)`,
      website: `https://${DEMO_HOST}/${slug}`,
      category: "Demo",
      developerPortalUrl: pageUrl(slug, "console"),
      primaryDocsUrl: pageUrl(slug, "oauth"),
    },
    version: 1,
    oauthSupport: "public",
    technical: {
      oauthVersion: "2.0",
      pkce: "unknown",
      clientSecretHandling: "DEMO: placeholder text.",
      refreshTokens: { supported: "unknown" },
      redirectUriRules: [],
      claimIds: ["c-oauth"],
    },
    profiles: [
      {
        id: "demo",
        intent: "DEMO: placeholder intent, not real research",
        audience: "public_multi_tenant",
        scopes: [{ name: "demo.read", purpose: "DEMO: placeholder scope", claimIds: ["c-oauth"] }],
        facts: {
          selfServeCreation: { value: true, claimIds: ["c-create"] },
          requiresAppReview: { value: "not_mentioned", claimIds: [] },
          requiresSecurityAssessment: { value: "not_mentioned", claimIds: [] },
          requiresBusinessVerification: { value: "not_mentioned", claimIds: [] },
          requiresDomainVerification: { value: "not_mentioned", claimIds: [] },
          partnerProgramGated: { value: "not_mentioned", claimIds: [] },
          paidAccessRequired: { value: "not_mentioned", claimIds: [] },
          legalEntityRequired: { value: "not_mentioned", claimIds: [] },
          marketplaceListingOptional: { value: "not_mentioned", claimIds: [] },
          configGotchas: [],
        },
        verdict: {
          stage1: { band: "Instant", summary: "DEMO: placeholder.", time: { range: null, basis: "unknown", claimIds: [] }, claimIds: ["c-create"] },
          stage2: { band: "None documented", summary: "DEMO: placeholder.", time: { range: null, basis: "unknown", claimIds: [] }, claimIds: [] },
        },
        blockerTags: ["none"],
        stage1DoneWhen: { text: "DEMO: placeholder check.", claimIds: ["c-oauth"] },
        blockedBy: [],
        stepIds: ["create-app"],
        requirementIds: [],
        limitIds: [],
        blockerIds: [],
        bottomLine: "DEMO guide produced by the scripted local demo model. Not real research.",
        topRisks: [],
      },
    ],
    defaultProfileId: "demo",
    steps: [
      {
        id: "create-app",
        stage: 1,
        title: "DEMO: placeholder step",
        owner: "developer",
        instructions: ["DEMO: placeholder instruction."],
        links: [],
        agentMarkBasis: "expected_from_docs",
        claimIds: ["c-create"],
      },
    ],
    requirements: [],
    limits: [],
    blockers: [],
    nuances: [],
    notFound: [{ item: "Everything", why: "This guide came from the local demo model, which does no research.", claimIds: [] }],
    claims: [claim("c-create", "apps are self-serve.", "console"), claim("c-oauth", "the provider supports OAuth 2.0.", "oauth")],
  };
}

const appFromTask = (messages: Message[]) => {
  const task = messages.find((m) => m.role === "user")?.content ?? "";
  return {
    appName: (task.match(/<app_name>([^<]*)<\/app_name>/)?.[1] ?? "Unknown app").replace(/ \(demo, not researched\)$/, ""),
    slug: task.match(/slug "([^"]+)"/)?.[1] ?? "unknown-app",
  };
};

export function demoModel(): ModelAdapter {
  return {
    name: "demo-scripted-model",
    async complete(_system, messages): Promise<ModelTurn> {
      const { appName, slug } = appFromTask(messages);
      const turns = messages.filter((m) => m.role === "assistant").length;
      const usage = { inputTokens: 0, outputTokens: 0 };
      const id = (n: string) => `${n}-${turns}`;
      if (turns === 0) {
        return { text: "", usage, toolCalls: ["console", "oauth"].map((p) => ({ id: id(`fetch-${p}`), name: "fetch", args: { url: pageUrl(slug, p) } })) };
      }
      if (turns === 1) return { text: "", usage, toolCalls: [{ id: id("draft"), name: "set_draft", args: { fields: demoGuide(appName, slug) } }] };
      return { text: "", usage, toolCalls: [{ id: id("submit"), name: "submit_guide", args: {} }] };
    },
  };
}

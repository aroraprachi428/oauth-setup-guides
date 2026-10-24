import { z } from "zod";

// Single source of truth for guide content. Adapted from PRD §6 to the Step 2
// evidence labels and two-stage bands. Rubric checks live in lib/bands.ts.

export const CLAIM_LABELS = ["verified", "reported", "uncertain", "tested"] as const;
export const SOURCE_KINDS = ["official", "vendor", "community"] as const;
export const READ_MODES = ["full", "snippet", "unfetchable"] as const;

export const STAGE1_BANDS = ["Instant", "Same day", "Days", "Weeks or more", "Gated"] as const;
export const STAGE2_BANDS = ["None documented", ...STAGE1_BANDS] as const;

export const BLOCKER_TAGS = [
  "user_cap",
  "review",
  "security_assessment",
  "business_verification",
  "admin_consent_or_per_tenant",
  "cost",
  "partner_approval",
  "none",
] as const;

export const HUMAN_GATES = [
  "identity_check",
  "payment",
  "legal_attestation",
  "two_factor",
  "captcha",
  "review_submission",
] as const;

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase kebab-case");
const isoDate = z.iso.date();
const claimIds = z.array(id);

const MAX_QUOTE_WORDS = 14;

export const SourceSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  // "full" means the page was opened and read, not just seen as a search snippet.
  read: z.enum(READ_MODES),
  retrievedAt: isoDate,
  quote: z
    .string()
    .refine((q) => q.trim().split(/\s+/).length <= MAX_QUOTE_WORDS, {
      message: `quotes must be under 15 words`,
    })
    .optional(),
});

export const ClaimSchema = z
  .object({
    id,
    statement: z.string().min(1),
    label: z.enum(CLAIM_LABELS),
    sources: z.array(SourceSchema),
    // Believed but not sourced; only allowed on uncertain claims.
    unsourced: z.boolean().optional(),
    testedHow: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.unsourced && c.label !== "uncertain") {
      ctx.addIssue({ code: "custom", message: `claim ${c.id}: only uncertain claims may be unsourced` });
    }
    if (!c.unsourced && c.sources.length === 0) {
      ctx.addIssue({ code: "custom", message: `claim ${c.id}: needs at least one source (or mark it uncertain + unsourced)` });
    }
    if (c.label === "verified" && !c.sources.some((s) => s.kind === "official" && s.read === "full")) {
      ctx.addIssue({ code: "custom", message: `claim ${c.id}: verified needs an official source read in full` });
    }
    if (c.label === "tested" && !c.testedHow) {
      ctx.addIssue({ code: "custom", message: `claim ${c.id}: tested needs testedHow` });
    }
  });

// "not_mentioned": the docs read say nothing about it. "unknown": sources conflict or couldn't be read.
const Fact = z.object({
  value: z.union([z.boolean(), z.literal("not_mentioned"), z.literal("unknown")]),
  claimIds,
});

const Note = z.object({ text: z.string().min(1), claimIds });
// A heads-up (warning or quirk). stepId pins it to the step it belongs to; without one, readers
// see it under "More details".
const stepId = id.optional();
const HeadsUp = Note.extend({ stepId });

export const ReviewFactsSchema = z.object({
  selfServeCreation: Fact,
  requiresAppReview: Fact,
  requiresSecurityAssessment: Fact,
  requiresBusinessVerification: Fact,
  requiresDomainVerification: Fact,
  partnerProgramGated: Fact,
  paidAccessRequired: Fact,
  legalEntityRequired: Fact,
  marketplaceListingOptional: Fact,
  testModeLimits: Note.optional(),
  configGotchas: z.array(HeadsUp),
});

export const TimeEstimateSchema = z.object({
  // Free text such as "1–3 business days"; null when nothing supports a range.
  range: z.string().min(1).nullable(),
  basis: z.enum(["official", "community", "unknown"]),
  // What starts the clock, e.g. "after 50 users have linked".
  startsWhen: z.string().min(1).optional(),
  claimIds,
});

const stageVerdict = <B extends readonly [string, ...string[]]>(bands: B) =>
  z.object({
    band: z.enum(bands),
    summary: z.string().min(1),
    time: TimeEstimateSchema,
    claimIds,
  });

export const ScopeSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  claimIds,
});

export const BlockedBySchema = z.object({
  party: z.enum(["provider", "tenant_admin", "you"]),
  how: z.string().min(1),
  claimIds,
});

export const ProfileSchema = z.object({
  id,
  intent: z.string().min(1),
  audience: z.enum(["self_or_testers", "public_multi_tenant"]),
  scopes: z.array(ScopeSchema).min(1),
  facts: ReviewFactsSchema,
  verdict: z.object({
    stage1: stageVerdict(STAGE1_BANDS),
    stage2: stageVerdict(STAGE2_BANDS),
  }),
  blockerTags: z.array(z.enum(BLOCKER_TAGS)).min(1),
  stage1DoneWhen: Note,
  blockedBy: z.array(BlockedBySchema),
  stepIds: z.array(id).min(1),
  requirementIds: z.array(id),
  limitIds: z.array(id),
  blockerIds: z.array(id),
  bottomLine: z.string().min(1),
  topRisks: z.array(z.string()).max(3),
});

export const StepSchema = z.object({
  id,
  stage: z.union([z.literal(1), z.literal(2)]),
  title: z.string().min(1),
  owner: z.enum(["agent", "developer", "provider"]),
  instructions: z.array(z.string().min(1)).min(1),
  links: z.array(z.object({ label: z.string(), url: z.url() })),
  estimateMinutes: z.number().int().positive().optional(),
  humanGate: z.enum(HUMAN_GATES).optional(),
  // Agent/human marks are expectations from docs until a hands-on run tests them.
  agentMarkBasis: z.enum(["expected_from_docs", "tested"]),
  uiLabelsMayBeStale: z.boolean().optional(),
  claimIds,
});

export const RequirementSchema = z.object({
  id,
  label: z.string().min(1),
  detail: z.string().min(1),
  howToPrepare: z.string().min(1),
  agentCanDraft: z.boolean(),
  claimIds,
});

export const LimitSchema = z.object({
  id,
  what: z.string().min(1),
  value: z.string().min(1),
  whenHit: z.string().min(1),
  claimIds,
});

export const BlockerSchema = z.object({
  id,
  stepId,
  symptom: z.string().min(1),
  cause: z.string().min(1),
  fix: z.string().min(1),
  claimIds,
});

export const TechnicalSchema = z.object({
  authorizationUrl: z.url().optional(),
  tokenUrl: z.url().optional(),
  discoveryUrl: z.url().optional(),
  oauthVersion: z.enum(["2.0", "1.0a", "oidc"]),
  pkce: z.enum(["required", "supported", "unsupported", "unknown"]),
  clientSecretHandling: z.string().min(1),
  refreshTokens: z.object({
    supported: z.union([z.boolean(), z.literal("unknown")]),
    expiry: z.string().optional(),
    notes: z.string().optional(),
  }),
  accessTokenLifetime: z.string().optional(),
  redirectUriRules: z.array(z.string().min(1)),
  claimIds,
});

export const GuideSchema = z
  .object({
    slug: id,
    app: z.object({
      name: z.string().min(1),
      website: z.url(),
      category: z.string().min(1),
      developerPortalUrl: z.url(),
      primaryDocsUrl: z.url(),
      logoUrl: z.url().optional(),
    }),
    source: z.enum(["curated", "generated"]),
    // Set by the research agent; required on generated guides, forbidden on curated ones.
    generator: z.object({ model: z.string().min(1), jobId: z.string().min(1), generatedAt: isoDate }).optional(),
    version: z.number().int().positive(),
    lastVerified: isoDate,
    oauthSupport: z.enum(["public", "partner_only", "none"]),
    technical: TechnicalSchema,
    profiles: z.array(ProfileSchema).min(1),
    defaultProfileId: id,
    steps: z.array(StepSchema).min(1),
    requirements: z.array(RequirementSchema),
    limits: z.array(LimitSchema),
    blockers: z.array(BlockerSchema),
    nuances: z.array(z.object({ id, text: z.string().min(1), stepId, claimIds })),
    notFound: z.array(z.object({ item: z.string().min(1), why: z.string().min(1), claimIds })),
    claims: z.array(ClaimSchema).min(1),
  })
  .superRefine((g, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });

    const uniq = (kind: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const i of ids) {
        if (seen.has(i)) issue(`duplicate ${kind} id: ${i}`);
        seen.add(i);
      }
      return seen;
    };
    const claims = uniq("claim", g.claims.map((c) => c.id));
    const steps = uniq("step", g.steps.map((s) => s.id));
    const reqs = uniq("requirement", g.requirements.map((r) => r.id));
    const limits = uniq("limit", g.limits.map((l) => l.id));
    const blockers = uniq("blocker", g.blockers.map((b) => b.id));
    const profiles = uniq("profile", g.profiles.map((p) => p.id));
    uniq("nuance", g.nuances.map((n) => n.id));

    if (!profiles.has(g.defaultProfileId)) issue(`defaultProfileId ${g.defaultProfileId} is not a profile`);
    if (g.source === "generated" && !g.generator) issue("generated guides need generator info");
    if (g.source === "curated" && g.generator) issue("curated guides must not have generator info");

    // Every claimIds array anywhere in the guide must point at a real claim.
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "claimIds" && Array.isArray(v)) {
            for (const cid of v) if (!claims.has(cid)) issue(`${path}.claimIds: unknown claim ${cid}`);
          } else if (k !== "claims") walk(v, `${path}.${k}`);
        }
      }
    };
    walk(g, "guide");

    const stepRef = (path: string, sid: string | undefined) => sid !== undefined && !steps.has(sid) && issue(`${path}.stepId: unknown step ${sid}`);
    g.nuances.forEach((n) => stepRef(`nuance ${n.id}`, n.stepId));
    g.blockers.forEach((b) => stepRef(`blocker ${b.id}`, b.stepId));
    g.profiles.forEach((p) => p.facts.configGotchas.forEach((c, i) => stepRef(`profile ${p.id} configGotchas[${i}]`, c.stepId)));

    const stepById = new Map(g.steps.map((s) => [s.id, s]));
    for (const p of g.profiles) {
      const ref = (kind: string, ids: string[], pool: Set<string>) =>
        ids.forEach((i) => pool.has(i) || issue(`profile ${p.id}: unknown ${kind} ${i}`));
      ref("step", p.stepIds, steps);
      ref("requirement", p.requirementIds, reqs);
      ref("limit", p.limitIds, limits);
      ref("blocker", p.blockerIds, blockers);
      if (!p.stepIds.some((s) => stepById.get(s)?.stage === 1)) issue(`profile ${p.id}: needs at least one Stage 1 step`);
      if (p.blockerTags.includes("none") && p.blockerTags.length > 1) issue(`profile ${p.id}: "none" cannot be combined with other tags`);
    }
  });

export type Source = z.infer<typeof SourceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];
export type ReviewFacts = z.infer<typeof ReviewFactsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Limit = z.infer<typeof LimitSchema>;
export type Blocker = z.infer<typeof BlockerSchema>;
export type Guide = z.infer<typeof GuideSchema>;
export type Stage1Band = (typeof STAGE1_BANDS)[number];
export type Stage2Band = (typeof STAGE2_BANDS)[number];
export type BlockerTag = (typeof BLOCKER_TAGS)[number];

# PRD — OAuth Readiness Guides

**Composio APM Integrations take-home** · Draft v1 · 2026-10-22 · Owner: Prachi Arora

> **One line:** Look up any app and get a shareable guide that tells you how hard it is to get its OAuth app production-ready, how long it will take (hands-on work vs. waiting for approval), what could block you, and which steps an agent can do for you.

**Assumptions to confirm** (they shape the scope below): about 5–7 working days to build; a hosted, publicly reachable demo; Next.js + Claude stack. If any of these change, see §10.

---

## 1. Problem statement

A developer building an AI agent needs their users to connect third-party apps. Before launch, they usually have to **create an OAuth app with each provider and get it approved**. Today they piece this together from docs, console UIs, review policies and support emails. They **can't predict whether setup takes an hour or six weeks**, and blockers (security assessments, business verification, partner programs, paid tiers) only show up halfway through.

What this costs: launches slip, integrations get dropped after the work has started, and developers ship in "testing mode" without knowing its limits (e.g. Google's 100-test-user cap, or refresh tokens that expire after 7 days in testing).

**What exists today:** Composio's [auth guides](https://composio.dev/auth) (46 of them) answer *"how do I click through the console to create credentials."* They don't answer *"how hard, how long, what blocks me, and what happens after creation."* That gap is the product.

**Key insight:** difficulty isn't a fixed property of an app. It depends on **which scopes you need** (Gmail read = *restricted*, Calendar = *sensitive*, profile = neither) and **who your users are** (just you or testers vs. public multi-tenant). A guide has to be scope-aware and audience-aware, or it will be wrong for half its readers.

## 2. Goals

| # | Goal | How we'll know |
|---|------|----------------|
| G1 | A developer can tell in **under 30 seconds** whether an app is a "today" or "next month" integration | The verdict card (tier + effort + wait + top risks) sits above the fold on every guide |
| G2 | A developer always knows **the next step and who owns it** (agent / you / provider) | Every step has an owner and an order; nothing is left as "see docs" |
| G3 | Guidance is **trustworthy and honest about uncertainty** | ≥ 90% of claims cite a source or are marked *tested*; anything unknown is labelled, not guessed |
| G4 | **Any app**, not just curated ones, gets a usable guide in real time | Live generation returns a complete, schema-valid guide in **≤ 3 min** (p90) |
| G5 | Guides are **shareable without explanation** | Each guide has a stable public URL plus Markdown export; a teammate can act on it cold |

## 3. Non-goals (MVP)

- **All 100 guides.** We demo 6 curated guides plus live generation. The schema and pipeline are built to scale to 100, but writing them isn't the point of the take-home.
- **Fully autonomous setup** (the agent creates real provider accounts, passes ID checks, pays). Doing this breaks provider ToS, requires a human for KYC, and is risky. The agent investigates and prepares; the human signs.
- **Executing the submission to provider review.** We generate the review *materials*, not the submission itself.
- **User accounts, teams or auth for our own app.** Guides are public, so there's nothing to log into. This keeps scope tight.
- **Auto-refreshing guides when providers change policy.** Out of scope. We show `lastVerified` and allow re-generation on demand.
- **Non-OAuth auth** (API keys, basic auth), except as a one-line "this app doesn't use OAuth" result.

## 4. Users & user stories

**Personas**
- **Agent builder (primary):** a developer at a startup adding integrations to an AI agent. Has never set up a Google or Meta OAuth app before.
- **Tech lead / PM (secondary):** decides which integrations make the launch and needs timelines to plan around.
- **Composio integrations team (internal):** maintains the library and wants to add apps cheaply.

**Agent builder**
1. As an agent builder, I want to search for an app and immediately see how hard its OAuth setup is, so I can decide whether to include it in this launch.
2. As an agent builder, I want to choose the scopes and audience I need and see the verdict change, so the estimate matches *my* integration rather than a generic one.
3. As an agent builder, I want an ordered checklist where each step says who does it (agent / me / provider), so I always know what to do next.
4. As an agent builder, I want to know what I'll be asked for during review (privacy policy, domain verification, demo video, security assessment) before I start, so I can prepare in parallel.
5. As an agent builder, I want the agent to draft review materials (scope justifications, privacy policy, demo video script), so I don't start from a blank page.
6. As an agent builder who hit a rejection or error, I want a blocker playbook (symptom → cause → fix), so I can recover without emailing the provider.
7. As an agent builder, I want to submit an app that isn't in the library and watch the agent investigate it, so I get a guide for niche apps too.
8. As an agent builder, I want to see what was tested, what is sourced and what is uncertain, so I know how much to trust each line.

**Tech lead / PM**
9. As a tech lead, I want to share a link to a guide and a library view sorted by time to production, so I can plan the integration roadmap.

**Edge cases**
10. As a user who submits an app with no public OAuth, I want a clear answer ("no OAuth; uses API keys" or "OAuth is partner-only; here's how to apply") rather than an invented guide.
11. As a user whose live generation fails partway, I want the partial guide with gaps clearly labelled and a retry option, not an error page.
12. As a user who submits an ambiguous name ("Notion" vs "Notion Calendar"), I want to confirm which app is meant before generation starts.

---

## 5. Requirements

### P0: must-have (the MVP fails without these)

**P0-1 Guide library page**
- Grid of guides with name, logo, tier badge, "hands-on ≈ X h · wait ≈ Y" and a review-required flag.
- Filter by tier; sort by time to production; search by name.
- A search with no match shows "Generate a guide for '<query>'", which leads into P0-4.
- ✅ Given 6 curated guides, when I filter to 🟠, then only review-gated guides are shown.

**P0-2 Guide page**
- **Verdict card:** tier, hands-on effort range, wait range, overall confidence, top 3 risks, one-line "bottom line."
- **Profile selector** (scope set × audience). Switching profile recalculates the verdict and shows or hides the relevant steps and requirements. Each guide ships with 1–3 profiles (e.g. Google: *Sign-in only* / *Calendar* / *Gmail read*).
- **Path timeline:** phases (Create → Configure → Test mode → Verification/Review → Production), each with duration and whether you can ship to some users during it.
- **Steps:** ordered, each with an owner (🤖 agent / 👤 you / 🏢 provider), an estimate, instructions, deep links, and evidence references.
- **Requirements checklist:** the exact artefacts needed (privacy policy URL, homepage, verified domain, logo, demo video, business documents, security assessment).
- **Blocker playbook:** symptom → likely cause → fix.
- **Evidence panel:** every claim with a status (`tested` / `sourced` / `inferred` / `unknown`), source URL and checked date.
- ✅ Given the Google guide, when I switch from *Calendar* to *Gmail read*, then the tier moves from 🟠 to 🔴, the CASA assessment step appears, and the wait range grows to weeks.

**P0-3 Six curated guides** (see §7), human-verified, with as many claims as possible at `tested` status.

**P0-4 Live generation**
- Input an app name or URL, then get a disambiguation step if the match is unclear.
- A progress view streams pipeline stages and findings as they happen ("Found OAuth endpoints at …", "Review policy: App Review required for advanced access").
- The output is a guide in the same schema and UI as curated guides, labelled "AI-generated · confidence X".
- Partial failure produces a partial guide with `unknown` claims and a "retry stage" control.
- ✅ Given an app not in the library, when I submit it, then within 3 minutes (p90) I land on a shareable guide URL.
- ❌ It must not show a source URL that doesn't resolve (every cited URL is fetched and checked during the run).

**P0-5 Deterministic tiering.** The LLM extracts *facts* (flags such as `requiresAppReview`, `requiresSecurityAssessment`); **code computes the tier and estimates** from those facts using a published rubric (§6.3). This keeps tiers consistent across curated and generated guides, and it can be explained.

**P0-6 Sharing.** Stable URL `/guides/<slug>?profile=<id>`, a "Copy as Markdown" checklist, and Open Graph preview metadata.

**P0-7 Methodology page.** Explains tiers, the estimate model, evidence statuses, and what "tested" means for curated guides vs. generated ones. This is the "be clear about what you tested" requirement.

### P1: nice-to-have (fast follows if time allows)

- **P1-1 Agent-drafted review kit:** per profile, generate scope justification text, a privacy policy draft, a demo-video shot list, and answers to the provider's review form questions.
- **P1-2 Redirect / endpoint probe:** a live check that calls the authorize endpoint with a dummy `client_id` and records how the provider responds. This turns "endpoint exists" into `tested`.
- **P1-3 Library comparison view:** a table across apps of tier, wait, review type and paywall, for roadmap planning.
- **P1-4 "I hit this" feedback** on blockers and steps, stored for maintainers.
- **P1-5 Accuracy self-eval:** run live generation on the 6 curated apps and diff against the curated truth (tier, key requirements). Show the score on the methodology page.

### P2: future (design for it, don't build it)

- Scale the library to 100 guides via a batch run of the pipeline plus human review queue.
- Scheduled re-verification with a diff ("Meta changed App Review rules on <date>").
- Browser agent that completes setup inside the user's own signed-in session, handing control back at human gates.
- Tie-in with Composio: "Skip all of this, use Composio's managed OAuth app" wherever it's available.
- Export to Linear/Jira as tickets.

---

## 6. Guide schema

A single schema is the source of truth for curated and generated guides. The UI only renders it. It's defined in Zod (`lib/schema.ts`), which also serves as the structured-output schema for the LLM.

### 6.1 Shape

```ts
Guide {
  slug: string                       // "google-workspace"
  app: { name, website, logoUrl, category, developerPortalUrl }
  source: "curated" | "generated"
  version: number
  lastVerified: ISODate
  overallConfidence: "high" | "medium" | "low"
  oauthSupport: "public" | "partner_only" | "none"   // "none" → short-circuit result
  technical: {                       // provider facts, profile-independent
    authorizationUrl?, tokenUrl?, discoveryUrl?,
    oauthVersion: "2.0" | "1.0a" | "oidc",
    pkce: "required" | "supported" | "unsupported" | "unknown",
    refreshTokens: { supported: bool, expiry?: string, notes? },
    accessTokenLifetime?: string,
    redirectUriRules: string[],      // "HTTPS only", "exact match", "max 10"
    claimIds: string[]
  }
  profiles: Profile[]                // 1–3 scope × audience variants
  steps: Step[]                      // shared pool; profiles select by id
  requirements: Requirement[]
  blockers: Blocker[]
  claims: Claim[]                    // the evidence ledger
  agentRun?: AgentRun                // generated guides only
}

Profile {
  id: "gmail-read"
  label: "Read & send Gmail"
  scopes: string[]                   // "https://www.googleapis.com/auth/gmail.readonly"
  audience: "self_or_testers" | "public_multi_tenant"
  facts: ReviewFacts                 // extracted → drives tier
  verdict: Verdict                   // computed, never LLM-written
  phases: Phase[]
  stepIds: string[]; requirementIds: string[]; blockerIds: string[]
  bottomLine: string                 // one sentence, LLM-written
  topRisks: string[]                 // ≤ 3
}

ReviewFacts {                        // each fact carries claimIds
  selfServeCreation: bool
  requiresAppReview: bool            // provider reviews the app before public use
  requiresSecurityAssessment: bool   // e.g. Google CASA
  requiresBusinessVerification: bool // e.g. Meta
  requiresDomainVerification: bool
  partnerProgramGated: bool          // e.g. LinkedIn Marketing APIs
  paidAccessRequired: bool           // e.g. X API tiers
  testModeLimits?: string            // "100 test users; refresh tokens expire in 7 days"
  marketplaceListingOptional: bool
  configGotchas: string[]            // "Enable Manage Distribution", "HTTPS-only redirects"
}

Verdict {
  tier: "green" | "yellow" | "orange" | "red"
  handsOnHours: [min, max]
  waitDays: [min, max]
  canShipToTestersFirst: bool
  confidence: "high" | "medium" | "low"
}

Phase   { name, waitDays: [min,max], handsOnHours: [min,max], usersUnblocked: "none"|"testers"|"all" }
Step    { id, title, owner: "agent"|"developer"|"provider", estimateMinutes,
          instructions: markdown, links: {label,url}[], agentCanDo?: string, claimIds }
Requirement { id, label, detail, howToPrepare, agentCanDraft: bool, claimIds }
Blocker { id, symptom, cause, fix, claimIds }

Claim {
  id, statement
  status: "tested" | "sourced" | "inferred" | "unknown"
  sources: { url, title, quote?, fetchedAt }[]   // required unless inferred/unknown
  testedHow?: string                             // "Created app in console 2026-10-24"
}

AgentRun { startedAt, durationMs, stages: { name, status, summary, durationMs }[],
           stoppedAtHumanGate?: string, model: string }
```

### 6.2 Evidence rules (enforced in code)
- `sourced` claims must have at least 1 source URL that returned HTTP 2xx during the run. If not, the claim is downgraded to `inferred`.
- `tested` exists only in curated guides, where a human performed the step (with `testedHow`), or for P1-2 live probes.
- Every `ReviewFacts` field must link to at least one claim. A fact with no claim is set to `unknown`, and the verdict confidence drops.

### 6.3 Tier and estimate rubric (code, not LLM)

| Tier | Rule (first match wins) | Typical wait |
|---|---|---|
| 🔴 **Gated** | `partnerProgramGated` OR `requiresSecurityAssessment` OR `oauthSupport = partner_only` | weeks–months |
| 🟠 **Review** | `requiresAppReview` OR `requiresBusinessVerification` OR `paidAccessRequired` | days–weeks |
| 🟡 **Self-serve with gotchas** | `requiresDomainVerification` OR `testModeLimits` set OR `configGotchas` non-empty | minutes–hours |
| 🟢 **Self-serve** | none of the above | minutes |

- **Hands-on hours** = the sum of step estimates where the owner is developer or agent. **Wait days** = the sum of phase wait times where the owner is provider.
- Wait ranges come from a lookup table per review type (e.g. Google sensitive-scope verification, Meta App Review), each sourced. Where no source exists, the range is marked `inferred`.
- **Confidence** is the lowest of: the share of facts that are sourced or tested, and the stage completion of the run.

---

## 7. The 6 demo apps

These were picked to **cover every tier and every kind of blocker**, so the demo shows the rubric doing work rather than six similar guides. All provider facts below are **starting hypotheses to verify during the build**. Each one becomes a claim with a source.

| # | App | Profiles | Expected tier | Why it's in the set (nuance to show) |
|---|---|---|---|---|
| 1 | **GitHub** | Repo access (OAuth App) · GitHub App | 🟢 | Easy baseline. Nuance: OAuth App vs GitHub App choice; OAuth App tokens don't expire; single callback URL |
| 2 | **Slack** | Bot in own workspace · Public distribution | 🟢 → 🟡 | Same app, two audiences. "Manage Distribution" toggle and HTTPS redirects; unlisted commercial apps have `conversations.history`/`replies` cut to Tier 1 (1 req/min, 15 objects), so the Marketplace is effectively required for read-heavy agents (sourced, §7.1) |
| 3 | **Google Workspace** | Sign-in only · Calendar · Gmail read | 🟢 → 🟠 → 🔴 | **Showcase for scope-awareness.** Testing mode (100 users, 7-day refresh tokens); sensitive-scope verification; restricted scopes need an annual CASA assessment; domain verification; demo video |
| 4 | **Meta (Instagram API)** | Own account (standard access) · Public users (advanced access) | 🟡 → 🟠 | Business verification + App Review with screencast per permission; Basic Display deprecated, so the "old tutorials are wrong" problem shows up here |
| 5 | **LinkedIn** | Sign in with LinkedIn (OIDC) · Post on behalf of members · Community Management API | 🟢 → 🔴 | Self-serve products vs a partner-gated program; company page verification; product-combination restrictions |
| 6 | **Salesforce** | Connected App in own org · Distribute via AppExchange | 🟡 → 🔴 | Easy to create, hard to distribute (AppExchange security review, fees); since Spring '26, creating new Connected Apps is restricted by default and External Client Apps are the path forward, so most older tutorials are now wrong (sourced, §7.1) |

### 7.1 Source map: where developers look today

The brief names three things developers do today: **piece together documentation**, **work through unfamiliar setup flows**, and **email providers**. These are the actual sources behind each one for the 6 demo apps. They become (a) the seed evidence for the curated guides and (b) the three source types that pipeline stage 1 hunts for on any new app. All links were checked on 2026-10-22: HTTP 200, or 403 for bot-blocked pages, which are marked †.

| App | 📄 Documentation | 🛠️ Setup flow (where you click) | ✉️ Talking to the provider |
|---|---|---|---|
| **GitHub** | [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) · [GitHub Apps vs OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps) | [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) → [Settings › Developer settings](https://github.com/settings/developers) | No approval step for OAuth Apps. [GitHub Support](https://support.github.com) tickets; [Community Discussions](https://github.com/orgs/community/discussions); [Marketplace docs](https://docs.github.com/en/apps/github-marketplace) only if you list |
| **Slack** | [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth) · [Scopes reference](https://docs.slack.dev/reference/scopes) · [App distribution](https://docs.slack.dev/distribution) · [Non-Marketplace rate limit change](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) | [api.slack.com/apps](https://api.slack.com/apps) → OAuth & Permissions → Manage Distribution → *Submit to the Slack Marketplace* | [Marketplace review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide): **no review-team email**. Feedback arrives inside the submission flow and status by email. General: [Slack help request](https://slack.com/help/requests/new) |
| **Google** | [OAuth 2.0 overview](https://developers.google.com/identity/protocols/oauth2) · [Scopes list](https://developers.google.com/identity/protocols/oauth2/scopes) · [Policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) · [Sensitive](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) / [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | [Google Auth Platform console](https://console.cloud.google.com/auth/overview) → Branding, Audience, Data Access, Clients → *Publish app* → *Prepare for verification* ([submission steps](https://support.google.com/cloud/answer/13461325)) | [OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073) · [Verification requirements](https://support.google.com/cloud/answer/13464321). **All communication is by email to the project's Owners/Editors**, so a stale owner email silently stalls review. CASA is run by a third-party assessor ([App Defense Alliance CASA](https://appdefensealliance.dev/casa)) |
| **Meta (Instagram)** | [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview) · [App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review) · [App Review process](https://developers.facebook.com/docs/resp-plat-initiatives/app-review) · [Business verification](https://developers.facebook.com/docs/development/release/business-verification) | [App Dashboard](https://developers.facebook.com/apps) → Instagram › API setup with Instagram login → App Review → connect a **verified business** before publishing | [Developer Support](https://developers.facebook.com/support/) (**login-gated**, so content isn't visible until you sign in) · [Bug reports](https://developers.facebook.com/support/bugs/) · [Community forum](https://developers.facebook.com/community/). App Review feedback arrives in the dashboard |
| **LinkedIn** | [Authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) · [Getting access (products & permissions)](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) · [Community Mgmt app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review) | [Developer Portal › My Apps](https://www.linkedin.com/developers/apps) → Create app → verify Company Page → Products tab → vetting survey | [API Partner Support guide](https://learn.microsoft.com/en-us/linkedin/shared/linkedin-api-partner-support-guide) → [contact form](https://www.linkedin.com/help/linkedin/ask/dsapi) (form type: *Developer Support* or *Vetting Appeal*). Reviewers follow up **by email to your business address** |
| **Salesforce** | [External Client Apps](https://help.salesforce.com/s/articleView?id=xcloud.external_client_apps.htm&type=5) · [Connected Apps overview](https://help.salesforce.com/s/articleView?id=sf.connected_app_overview.htm&type=5) · [Connected app creation restricted (Spring '26)](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-connected-app.html)† | [Developer Edition signup](https://developer.salesforce.com/signup)† → Setup › External Client App Manager. For distribution: [AppExchange security review](https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/security_review_how_it_works.htm)† | **Salesforce Customer Support case** to re-enable Connected App creation (one-time per org). [Partner Community](https://partners.salesforce.com) cases for security review changes; a call with a reviewer needs about 3 weeks' notice |

**Patterns across apps:** these feed directly into product decisions.

1. **"Email the provider" rarely means an email address.** It means a **web form** (LinkedIn), a **support case** (Salesforce), **feedback inside the submission flow** (Slack, Meta), or **email sent to whoever owns the project** (Google). → The guide should name the exact channel, the form field to pick, and who will receive replies, as a step with an 👤 owner.
2. **Replies go to a specific inbox you may not watch.** Google writes to project Owners/Editors and LinkedIn to the business email. → Add a requirement: "Make sure <role> inbox is monitored," with a blocker entry for "review stalled, no reply."
3. **Support is often login-gated** (Meta), and some docs block bots (Salesforce †). → Pipeline stage 1 needs a browser fallback, and gated content is marked `unknown` rather than guessed.
4. **Docs and the live console drift apart.** Google renamed its consent screen to Google Auth Platform, Salesforce moved to External Client Apps, and Instagram Basic Display was deprecated. → Steps link to *both* the doc and the console screen, and changelogs are a fourth source type the pipeline checks.
5. **The hard facts live in changelogs and support FAQs, not in "Getting started."** Examples: the Slack rate limit cut, LinkedIn's rule that Community Management must be the only product on its app, and its 21-day survey deadline. → Pipeline stage 3 must search changelog and support pages explicitly.

**New facts from this pass** (for the curated guides; every one is sourced above):
- **Slack Marketplace:** needs ≥ 10 active workspaces before you can submit. Preliminary review ≤ 10 business days; functional review ≤ 10 weeks (new apps).
- **LinkedIn Community Management API:** must be the *only* product on its app. The vetting survey must be done within 21 days. Dev-tier rejection means creating a new app. Ads API Standard tier review takes up to 30 business days.
- **Google:** restricted scopes need a CASA assessment every 12 months, plus re-assessment when you add a new restricted scope.
- **AppExchange security review:** sources disagree on fees and timing (from a 4-week review to a 6–9 week queue; fees range from $999 per attempt to about $2,700 for paid apps). The guide should show the range and flag it as `inferred`.

**Live generation test set** (not curated; used to show and evaluate the pipeline): one mid-market app (e.g. **Calendly**), one long-tail app (e.g. **TickTick** or **Strava**), and one negative case with no public OAuth (to exercise P0-4's `oauthSupport = none` path).

**What "tested" means for curated guides:** I personally create the OAuth app in each provider with my own developer accounts, record what happened and when, and stop before any paid or KYC step. I'll say explicitly which steps were tested vs. sourced (e.g. CASA won't be tested and is cited from Google's docs).

---

## 8. Live generation pipeline

**Design principles:** facts first and prose last; every stage streams progress; every claim carries its source; code (not the model) decides tier and estimates; fail soft.

```
input ─► 0 Resolve ─► 1 Discover ─► 2 Extract technical ─► 3 Investigate review policy
                                                                   │
           6 Render + store ◄─ 5 Synthesize prose ◄─ 4 Verify & compute (code)
```

| Stage | What happens | Tools | Budget |
|---|---|---|---|
| **0 Resolve** | Normalise the name or URL to a canonical app + website; if ambiguous, return candidates for the user to pick | Web search | 10 s |
| **1 Discover** | Find the four source types from §7.1: **docs** (OAuth guide, scopes reference), **setup flow** (developer console URL and screen names), **provider contact** (support form, case system, review feedback channel and who receives replies), and **changelog / support FAQ**. Also pricing pages. Try `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` | Web search, fetch | 30 s |
| **2 Extract technical** | From the docs: endpoints, PKCE, refresh token behaviour, token lifetimes, redirect rules, scope list grouped by sensitivity | Fetch + structured output | 30 s |
| **3 Investigate review policy** | Build 1–3 profiles (common scope sets × audience); for each, extract `ReviewFacts`, test-mode limits, required artefacts, known blockers (forums, provider docs, changelogs) | Search, fetch, structured output | 60 s |
| **4 Verify & compute** (code) | Fetch-check every source URL; downgrade unsupported claims; *(P1)* probe the authorize endpoint; apply the §6.3 rubric to get tier, hours, days and confidence | HTTP, rubric | 15 s |
| **5 Synthesize** | Write steps, bottom line, top risks, blocker playbook and "agent can do" notes, constrained to existing claims (no new facts at this stage) | LLM | 30 s |
| **6 Render + store** | Validate against Zod (retry once on failure); save; redirect to `/guides/<slug>` | DB | 5 s |

**Guardrails**
- **No new facts after stage 3:** synthesis only gets the claim ledger and must reference claim IDs.
- **Schema-validated output** at every LLM stage, with one repair retry, then fall back to `unknown`.
- **Fetched pages are untrusted data.** Strip instructions from them, and never follow links or forms suggested by page content beyond docs crawling (prompt-injection hygiene, which matters given Composio's own "Firewall" product).
- **Cache** guides by canonical slug for 7 days; "Regenerate" bypasses the cache.
- **Cost / time ceiling** per run (max fetches and max tokens). If hit, return the partial guide.

**Streaming UX:** server-sent events emit `{stage, status, message, partialFindings}`. The progress page shows a stage list with live findings, and the verdict card fills in as soon as stage 4 finishes.

---

## 9. Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | Pages and API routes in one codebase; SSR for shareable guide pages with OG tags |
| UI | **Tailwind + shadcn/ui** | Fast and clean; badges, tabs and accordions come built in |
| Schema | **Zod** | One definition used for TS types, LLM structured output and runtime validation |
| LLM | **Claude API**: `claude-opus-5-5` for review-policy reasoning and synthesis; `claude-sonnet-5-5` / `claude-haiku-5-5` for extraction and URL triage | Quality where judgement matters, speed and cost where it doesn't |
| Search & fetch | Claude's server-side **web search** and **web fetch** tools | No extra vendor; citations come back with results |
| Browser probe (P1) | Playwright (local) / Browserbase (hosted) | Only for the authorize-endpoint probe and JS-rendered docs |
| Storage | Curated guides as **JSON files in the repo** (reviewable in git); generated guides in **Postgres (Neon) or SQLite (Turso)** | Curated content gets versioned and diffed; generated content is just data |
| Streaming | SSE from a route handler | Simple and works with Next.js |
| Hosting | **Vercel**, with the pipeline route set to a long `maxDuration` | One-click deploy; if runs exceed limits, move the pipeline to a small worker (Railway/Fly) |
| Observability | Store `AgentRun` per guide; log tokens and latency per stage | Feeds the methodology page and the self-eval |

**Repo layout (proposed)**
```
app/                 # routes: /, /guides/[slug], /generate, /methodology, /api/generate
lib/schema.ts        # Zod guide schema
lib/rubric.ts        # tiering + estimate logic (unit tested)
lib/pipeline/        # stages 0–6, one file each
content/guides/*.json# 6 curated guides
docs/PRD.md          # this file
```

---

## 10. Success metrics

**For the take-home (measurable before submitting)**

| Metric | Target | Stretch |
|---|---|---|
| Live generation p90 time | ≤ 3 min | ≤ 90 s |
| Claims with source or tested status (generated) | ≥ 80% | ≥ 90% |
| Tier agreement: live generation vs curated truth on the 6 apps (P1-5) | 5 / 6 | 6 / 6 |
| Key requirement recall vs curated truth | ≥ 80% | ≥ 90% |
| Broken source URLs in any guide | 0 | 0 |
| Cold-read test: a peer finds the next step and estimates the timeline from a guide without help | 3 / 3 people | — |

**If this shipped at Composio (hypotheses)**
- *Leading:* search → guide view rate; profile-switch rate (shows that scope-awareness gets used); share or copy-Markdown rate; live generations per week for apps not in the library (a demand signal for which apps to build next).
- *Lagging:* time from "start setup" to "first production connection" for custom OAuth apps; fewer support tickets about provider review; conversion to Composio managed auth when a guide shows 🟠/🔴.

## 11. Open questions

| Question | Owner | Blocking? |
|---|---|---|
| How much build time is available? (The scope above assumes 5–7 days) | Prachi | **Yes**: decides whether P1-1 and P1-2 make it |
| Should the result be built on, or reference, Composio's platform (e.g. "use Composio managed auth" recommendations)? | Composio | No |
| Which developer accounts can I use for testing (Google Cloud, Meta, LinkedIn, Salesforce Developer Edition)? | Prachi | Yes for 🟢/🟡 tested claims |
| Is a browser agent attempting provider console steps acceptable under each provider's ToS? Default is to probe only public pages and endpoints | Legal / Composio | No (default is safe) |
| Should wait-time ranges use only official sources, or also community reports (forums, Reddit)? | Product | No: mark community data as `inferred` |

## 12. Timeline (assuming 6 working days)

| Day | Deliverable |
|---|---|
| 1 | Schema + rubric (with unit tests); manually research and test **Google** end to end, since it's the hardest app and stress-tests the schema |
| 2 | Guide page and library UI rendering the Google JSON; curate **GitHub** and **Slack** |
| 3 | Curate **Meta**, **LinkedIn** and **Salesforce**; methodology page |
| 4 | Pipeline stages 0–4 with SSE progress UI |
| 5 | Stages 5–6, storage, sharing, Markdown export; run the live generation test set |
| 6 | P1-5 self-eval, polish, deploy, README with decisions and limits, Loom walkthrough |

**Cut line if behind:** drop P1 entirely, then drop the third profile on Google and LinkedIn. Never cut the evidence panel or the deterministic rubric. They're the core of the "be clear about what you tested" ask.

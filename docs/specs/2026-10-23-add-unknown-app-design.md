# Spec: add an unknown app with a research agent (MVP)

Date: 2026-10-23 · Status: draft for review

## Goal
A user searches for an app the gallery doesn't have and clicks **Add**. A research agent writes a guide for it under the same rules as the curated guides. If the guide passes the checks, it joins the public gallery, so the next person gets it instantly. Readers can **report a problem** on any step, and repeated reports trigger a focused re-check by the agent.

## Context and constraints
- This is a **public, hosted, shared** tool.
- The agent runs on a **free hosted model only**. Claude isn't used, and there's no paid fallback.
- New guides are **approved automatically** if they pass the code checks. There's no human review in the MVP.
- The existing schema ([lib/schema.ts](../../lib/schema.ts)), rubric ([lib/bands.ts](../../lib/bands.ts)) and validator stay the source of truth.
- The 8 curated guides stay in git (`content/guides/*.json`) and are never touched by the agent.

## User flow
```
Search an app
  ├─ match in gallery ─► open the guide
  └─ no match ─► "Add <app>" ─► progress page (live steps)
                                  ├─ checks pass ─► saved, added to gallery, guide shown
                                  ├─ checks fail ─► show what was found, marked "incomplete", not saved
                                  ├─ limit reached ─► "Daily limit reached, try tomorrow"
                                  └─ free quota exhausted ─► queued; progress page shows position
```
- If someone requests an app that's already being researched, they join that run instead of starting a new one.
- Search matches the app name and slug, case-insensitively. Curated guides win over generated ones for the same slug.

## Components

| Unit | Responsibility |
|---|---|
| `app/page.tsx` (library) | Adds a search box. With no match, shows an **Add** button. Lists curated and generated guides together, with generated ones labelled "AI-generated". |
| `app/add/[jobId]/page.tsx` | Progress page. Follows the job over server-sent events and redirects to the guide when it's done. |
| `app/api/add/route.ts` | Normalises the app name, checks limits, joins or creates a job, and returns `jobId`. |
| `app/api/jobs/[id]/events/route.ts` | Streams job progress (SSE). |
| `lib/agent/runner.ts` | Runs the agent loop with a fixed tool set and hard limits. |
| `lib/agent/model.ts` | Adapter for the free model provider, kept swappable behind one interface. |
| `lib/agent/tools.ts` | `search`, `fetch`, `validate_draft`, `submit_guide`. |
| `lib/agent/gates.ts` | Code checks run after the agent finishes (below). |
| `lib/store.ts` | Hosted database access for generated guides, jobs and reports. |
| `components/ReportProblem.tsx` | The report link and form on steps and the verdict. |
| `app/api/reports/route.ts` | Validates and rate-limits reports, stores them and queues a re-check when the trigger is met. |
| `lib/guides.ts` (existing) | Extended to merge curated files with published generated guides. |

## The agent run
- **Instructions:** the Step 2 research rules (how to read, label and rank sources), a summary of the schema, the Dropbox guide as a worked example, and the app name. Fetched page text is marked as data, never instructions.
- **Tools:**
  - `search`: web search through a free option to be decided (see Open decisions). It also tries the provider's `llms.txt`, sitemaps and `/.well-known/openid-configuration` directly.
  - `fetch`: our own HTTP GET with HTML-to-text conversion. Every call is logged with its URL, status and whether real content came back.
  - `validate_draft`: runs the schema and rubric checks and returns the errors, so the agent can fix them.
  - `submit_guide`: the final answer, which ends the run.
- **Working style:** the agent fills the guide section by section, validating after each section, rather than writing one large JSON at once. This suits smaller models.
- **Limits per run:** 15 minutes, 80 fetches and a token ceiling set from the chosen model's limits. If a limit is hit, the result counts as failed.
- **No OAuth:** if the provider has no OAuth, the agent returns a short `oauthSupport: none` guide.

## Code checks (gates)
These run after `submit_guide` and before anything is saved:
1. **Read status comes from the fetch log, not the agent.** A source counts as `full` only if this run fetched it and got content back. `snippet` means it only appeared in search results; `unfetchable` means the fetch failed.
2. **Downgrade unbacked claims.** Any `verified` claim with no official source read in full becomes `uncertain`.
3. **Schema and rubric:** the same checks as `npm run validate`.
4. **Publish bar:**
   - the guide passes checks 1–3
   - at least 50% of its claims are `verified`
   - it has at least one Stage 1 step and a "you're done when" check
5. **Outcome:** a guide that passes is saved as published with `source: "generated"` and the model name. One that fails is returned to the requester only and isn't saved.

## Protections for a public tool
- **Limits:**
  - 3 new apps per visitor per day, keyed on IP plus a cookie
  - a global daily cap on runs, set by config
  - when the free provider's quota is exhausted, new requests queue instead of failing
- **Input:** app names are trimmed, limited to 60 characters and normalised to a slug. They're only ever used as data.
- **Fetch safety:**
  - `https` only
  - block private and local IP ranges, rechecked after DNS resolution
  - at most 5 redirects, 5 MB per response and 20 seconds per request
  - respect `robots.txt`
  - GET only, with no cookies or credentials
- **Model output** is parsed only as JSON and must pass the schema. It's never run as code.

## "Report a problem" feedback loop
**Where:** a small "Report a problem" link on every step and on the verdict, in both generated and curated guides.

**The report form takes one click plus optional detail:**
- **Type:** "Label or button is different", "Got an error", "Took longer than stated", "Needed something not listed", "Something else"
- **Optional:** free text or a pasted error message (max 1,000 characters), and for "Took longer", the actual time taken
- No sign-in and no source citation required

**Rules:**
1. **Reports never edit a guide directly.** They're stored against the guide and the step or section they refer to.
2. **Trigger:** 2 or more reports on the same generated guide within 30 days queue a **focused re-check**. The agent re-reads that guide's official sources for the reported parts, plus anything the report text points to, such as an error code.
3. **A re-check may change a `verified` claim only if it finds an official source that says something different.** Reports alone never flip a fact.
4. **Outcome:** if the re-check produces a changed guide that passes all the gates and the publish bar, it replaces the published guide. The old JSON is kept in the `guide_history` table. If nothing changed, only the last-checked date updates. Either way, the reports it covered are marked resolved.
5. **Experience facts** (such as "took longer") are shown on the guide only once 3 or more open reports agree. They appear as a reported range, for example "4 people reported 3–14 days". Reports older than 6 months are ignored.
6. **Curated guides are never rewritten by the agent.** Reports on them are collected and listed for a human to act on in git.
7. **Abuse:** at most 5 reports per visitor per day, and duplicate reports from the same visitor on the same step are ignored. Report text is only data and is never followed as instructions.
8. **Quota:** re-checks use the same free-model queue, with lower priority than adding new apps.

## Data (hosted database: Turso or Neon)
- **`generated_guides`:** `slug` (primary key), `guide_json`, `model`, `created_at`, `last_checked`, `status` (`published`)
- **`guide_history`:** `slug`, `guide_json`, `replaced_at`, `reason` (`report_recheck`)
- **`reports`:**
  - `id`, `slug`, `target` (step id or `verdict`), `type`, `detail`, `minutes_taken`
  - `visitor_hash`, `created_at`, `status` (`open` | `resolved`)
- **`jobs`:**
  - `id`, `slug`, `kind` (`add` | `recheck`), `status` (`queued` | `running` | `done` | `failed`)
  - `events` (JSON list of progress messages)
  - `result_json` (kept for failed runs so the requester can see what was found)
  - `created_at`

## Errors
- **Free model errors or rate limits:** retry with backoff up to 3 times, then put the job back in the queue.
- **Run crash or limit hit:** the job is marked `failed`, and the progress page shows whatever partial result exists, marked incomplete.
- **Database unavailable:** curated guides still render from files, and **Add** shows "temporarily unavailable".

## Testing
- **Unit tests:**
  - gates: read-status override, downgrade rule, publish bar
  - fetch safety: blocked IPs, redirect and size caps
  - name normalisation
  - limit checks
  - report rules: the trigger threshold, never editing directly, the 3-report display rule, the 6-month expiry, and per-visitor limits
- **Fake-model test:** a scripted fake model drives the runner end to end, so tests need no network or API quota.
- **Accuracy check before launch:** run the real free model on 2 apps that already have curated guides (Dropbox, Linear) and compare bands, tags and key requirements against the curated versions. Record the results; this tells us whether the 50% bar is sensible.

## Out of scope for the MVP
- scheduled 30-day refresh (only report-triggered re-checks are in)
- a version history UI and diffs (old versions are kept in `guide_history` but not shown)
- admin kill switch
- human review queue
- chat assistant
- the redesigned guide UI

## Decisions (approved 2026-10-23)
1. **Model: Gemini API free tier** (2.5 Flash).
   - Free-tier inputs may be used for training and read by human reviewers, so only public data goes through it.
   - The free tier's terms require paid services for apps serving users in the EEA, UK or Switzerland. Visitors are expected from India and the US only, and **no region check is applied** (decided 2026-10-23). Known risk: an EEA, UK or Swiss visitor could trigger a free-tier run.
   - Users must be 18 or over.
2. **Search: no general web search (option A, decided 2026-10-24).**
   - **Why grounding is out:** the live probe on 2026-10-24 found that Gemini 2.5 models are closed to new users, and free-tier Search grounding returns 429 on every 3.x model available to the key.
   - **How the agent finds pages instead:**
     - the provider's own endpoints: `llms.txt`, auth-related `sitemap.xml` entries, and `.well-known` OAuth discovery
     - following links in the pages it fetches
     - docs addresses the model already knows, which only count once actually fetched
   - **Known weaknesses:** thin community pain signals, and JS-rendered docs sites.
   - **Tavily as fallback (added 2026-10-24).** When `TAVILY_API_KEY` is set, the agent gets a `search` tool. It's for use only when provider endpoints and known URLs don't find the docs, or to look for community reports.
     - Capped at 6 searches per run (basic depth, 1 credit each). The free plan's 1,000 credits a month cover roughly 160+ guides.
     - If Tavily errors or runs out of quota, the run carries on without search.
   - **Model:** `gemini-3.5-flash` by default (`GEMINI_MODEL` to override).
3. **Hosting: Vercel Hobby.** Functions stop at 300 seconds, so a run is split into **chunks of at most 4 minutes**. Agent state is saved in the job row between chunks, and each chunk triggers the next. The progress page also nudges a stalled job. Hobby is limited to non-commercial use.
4. **Database: Turso** (libSQL, free plan, no card). Locally, the same code uses a SQLite file.

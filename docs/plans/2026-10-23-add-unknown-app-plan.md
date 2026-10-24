# Implementation plan: add unknown apps + "Report a problem"

Spec: [docs/specs/2026-10-23-add-unknown-app-design.md](../specs/2026-10-23-add-unknown-app-design.md) (approved 2026-10-23)

## How to read this
- Tasks run in order. Each one lists the files it touches, its tests (written first), and a "done when" check.
- **Task 0 is a decision gate.** Tasks 1–12 don't depend on its outcome: they code against small interfaces (`ModelAdapter`, `SearchAdapter`, `Store`) and are tested with fakes. Only tasks 13–15 need the real choices.
- Every task ends with `npm test`, `npm run typecheck` and `npm run validate` all passing.
- New dependencies are listed where they're needed. Nothing else gets installed.

---

## Task 0: Settle the four open decisions (with you, before task 13)
For each decision, research the current options under the evidence rules, write up 2–3 choices with sourced trade-offs, and get your pick.
1. **Free model provider:** a free tier that allows tool calling and suits a public app. Check its rate limits, terms and whether it trains on inputs.
2. **Free search:** provider endpoints only, self-hosted SearXNG, or a free search API tier that permits this use.
3. **Hosting:** Vercel plus a separate worker, or one host that allows 15-minute jobs.
4. **Database:** Turso or Neon.

**Done when:** your four choices are written into the spec's "Open decisions" section.

---

## Task 1: Schema additions for generated guides
- **Files:** `lib/schema.ts`, `tests/schema.test.ts`
- **Change:**
  - add an optional `generator: { model: string, jobId: string, generatedAt: ISODate }` field on `Guide`
  - require `generator` when `source === "generated"`, and forbid it when `source === "curated"`
- **Tests first:**
  - a generated guide without `generator` fails
  - a curated guide with `generator` fails
  - the existing 8 guides still pass
- **Done when:** tests pass and `npm run validate` reports 8/8.

## Task 2: Store interface and local implementation
- **Files:** `lib/store/types.ts` (the `Store` interface), `lib/store/sqlite.ts`, `lib/store/index.ts` (chooses an implementation from env), `tests/store.test.ts`
- **Dependency:** `@libsql/client`. It works with a local SQLite file and with Turso. If task 0 picks Neon, add `lib/store/postgres.ts` against the same interface in task 13.
- **Tables (from the spec):** `generated_guides`, `guide_history`, `jobs` (with `kind`), `reports`, and a `rate_limits` table for counters. Migrations live in one `lib/store/migrate.ts`.
- **Interface methods:**
  - guides: `getGuide`, `listPublished`, `saveGuide` (moves the old version to history), `touchChecked`
  - jobs: `createOrJoinJob`, `getJob`, `appendEvent`, `finishJob`, `nextQueuedJob`
  - reports: `addReport`, `openReports`, `resolveReports`
  - limits: `incrementCounter`
- **Tests first:** run against an in-memory database:
  - joining a running job returns the same id
  - saving a guide twice writes one history row
  - counters reset by date key
- **Done when:** store tests pass.

## Task 3: Merge curated and generated guides
- **Files:** `lib/guides.ts`, `tests/guides.test.ts`
- **Change:**
  - `getAllGuides()` and `getGuide(slug)` become async and merge files with `store.listPublished()`
  - a curated guide wins when slugs collide
  - generated guides are re-validated on read, and an invalid stored guide is skipped and logged rather than failing the page
  - if the store is down, curated guides alone are returned
- **Tests first:**
  - collision: curated wins
  - store down: curated only
  - invalid stored guide: skipped
- **Done when:** tests pass, and the library and guide pages still build with the 8 curated guides (`next build`).

## Task 4: Name normalisation and limits
- **Files:** `lib/limits.ts`, `lib/slug.ts`, `tests/limits.test.ts`
- **Rules:**
  - names are trimmed, capped at 60 characters, and slugified as lowercase kebab-case
  - empty or invalid names are rejected
  - each visitor gets 3 additions and 5 reports per day; the visitor key is a hash of IP plus a random cookie, never stored raw
  - a global daily run cap comes from env
- **Tests first:**
  - slug cases
  - the 4th addition in a day is refused
  - the 6th report is refused
  - the cap resets the next day
- **Done when:** tests pass.

## Task 5: Safe fetch tool
- **Files:** `lib/agent/fetch.ts`, `tests/fetch.test.ts`
- **Behaviour:**
  - GET only, `https` only, with no cookies or credentials
  - DNS is resolved and private or local ranges are rejected, both before connecting and after each redirect
  - at most 5 redirects, 5 MB per response and 20 seconds per request
  - `robots.txt` is checked and cached per host
  - HTML is converted to text; `.md` and `llms.txt` pass through as text
  - every call goes to the run's fetch log: URL, final URL, status, bytes, and whether content was found
- **Dependency:** an HTML-to-text library (pick a small, maintained one, such as `html-to-text`, at implementation time).
- **Tests first** (local test server plus a mocked resolver):
  - `127.0.0.1`, `10.x` and `169.254.169.254` are blocked
  - a redirect to a private IP is blocked
  - oversize responses are cut off
  - a `robots.txt` disallow is respected
  - log entries are correct
- **Done when:** tests pass.

## Task 6: Search tool
- **Files:** `lib/agent/search.ts` (the `SearchAdapter` interface plus a `ProviderEndpointsSearch` that always runs), `tests/search.test.ts`
- **`ProviderEndpointsSearch`:** given a domain, tries `/llms.txt`, `/sitemap.xml` and `/.well-known/openid-configuration` through the safe fetch tool and returns candidate URLs.
- **The general web search adapter** is added in task 13, once task 0 has picked one.
- **Tests first:** fixture responses produce the right candidate list, and unreachable endpoints are skipped quietly.
- **Done when:** tests pass.

## Task 7: Model adapter and fake model
- **Files:** `lib/agent/model.ts` (the `ModelAdapter` interface: send messages plus tool definitions, get text or tool calls back), `tests/fakes/fake-model.ts`
- **The fake model** replays a scripted list of tool calls. It's used by all runner tests.
- **Done when:** the interface compiles and the fake is used in task 9's tests.

## Task 8: Gates
- **Files:** `lib/agent/gates.ts`, `tests/gates.test.ts`
- **Order (from the spec):**
  1. Override every source's `read` from the fetch log.
  2. Downgrade unbacked `verified` claims to `uncertain`.
  3. Run the schema and rubric checks.
  4. Apply the publish bar: at least 50% verified, at least one Stage 1 step, and a "you're done when" check.

  The result is `{ status: "publish" | "requester_only", guide, reasons[] }`.
- **Tests first:**
  - a source the run never fetched becomes `snippet` or `unfetchable`
  - the downgrade happens
  - a guide at 49% verified is `requester_only` and one at 50% is `publish`
  - schema failures are reported
- **Done when:** tests pass.

## Task 9: Agent runner
- **Files:** `lib/agent/runner.ts`, `lib/agent/prompt.ts` (the Step 2 rules, schema summary and Dropbox example, assembled from the repo's files), `lib/agent/tools.ts`, `tests/runner.test.ts`
- **Loop:**
  - the system prompt plus the app name, worked section by section in this order: app and technical → profile facts and verdict → steps → requirements, limits and blockers → nuances and notFound → claims
  - `validate_draft` is available at every step, and `submit_guide` ends the run
  - fetched text is wrapped as quoted data
  - hard limits: 15 minutes, 80 fetches and a token ceiling from config; hitting any limit means the run failed
  - progress events go out through a callback
  - a `recheck` mode is accepted for task 12
- **Tests first** (fake model):
  - a happy path ends with `submit_guide` and the gates are applied
  - the fetch limit stops the run
  - a tool error is reported back to the model
  - page text containing "ignore previous instructions" doesn't change which tools get called
- **Done when:** tests pass.

## Task 10: Job queue and worker
- **Files:** `lib/jobs/queue.ts`, `lib/jobs/worker.ts`, `tests/queue.test.ts`
- **Behaviour:**
  - a request for a slug already queued or running joins that job
  - one worker loop claims jobs with priority `add` over `recheck`
  - provider rate-limit errors back off 3 times, then the job is requeued
  - on finish it saves the guide (`publish`) or stores `result_json` (`requester_only` or failed)
  - the queue position can be computed for the progress page
  - for the MVP the worker runs in-process, started once per server; task 13 moves it if hosting requires
- **Tests first:**
  - join instead of duplicate
  - priority order
  - backoff then requeue
  - publish versus requester-only storage
- **Done when:** tests pass.

## Task 11: Add flow (API and UI)
- **Files:**
  - `app/api/add/route.ts` (POST: normalise, check limits, create or join job, return `jobId`)
  - `app/api/jobs/[id]/events/route.ts` (SSE stream of events and the final status)
  - `app/add/[jobId]/page.tsx` plus a small client component for the event stream
  - `app/page.tsx` (search box, filtering, an **Add** button when nothing matches, "AI-generated" label)
  - `components/GuideCard.tsx`
  - `app/guides/[slug]/page.tsx` (an "AI-generated by <model>" note for generated guides)
  - tests: `tests/api-add.test.ts`
- **States the progress page must show:** queued (with position), running (live steps), published (redirect to the guide), requester-only or failed (show the result marked incomplete, kept in browser storage, wrapped in try/catch), and limit reached.
- **Tests first:** API limit refusals, join behaviour and input validation.
- **Done when:** with the fake model wired in, a local browser run goes from search to Add to progress to the guide, and the gallery shows the new card.

## Task 12: "Report a problem"
- **Files:** `components/ReportProblem.tsx`, `app/api/reports/route.ts`, `lib/reports.ts` (rules), changes to `app/guides/[slug]/page.tsx` (link on each step and the verdict, plus a reported-experience line), `tests/reports.test.ts`
- **Rules (from the spec):**
  - reports never edit a guide
  - 2 or more reports on a generated guide within 30 days queue a `recheck` job
  - a re-check can change `verified` claims only with a new official source; this is enforced by running the gates as usual, plus a check that every changed `verified` claim cites a URL fetched in that run
  - experience facts appear once 3 or more open reports agree, shown as a count and a range
  - reports older than 6 months are ignored
  - curated guides get reports stored but are never re-checked by the agent
  - reports are rate-limited, deduplicated per visitor and step, and the text is stored as data only
- **Tests first:**
  - the threshold triggers exactly one re-check
  - curated guides are never queued
  - a changed verified claim without a fetched source is rejected
  - the 3-report display rule and the 6-month expiry hold
- **Done when:** tests pass and a local run shows the report form submitting, with a re-check queued after the 2nd report.

## Task 13: Wire in the real choices from task 0
- **Files:** `lib/agent/model.<provider>.ts`, `lib/agent/search.<choice>.ts`, `lib/store/postgres.ts` (only if Neon was chosen), `.env.example` listing every required variable with no values
- **Done when:** one real run completes locally for a small app, with the result validated.

## Task 14: Accuracy check before launch
- Run the real free model on **Dropbox** and **Linear** with `GUIDES_DIR` pointed at an empty folder, so curated guides don't short-circuit the search.
- Compare against the curated guides: Stage 1 and Stage 2 bands, blocker tags, key requirements, and the share of claims verified.
- Record results in `evidence/agent-accuracy.md`. If the 50% publish bar looks wrong, bring numbers to you; don't change it silently.
- **Done when:** the file exists and you've seen the comparison.

## Task 15: Hosting and deploy
- **Files:** hosting config for the task 0 choice, and the worker entry point if it's separate
- Set env variables on the host and run migrations.
- Smoke-test the hosted site:
  - search, add and view
  - report, and confirm the re-check queues
  - limits refuse the 4th add
  - the fetch tool refuses a private IP
- **Done when:** the smoke test passes on the hosted URL. **Deploying is outward-facing, so I'll ask you before this step.**

## Task 16 (later): Guide page UI redesign
This is the presentation change discussed on 2026-10-23 and deferred. It needs a short design approval from you before building, including the "cleaner demarcation" you asked for.
- **Library:** cards show the app, intent, both bands and blocker tags. Evidence counts are removed. The "AI-generated" label from task 11 stays.
- **Guide page:**
  - **Header:** intent, both band pills, the bottom line, and *Open console* and *Docs* buttons.
  - **Clickable flowchart:** `Get your first token` → `✓ Checkpoint` → `Before real users` → `Real users can connect`. It stacks vertically on phones.
  - **Stage panels:** a checklist of step titles, with checkboxes saved in the browser (wrapped in try/catch) and a small icon on steps that need a human. Each step's instructions and links sit behind a "Details" toggle.
  - **Checkpoint panel:** the "you're done when" test.
  - **Final panel:** at-a-glance tiles for Time, Cost, Limits and Who can block you.
  - **"More details"** (collapsed): technical facts, nuances, troubleshooting, and "Not confirmed yet".
  - **"Report a problem"** links from task 12 stay on each step.
- **Evidence:** removed from the UI entirely (your choice). Labels, the Sources table and counts go; the data stays in the JSON and the evidence files.
- **Components:**
  - new: `GuideFlow`, `StageChecklist`, `GlanceTiles`
  - removed: `ClaimRefs`, `SourcesTable`, `EvidenceCounts`
  - no new UI libraries
- **Done when:** your design is approved; the build passes; a browser check at desktop and phone width passes with no horizontal scroll; nodes and toggles work from the keyboard (`aria-expanded`); and checkbox state survives a reload.

---

## Risks to watch
- **Free model quality:** the guides may often miss the 50% bar. Task 14 measures it early.
- **Free search coverage:** without general search, community pain signals will be thin. Provider endpoints cover the official docs.
- **Free tier limits:** rate limits may make the queue long. The progress page shows queue position.
- **Abuse of a public endpoint:** limits, the fetch guard and the global cap are in from day one (tasks 4, 5 and 10).

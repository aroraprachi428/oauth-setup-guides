# OAuth Setup Guides

Look up an app and see what it takes to get its OAuth app working for real users: how hard it is, how long it takes, what can block you, and who does each step.

Built for the Composio APM Integrations take-home. **Live demo:** _add the Vercel URL here_

## The problem

Before an AI agent's users can connect a third-party app, the developer has to create an OAuth app with that provider and often get it approved. Setup docs explain which buttons to click. They don't say whether the whole thing takes an hour or six weeks, or that a security assessment, business verification, partner program or paid tier is waiting halfway through.

Each guide answers that question, split into two stages:

| Stage | What it means |
|---|---|
| **First successful API call** | You, or a few test users, can complete the OAuth flow and call the API. |
| **Open to all users** | Any user can connect, after whatever review, verification or approval the provider requires. |

Each stage gets a time band (Instant, Same day, Days, Weeks or more, Gated). Difficulty depends on the scopes you need and who your users are, so a guide can carry several **profiles**. For example, Gmail read-only for any Google user is a very different job from Gmail for your own account.

## What's in the app

- **8 curated guides:** Dropbox, Gmail, Linear, LinkedIn, Microsoft (Outlook, Entra ID), QuickBooks Online, Shopify and X. They're written by hand from the providers' own docs, in [`content/guides/`](content/guides).
- **A guide page per app:**
  - the verdict, cost and who can block you, at a glance;
  - an ordered checklist per stage, saying who does each step (you, the provider, a customer admin or an agent);
  - what to have ready for review, troubleshooting, limits, and what isn't confirmed yet.
- **Add any app:** search for an app that isn't in the library and click **Add**. A research agent reads the provider's docs and drafts a guide. If the draft passes the checks, it joins the gallery, marked "AI-generated".
- **Report a problem:** readers can flag a step that's wrong or took longer than stated.
  - On an agent-written guide that's still only in the database, 2 open reports within 30 days trigger a focused re-check by the agent. Guides in `content/guides` record reports but aren't rewritten.
  - Once 3 or more people report how long setup took, the guide shows the range.

## How much to trust a guide

Every claim carries a label and its sources:

| Label | Meaning |
|---|---|
| `verified` | Stated on an official page that was read in full |
| `reported` | From community sources (forums, issues, posts) |
| `uncertain` | Believed, but not confirmed. Allowed without a source only here |
| `tested` | Checked by actually doing it |

The schema enforces the labels: for example, a `verified` claim must cite an official page read in full. Agent-written guides go through stricter checks before they're published ([`lib/agent/gates.ts`](lib/agent/gates.ts)):
- Nothing the model says about how it read a page is trusted. Read status comes from the run's own fetch log.
- Quoted text and numbers must actually appear on the cited page.
- At least half the claims must be verified.

A draft that fails is shown to the person who asked for it, but it isn't added to the gallery.

Research notes behind the curated guides are in [`evidence/`](evidence):
- [`corrections-log.md`](evidence/corrections-log.md): which early leads were confirmed, corrected or dropped;
- [`spot-check.md`](evidence/spot-check.md): claims to check by hand;
- [`composio-comparison.md`](evidence/composio-comparison.md): how each guide compares with Composio's public auth guides.

## How the research agent works

```
Add "Notion" → job queued → chunks of agent work → checks → published (database + content/guides)
```

- **Model:** Gemini's free tier (`gemini-3.5-flash`, with flash-lite fallbacks when the daily quota runs out). Free Search grounding wasn't available, so the agent finds pages through:
  - the provider's own endpoints (`llms.txt`, sitemaps, OAuth discovery);
  - links in the pages it reads;
  - docs URLs it already knows, which only count once actually fetched;
  - an optional Tavily search fallback, capped at 6 searches per run.
- **Safe fetching:** HTTPS GET only, no cookies, and private or local addresses are refused at DNS lookup. Size, redirects and wait time are capped, and fetched pages are passed to the model as untrusted data.
- **Serverless-sized chunks:** Vercel Hobby stops a function after 300 seconds. So a run is split into chunks, saved to the database in between, and each chunk triggers the next.
  - No new model call starts after 2 minutes in a chunk.
  - Tool calls still pending at 250 seconds are deferred to the next chunk.
  - A chunk the host kills is retried, and the job fails after 3 kills rather than looping.
  - A whole run is capped at 15 minutes, 80 model turns, 80 page fetches and 2M tokens.
- **Where new guides go:** the database (Turso), so they show up straight away, and `content/guides/`, next to the curated ones.
  - Locally, the file is written to the folder.
  - When hosted, it's committed to this repo through the GitHub API, which triggers a redeploy.
  - A guide that would fail `npm run validate` stays in the database only, so one bad file can't take the library down.
- **Limits for a public tool:**
  - 3 new apps and 5 reports per visitor per day;
  - 50 agent runs per day in total;
  - a second request for an app already being researched joins the existing run.

## Stack

Next.js 16 (App Router) with React 19, TypeScript and Zod. libSQL stores the data: a local SQLite file in development, Turso when hosted. Tests use Vitest. Hosting is Vercel Hobby.

## Running locally

```bash
npm install
```
```bash
cp .env.example .env.local
```

In `.env.local`, set:
- `GEMINI_API_KEY`, from Google AI Studio, free;
- `STORE_URL=file:./data/guides.db`.

Use `AGENT_MODEL=demo` to try the Add flow offline with a scripted agent. Then start the dev server:

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run validate` | Checks every guide in `content/guides` against the schema, rubric and style rules |
| `npm run promote -- <slug \| file.json>` | Copies a generated guide from the local database, or from a file, into `content/guides` |
| `npm run build` | Production build |

## Deploying (Vercel + Turso)

1. Create a Turso database. Its URL comes from `turso db show <db> --url`, and a token from `turso db tokens create <db>`. The tables are created on first use.
2. Import this repo on Vercel and set these environment variables:

| Variable | Value |
|---|---|
| `AGENT_MODEL` | `gemini` |
| `GEMINI_API_KEY` | Gemini API key |
| `TAVILY_API_KEY` | Optional search fallback |
| `STORE_URL`, `STORE_AUTH_TOKEN` | Turso URL and token |
| `VISITOR_SECRET` | Any long random string (`openssl rand -hex 32`) |
| `GITHUB_REPO`, `GITHUB_TOKEN` | `owner/name`, plus a fine-grained token for this repo only, with **Contents: read and write**. New guides get committed to `content/guides` |

3. Deploy, then test on the production URL, not a preview link: preview links are behind Vercel's login, which blocks the job chunks from calling each other.

## Known limitations

- **A waiting job only resumes while someone has its progress page open.** After a rate limit, or a "continuing tomorrow" pause, nothing restarts the job on its own. Re-checks triggered by reports have no progress page, so they can stall. A daily cron or a background nudge on page views would fix this.
- **Parallel runs aren't capped.** Several people adding apps at once can hit Gemini's free-tier per-minute limit together.
- **Run state is kept after a job ends.** It holds the full conversation, including fetched pages, so the database grows with each run.
- **Per-visitor limits are easy to get around**, for example by clearing cookies. The global daily cap is what protects the free quota.
- **No human review of agent-written guides.** They're labelled "AI-generated" and have to pass the checks above, but they're usually thinner than the curated ones.
- **JS-rendered docs sites** can be hard for the agent to read, since it fetches HTML without running scripts.

## Project layout

```
app/                 pages and API routes (library, guide, add progress, add/jobs/reports APIs)
components/          guide page UI (flow, checklists, glance tiles, report form)
content/guides/      guide JSON files, curated and agent-written
lib/schema.ts        the guide schema
lib/bands.ts         the time-band rubric
lib/agent/           research agent: runner, Gemini and Tavily adapters, safe fetcher, checks
lib/jobs/            job steps, chunk chaining, saving guides to files or GitHub
lib/store/           libSQL store (SQLite locally, Turso hosted)
evidence/            research notes behind the curated guides
docs/                PRD, design spec and plan
tests/               Vitest suite
```

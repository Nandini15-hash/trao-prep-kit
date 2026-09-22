# The AI Interview Prep Kit

A full-stack app that turns a pasted job description and a company URL into
a structured, editable interview prep kit — company brief, role breakdown,
categorised question bank, flashcards, and a day-by-day study schedule —
built by genuinely researching the company (crawling its site, searching for
public discussion of its interview process) rather than a single prompt.

Built for Trao's Full-Stack Engineering Assessment (`FS-AI-INTERVIEW-01`).

## Contents

- [Overview & tech stack](#overview--tech-stack)
- [Setup](#setup)
- [LLM provider](#llm-provider)
- [Architecture](#architecture)
- [Retrieval approach & sources](#retrieval-approach--sources)
- [Research & generation sequencing](#research--generation-sequencing)
- [Generated / edited / pinned state](#generated--edited--pinned-state)
- [Schedule allocation](#schedule-allocation)
- [Practice mode](#practice-mode)
- [Creative feature: a printable one-pager](#creative-feature-a-printable-one-pager)
- [Edge cases & failure handling](#edge-cases--failure-handling)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Key design decisions, trade-offs, and known limitations](#key-design-decisions-trade-offs-and-known-limitations)
- [Walkthrough video outline](#walkthrough-video-outline)

## Overview & tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind CSS | Preferred stack. Bumped from the initial 14.x scaffold to 16.3.5 to clear a `next audit` critical/high vulnerability; confirmed compatible with React 18. |
| Backend | Node.js + Express + TypeScript | Preferred stack. |
| Database | MongoDB (Atlas free tier, M0) via Mongoose | Preferred stack. A generated kit is stored as one validated JSON document (`Schema.Types.Mixed`) rather than mapped into a parallel Mongoose schema — see [Architecture](#architecture). |
| Validation | Zod | The single source of truth for the Appendix A kit shape — see below. |
| Auth | JWT session cookie (httpOnly) + bcrypt | Minimal, per Section 1: no email verification, password reset, or roles. |
| LLM | Google Gemini, free tier | See [LLM provider](#llm-provider). |
| Search | Tavily, free tier | See [Retrieval approach](#retrieval-approach--sources). |
| HTML parsing | Cheerio | For crawling and cleaning company pages. |
| Testing | Vitest + Supertest | 149 tests in `apps/api`. |

**Monorepo layout** (npm workspaces):

```
apps/web       Next.js frontend
apps/api       Express backend, and the batch CLI (apps/api/src/scripts/evaluate.ts)
packages/shared  Zod schemas shared by both — the Appendix A kit shape and the Appendix B batch shape
```

Why a shared package instead of duplicating types: Appendix A's structure is
used for three different things — validating what the LLM produces,
validating what the frontend submits, and shaping what the batch command
writes to disk — and the brief is explicit that field names must match
exactly across all of them. Keeping one Zod schema as the single source of
truth means "structure changed" is a one-file change everywhere, and the
frontend gets the same TypeScript types Express does, so a mismatch between
what the API returns and what the UI expects is a compile error, not a
runtime surprise.

## Setup

### Prerequisites

- Node.js ≥ 18.18
- A [Google AI Studio](https://aistudio.google.com/app/apikey) API key (Gemini, free tier — no card)
- A [Tavily](https://app.tavily.com) API key (free tier, 1,000 credits/month — no card)
- A MongoDB connection string — [Atlas free tier (M0)](https://www.mongodb.com/cloud/atlas/register) for anything beyond `npm run evaluate`, which never touches the database (see below)

### Install

```bash
git clone <this repo>
cd trao-prep-kit
npm install
npm run build --workspace=packages/shared   # apps/api and apps/web import its built output
```

### Environment variables

Two `.env.example` files — copy each and fill in the values (every var is
commented with what it's for):

```bash
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/api/.env` needs `MONGODB_URI` and `JWT_SECRET` to be *present* (Zod
validates the shape of `process.env` at startup) even if you're only ever
running the batch command below, which never opens a database connection or
checks a session — a placeholder value for those two is fine in that case.
`GEMINI_API_KEY` and `TAVILY_API_KEY` are the ones that actually matter for
generation.

### Run locally

```bash
npm run dev:api    # http://localhost:4000
npm run dev:web     # http://localhost:3000, in a second terminal
```

### Run the batch entry point (Section 9, mandatory)

```bash
npm run evaluate -- --input cases.json --output kits.json
```

This is the exact command from Section 9, run from the repo root after the
install step above (no other setup). `cases.json` is an array of
`{ id, jd, company_url, days }` objects (Appendix B); the command writes a
single `kits.json` in Appendix B's output shape. It reuses
`generateKit()` from `apps/api/src/services/generation/pipeline.ts` — the
same function `POST /kits` calls — so this is the app's real pipeline, not
a parallel implementation. See
[`apps/api/src/scripts/evaluate.ts`](apps/api/src/scripts/evaluate.ts) for
the full implementation notes (concurrency, per-case timeout, why).

### Tests

```bash
npm test   # runs the apps/api vitest suite (149 tests)
```

## LLM provider

**Google Gemini**, free tier (`gemini-3.6-flash` by default -- configurable
via `GEMINI_MODEL`; Google periodically deprecates flash model names, so if
generation starts failing with an HTTP 404 "model no longer available"
error, check https://aistudio.google.com for the current name and update
`GEMINI_MODEL`). Reasons:

- A genuinely free tier with no card required, which the brief requires.
- Native JSON-mode output (`responseMimeType: "application/json"`), which
  made the JSON-mode + Zod-validate + bounded self-repair loop in
  `services/llm/generate-structured.ts` straightforward — every generation
  call goes through that one function.
- The model name is `GEMINI_MODEL`, an env var rather than a hardcoded
  string — Gemini's model lineup has moved fast, and swapping models (or
  reacting to one being deprecated) is then a config change, not a
  redeploy. Check [ai.google.dev](https://ai.google.dev/gemini-api/docs/models)
  for what's current.

`services/llm/gemini-client.ts` retries 429s, 5xx responses, timeouts and
network errors with exponential backoff (Section 2's explicit warning:
"a pipeline that falls over the first time a provider says 'slow down' is
the most common way to lose points here"). It deliberately does **not**
retry a 4xx that isn't a rate limit, or a safety-filter content block —
retrying an unmodified request can't change either outcome, so those fail
fast instead of burning the retry budget (and, in a batch run, Section 9's
15-minute window) waiting for a response that was never going to differ.

## Architecture

```
                 ┌─────────────┐        ┌──────────────────────┐
  Browser  ───▶  │  apps/web   │  ───▶  │       apps/api        │
                 │ (Next.js)   │  fetch  │  (Express, TS)        │
                 └─────────────┘  cookie └──────────┬───────────┘
                                                     │
                        ┌────────────────────────────┼─────────────────────────┐
                        │                             │                         │
                 retrieval/*                   generation/*              kit-builder.ts
             (crawler, robots.txt,        (extract → brief → questions        (edit /
              rate limiter, fetcher,       → coverage passes → flashcards      regenerate,
              search/tavily.ts)            → schedule; pipeline.ts)            pinned-state)
                        │                             │                         │
                        └──────────────┬──────────────┴─────────────┬───────────┘
                                       llm/*                    kit.service.ts
                                (Gemini client,                (persistence,
                                 JSON-mode + repair)             ownership,
                                                                  async job)
                                                                     │
                                                                MongoDB (Kit, User)
```

Section 13 asks for retrieval, extraction, generation, scheduling and
persistence to be "clearly separated concerns" — that maps directly onto
`apps/api/src/services/`:

- `retrieval/` — fetching and cleaning pages, crawling, robots.txt, rate
  limiting, URL safety. Knows nothing about kits or the LLM.
- `search/` — the Tavily integration for public interview-discussion.
- `llm/` — the Gemini client and the JSON-mode/repair/validate wrapper.
  Knows nothing about kits either; it's a generic "get me valid JSON
  matching this Zod schema" utility.
- `generation/` — the actual pipeline: requirement extraction, company
  brief, per-category question generation, coverage checking, schedule
  allocation. Orchestrates the three layers above; this is where Section
  3's sequencing lives (see below).
- `kit-builder.ts` — pure functions over a `Kit` object for every edit and
  per-section regeneration a user can make. No I/O at all — every function
  takes a `Kit` and returns a new `Kit`, which makes the pinned-state logic
  (the brief's "hardest state problem") straightforward to unit-test in
  isolation.
- `kit.service.ts` — the only layer that touches MongoDB. Wraps
  `generation/pipeline.ts` (kit creation, as a background job) and
  `kit-builder.ts` (edits) around persistence, ownership checks, and
  re-validates every write against the Appendix A schema before saving.
- `kit.routes.ts` / `auth.routes.ts` — the thin HTTP layer: Zod-validated
  request bodies, calls into the service layer, structured JSON errors.

## Retrieval approach & sources

**Company site.** `retrieval/crawler.ts` does a bounded best-first search
from the given URL, not a fixed list of paths — the brief is explicit that
a hard-coded `/careers` guess isn't sufficient, since real companies put
their hiring page at `/jobs`, `/handbook`, an engineering blog, or nowhere
at all. Each discovered link is scored by `retrieval/rank-links.ts` against
hiring-related and about-related keywords in its URL path and anchor text;
the crawl frontier is a priority queue by that score, bounded by
`CRAWL_MAX_PAGES` (default 8) so a large site doesn't blow the time/token
budget. `robots.txt` is fetched and respected per origin (`retrieval/robots.ts`,
cached per-origin so it's fetched once per crawl); a per-host rate limiter
(`retrieval/rate-limiter.ts`) spaces requests by `CRAWL_RATE_LIMIT_MS`.
`retrieval/fetcher.ts` retries transient failures (timeout, 5xx) with
backoff, enforces a content-type allowlist and a streamed size cap, and
follows redirects manually so each hop can be re-checked for safety (see
[Security](#security)). A source that can't be retrieved is recorded and
skipped, never fatal to the run (Section 2).

**Public interview discussion.** `search/tavily.ts` queries Tavily for
public discussion of the company's interview process. Tavily was chosen
over the alternatives checked at build time: Brave's Search API dropped its
free tier, and Google's Custom Search JSON API is closed to new customers —
Tavily's free tier (1,000 credits/month, no card) was the one still
genuinely available. If it fails or times out, that's recorded honestly
(`discussion.error`) and the pipeline continues without it — a missing
signal, not a failed run.

**Untrusted content.** Everything retrieved this way — crawled page text,
search snippets, and the pasted job description itself — is wrapped with
`services/llm/prompt-safety.ts`'s `wrapUntrusted()` before it reaches a
prompt: an explicit `<untrusted_LABEL>...</untrusted_LABEL>` block with
framing that tells the model this is data to summarise, never instructions
to follow. See [Security](#security).

## Research & generation sequencing

Section 3 is explicit that this has to be "a sequence of deliberate steps
that respond to what has actually been found," not one prompt. The
sequence, all in `services/generation/pipeline.ts`:

1. **Extract requirements** from the pasted JD. No retrieval needed —
   pasted text is already there. IDs (`r1`, `r2`, ...) are assigned in code,
   not trusted to the model, so they're stable and guaranteed unique.
2. **Crawl the company site** for an about page and a hiring page.
3. **Search for public interview discussion**, using the crawled/derived
   company name.
4. **Generate the company brief** from crawled page text only — never
   fabricated when nothing could be retrieved (see [Edge cases](#edge-cases--failure-handling)).
5. **Generate questions**, one model call *per category* rather than one
   call for everything: a requirement like "5+ years with React" is
   scoped to a `technical` call, "mentoring junior engineers" to a
   `behavioural` one — Section 3 is explicit these "should not come from
   the same call with the same instructions." Whether a `system-design`
   category is generated at all depends on what step 2/3 actually found
   (`generation/hiring-signals.ts` detects mentions of a system-design
   round) or, absent any signal, on seniority — this is the "changes what
   questions make sense" part of sequencing being genuine, not decorative.
   `company-fit` questions are generated last, from the brief written in
   step 4.
6. **Check coverage** (`generation/coverage.ts`, pure code — Section 3:
   "your code's decision to make, not the model's"): compare every
   `must`-priority requirement against what the generated questions
   actually reference. Any gap triggers a second, narrowly-scoped
   generation call for just that requirement, then re-checks — see
   [Design decisions](#key-design-decisions-trade-offs-and-known-limitations)
   for why it's capped at 2 passes.
7. **Generate flashcards**, one batched call across all requirements.
8. **Allocate the schedule** — pure code, no model call. See
   [Schedule allocation](#schedule-allocation).

Each step's `onProgress` callback feeds the `progress` array on the
`Kit` document, which the frontend polls and renders as a step list
(Section 12: "watch the kit being generated, with visible progress")
rather than a bare spinner.

## Generated / edited / pinned state

Section 6 calls this "the hardest state problem in the assessment." The
representation: every question, flashcard, and the company brief carries an
optional `_meta: { origin, pinned }` block — additive to Appendix A, so
stripping it still leaves a kit that matches the required structure exactly.

- `origin` is `"generated"`, `"edited"`, or `"user_added"`.
- `pinned` starts `false` on anything the model generated, and flips to
  `true` the moment a user edits it or adds it by hand.

A regeneration of a category (`kit-builder.ts`'s `regenerateQuestionCategory`)
only ever replaces questions where `pinned === false`. Critically, it
doesn't just *keep* pinned questions after the fact — it excludes the
requirements they already cover from what's re-requested from the model at
all, so a hand-edited question doesn't just survive numerically, the
regeneration doesn't even ask the model to redo that ground (verified in
`kit-builder.test.ts`: the mocked category-generation call asserts it only
receives the *uncovered* requirements). The same pattern applies to
flashcards and the company-fit category; the company brief itself is a
whole-section replace on regenerate (there's no itemized list within it to
partially preserve).

## Schedule allocation

Deterministic, pure code (`generation/schedule.ts`) — Section 8 is explicit
this belongs in code, not a prompt:

- Questions are sorted must-priority-first, then hardest-first (by
  `difficulty`), then by stable id as a tiebreak.
- That sorted list is sliced into exactly `days_available` contiguous
  chunks via `Math.floor((day - 1) * total / daysAvailable)` indexing, so
  every day gets a fair share and the split is exact even when the
  question count doesn't divide evenly.
- `minutes` per question is `15 * difficulty` (15/30/45 minutes), summed
  per day, always an integer.
- A day with no material left (a 60-day schedule against a handful of
  questions) gets an honest `"Review & practice flashcards"` focus and
  0 minutes, rather than an empty or fabricated entry.

`validateKitStructure()` in `packages/shared/src/schema.ts` additionally
checks the cross-field invariants Appendix A implies: `schedule.days.length`
matches `days_available`, and every `must`-priority requirement is actually
represented by a scheduled question — this runs before every save
(`kit.service.ts`) and before the batch command writes a kit "ok"
(`scripts/evaluate.ts`).

## Practice mode

Section 7 leaves the "order the next session by confidence" question
deliberately open between a confidence-weighted sort and a spaced-repetition
interval. This implementation is confidence-weighted
(`services/practice.ts`): a never-reviewed card sorts first (treated as
maximally unconfident — you haven't proven you know it yet), then ascending
stated confidence, then least-recently-reviewed as a tiebreak so two cards
at the same confidence don't always resurface in the same order.

Chosen over a proper spaced-repetition interval (SM-2 and similar) because:
the prep window here is 1–60 days, not the months-to-years horizon
spaced-repetition intervals are built to optimise for, so the two
approaches converge in practice over a realistic prep window; and a
confidence-weighted sort is far simpler to explain, verify, and defend in
a 3-minute video than an interval scheduler's parameters. `orderForPractice()`
and `recordReview()` are pure functions, unit-tested directly
(`practice.test.ts`) without needing a running server.

## Creative feature: a printable one-pager

`/kits/[id]/print` (`apps/web/src/app/kits/[id]/print/page.tsx`) — one of
the directions the brief itself suggests. The problem it solves: everything
else in this app assumes a live connection and an editing mindset, but the
day of the interview someone doesn't want to be tabbing through the
builder's categories and regenerate buttons on their phone — they want one
page, or a PDF of one, they can glance at or have printed. It's a dedicated
read-only route rather than a print stylesheet bolted onto the builder
page (whose DOM is full of interactive chrome that would need hiding piece
by piece and would still print each question's editable state), and the
browser's own print dialog doubles as "Save as PDF" in every modern
browser, so it needed no PDF library on either side.

## Edge cases & failure handling

Section 10, point by point:

| Case | Handling |
|---|---|
| Company URL invalid, 404s, or times out | `retrieval/fetcher.ts` retries transient failures then gives up; `crawlCompanySite()` catches and returns an empty result rather than throwing — the pipeline continues with an honest "could not retrieve any usable pages" brief. Tested in `crawler.test.ts`. |
| Company site has no discoverable hiring/about page | The link-ranking crawl simply finds nothing above its relevance threshold; `hiringPage`/`aboutPage` are `null`, and the kit says so rather than guessing. Tested in `crawler.test.ts`. |
| JD is a two-line stub | `extractRequirements()` returns whatever's genuinely there — an empty or near-empty requirements list — rather than inventing content to fill the shape. Tested in `extract-requirements.test.ts`. |
| Public discussion turns up nothing | `search/tavily.ts` reports `{ results: [] }` honestly; the pipeline proceeds without that signal. Tested in `tavily.test.ts`. |
| Model returns invalid JSON or an incomplete kit | `services/llm/generate-structured.ts` retries with a repair prompt that quotes the specific Zod validation error back to the model (bounded — `MAX_REPAIR_ATTEMPTS`), then throws a typed `LlmError` if it still can't get valid output. Every generated `Kit` is also re-validated against the full Appendix A schema (`KitSchema.parse` + `validateKitStructure`) before being saved or written to `kits.json` — a bug that somehow produced an invalid kit fails loudly instead of persisting silently. Tested in `generate-structured.test.ts`. |
| LLM provider rate-limits or briefly fails | `services/llm/gemini-client.ts` retries 429/5xx/timeout/network errors with exponential backoff; a genuinely non-retryable error (bad request, safety block) fails fast instead. Tested in `gemini-client.test.ts`. |
| Same description + company submitted twice | `kit.service.ts`'s `createKit()` checks for an identical in-flight job (same owner, `jd`, `companyUrl`, `days`, status `pending`/`generating`) and returns the existing one instead of spawning a duplicate. Tested in `kit.service.test.ts`. |
| 1-day or 60-day schedule | `allocateSchedule()` handles both: a 1-day schedule gets everything; a 60-day schedule against a handful of questions gets honest empty review days rather than fabricated ones. Tested in `schedule.test.ts`. |

## Security

Section 11, point by point:

- **URL validation before fetching.** `retrieval/url-safety.ts` rejects
  private/loopback addresses (`assertSafeUrl`, via `ipaddr.js`) — but only
  in production. Outside production this is intentionally permissive:
  Appendix B's example input serves company sites from
  `http://localhost:8099/acme/`, and Section 9 says as much explicitly
  ("the company sites used with this command may be served from a local
  address"), so blocking loopback addresses unconditionally would break
  the mandatory batch harness. Redirects are re-validated per hop
  (`assertSafeRedirect`) so a safe URL can't redirect its way to an
  internal address.
- **Restricted content types and sizes.** `fetcher.ts` enforces a
  content-type allowlist and a streamed size cap, aborting a response that
  exceeds it rather than buffering an arbitrarily large body.
- **Untrusted text is never instructions.** Every piece of text this app
  didn't write — the pasted JD, every crawled page, every search snippet —
  is wrapped in an explicit `<untrusted_LABEL>...</untrusted_LABEL>` block
  (`services/llm/prompt-safety.ts`) with framing that tells the model this
  is content to process, not directions to follow, before it ever reaches
  a prompt. `extract-requirements.test.ts` verifies this directly:
  a JD containing "ignore all previous instructions" is still wrapped, not
  interpolated raw.
- **Session cookie.** `httpOnly`, and `SameSite=None; Secure` in production
  (frontend and backend deploy to two different hosts, which makes the
  cookie genuinely cross-site — `SameSite=Lax` is not sent on a cross-site
  fetch at all, only a top-level navigation) or `SameSite=Lax` for local
  http dev, where `Secure` isn't available. See `auth.service.ts` and its
  tests.

## Testing

`npm test` runs the `apps/api` Vitest suite — 149 tests. What's covered,
roughly:

- **Pure logic**, directly, without any I/O: schedule allocation, coverage
  checking, structure validation (the three things Section 14 calls out by
  name), the pinned-state builder functions, practice-mode ordering.
- **Integration points**, against mocked boundaries rather than live
  services: the Gemini client's own retry/backoff against a mocked
  `fetch`; the JSON-repair loop against a mocked `callGemini`; the crawler
  against a real local HTTP fixture server (not mocked — realistic
  redirect/robots.txt/link-discovery behavior); auth and kit routes against
  a mocked Mongoose model (this sandbox's network policy blocks
  `mongodb-memory-server`'s binary download from `fastdl.mongodb.org`, so
  there's no in-memory-Mongo integration test here — see
  [Known limitations](#key-design-decisions-trade-offs-and-known-limitations)).
- **The batch CLI**, both as a mocked unit test suite and as a real,
  unmocked run of `npm run evaluate -- --input --output` (no API key
  configured in the build sandbox, so both smoke-test cases came back
  `"failed"` with `NO_API_KEY` — which is itself the correct behavior to
  verify: it failed gracefully, per-case, and still wrote valid
  Appendix-B-shaped output).

## Deployment

Mandatory (Section 12): both frontend and backend publicly reachable, on
free tiers, with env vars handled securely (never committed — see
`.gitignore` and the two `.env.example` files).

**Backend (`apps/api`) — Render, free web service:**

1. New Web Service → point at this repo.
2. Root directory: repo root. Build command:
   `npm install --include=dev && npm run build --workspace=packages/shared && npm run build --workspace=apps/api`.
   Start command: `npm run start --workspace=apps/api`.
   (The `--include=dev` matters: Render sets `NODE_ENV=production` during
   the build, and plain `npm install` skips `devDependencies` under that
   flag — which is where `typescript` lives in every workspace here. Without
   it, `npm install` silently installs zero copies of TypeScript and the
   build script falls through to whatever `tsc` happens to be on Render's
   system PATH instead of your project's pinned version, which can fail in
   confusing, version-independent ways.)
3. Set env vars from `apps/api/.env.example`: `MONGODB_URI` (an Atlas
   connection string), `JWT_SECRET` (a real random 32+ char secret, not the
   placeholder), `NODE_ENV=production`, `CORS_ORIGIN` set to the frontend's
   deployed URL (below), `GEMINI_API_KEY`, `TAVILY_API_KEY`.

**Database — MongoDB Atlas, free tier (M0):**

Create a free cluster, a database user, and allow network access from
anywhere (`0.0.0.0/0`) — Render's free tier doesn't have static outbound
IPs. Copy the connection string into the backend's `MONGODB_URI`.

**Frontend (`apps/web`) — Vercel:**

1. New Project → point at this repo, set the root directory to `apps/web`.
2. Vercel auto-detects Next.js and runs `apps/web`'s own `npm run build`,
   which is deliberately written as
   `cd ../.. && npm run build --workspace=packages/shared && cd apps/web && next build` —
   it builds the shared workspace package before `next build`, so no
   custom Vercel build-command override is needed even though the app
   lives in a monorepo subdirectory. (Vercel detects the root
   `package-lock.json`/workspaces and runs install from the repo root
   automatically.)
3. Set `NEXT_PUBLIC_API_URL` to the backend's deployed URL (from Render,
   above) in the project's environment variables.
4. Once deployed, go back to the backend's `CORS_ORIGIN` and set it to this
   Vercel URL (they reference each other, so the backend has to be deployed
   first, or the CORS var updated after the frontend's URL is known).

## Key design decisions, trade-offs, and known limitations

- **Coverage passes capped at 2** (`MAX_COVERAGE_PASSES` in
  `pipeline.ts`): one initial pass plus up to two gap-fill passes. A model
  that persistently can't produce a question for a given requirement after
  three total attempts is more likely a sign the requirement itself is odd
  (contradictory, or not really extractable into a question) than that one
  more retry would fix it — and an unbounded loop risks never terminating.
  A kit that still has an uncovered gap after that reports it honestly via
  `coverage.uncovered_requirement_ids` rather than looping forever or
  silently dropping the requirement.
- **Kit creation is async, edits/regenerates are sync.** Creating a kit
  kicks off `generateKit()` as a background job (`kit.service.ts`), with
  the frontend polling status — this can take anywhere from a few seconds
  to over a minute, and Section 13 explicitly asks "what happens when it
  takes ninety seconds." A single edit/regenerate action, though, runs
  synchronously within its HTTP request; it's a much smaller unit of work
  than the full pipeline, and giving every one of them its own
  async-job/polling machinery wasn't worth the added complexity for what's
  usually a single category or the brief. The trade-off: a "regenerate this
  category" click can leave the UI waiting 10–90 seconds for one response.
  Documented here rather than hidden — the regenerate buttons in the UI say
  so while they're in flight.
- **No MongoDB integration tests in this environment.** The sandbox this
  was built in blocks outbound access to `fastdl.mongodb.org`, which
  `mongodb-memory-server` needs to download its binary — so every
  Mongoose-model-dependent test here mocks the model instead of exercising
  a real database. The route/service contract (status codes, ownership
  checks, error shapes) is still verified; what isn't is Mongoose's own
  query behavior. Worth a quick local run against a real MongoDB (Atlas
  free tier, or `mongodb-memory-server` somewhere that can reach it) before
  relying on this for anything beyond what's already tested here.
- **No live run against real API keys during development.** This was
  built and tested entirely against mocked LLM/search boundaries — there's
  no Gemini or Tavily API key available in the build environment. Every
  piece of generation logic is unit-tested at its mocked boundary and the
  full pipeline is tested end-to-end against mocked calls
  (`pipeline.test.ts`, `pipeline-structure.test.ts`), but a first real run
  with your own keys is worth doing before submission, both to sanity-check
  output quality and to see actual free-tier rate-limit behavior in
  practice.
- **The batch CLI's concurrency (2) and per-case timeout (4 minutes)**
  are a deliberate middle ground — see the comment block at the top of
  `apps/api/src/scripts/evaluate.ts` for the full reasoning: bounded so 5
  cases can't exceed Section 9's 15-minute budget even in an all-timeout
  worst case, while still parallelizing the common case.
- **Requirements themselves aren't editable in the builder** — only
  questions, flashcards, the company brief, and the schedule (Section 6's
  stated scope). Coverage-checking and scheduling are both checked against
  `role.requirements`, so letting them drift independently of the
  extraction step would undermine the one guarantee coverage-checking
  exists to provide.
- **No undo/version history.** An edit or a regenerate overwrites the
  previous state; there's no way to step back to a prior draft of a
  question or brief short of re-typing it. Worth calling out as a real gap
  for a tool people will iterate on repeatedly.
- **Deleting a kit is immediate and irreversible** — no trash/recovery
  window.

## Walkthrough video outline

A suggested 3–4 minute structure covering everything the brief's video
checklist asks for — narrate over the actual running app rather than
slides:

1. **(30s) Create a kit end to end.** Paste a real JD, a company URL,
   set days. Show the progress steps appearing live while it generates.
2. **(45s) Research and generation, and the second pass.** Open the
   ready kit; point at the company brief and its sources (crawled pages);
   scroll to a `system-design` question and note it's there *because* the
   hiring page mentioned one (or because of seniority) — that's the
   sequencing, not decoration. If a coverage gap is visible, point at
   `coverage.passes` and explain the gap-fill pass.
3. **(45s) Editing, reordering, and a regeneration that preserves
   edits.** Hand-edit a question's prompt (note the "Edited" badge), then
   click "Regenerate" on that same category — show the edited question
   survives untouched while the rest of the category refreshes.
4. **(45s) Practice mode and the schedule.** Step through a few
   flashcards, rate confidence, show the ordering. Switch to the schedule
   tab and point out must-have coverage and the harder/earlier ordering.
5. **(30s) The creative feature, and one design decision to defend.**
   Show the printable one-pager. Then pick one decision from
   [Key design decisions](#key-design-decisions-trade-offs-and-known-limitations)
   — the coverage-pass cap or the confidence-weighted practice ordering
   are both easy to explain in one breath — and say why, out loud.

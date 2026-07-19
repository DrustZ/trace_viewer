# Report — UX & architecture decisions

The brief: a tool for loading, reading, and debugging LLM traces, working well with code
agents. This report explains what I chose to build, why, and what I deliberately did not.

## TL;DR — design FAQ

Skim this first; the numbered sections below go deeper.

**What is it, in one line?** A local-first viewer for reading and debugging a *single* LLM/RL
rollout trace — load it (paste / file / URL, or a run folder), read the agent conversation,
inspect tokens / spans / reward, and diff two runs. It answers *"why did this rollout go
wrong,"* not *"how is my app doing in production."*

**Why local-first + in-memory, no database?** The corpus (~1.3k traces) loads into memory and
aggregates in milliseconds; disk JSON under `data/runs/<run>/` is the source of truth, so
traces stay greppable and shareable as files. The store sits behind a narrow interface — at
100k+ traces you swap it for SQLite/DuckDB without touching anything else. Trade-off: boot
waits on the initial scan and there's no cross-restart index — fine for a dev-time tool.

**Why a normalized schema + connectors instead of per-format UI code?** One internal
`Trace/Message` model (roles + harmony-style channels); connectors detect+parse foreign
formats into it and *never throw*. Every view renders only the normalized model, so adding a
format is one file and the UI never grows format branches. Unknown fields are preserved in
`meta.extra` (shown in Metadata) and the Raw tab keeps original bytes — normalization never
loses information.

**Why are runs folders, not a field?** A run is a directory under `data/runs/`; the scanner
derives the run id from the folder name. Adding a run = dropping in a folder — which is how RL
runs actually land on disk, with no migration.

**Why does the home load nothing until you pick a run?** A real corpus can hold thousands of
runs; aggregating "everything" by default is neither useful nor cheap. An empty state forces
intent, and curves / components / table / AI are all gated behind a selection — so corpus size
never gates first paint.

**Why is the URL the share unit?** Filters, sort, grouping, selected run/trace, and tab all
serialize into the URL with one codec shared by the UI and API. Sharing a debugging state is
copying the address bar; deep-linking from an AI finding is trivial. Trade-off: a busy query
string.

**Why chat-first, step-grouped?** RL rollouts *are* agent conversations. A flat message list is
unreadable at 40 turns; grouping a response (reasoning → tool calls → answer) into one card
fixes it. I tried chat-style left/right alignment and reverted it — the eye ping-pongs;
uniform full-width, left-aligned, with color-coded kind chips reads better.

**Why is import ephemeral (in-memory, no disk)?** Import means "load & view this one trace,"
not corpus management. It's held in memory (re-importing just refreshes — never errors on a
duplicate), opens in a drawer with the home kept on the left so you can keep importing/loading,
and Raw still works from the in-memory copy. For a persistent corpus you drop files into
`data/runs/`.

**Why hide Timeline / Prev-Next / step-split for imported traces?** Honesty. A one-off import
has no run/checkpoint/split, no list to page through, and often no timing — so rather than
fabricate them (synthetic 1s span ticks, a "train" label, "1/1344"), the UI shows what exists
and hides what doesn't. Evolution stays, rendering a graceful "only one checkpoint" state so
the view is still consistent with loaded-run traces.

**Why synthetic data, not real traces?** Deterministic (same seed → byte-identical, unit-tested),
no licenses/downloads, dataset-shaped across six components, with failure modes worth finding
(malformed tool JSON, truncation, budget/cancel, wrong answers) and a 400-turn stress trace.
Realistic semantics matter: `executing` traces exist only in the in-progress run.

**Biggest bug?** An AI query — "which groups at step 125 average < 0.5" — returned only
score-0 traces: the filter DSL is per-trace, but the question is per-group. Fixed by giving the
analysis agent an `aggregate_instances` tool (group → avg) instead of filtering rows. The same
"don't fabricate / don't conflate" theme recurred in the Timeline (synthetic durations →
"order only · no timing") and in a dedup pass (I over-removed the component analytics table,
then restored it — dedup ≠ deleting a genuinely distinct view).

**Key trade-offs.** In-memory store (speed/simplicity vs scale/persistence); synthetic logprobs
(renders the full token UI vs not real logits); CSS-variable dark remap (pragmatic vs
bespoke-designed); Compare fixed at A/B (simple vs n-run, though the model is n-ready); no
component unit tests (a heavily-tested pure-function core + Playwright QA vs no view tests).

## 1. Problem framing & user

I built for the user I know best from production RL work: **a researcher reading rollout
traces from a post-training run to find out why something broke** — a bad tool call, a wrong
answer, a slow turn, a reward curve that stopped moving. That user reads *deeply* into single
traces, but always arrives at them through *aggregates*: a reward dip at a checkpoint, a
component underperforming, an instance that never passes.

That framing drives the two-level information architecture:

- **Corpus level** (home): reward-by-checkpoint curves, per-component analytics, an
  instance-grouped trace table — the "where do I look?" instruments.
- **Trace level**: a chat-first conversation view with step-grouped agent responses (with an
  in-view Timeline profiling mode and a compact three-pane mode), plus Metadata, Evolution
  (instance across checkpoints), Playground (replay), and Raw tabs.

Langfuse/LangSmith answer "how is my app doing in production"; this tool answers "why did
this rollout go wrong". That's why it is local-first and reader-optimized rather than an
ingestion platform.

## 2. Core decisions (choice → why → trade-off)

**Normalized schema with harmony-style channels.** One internal `Trace/Message` model with
roles (`system/developer/user/assistant/tool`) and channels (`analysis/commentary/final`).
Connectors translate foreign formats into it; every view renders only the normalized model.
Trade-off: some source-specific richness flattens — mitigated by `meta.extra` (unrecognized
fields are preserved, never dropped) and the Raw view (original bytes).

**Connectors never throw.** `detect() + parse() → {traces, warnings}`. Bad input degrades to
warnings plus whatever was salvageable; a deliberately corrupt file ships in the corpus to
keep the scanner honest. Malformed tool-call JSON is *kept raw with a parseError* and rendered
loudly — for an RL debugger, a model emitting broken JSON is signal, not noise to repair.

**One stats definition.** All formats' metrics are recomputed centrally (`computeStats`) so
"turns" or "thinking tokens" mean the same thing regardless of source. Sources may override
with exact values (e.g., real token counts) — overrides win, estimates fill gaps.

**In-memory store + JSON files; no database.** ~1,340 traces aggregate in milliseconds in
memory; disk (plain JSON) is the source of truth, so traces are greppable and shareable as
files. The store hides behind a narrow interface — at 100k+ traces you swap one file for
SQLite/DuckDB. Progressive scanning (serve immediately, stream the corpus in batches) covers
the "huge directory" case without the database. Trade-off: no cross-restart index; accepted
for a dev-time tool.

**The URL is the share unit.** Filters, sort, grouping, search, selected trace, drawer state,
tab, and message anchors all serialize into the URL with one codec shared by the UI and the
API. Sharing a debugging state = copying the address bar. This also made deep-linking from
AI-analysis findings trivial. Trade-off: a slightly busy query string.

**Step-grouped conversation.** An agent "response" is one unit: reasoning (collapsed by
default, expandable in place), then tool calls or the final answer. Uniform full-width,
left-aligned cards with color-coded borders and kind chips carry the who-said-what signal —
we tried chat-style left/right alignment and reverted it after dogfooding (eyes ping-pong).
Expand-all deliberately does *not* open reasoning (it's the noisiest content); collapse-all
closes everything. Flat message lists made 40-turn agent traces unreadable; grouping fixed it.

**Two timeline granularities.** A vertical minimap beside the conversation (color = message
kind, width/saturation = duration, with a visible-window indicator; click to jump) answers
"where does the time go while I read". The Timeline tab is the profiling view: a nested span
tree (turns → model/sandbox/grader) with proportional bars and a span-detail panel including
grader exceptions. Spans come from the generator as `meta.extra.spans`; traces without them
(imports) get a derived tree from message timestamps, so the view works for any format.

**Deterministic generator as executable spec.** The example corpus is generated
(seeded PRNG; same seed ⇒ byte-identical, unit-tested) with six dataset-shaped components,
per-instance sigmoid learning curves, dense checkpoints, injected failure modes, synthetic
logprobs (low confidence forced around failures), observability spans, judge verdicts with
reasoning, golden responses, and a reward breakdown (correctness vs length penalty). Realistic
semantics were a design goal: `executing` traces exist only at the training frontier, because
a finished experiment contains only completed/failed rollouts.

**AI features with graceful degradation.** Natural-language→filter, trace chat, the analysis
agent, and playground replay all use claude-sonnet-5 when a key is present. Without a key the
filter falls back to a deterministic rule parser and the rest degrade to clear affordances —
the evaluator experience never depends on credentials. The analysis agent's tools are this
app's own store operations (list/aggregate/read/search), which keeps it grounded: findings
cite real trace ids and propose a filter you can apply with one click.

**Single package, `shared/` contract.** One `package.json`, pure-TS `shared/` imported by both
server and web. No workspaces, no build orchestration — the reviewer runs two commands. All
view-feeding logic (stats, filters, aggregation, connectors, span building, tokenization)
lives in tested pure functions; UI stays thin.

## 3. Failure modes & edge cases handled

- **Bad input**: corrupt/unrecognized files are skipped with warnings (one ships in the
  corpus); pasted garbage returns 422 with reasons; unparseable tool JSON renders raw + red.
- **Empty states**: every view has explicit empty/loading/error states, including "why is
  Evolution empty for an imported trace" explanations and ungraded-score causes
  ("run cancelled before grading", "budget exhausted").
- **Huge traces**: a 3.5 MB / 400-turn trace ships in the corpus; virtualized rendering,
  clamped payloads, lazy raw view, capped span trees and token rendering keep it smooth.
- **Trace-level failures as data**: timeouts + retries, truncation, budget exhaustion,
  cancellation, judge exceptions — each visibly encoded (badges, red spans, summary notes).
- **Import safety**: server-side URL fetch is SSRF-guarded (protocol whitelist, private-range
  DNS rejection, size/time caps) — cheap to do, and the right reflex even in a local tool.

## 4. Performance & the path to millions of traces

What ships today is sized for the committed corpus (~1.2k traces) but the seams are placed
for orders of magnitude more:

- **Already built for scale**: progressive boot scan (serve in <1s, stream the corpus in
  batches with visible progress); every list/filter/sort/aggregate runs on summaries only —
  message bodies travel only on single-trace fetch; search index caps text per message;
  aggregates memoize per store version; the huge-trace path (virtualization, clamps, capped
  span/token rendering) is stress-tested with a 3.5 MB / 400-turn rollout.
- **At ~100k traces**: keep the architecture, swap residency — summaries stay in memory,
  full messages move to on-demand disk reads behind a small LRU (the store is a narrow
  single-file interface precisely so this is a local change); the trace table switches from
  a 2k-row fetch to keyset pagination feeding the existing virtualized viewport.
- **At millions**: replace the in-memory index with SQLite/DuckDB (metadata columns +
  FTS for keyword search) behind the same store interface; scan becomes an incremental
  indexer (mtime/size deltas); aggregates become SQL. The connector layer, normalized model,
  URL/filter DSL, and every view are unchanged — which is the point of the contract-first
  layering.

Other optimizations: log-scaled duration bars (30s timeouts don't flatten 200ms calls),
lazy BPE tokenization (only on Tokens-tab open), chip/DOM caps with explicit "+N more".

Virtualized lists everywhere content is unbounded (tables, conversation, raw view, span
trees); aggregates memoized per store version; minisearch index rebuilt lazily; progressive
boot scan (serve in <1s, stream the corpus); token chips capped with an explicit "+N more";
log-scaled duration bars so 30s timeouts don't flatten 200ms tool calls.

## 5. Non-goals

- **Production observability platform** — no auth, no multi-tenant, no OTel ingestion, no
  alerting. This is a dev-time debugging tool; that scoping is a feature.
- **Live tailing of in-flight runs** — the model supports `executing`, but streaming ingest
  is future work.
- **Real dataset content** — synthetic but dataset-shaped; no downloads, no licenses, fully
  deterministic.
- **UI test suite** — view-feeding logic is unit-tested (322 tests incl. API integration);
  the UI was verified continuously with a headless Playwright harness (`scripts/ui-debug.ts`)
  and manual review at every iteration. Playwright E2E specs are the natural next step.

## 6. Known gaps & if I had more time

A structured self-review against an earlier prototype of mine surfaced a prioritized adoption
list; what fit before the deadline landed (honest partial-comparison semantics on /compare —
totals vs loaded, '≈' aggregates, B−A delta labeling, matched/one-side-only rows; ephemeral
load-and-view import that opens the trace directly). The rest is deliberately deferred
and documented here as the next hardening pass:

- **First-class run identity** — runId currently lives in `meta.extra` with query-level
  scoping (evolution/siblings/panels are run-aware); the full version threads
  `(runId, traceId)` through types, URL, API, cache keys and the store.
- **Evaluation-evidence panel** — split reward / score / passed with a versioned pass
  policy, evaluator revision, and the judge's full prompt/rubric alongside its reasoning
  (we show reasoning + verdict + golden today; `score > 0` as "success" is a stand-in).
- **Raw provenance** — Normalized vs Original toggle, parser version/warnings, source
  locator and content hash on the Raw tab.
- **Verifiable AI citations** — chat/analysis cite `#N` and trace ids as free text today;
  the hardened version validates citations against real ids, rejects fabricated ones, and
  makes each citation a click-to-evidence jump.
- **Acceptance matrix** — adversarial E2E fixtures (500+ instances, 200+ rollouts on one
  instance, mixed-run collisions, hostile Markdown, duplicate-id import batches).

Two small navigation affordances also deferred: tool-call ↔ result click-through, and
"go to message" from a Timeline span (the span detail shows the message id).

Also: streaming responses for chat/analysis; a Python-sandbox tool for the analysis agent;
an OTel GenAI / Langfuse export connector (the registry makes this one file); SQLite index
behind the store for 100k+ corpora; richer cross-run diffing (per-instance output diffs,
regression detection between checkpoints); redaction toggles for sensitive payloads;
Playwright E2E suite.

## 7. Brief coverage map

| Brief item | Where it lives |
|---|---|
| Load by paste / upload / URL | Import dialog (3 tabs), sidebar drag-and-drop, watched `data/` dir; SSRF-guarded server fetch |
| Conversation clearly by message type | Role/channel color coding, step-grouped responses, uniform full-width cards (left/right chat alignment was tried and reverted — see §2) |
| Very long traces | Virtualized everything; 3.5 MB / 400-turn stress trace ships in-corpus; minimap navigation; content clamps; lazy raw |
| Stats about the trace | Per-trace metrics strip, Metadata tab, compact-mode metrics panel (token breakdown, avg neg log-prob); corpus tiles / component table / reward curves |
| More than one trace format | six connectors (native, openai-chat, openai-responses, anthropic-messages, qwen-generic, harmony) behind an auto-detecting registry; `examples/` fixtures |
| View the raw trace | Raw tab (lazy, downloadable) + per-message raw JSON view |
| Format normalization / extensibility | `shared/connectors` interface (never-throws), one central stats definition, `meta.extra` preserves unknown fields; new format = one file + registry entry |
| Easy to get value | Two commands to a fully populated app; 30-second tour in the README; seeded demo data with failures worth finding |
| Persistence (UX + architecture) | Disk JSON (`data/runs/<run>/`) is the source of truth; import is ephemeral load-and-view (in-memory); view state in the URL; UI preferences in localStorage |
| Sharing with a teammate | The URL is the share unit (filters/tab/drawer/message anchors); traces are plain files you can send; import round-trips them |
| Code patterns | Pure-function core in `shared/` consumed by both server and web; app factory for testability; single DSL codec for URL+API; contract-first schema |
| Keeping code clean | Strict TS + biome; ~260 unit/integration tests; view-feeding logic out of components; dead-code sweeps |
| Optimizations | §4 above |

## 8. Process

Built in one continuous session with Claude Code under my direction (design, hand-drawn
layouts, data-model spec, milestone gates, browser review of every version, course
corrections throughout — see progress.md for the version-by-version log and git history for
the milestone commits). Total wall-clock ≈ one working day, of which the final feature set
landed in the last three hours via parallelized implementation waves.

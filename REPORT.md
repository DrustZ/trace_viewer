# Report — UX & architecture decisions

The brief: a tool for loading, reading, and debugging LLM traces, working well with code
agents. This report explains what I chose to build, why, and what I deliberately did not.

## 1. Problem framing & user

I built for the user I know best from production RL work: **a researcher reading rollout
traces from a post-training run to find out why something broke** — a bad tool call, a wrong
answer, a slow turn, a reward curve that stopped moving. That user reads *deeply* into single
traces, but always arrives at them through *aggregates*: a reward dip at a checkpoint, a
component underperforming, an instance that never passes.

That framing drives the two-level information architecture:

- **Corpus level** (home): reward-by-checkpoint curves, per-component analytics, an
  instance-grouped trace table — the "where do I look?" instruments.
- **Trace level**: a chat-first conversation view with step-grouped agent responses, plus
  Timeline (profiling), Evolution (instance across checkpoints), Playground (replay), Raw.

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

**In-memory store + JSON files; no database.** ~1,200 traces aggregate in milliseconds in
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
  message bodies travel only on single-trace fetch; search index caps text per trace;
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
- **UI test suite** — view-feeding logic is unit-tested (≈260 tests incl. API integration);
  the UI was verified continuously with a headless Playwright harness (`scripts/ui-debug.ts`)
  and manual review at every iteration. Playwright E2E specs are the natural next step.

## 6. Known gaps & if I had more time

Two navigation affordances were consciously deferred at the deadline (both small,
both noted from self-review): click-through from a tool call to its result card and back,
and a "go to message" jump from a Timeline span into the conversation view (the span detail
panel shows the message id today).

Also: streaming responses for chat/analysis; a Python-sandbox tool for the analysis agent;
an OTel GenAI / Langfuse export connector (the registry makes this one file); SQLite index
behind the store for 100k+ corpora; richer cross-run diffing (per-instance output diffs,
regression detection between checkpoints); redaction toggles for sensitive payloads;
Playwright E2E suite.

## 7. Brief coverage map

| Brief item | Where it lives |
|---|---|
| Load by paste / upload / URL | Import dialog (3 tabs), sidebar drag-and-drop, watched `data/` dir; SSRF-guarded server fetch |
| Conversation clearly by message type | Role/channel color coding, step-grouped responses, input-left / response-right alignment |
| Very long traces | Virtualized everything; 3.5 MB / 400-turn stress trace ships in-corpus; minimap navigation; content clamps; lazy raw |
| Stats about the trace | Per-trace metrics strip, Metadata tab, compact-mode metrics panel (token breakdown, avg neg log-prob); corpus tiles / component table / reward curves |
| More than one trace format | native + harmony + openai-chat connectors behind an auto-detecting registry |
| View the raw trace | Raw tab (lazy, downloadable) + per-message raw JSON view |
| Format normalization / extensibility | `shared/connectors` interface (never-throws), one central stats definition, `meta.extra` preserves unknown fields; new format = one file + registry entry |
| Easy to get value | Two commands to a fully populated app; 30-second tour in the README; seeded demo data with failures worth finding |
| Persistence (UX + architecture) | Disk JSON is the source of truth; imports persist to `data/imported/`; view state in the URL; UI preferences in localStorage |
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

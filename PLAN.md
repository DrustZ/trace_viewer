# Trace Viewer — Plan

A local-first web tool for loading, reading, and debugging LLM traces from RL post-training runs.
When something breaks — a bad tool call, a wrong answer, a slow turn, a reward that never moves —
an engineer opens this tool, finds the rollout, and reads exactly what the model did and why.

**Positioning.** Langfuse-class platforms answer "how is my app doing in production"; this tool
answers "why did this rollout go wrong". Single-trace comprehension for researchers: chat-first,
checkpoint-aware, zero-infra. Works well with code agents (bash / editor / test-runner tool calls
are first-class citizens, not generic spans).

## Users & core scenarios

Researchers and engineers running RL post-training over agentic tasks. Concrete debugging loops:

1. **"Why did reward drop at step 150?"** → open reward curve, click the step, filter failed
   rollouts, read the first broken trace.
2. **"Why does this instance never pass?"** → group traces by instance, open Evolution to see
   score across checkpoints, compare a failing rollout against a passing sibling.
3. **"Which turn is slow?"** → open Timeline, find the widest bar, jump to that message.
4. **"Is the model unsure or just wrong?"** → toggle token logprobs, look for low-confidence
   spans inside the answer / tool arguments.
5. **"A teammate hit a weird trace"** → they paste the raw trace (any supported format) or send
   a URL; every view state is URL-addressable for sharing.

## Features

Core (table stakes from the brief):

- Load traces by **paste / file upload / URL**, plus a `data/` directory scanned & watched by the server
- **Conversation view by message type** — system / developer / user / assistant / tool, with
  thinking (harmony `analysis` channel) as collapsible reasoning blocks
- **Very long traces** — virtualized rendering, collapsed-by-default long payloads, in-trace search
- **Stats** — per-trace metrics (score, tokens, turns, tool uses, sandbox executions, thinking
  portion, duration, errors, truncation) and corpus aggregates (tiles, per-component table)
- **Multiple formats** — connector registry with auto-detection: native JSON, raw harmony token
  text, OpenAI chat-completions JSON; new format = one file + one registry entry
- **Raw view** — untouched source text, lazily loaded, downloadable

Differentiators (the RL-debugging layer):

- **Reward curves** (train/test) over checkpoint steps; click a point to filter that checkpoint
- **Component table** — per-dataset aggregates (count, success %, avg score/turns/tokens, sparkline)
- **Evolution view** — one instance across checkpoints: score curve + rollouts at each step + siblings
- **Timeline view** — Gantt of message/tool durations inside a trace; click a bar to jump to it
- **Token logprob visualization** — per-token confidence shading over model output
- **Filter builder** — key/operator/value conditions, serialized into the URL (shareable);
  **AI filter**: natural language → filter conditions (LLM when `ANTHROPIC_API_KEY` is set,
  deterministic rule parser fallback so the feature works offline)
- **Search** — indexed keyword search across all traces (snippets), plus in-trace find & jump

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript | Fastest iteration; team-standard stack |
| Styling | Tailwind CSS v4 | Clean light-theme tables/tiles quickly, no CSS drift |
| Server state | TanStack Query v5 | Caching, refetching; no hand-rolled fetch state |
| Virtualization | @tanstack/react-virtual | Dynamic-height message lists, 400+ turn traces |
| Charts | Recharts (curves) + hand-rolled SVG (sparklines, timeline) | Recharts for tooltip/legend "for free"; SVG where libs fight us |
| Backend | Express 4 + tsx (Node ≥ 20) | Boring and reliable; serves API + built SPA on one port |
| Storage | In-memory Map + JSON files on disk | ~1k traces ⇒ ms-level aggregation in memory; disk is the source of truth. Swap `traceStore.ts` for SQLite at 100k+ |
| Watch / search | chokidar + minisearch | Incremental rescan; tiny indexed search with snippets |
| Validation | zod | Boundary validation (imports, AI filter output) |
| Tests / lint | Vitest + supertest, Biome | Unit tests for all pure logic; small API integration suite |

Single `package.json` (no workspaces). Shared pure-TS code lives in `shared/` and is imported by
both the server and the web app via the `@shared` alias.

```
npm run dev        # concurrently: tsx watch server (:8787) + vite (:5173, proxies /api)
npm run build      # tsc --noEmit && vite build
npm start          # production: Express serves dist/ + API on one port
npm run generate   # regenerate example data (deterministic, seeded)
npm test / lint
```

## Architecture

```
requirement.md  PLAN.md  progress.md  README.md  REPORT.md
shared/                  # pure TS, no node/dom deps — the contract
  schema/types.ts        # normalized trace model (frozen at M2)
  connectors/            # types, registry, native, harmony, openaiChat
  stats/                 # computeStats, aggregate, evolution
  filter/                # keys, evaluate, parse (URL/API DSL), nlRules
server/
  index.ts  app.ts       # createApp(store) factory (supertest-able)
  store/                 # traceStore (in-memory index), scan (chokidar watch)
  routes/                # traces, aggregates, evolution, search, import, aiFilter
  search/searchIndex.ts  # minisearch wrapper
  ai/anthropic.ts        # NL→filter via LLM, zod-validated, timeout→rules fallback
src/                     # web app
  api/  state/  pages/   # client+hooks, URL filter params, HomePage/TracePage
  components/            # home/, trace/, common/
generator/               # deterministic synthetic-trace CLI (+ scenarios/, emit/)
data/
  traces/native/<component>/step-<n>/*.json    # committed example corpus
  traces/harmony/*.txt   traces/openai/*.json  # connector demo files
  traces/manifest.json                         # seed + composition summary
  imported/                                    # paste/upload/URL persistence (gitignored)
```

Data flow: `data/` files → connector registry (detect + parse) → normalized `Trace` → in-memory
store (+ minisearch index) → REST API → React Query → views. Imports go through the same
connectors and are persisted to `data/imported/`, so they survive restarts and can be shared as
files. Every filter/sort/tab/message anchor lives in the URL — a link *is* the share unit.

## Normalized schema (summary)

- `TraceMeta` — traceId, instanceId (join key for Evolution), component (dataset name), status
  (`completed | failed | executing`), timestamp, checkpointStep, split (`train | test`),
  dataLocation, sourceFormat, rewardDetails, extra (unrecognized fields are kept, never dropped)
- `TraceStats` — score (`number | null` = ungraded), hasError, truncated, model config (name,
  contextWindow, temperature, topP), input/output/thinking/total tokens, turns, toolUses,
  sandboxExecutions, thinkingPortion, durationMs
- `Message` — role (`system | developer | user | assistant | tool`), channel
  (`analysis | commentary | final`, harmony-style), content, toolCalls (arguments kept as the
  raw string — malformed JSON is a first-class debugging artifact, with `parseError` attached),
  toolResult (isError, durationMs), optional per-token logprobs, timestamp, durationMs,
  per-message score / judgeOutput
- Aggregates — `ComponentAggregate`, `RewardCurves` (train/test), `EvolutionSeries`

Connector contract: `detect(text)` + `parse(text) → { traces, warnings }`. Connectors **never
throw** — bad input degrades to warnings plus whatever was salvageable. Stats are always recomputed
by `computeStats` so all formats share one metrics definition.

## Example data (generator)

Deterministic TypeScript CLI (seeded PRNG; same seed ⇒ byte-identical output, asserted in tests).
Six components modeled after real datasets, each with a different conversation shape and scoring
semantics:

| Component | Modeled after | Shape | Scoring |
|---|---|---|---|
| `stem/deepscaler-math` | DeepScaleR-Preview | 1 turn + long thinking | programmatic math-verify → 0/1 |
| `stem/nemotron-science` | Nemotron-RL-Science | 1 turn + thinking | LLM-as-judge → 0/1 + judge output |
| `swe/swebench-verified-mini` | SWE-bench Verified mini | multi-turn: issue → bash / editor → diff → pytest | tests passed → 0/1 + details |
| `terminal/terminal-bench` | terminal-bench | command ↔ terminal loop (sandbox) | checker → 0/1 |
| `code/leetcode` | LeetCodeDataset | problem → thinking → code → sandbox test run | testcase pass fraction |
| `search/browsecomp-plus` | BrowseComp-Plus | search queries ↔ result snippets → answer | answer match → 0/1 |

Scale: 10 instances per component × 16 rollouts per instance, spread over ≥3 checkpoint steps
(from [1, 25, 50, 100, 150, 200, 250, 300]); train/test split with test evaluated at fewer steps
→ ~1,000 traces. Scores follow a per-instance sigmoid learning curve over steps, so Evolution
shows "it clicked after step N".

Injected failure modes (~25%): tool timeout + retry, malformed tool-call JSON, truncation,
budget exhaustion, cancelled run, wrong answer (score 0 with judge explanation) — plus a couple
of `executing` traces, one deliberately corrupt file (connector robustness), and one huge
~400-turn / ~4 MB terminal trace (virtualization stress test). ~30% of traces carry synthetic
per-token logprobs (high-confidence baseline, forced-low around injected failures, so
low confidence ≈ suspicious region).

The same generator also emits a handful of raw-harmony `.txt` and OpenAI chat-completions `.json`
files — demo inputs for the other two connectors and golden fixtures for their tests.

## Milestones

Each milestone ends demoable. Order: data first, then MVP viewer, then filters, then deep features.

- **M0 — Project docs** (this file + progress.md) → review gate ✅ you are here
- **M1 — Scaffold**: one command boots API + web; health check renders; tests green
- **M2 — Data layer**: schema frozen; generator (full spec above); 3 connectors; stats; unit tests
- **M3 — MVP**: trace table + stat tiles; trace page with Conversation / Metadata / Raw tabs;
  prev/next; virtualized 4 MB trace scrolls smoothly; malformed tool JSON rendered red
- **M4 — Filters & search**: filter DSL + builder UI + URL state; component table; reward curves
  with click-to-step; group-by-instance; global + in-trace search
- **M5 — Deep features** (four independent tracks): Timeline · Evolution + siblings ·
  token-logprob shading · AI filter + Import dialog (paste/upload/URL)
- **M6 — Polish, QA, docs, package**: empty/error/loading states; README (arch diagram, 30-second
  tour, AI-usage note); REPORT (decisions & motivations, failure handling, non-goals, future
  work); full QA pass incl. production build; zip

Cut order if time collapses: AI-filter LLM path (keep rules) → URL import (keep paste/upload) →
group-by-instance → Timeline (fall back to duration badges) → logprob shading (fall back to
avg-logprob number). Never cut: conversation view, filters + table, connectors, Evolution, docs.

## Non-goals

- Production observability platform (multi-tenant, auth, OTel ingestion, alerting) — this is a
  dev-time debugging tool, deliberately local-first
- Live streaming/tailing of in-flight runs (the model supports `executing`; live tail is future work)
- Real dataset downloads — example data is synthetic but shaped after the real datasets above
- UI test suite — all view-feeding logic lives in tested pure functions; UI verified by manual QA

## Risks & mitigations

1. **Harmony parsing edge cases** (`to=functions.x`, `<|return|>` vs `<|end|>`, unclosed blocks)
   → support the documented subset; unknown token sequences degrade to content + warning, never throw
2. **Virtualization + dynamic heights** (expanding a reasoning block) → react-virtual
   `measureElement`; collapse state owned by the list, not the recycled row; fallback = plain
   render with hard content clamps
3. **Data size creep** (logprob arrays) → measure after generate; knobs: logprob coverage,
   rollouts, output length. Target ≤ ~30 MB committed
4. **Recharts click payload quirks** → click-to-step is an enhancement; the checkpoint dropdown
   filter always exists
5. **Two-process dev friction** → vite proxy hardwired at M1; zero CORS anywhere


## Extended feature roadmap (post-baseline)

Ordering: finish v0.7 (sidebar layout + token-chip probs) → **M6 packages a submittable
baseline** → then ship the extended set below, one version at a time, committing after each.

Already shipped along the way (from the original wishlist): shareable permalinks (every view
state is a URL), correct system message rendering, trace-id/keyword search with snippets,
test-failure details (rewardDetails + tool output), proto-extension-style metadata viewing
(`meta.extra` via JSON tree), rich format tracing (markdown/KaTeX + Rich/Raw), harmony tokens
visible (Tokens mode + raw harmony source in Raw tab).

### v0.8 — Judge & score deep-dive
Everything pertaining to the final score, inspectable in one place:
- Generator: judge **reasoning** (not just verdict), **golden/reference response**, reward
  decomposition (`correctness_score` vs `final_reward` with explicit length-penalty term),
  richer test-failure detail
- UI: a Score panel on the trace page — golden response rendered (rich), judge reasoning +
  output quoted, correctness-vs-reward split with the penalty visible, per-test failures grid;
  "validate the judge" reading flow: golden vs actual vs judge-verdict side by side

### v0.9 — Trace AI chat
Floating chat panel on the trace detail view: packs the current trace (messages + metadata +
score data, truncated to budget) as context, answers questions like "is this answer actually
wrong?" via claude-sonnet-5 (`ANTHROPIC_API_KEY`; hidden when no key). Streaming responses;
conversation stays client-side.

### v1.0 — AI analysis agent
Home-page analysis box: "find traces with reward-hacking patterns", "why do swe traces time
out?" → an agent loop (tool-use over this app's own REST API: list/filter/aggregate/get-trace/
search) that plans, samples traces, reads them, and returns a summary + example trace links +
a suggested filter query. Progress panel streams the agent's steps. Python-sandbox analysis is
explicitly out of scope for now (documented); the API-tools loop covers the debugging stories.

### v1.1 — Power filters & real tokenizer
- New derived filter keys where the data supports them: contextLength, has zero-logprob token
  spans (consecutive), token/char presence, shortest-success / longest-running presets
  (sort+filter presets dropdown), harmony-format-error flag; generator adds per-trace
  `kl` + `trainer_batch` fields so KL-outlier / batch-range filters work
- Real BPE segmentation for Tokens mode via a JS tokenizer (`gpt-tokenizer`), replacing the
  synthetic whitespace tokenizer for imported traces without token arrays

### v1.2 — Cross-run comparison (delphi-like)
- Data model: `runId` on traces; generator emits a second run variant (different seed/name)
  with overlapping instances
- Sidebar grows a run switcher (the tree's top level); pick two runs → compare view: same
  instanceId across runs (final-checkpoint outputs side by side, reward diff table), reward
  curves overlaid per run; eval-set comparison across runs

### v1.3 — Scale architecture (async/progressive loading)
For millions of rollouts: metadata-first progressive scan (UI usable while checkpoints stream
in, per-checkpoint view updates), scan-progress indicator, message bodies always lazy; SQLite
(or DuckDB) index behind the existing `traceStore` interface for keyword search at scale —
interface already isolates the swap to one file.

### v1.5 — S2-inspired compact trace mode (adopted from the S2 viewer reference)
A third reading mode for dense agent traces, toggleable from the conversation view:
- **Left turn rail**: one compact cell per step/action — intent or tool label
  ('exploring code files', 'grep', '31 lines'), result line-counts, and inline **warning
  badges** derived per unit (output-too-long, malformed tool JSON, timeout/retry, truncated).
  Click a cell → center focuses that unit. This rail doubles as a scannable failure map.
- **Center**: the selected unit rendered with the existing card renderers
  (Rendered | Raw | Tokens views apply per piece).
- **Right metrics panel**: score/instance chips; turns · messages · user msgs · tool calls ·
  tools ✓/✗ · input/output/reasoning tokens · **avg neg log-prob**; a **token-breakdown
  stacked bar** (system / user / tool response / reasoning / tool call, color-coded);
  remaining `meta.extra` metrics as a key list.
- Data additions: per-trace `avg_neg_logprob` (generator + stats), per-unit derived flags
  (computed client-side from existing message data — no schema change).
Deliberately NOT adopted from S2: dark theme (keeping one coherent light theme),
Proto view (no proto layer here — Raw JSON covers it), external Sisyphus/Delphi links
(no external systems), trainer-logprob files (no trainer artifacts in this demo).

### v1.4 — Checkpoint playground / replay
Select a prompt (or history prefix) + a "checkpoint" and replay it live. Real policy
checkpoints don't exist in this demo, so replay calls a stand-in model (claude via API, clearly
labeled as simulation) — the UX (prefix selection, side-by-side with the recorded rollout) is
the deliverable; swapping in a real inference endpoint is a config change.

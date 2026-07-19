# Progress Log

Working log for the trace viewer build. Newest entries at the bottom. "Notes to remember" collects
gotchas and decisions we must not lose track of.

## 2026-07-18 — M0: plan & docs

**Done**
- Reviewed hand-drawn layouts (`traceviewsource/draft_*.HEIC`) and prior-tool screenshots;
  distilled them into PLAN.md (homepage = curves + tiles + component table + filter + trace
  table; trace page = Conversation / Timeline / Metadata / Evolution / Raw tabs)
- Locked decisions: web app + light Node backend; project root = `coding/trace_viewer/`;
  harmony-style message model (roles + analysis/commentary/final channels) with optional
  per-token logprobs; data-first milestone order (generator before viewer)
- Wrote PLAN.md (features, stack, architecture, schema, generator spec, milestones, non-goals)

**Next**: M1 scaffold after PLAN.md review.

## 2026-07-18 — M1: scaffold (done, commit 0a67ee1)

**Done**
- Single-package repo: Vite + React 19 + TS strict + Tailwind v4, Express 5 API (`server/app.ts`
  factory + `server/index.ts`), `npm run dev` boots both behind one command with a `/api` proxy
  (zero CORS); production mode serves `dist/` + API from one port
- Contract frozen: `shared/schema/types.ts` (Trace/Message/aggregates),
  `shared/connectors/types.ts`, `shared/filter/types.ts`, and `shared/stats/computeStats.ts`
  (single metrics definition, 8 unit tests green)
- Toolchain checks all green: `tsc --noEmit`, `vitest run`, `biome check`

**Notes to remember**
- Dependencies resolved to current majors: React 19, Express 5, zod 4, recharts 3,
  react-router 7, Biome 2, Vitest 4, TS 6. Express 5 route wildcards need RegExp form
  (`app.get(/^\/(?!api\/).*/)`) — string `*` patterns are gone.
- TS 6 removed `baseUrl`; path aliases must be relative (`"@shared/*": ["./shared/*"]`).
- Biome 2 config: `files.includes` with `!` negations; Tailwind needs
  `css.parser.tailwindDirectives: true`.
- A "turn" = one contiguous assistant message block (one model invocation); tool results
  belong to the step that invoked them (`stepIndex`).
- `.env` holds ANTHROPIC_API_KEY (gitignored); `.env.example` documents it. AI filter model
  default: claude-sonnet-5.

**Notes to remember**
- System `node` on this machine is v16 (EOL). Use Homebrew Node 22:
  `export PATH="/opt/homebrew/bin:$PATH"` before any npm/npx. `package.json` sets
  `engines.node >= 20`; README must state it.
- `coding/trace_viewer1/` holds an unrelated practice kit — do not touch, do not reference.
- Generator must stay deterministic: no `Date.now()`/`Math.random()` outside the seeded PRNG;
  timestamps derive from the seed. Same seed ⇒ byte-identical output (unit-tested).
- Connectors never throw; salvage + warnings. Stats recomputed centrally in `computeStats` for
  every format (one metrics definition).
- Keep committed `data/` ≤ ~30 MB — check `du -sh data/` right after the first generate.
- Malformed tool-call JSON is kept as the raw string with `parseError` — it is a debugging
  artifact, not something to "fix" at parse time.
- Every view state (filters, sort, tab, message anchor) must round-trip through the URL —
  the URL is the sharing mechanism.
- Take-home requires disclosing AI-tool usage in the submission → README will note the project
  was built with Claude Code (plan reviewed/directed by me); keep the note factual.
- Interactive browser QA available via Claude Code Chrome integration (`claude --chrome`) once
  the "Claude in Chrome" extension is installed — use it for the M6 QA pass.

## 2026-07-18 — M2: data layer (done, commit fb2aecb)

Four parallel tracks: aggregates (statTiles/componentAggregates/rewardCurves/evolution),
3 connectors (native / harmony text / openai-chat + registry, never-throw contract),
filter DSL (19 keys, evaluate + URL codec + NL rules fallback), deterministic generator.
Corpus: 961 traces / 11MB / 6 components × 10 instances × 16 rollouts over ≥3 checkpoint steps;
failures: 68 truncation, 79 wrong-answer, 29 malformed-JSON, 10 timeout+retry, 38 cancelled,
10 budget; 255 traces with synthetic logprobs (low confidence forced around failures);
huge trace `termbench-ihuge-s150-r01` (3.5MB/400 turns); 6 harmony + 6 openai showcase files;
1 corrupt file for scanner tolerance. 122 tests green.

## 2026-07-18 — M3: MVP (done, commit 6d0e826)

Full REST API (traceStore + chokidar scan/watch + minisearch + all routes from
shared/schema/api.ts incl. SSRF-guarded URL import), home page (tiles/filter bar/virtualized
sortable table/group-by-instance), trace page (conversation with REASONING collapse +
malformed-JSON red blocks + step badges, metadata tab, raw tab with virtualized lines).
E2E verify agent: 17 endpoint checks PASS, 6 Playwright screenshots judged, huge trace renders
~3.8s incl. browser boot, zero page errors, 144 tests green.

**Notes to remember**
- The 6 openai showcase files carry no sidecar meta → they land under component
  `imported/openai-chat` (7 components in /api/meta). Intentional: demonstrates connector
  defaults; revisit only if it confuses the demo story.
- `data/imported/` is runtime state — clean test artifacts before packaging.
- Verify agents leave the dev server running at :5173 (pid in /tmp/tv_dev.pid, log /tmp/tv_dev.log).

## 2026-07-19 — v0.4: user-feedback rework (done, commit 99c65ac)

User tested v0.3 in the browser; this round is their feedback verbatim → product:
- Fixed top region (tiles / reward curves / hierarchical component table, each a collapsible
  section persisted to localStorage) with only the trace table scrolling
- Reward curves: dense checkpoint grid (every 5 steps → 61 train points, 12 test evals) so the
  chart reads as real training progress; click a point filters that step
- Component table: category ▸ dataset hierarchy, count-weighted rollups, split control,
  sparklines, row click filters
- Trace preview drawer: right slide-over (?peek= in URL), drag-resizable, Expand → full page;
  group-by-instance header rows show per-column averages aligned under the table columns
- Conversation: TRACE SUMMARY panel (score chips / ground truth / judge output / status badges),
  system+developer messages now exist in data AND render (collapsed with explicit affordance),
  distinct per-type colors (system slate / user blue / reasoning violet / tool-call indigo /
  tool-result cyan / final emerald)
- Data semantics: `executing` only at the training frontier (max checkpoint step) — a finished
  experiment contains only completed/failed

**Notes to remember**
- Verify-agent false alarm: "all swebench traces hasError" was wrong (19/159 measured); failing
  pytest first-runs are correctly isError=false — only tool malfunctions set isError.
- ui-debug.ts first hit after HMR of a new dep can race vite's deps prebundle
  (ERR_ABORTED on recharts.js) — retry with a longer --wait.
- generate.test.ts asserts executing traces sit at the max checkpoint step (1-2 allowed at
  small --scale).

## 2026-07-19 — v0.5 → v0.6 (commits 8cc37a9, 672771c, 3b13529, 2329cf0)

- v0.5: timeline rail + in-trace search, Evolution tab, logprob shading, AI filter
  (sonnet-5 + rules fallback), condition builder, global search, import dialog
- v0.5.1: step-grouped conversation (StepCards, nested collapsed REASONING,
  expand/collapse-all), from user feedback
- v0.5.2: span-level profiling — generator ProfSpans (model/sandbox/grader + exceptions),
  Langfuse-style Timeline tab with span detail panel, derived fallback for imports
- v0.6: markdown/KaTeX rich rendering + Rich/Raw pills + numbering + reward/token chips,
  tri-state logprob views, evolution range band + scatter + tiles (sisyphus references)

## 2026-07-19 — Waves 1–2 + fix packs (commits bbc863c, 4369b4f, b744ba7, …)

Compressed delivery mode (user: everything within 3 hours; per-wave minimal gates, one full
verify at the end):
- Wave 1: vertical sidebar layout (selection stats, category tree multi-select, sidebar
  filters, import dropzone, run status bar), token-prob chips + inference top-k, judge
  reasoning + golden response + reward breakdown (+kl/trainer_batch), trace AI chat,
  progressive scan
- Wave 2: AI analysis agent (tool-use loop over the store), power filter keys + presets +
  gpt-tokenizer BPE fallback, cross-run comparison (run-b corpus + /compare), playground/replay
- Fix pack (user testing feedback): chat-style left/right alignment, vertical minimap
  timeline slider replacing the per-row rail, expand/collapse-all covering system/developer
  folds, score/evolution fallback states for unscored traces
- FIX-C: per-message Rendered|Raw|Tokens tabs with inline token inspector (confidence chips,
  #idx / prob% / ↵ toggles, selected-token panel with top-k alternatives)

**Notes to remember**
- Corpus is now TWO runs: data/traces (run-a, seed 42, 961) + data/traces_runb (run-b,
  seed 43, scale 0.5, 241; traceIds prefixed 'b-', instanceIds shared for /compare joins).
- The 'run' filter key defaults absent extra.run to 'run-a'.
- Waves used minimal inline gates (tsc+vitest+regen) instead of per-wave verify agents —
  final full verify happens in M6.

## 2026-07-19 — Final stretch: FIX-C, v1.5, cleanup, M6 (commits 298c9f1, 78e1981, 23618c4, …)

- FIX-C: per-message Rendered|Raw|Tokens tabs + inline token inspector (confidence ≥80%
  thresholds, Top-K/Probs/#/↵ toggles, selected-token panel with top alternatives, BPE
  synthetic fallback, full-message raw JSON) — replaces the global logprob toggle
- v1.5: S2-inspired compact three-pane mode (turn rail with warning badges, focused center,
  metrics panel with token-breakdown bar and avg neg log-prob)
- Dead-code sweep; .env.example completed; REPORT gained the scale path (path to millions:
  progressive scan shipped; lazy-body LRU and SQLite/FTS documented at the store seam) and
  a brief-coverage map
- AI features live-verified end to end: filter (sonnet-5 DSL), trace chat (diagnosed a wrong
  answer with cause + #N citation), analysis agent (grounded findings + suggested filter,
  14.6s), playground replay (3.9s)
- M6: brief-organized acceptance sweep (six Suggestions + edge cases + production mode),
  then packaging via `git archive` (committed content only — no node_modules/.env/imported)

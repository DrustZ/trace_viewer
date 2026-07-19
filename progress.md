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

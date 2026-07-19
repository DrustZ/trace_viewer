# Report — features & design rationale

## What it is

A **local-first tool for reading and debugging a single LLM/RL rollout trace**. You point it at
run folders (or paste/import one trace), find the rollout, and read exactly what the model did
— the conversation, the tokens, the timing, the reward, and how it evolved across training.

**Positioning.** It takes cues from [Langfuse](https://github.com/langfuse/langfuse) (LLM
observability) and [agent-prism](https://github.com/evilmartians/agent-prism) (agent-trace
visualization), but is deliberately **lighter-weight and reading-optimized**: no ingestion
pipeline, no database, no auth, no cloud — two commands and you're reading traces off disk. It
answers *"why did this rollout go wrong,"* not *"how is my app doing in production."* A trace
opens in a **side drawer, not a new page**, because when you're debugging you want to flip
between rollouts fast without losing the list.

*Background:* I build and maintain **Reflection AI's internal trace viewer and RL-run trace
debugger**, so the workflows here — read a rollout, profile it, compare runs, watch an instance
evolve across checkpoints — are the ones I reach for daily. This is a clean-room, self-contained
take on them (no internal code or data), which is why the feature choices below are opinionated
rather than exhaustive.

## Features, and why each exists

Each feature earns its place against one job: **read a rollout deeply, or find which rollout to
read.**

- **Chat-first, step-grouped conversation.** A rollout *is* an agent conversation; a flat list
  is unreadable at 40 turns. Grouping each response (reasoning → tool calls → answer) into one
  card keeps long agentic traces legible.

- **Rendered ⇄ Raw per message.** *Rendered* (markdown, code, math) to read fast; *Raw* to see
  the exact bytes the model emitted. Malformed tool-call JSON is kept **raw and loud** (not
  repaired) — for a trainer, broken JSON is signal, not noise.

- **Compact mode.** A three-pane reader (turn rail + reading pane + metrics) for very long
  traces — so a 100-turn or multi-MB rollout stays navigable instead of an endless scroll.

- **Token logprob visualization.** Per-token confidence coloring with top-k alternatives.
  During training this matters: seeing *where the model is unsure* (or suspiciously overconfident)
  is central to SFT/RL data quality, and impossible to eyeball from raw numbers.

- **Timeline (profiling).** A turn → model / sandbox / grader span tree with duration bars and
  exceptions surfaced in red. **Errors + timing are the two things you need to debug a slow or
  failing rollout**, so they get a dedicated visual instead of being buried in the transcript.

- **Evolution (one instance across checkpoints).** The same instance's score and rollouts over
  training steps. Answers *"did this case get better or worse as training progressed?"* — the
  core question in experiment analysis.

- **Compare (two runs, side by side).** Diff one instance across two runs — reward-curve overlay
  plus rollouts and full trace views per side. Answers *"did run B's change actually help?"*

- **Aggregates to find where to look.** Reward-by-checkpoint curves, per-component analytics,
  and **group-by-instance** in the trace table. You almost never start from a single trace — you
  arrive at it through a dip in a curve or a failing component, so those instruments come first.

- **AI features (natural-language filter, Ask-AI chat, analysis agent, playground).** Pure
  efficiency: turn a question into a filter, ask about the open trace, or let an agent scan the
  corpus and cite traces. All degrade gracefully to a clear notice (or a rule-based fallback)
  when there's no API key, so the tool never *depends* on credentials.

- **Import (paste / file / URL, six format connectors).** Load a one-off trace to view; it opens
  in the drawer, held in memory only. Anthropic Messages, OpenAI Chat/Responses, Qwen/DeepSeek,
  harmony, and the native format are auto-detected.

- **Day / night theme + everything-in-the-URL.** Dark mode for long reading sessions; every view
  state (filters, sort, tab, open trace) serializes into the URL, so sharing a debugging state is
  just copying the address bar.

## Architecture (one paragraph)

Foreign formats pass through **connectors that never throw** into one **normalized Trace/Message
model** (roles + harmony-style channels); every view renders only that model, so adding a format
is one file and unknown fields survive in `meta.extra` + the Raw view. Metrics come from **one
stats definition** so "turns"/"tokens" mean the same thing regardless of source. Storage is an
**in-memory store over plain JSON** under `data/runs/<run>/` (a run *is* a folder — drop one in
and it appears); the store sits behind a narrow interface, so scaling to 100k+ traces is a
SQLite/DuckDB swap without touching the views. All view-feeding logic (stats, filters, connectors,
tokenization, span-building) is pure and unit-tested (~320 tests); the React UI stays thin.

## Trade-offs & non-goals

- **In-memory, no database** — millisecond aggregates + zero infra, vs. no cross-restart index
  and boot waits on the scan. Fine for a dev-time tool.
- **Synthetic corpus** — deterministic, license-free, dataset-shaped with real failure modes;
  logprobs are synthetic (the UI renders real ones as-is).
- **Compare is A/B** — the data model is n-run-ready; the UI fixes it at two.
- **Not a production platform** — no auth, multi-tenant, OTel ingestion, or alerting by design.
- **No component unit tests** — the pure-function core is heavily tested and the UI was verified
  with a headless-Playwright harness; React E2E specs are the natural next step.

## AI-tooling disclosure

Built with **Claude Code** under my direction — product design, layouts, data model, milestones,
and per-iteration browser review are mine; implementation and testing were AI-accelerated and
reviewed. Reference material: the Anthropic Messages and OpenAI Responses API docs, the OpenAI
harmony format, and the Langfuse / agent-prism projects named above.

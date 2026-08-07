# Run it

A local web app — no account, no database, no cloud. Two commands and you're in.

## Prerequisites

- **Node.js ≥ 20** (check with `node -v`)

## Run — one click

```bash
./setup.sh
```

Installs dependencies, generates the example corpus, and starts the app. Then open
**http://localhost:5173**.

### Or run it manually

```bash
npm install
npm run generate:all   # creates the bundled example corpus (deterministic)
npm run dev            # API on :8787 + web UI on :5173
```

Then open **http://localhost:5173**. (`generate:all` is only needed once — the source package
ships the generator, not the ~30 MB corpus, so you create it locally in one step.)

## What you'll see

- The app boots with **example data already bundled** — nothing to download.
- On the home page, pick a run from the **RUNS** list on the left to load its traces, then
  click any trace to read the full conversation.
- Want to load your own? Click **Import a trace** (paste JSON, upload a file, or fetch a URL).
  Ready-made samples for every supported format live in the `examples/` folder.

## Use it with ACE

Keep `trace_viewer` and `ac_express` as sibling checkouts:

```text
<workspace>/
├── trace_viewer/
└── ac_express/
```

On startup the Viewer automatically adds these existing ACE directories:

- `../ac_express/data` as the read-only `production` corpus;
- `../ac_express/runs/episodes` as simulation/evaluation runs.

There is no copy step and you should not add either folder again through the UI. If ACE is not a
sibling checkout, point discovery at it for that launch:

```bash
ACE_PROJECT_ROOT=/absolute/path/to/ac_express npm run dev
```

To watch any other corpus while the server is running, choose **Import a trace → Folder**, enter
an absolute directory, optionally give it a unique run label, and click **Add & watch**. The folder
must be inside `TRACE_VIEWER_ALLOWED_DATA_PARENTS`; by default that is the parent directory of the
Viewer checkout. Scope a different parent explicitly rather than allowing the whole home directory:

```bash
TRACE_VIEWER_ALLOWED_DATA_PARENTS=/absolute/path/to/eval-workspaces npm run dev
```

UI-added folders are restored after restart from `.trace-viewer/data-roots.json`. That registry is
machine-local, git-ignored, written with private permissions, and is the only place the full path is
persisted; list APIs expose only safe labels/relative display paths. For a deployment-managed root,
use `TRACE_DATA_ROOTS=run-label=/absolute/path/to/traces` instead.

The ACE entry points are linked across the UI and can also be opened directly:

- `/ace` — run launcher, lifecycle/control, live activity, episode outcomes, and failure triage;
- `/ace/analysis` — aggregate outcomes, pass^k, escalation, detector, tool, and cost breakdowns;
- `/ace/tasks` — Task Explorer for scenario goals, constraints, expected outcomes, grader contract,
  source digest, and observed trace coverage;
- `/ace/lab` — a single-task debug/counterfactual launch with recorded-versus-effective config;
- `/reviews` — Calibration and Assisted human-review queues;
- `/compare` — matched-seed A/B results and exact trace evidence.

### Live update contract

ACE's atomically written trace/manifest files are the durable source of truth. After a complete
message is saved, the file watcher publishes a sequenced SSE change notification and the open run,
trace, drawer, or aggregate view refetches the affected data. This is **message-level live update**,
not token streaming. A trace follows new messages only while you are at the bottom; after you scroll
up it preserves your position and shows **N new · Jump to latest**. During model/tool work, the ACE
run and Lab views can show the recorded pending phase.

### Replay fidelity names

The trace **Replay & Fork** tab keeps three capabilities deliberately separate:

1. **Historical tool replay** re-executes informative historical reads/writes and reports matches,
   residuals, and raw/chronological indices. It is compatibility evidence, not exact LLM replay.
2. **State-exact checkpoint restore** restores the recorded prefix, DB, RNG, ledger, and component
   state without calling a model or tool.
3. **Immutable checkpoint fork** creates a child run at a safe checkpoint. Exact fork keeps the
   recorded configuration; counterfactual fork may change the next user message, prompt, model, or
   temperature and is marked policy-changed/future-generation-nondeterministic.

Missing checkpoint, scenario, or config snapshots disable the corresponding action and the UI says
what is absent. The source trace/archive is never modified. **LLM-only continuation** is a separate
stand-in-model playground and is not ACE replay.

## ACE milestone smoke tests

These tests are ordered so each completed milestone is useful on its own. Provider-backed launch or
fork steps spend against the cost cap you choose; the read-only steps do not call a model.

### 1. Boot and discover ACE data

1. Start with `npm run dev`, then open `http://localhost:5173`.
2. Open the status bar's **data roots** menu and then **ACE runs**.

**Expected:** when the two sibling ACE directories exist, `production` is listed without an import,
and each discovered batch under `runs/episodes` is addressable by its exact run ID. A production-only
run is visibly read-only instead of exposing pause/resume/cancel controls.

### 2. Add a separate watched folder

1. Choose **Import a trace → Folder**.
2. Enter an existing absolute trace directory inside an allowed parent, add a unique label, and
   click **Add & watch**.
3. Restart the Viewer once after it finishes indexing.

**Expected:** the success notice reports indexed traces/warnings; the labeled run appears in the
sidebar; after restart it is marked **saved locally**. An outside-parent path is rejected rather than
silently granting browser access to arbitrary files.

### 3. Inspect task definitions and failures

1. Open **Task explorer**, search or filter to one scenario, and open its detail.
2. Inspect its goal/constraints, expected outcome, scoring authority/source digest, definition
   provenance, and formal run coverage.
3. Open one linked trace, then inspect **Evaluation** and **State & Tools**.

**Expected:** Task Explorer distinguishes current, historical, and unavailable definition evidence.
The trace separates runtime, invalid-user-simulator, grading, tool, detector, judge/semantic, and
integrity findings; grader evidence, world changes, visible versus actual tool outcome, and unknown
outcomes remain explicit. An ungraded production trace is shown as ungraded, not inferred successful.

### 4. Watch one low-cost debug run live

1. From a task detail choose **Open Interactive Lab** so one scenario is preselected.
2. Select **Debug**, one seed, a small max-message limit and cost cap, then launch only when the
   page says **ACE bridge ready** and the required provider credentials are configured.
3. Keep the run/trace open; scroll upward once messages begin arriving. Optionally request pause,
   resume, or cancel.

**Expected:** durable message counts, pending phase, and completed messages update without a page
reload. While scrolled up, your position stays fixed and the Jump-to-latest control appears. Control
requests take effect at a safe turn boundary. The debug run is labeled and excluded from formal
scored aggregates.

### 5. Submit a human review

1. Open **Human review** and choose **Calibration** before selecting an unreviewed trace.
2. Review transcript, rubric, and available scenario/policy ground truth; save a draft if desired,
   then submit one real judgment with rubric evidence.
3. Switch to **Assisted** for another trace and classify automatic failures as confirmed,
   false-positive, or unsure.

**Expected:** before Calibration submission, model/run arm and automatic grade, judge, detector, and
failure conclusions are redacted server-side. Submission locks the revision and then reveals the
comparison. Assisted mode shows automatic evidence immediately. Drafts remain separate; submitted
records append under the ACE `runs/labels/reviews.jsonl` store. Calibration reports raw agreement,
per-class recall, and κ; κ is shown as undefined when the observed classes cannot define it.

### 6. Verify replay boundaries

1. On a compatible production trace, open **Replay & Fork** and run **Historical tool replay**.
2. On a simulation trace with an archive, choose a safe boundary and run **Restore snapshot (no
   execution)**.
3. Inspect the exact and counterfactual fork controls without submitting a paid fork unless you
   intend to run it.

**Expected:** historical results identify tool-only fidelity and residuals. Restore reports the
checkpoint and boundary message without model/tool execution. Fork controls are enabled only when
required snapshots exist, show immutable lineage, and clearly distinguish exact config from a
policy-changed counterfactual. A trace lacking evidence shows the missing prerequisites instead.

### 7. Compare matched A/B evidence

1. Open **Compare runs**, choose two runs, then choose a shared instance. A Task Explorer
   **Compare matched A/B** link can prefill these fields.
2. Select one durable trace on each side and expand **Aligned ACE trace diff**.

**Expected:** the matched table uses schedule digest + scenario ID + environment seed, reports
improvements/regressions/ties, failed-check changes, paired pass delta, and a 95% CI when enough
pairs exist. Exact evidence aligns messages, tool sequence, world diff, and submitted local review
labels; missing labels are stated rather than synthesized.

### 8. Test Tailnet-only access

1. Stop the normal dev process if it owns ports 5173/8787, then run `npm run serve:tailscale`.
2. Open the printed Tailnet IP or MagicDNS URL from another authorized Tailnet device.
3. Copy the token locally from `~/.trace-viewer/access-token` into the unlock screen. Do not paste it
   into chat, logs, screenshots, source control, or a shared URL.

**Expected:** the launcher binds the frontend only to this machine's Tailscale IPv4 interface, keeps
the API on loopback behind the Vite proxy, and protects API/SSE access with the stable random token.
The token file remains outside the checkout with mode `0600`. Unlock exchanges the plaintext token
for a 30-day HttpOnly, SameSite=Strict session cookie; a first-visit
`#access_token=<TOKEN>` fragment is also
accepted and removed immediately. The launcher must stay running; for always-on use, configure the
OS service manager to supervise this command so it restarts the API/frontend pair after login or a
child-process failure.

## Optional — AI features

Natural-language filtering, per-trace chat ("Ask AI"), and corpus analysis use Claude when an
API key is present. **Everything else works without a key.**

```bash
cp .env.example .env        # then set ANTHROPIC_API_KEY in .env
npm run dev
```

## Optional — production build

```bash
npm run build && npm start  # serves the built app + API on a single port (8787)
```

## Optional — protect a Tailscale/shared server

By default, `serve:tailscale` automatically creates a stable random token at
`~/.trace-viewer/access-token` (mode `0600`, outside the served project) and protects all API/SSE
routes. Vite also denies direct access to the repository's private `.trace-viewer/` state and
`data/` corpus; traces are available only through the authenticated API. You may override the token:

```bash
TRACE_VIEWER_ACCESS_TOKEN='replace-with-a-long-random-token' npm run serve:tailscale
```

Open the normal server URL and paste the token into the unlock screen. For a convenient first
visit, the owner can also append `#access_token=YOUR_TOKEN` to the URL. The fragment is exchanged
for a 30-day, `HttpOnly`, `SameSite=Strict` cookie and removed from browser history immediately;
the plaintext token is not stored in the cookie or local storage. Avoid sharing token-bearing URLs
in chat or screenshots.

When `TRACE_VIEWER_ACCESS_TOKEN` is empty or unset, the current unauthenticated localhost workflow
is unchanged for the normal local dev command; the Tailscale launcher generates a token unless the
operator explicitly sets `TRACE_VIEWER_REQUIRE_ACCESS_TOKEN=0`. That opt-out is only appropriate
for a single-person Tailnet with trusted ACLs: every Tailnet peer allowed to reach the device can use
the API. Shared Tailnets, including Tailnets with tagged devices, must keep the token gate enabled.
Even with the gate disabled, the frontend binds only to an IPv4 address listed for the current node
by `tailscale status`, and the API remains on `127.0.0.1`. A `TRACE_VIEWER_TAILSCALE_IP` override
must exactly match one of those Self addresses; wildcard, LAN, loopback, and non-Self addresses are
rejected. The health probe remains available at `GET /api/health` in either mode. Set
`TRACE_VIEWER_ACCESS_TOKEN_FILE` to choose a different machine-local token path outside the
repository; paths inside the served project are rejected.

## Troubleshooting

- **Errors on an old Node / `node -v` < 20** → install Node 20+ and retry.
- **Port already in use** → free port 5173 (web) or 8787 (API), or set `PORT` for the API.

---

For features, architecture, and design decisions, see **README.md** and **REPORT.md**.

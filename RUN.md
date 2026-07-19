# Run it

A local web app — no account, no database, no cloud. Two commands and you're in.

## Prerequisites

- **Node.js ≥ 20** (check with `node -v`)

## Run

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

That's it. One command starts both the API (port 8787) and the web UI (port 5173).

## What you'll see

- The app boots with **example data already bundled** — nothing to download.
- On the home page, pick a run from the **RUNS** list on the left to load its traces, then
  click any trace to read the full conversation.
- Want to load your own? Click **Import a trace** (paste JSON, upload a file, or fetch a URL).
  Ready-made samples for every supported format live in the `examples/` folder.

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

## Troubleshooting

- **Errors on an old Node / `node -v` < 20** → install Node 20+ and retry.
- **Port already in use** → free port 5173 (web) or 8787 (API), or set `PORT` for the API.

---

For features, architecture, and design decisions, see **README.md** and **REPORT.md**.

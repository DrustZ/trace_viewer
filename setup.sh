#!/usr/bin/env bash
#
# One-click setup + run for Trace Viewer.
# Installs dependencies, generates the example corpus (deterministic), and starts
# the app at http://localhost:5173.
#
# Requires Node.js >= 20 (the script checks and tells you if it's missing).
#
set -euo pipefail
cd "$(dirname "$0")"

MIN_NODE=20

echo "▶ Checking Node.js…"
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install Node >= ${MIN_NODE} (https://nodejs.org or via nvm), then re-run." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE}" ]; then
  echo "✗ Node $(node -v) is too old — need >= ${MIN_NODE}. Upgrade and re-run." >&2
  exit 1
fi
echo "✓ Node $(node -v)"

echo "▶ Installing dependencies…"
npm install

# The corpus is generated, not shipped. Skip if it already exists.
if [ -d "data/runs/run-a" ]; then
  echo "✓ Example corpus already present (data/runs) — skipping generation."
else
  echo "▶ Generating the example corpus (deterministic; ~4 runs)…"
  npm run generate:all
fi

echo ""
echo "▶ Starting Trace Viewer → http://localhost:5173  (Ctrl+C to stop)"
npm run dev

#!/usr/bin/env bash
# Runs the browser end-to-end tests: builds the app, serves it with a simulated
# Google Drive on localhost:8765, and drives it with Playwright (Chromium).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 build.py
python3 test/build_harness.py

python3 -m http.server 8765 --directory test/site >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fs http://localhost:8765/index.html >/dev/null; then break; fi
  sleep 0.2
done

python3 test/e2e.py

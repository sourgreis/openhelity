#!/usr/bin/env bash
# Launch the configurator in its own window, without an address bar or tabs.
#
#   ./tools/app.sh [port]
#
# Starts a local server if one is not running yet and opens the page in Chrome
# in app mode. WebHID only exists in Chromium and only in a secure context, so
# http://localhost is required rather than file://.
set -euo pipefail

port="${1:-4173}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"
url="http://localhost:$port/"

if [[ ! -f "$root/pkg/openhelity_bg.wasm" ]]; then
  echo "The WebAssembly core is not built yet: run ./tools/build.sh first." >&2
  exit 1
fi

if ! curl -sf -o /dev/null --max-time 2 "$url"; then
  echo "Starting a server on port ${port}…"
  nohup python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null --max-time 1 "$url" && break
    sleep 0.2
  done
fi

for chrome in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
do
  if [[ -x "$chrome" ]]; then
    exec "$chrome" --app="$url"
  fi
done

echo "No Chrome, Edge or Chromium found. Open it manually: $url" >&2
exit 1

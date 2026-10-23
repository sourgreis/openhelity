#!/usr/bin/env bash
# Run the web configurator locally.
#
# WebHID only works in a secure context, so web/index.html cannot be opened
# straight from disk: http://localhost is required.
#
#   ./tools/serve.sh [port]      then open http://localhost:<port>
set -euo pipefail

port="${1:-4173}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"

if [[ ! -f "$root/pkg/openhelity_bg.wasm" ]]; then
  echo "The WebAssembly core is not built yet: run ./tools/build.sh first." >&2
  exit 1
fi

echo "Configurator: http://localhost:$port"
echo "Requires Chrome, Edge or another Chromium with WebHID."
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root"

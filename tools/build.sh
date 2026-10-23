#!/usr/bin/env bash
# Build the Rust core into WebAssembly for the web configurator.
#
#   ./tools/build.sh            release build into web/pkg
#   ./tools/build.sh --dev      faster, unoptimised build
#
# Needs the wasm32-unknown-unknown target and wasm-pack:
#     rustup target add wasm32-unknown-unknown
#     cargo install wasm-pack        (or: brew install wasm-pack)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="--release"
[[ "${1:-}" == "--dev" ]] && profile="--dev"

has_wasm_target() {
  [[ -d "$(rustc --print sysroot 2>/dev/null)/lib/rustlib/wasm32-unknown-unknown" ]]
}

# Homebrew's `rust` formula has no wasm32 target and shadows rustup, which
# Homebrew installs keg-only. Fall back to a rustup toolchain if there is one.
if ! has_wasm_target; then
  for dir in "$(brew --prefix rustup 2>/dev/null)/bin" "$HOME/.cargo/bin"; do
    if [[ -x "$dir/rustc" ]]; then
      export PATH="$dir:$PATH"
      has_wasm_target && break
    fi
  done
fi

if ! has_wasm_target; then
  echo "rustc ($(command -v rustc || echo 'not found')) has no wasm32-unknown-unknown target." >&2
  echo "Install it through rustup:  rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

wasm-pack build "$root/crates/wasm" "$profile" --target web --no-pack \
  --out-dir "$root/web/pkg" --out-name openhelity
node "$root/tools/notices.mjs" "$root/web/pkg/THIRD-PARTY-NOTICES.txt"

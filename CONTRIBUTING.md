# Contributing

## Prerequisites

- [rustup](https://rustup.rs/) — `rust-toolchain.toml` pulls in the stable
  toolchain, `clippy`, `rustfmt` and the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) — `cargo install wasm-pack`
- Node.js 22 or newer, for the build's licence notices, the tests and checks
- Python 3, only to serve the page locally
- a Chromium-based browser (Chrome, Edge, Opera, Brave)

## Building and running

```bash
./tools/build.sh          # builds the protocol core into web/pkg
./tools/build.sh --dev    # the same, unoptimised and faster
./tools/serve.sh          # http://localhost:4173
./tools/app.sh            # macOS: the page in its own Chrome app window
```

WebHID only works in a secure context, so `web/index.html` cannot be opened
from disk: it has to come from `localhost` or `https://`.

## Checks

CI runs the same steps; run them before opening a pull request.

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npx @biomejs/biome@2.5.15 ci .   # JavaScript lint
shellcheck tools/*.sh
npm run check                    # module syntax and translations
npm test                         # needs ./tools/build.sh first
```

The tests talk to a mock keyboard (`tests/support/mock-hid.mjs`); no hardware
is needed.

## Layout of the repository

| Path | Contents |
| --- | --- |
| `crates/core` | protocol framing and the codecs of every memory bank |
| `crates/wasm` | WebAssembly bindings the page calls |
| `web/` | the configurator: `index.html`, `js/`, `css/`, translations in `locales/` |
| `tests/` | Node tests of the page modules against the built core |
| `tools/` | build, serve and check scripts |
| `docs/` | the protocol and the interface |

Knowledge about the keyboard belongs in `docs/protocol.md` and about the
interface in `docs/ui.md`, not in code comments.

## Adding a keyboard model

The connection dialog only lists models in `DEVICE_MODELS` in
`web/js/protocol.js`, keyed by `"vendor:product"` in lower-case hex:

```js
export const DEVICE_MODELS = Object.freeze({
  "19f5:fd50": { name: "ZUOYA HE30 (G-COME)", type: 101 },
});
```

A model is added there only once it has been tested on real hardware. A board
with a different key layout also needs its factory key codes in
`web/js/layout.js` (in keymap-bank order, as command 7 returns them); the
diagram is generated from those codes. Please describe what you tested in the
pull request, and attach protocol captures rather than vendor software or
firmware files.

## Translations

See [`web/locales/README.md`](web/locales/README.md).

## Commits and pull requests

Keep a pull request to one change, write commit messages in English in the
imperative mood, and update `docs/` together with the code when behaviour or
protocol knowledge changes. Notable changes go into `CHANGELOG.md`.

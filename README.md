# Chopsticks

[![CI](https://github.com/sirbuffalo/chopsticks/actions/workflows/static.yml/badge.svg)](https://github.com/sirbuffalo/chopsticks/actions/workflows/static.yml)

A web implementation of the hand game [Chopsticks](rules.md), deployed via GitHub Pages from the [`frontend/`](frontend/) directory.

The bot is written in Rust and compiled to WebAssembly during the static-site build, then paired with a prebuilt opening-position cache.

## Setup

You'll need:

- [Rust](https://www.rust-lang.org/tools/install) (installs `cargo` and `rustup`)
- [Node.js](https://nodejs.org/) (any recent version)

After installing Rust, add the WebAssembly compilation target:

```sh
rustup target add wasm32-unknown-unknown
```

Without this target, `cargo build` will fail with `error[E0463]: can't find crate for 'std'`.

## Building

To regenerate the static site at [`frontend/`](frontend/), run:

```sh
./scripts/build-static-wasm.sh
```

This script:

1. Builds the Rust library ([`src/lib.rs`](src/lib.rs)) for the `wasm32-unknown-unknown` target.
2. Runs [`scripts/copy-wasm.mjs`](scripts/copy-wasm.mjs) to copy the resulting `.wasm` into [`frontend/chopsticks.wasm`](frontend/chopsticks.wasm).
3. Runs [`scripts/prebuild-cache.mjs`](scripts/prebuild-cache.mjs) to generate [`frontend/bot_cache.js`](frontend/bot_cache.js).

The generated [`frontend/chopsticks.wasm`](frontend/chopsticks.wasm) and [`frontend/bot_cache.js`](frontend/bot_cache.js) files are ignored by git. Re-run the build script after changing [`src/lib.rs`](src/lib.rs) or cache-relevant game logic, and before local browser testing.

## Testing locally

The frontend is a static site, so any local HTTP server works. From the repo root:

```sh
./scripts/build-static-wasm.sh
python3 -m http.server -d frontend 8000
```

Then open <http://localhost:8000>.

To run the Rust unit tests (host target, not wasm):

```sh
cargo test
```

To install development dependencies and run the JS unit tests:

```sh
npm ci
npm run test:unit
```

To run the browser smoke and integration tests:

```sh
npm ci
npx playwright install chromium
./scripts/build-static-wasm.sh
npm run test:e2e
```

To run the markdown lint check:

```sh
npm run lint:md
```

## Deployment

Pushes to `master` trigger [`.github/workflows/static.yml`](.github/workflows/static.yml). CI runs `./scripts/build-static-wasm.sh`, runs the Playwright tests against the generated static site, uploads the generated [`frontend/`](frontend/) directory, and deploys that tested artifact to GitHub Pages.

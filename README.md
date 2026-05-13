# Chopsticks

A web implementation of the hand game [Chopsticks](rules.md), deployed via GitHub Pages from the [`frontend/`](frontend/) directory.

The bot is written in Rust and compiled to WebAssembly, then embedded into a JS module along with a prebuilt opening-position cache.

## Building

To regenerate the static site at [`frontend/`](frontend/), run:

```sh
./scripts/build-static-wasm.sh
```

This script:

1. Builds the Rust library ([`src/lib.rs`](src/lib.rs)) for the `wasm32-unknown-unknown` target.
2. Runs [`scripts/embed-wasm.mjs`](scripts/embed-wasm.mjs) to embed the resulting `.wasm` into [`frontend/bot_wasm.js`](frontend/bot_wasm.js).
3. Runs [`scripts/prebuild-cache.mjs`](scripts/prebuild-cache.mjs) to generate [`frontend/bot_cache.js`](frontend/bot_cache.js).

### Requirements

- Rust toolchain with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Node.js

## Deployment

Pushes to `master` trigger [`.github/workflows/static.yml`](.github/workflows/static.yml), which publishes [`frontend/`](frontend/) to GitHub Pages. The build script is not run in CI — commit the regenerated [`frontend/`](frontend/) artifacts before pushing.

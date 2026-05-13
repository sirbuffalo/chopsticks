# Agent Notes

Operational context for an agent (Claude, Codex, etc.) working in this repo. Pairs with [README.md](README.md) (human onboarding) and [TODO.md](TODO.md) (suggested work).

## Repo shape

- [src/lib.rs](src/lib.rs) — Rust solver compiled to `wasm32-unknown-unknown`. Exposes `chopsticks_bot_next_state` and `chopsticks_bot_ranked_next_state` to JS.
- [src/main.rs](src/main.rs) — native CLI that uses `rusqlite` to precompute a solve database. **Gated by `cfg(not(target_arch = "wasm32"))`** in [Cargo.toml](Cargo.toml); it does **not** ship to the browser.
- [frontend/](frontend/) — what GitHub Pages serves. Plain HTML/CSS/JS, no bundler.
- [scripts/](scripts/) — Node build helpers (`.mjs`) and the top-level shell script.
- [.github/workflows/static.yml](.github/workflows/static.yml) — builds the static WASM frontend, runs Playwright tests, uploads the generated `frontend/` artifact, and deploys it to Pages on push to `master`.

## Build pipeline

`./scripts/build-static-wasm.sh` runs three steps in order:

1. `cargo build --target wasm32-unknown-unknown --release --lib` → `target/wasm32-unknown-unknown/release/chopsticks.wasm`
2. [scripts/copy-wasm.mjs](scripts/copy-wasm.mjs) copies the wasm into [frontend/chopsticks.wasm](frontend/chopsticks.wasm).
3. [scripts/prebuild-cache.mjs](scripts/prebuild-cache.mjs) instantiates the wasm in Node, explores positions reachable within `MAX_CACHE_DEPTH` plies (default 12, override with env var), and writes [frontend/bot_cache.js](frontend/bot_cache.js).

Env vars on the cache step:

- `MAX_CACHE_DEPTH=N` — exploration depth.
- `RESET_CACHE=1` — wipe and rebuild instead of expanding the existing cache.

## Generated files — DO NOT HAND-EDIT

One JS artifact has a generator banner at the top:

- [frontend/bot_cache.js](frontend/bot_cache.js) — regenerate via step 3 above.
- [frontend/chopsticks.wasm](frontend/chopsticks.wasm) — regenerate via step 2 above.

These files are ignored by git. CI regenerates them before browser tests and deploys the tested `frontend/` artifact. Any local change to [src/lib.rs](src/lib.rs) or cache-relevant game logic requires re-running `./scripts/build-static-wasm.sh` before browser testing, otherwise the local frontend may use a stale bot.

## Game-logic duplication

The repetition / draw rule and legal-move enumeration exist in **three** places and must stay in sync:

- [src/lib.rs](src/lib.rs) — authoritative solver.
- [scripts/prebuild-cache.mjs](scripts/prebuild-cache.mjs) — replays user-side moves to decide which positions to cache.
- [frontend/rules.js](frontend/rules.js) — client enforcement (`wouldRepeat`, `hasLegalUserMove`, `canonicalPair`, packed-state helpers). [frontend/script.js](frontend/script.js) and [frontend/bot.js](frontend/bot.js) consume these helpers.

Constants worth knowing: `MODULUS = 5`, `REPETITION_LIMIT = 3` (a position occurring a 3rd time is illegal → draw if no other move).

State encoding used between Rust and JS: a `u32` whose low 16 bits hold four nibbles `user[0] | user[1]<<4 | opponent[0]<<8 | opponent[1]<<12`. The high 16 bits are unused for live positions; `chopsticks_bot_ranked_next_state` returns `u32::MAX` (seen as `-1` on the JS side) to signal "no legal move at this rank." See `pack_hands` in [src/lib.rs](src/lib.rs) and `applyPackedHands` / `packedToState` in [frontend/rules.js](frontend/rules.js).

Hand pairs are canonicalized by sorting ascending (`canonicalPair` / `sortedPair`) before hashing or comparing — `[3,1]` and `[1,3]` are the same position.

## Rules reference

[rules.md](rules.md) is the gameplay spec. It is **not** consumed by code — purely a reference doc.

## Deploy

Push to `master` → [.github/workflows/static.yml](.github/workflows/static.yml) builds `frontend/`, tests it, uploads the generated artifact, and deploys it to Pages. Live site is served from the `frontend/` directory at the root path; there is a [frontend/CNAME](frontend/CNAME) for the custom domain.

## Conventions

- JS formatting is controlled by Prettier through `npm run format` / `npm run format:check`; do not hand-format around it.
- Rust formatting uses `cargo fmt` with the repo's [rustfmt.toml](rustfmt.toml).
- JS linting is configured in [eslint.config.js](eslint.config.js); run `npm run lint` or `npm run lint:fix`.
- Rust unit tests exist in [src/lib.rs](src/lib.rs) and [src/main.rs](src/main.rs); run `cargo test`.
- JS unit tests live under [tests/unit/](tests/unit/) and run with `npm run test:unit` (Node's built-in test runner). Playwright e2e tests live under [tests/e2e/](tests/e2e/) and run with `npm run test:e2e`.
- There is no frontend bundler. `package.json` is for development tooling (`prettier`, `eslint`, `globals`) and hook setup, not for shipping bundled assets.
- Frontend uses native ES modules — [frontend/index.html](frontend/index.html) loads `<script type="module" src="script.js">` and the modules under [frontend/](frontend/) use `import`/`export` (no bundler, no globals). New frontend code should match.
- Playwright starts a local HTTP server from [playwright.config.js](playwright.config.js). In sandboxed agent runs, `npm run test:e2e` may fail before tests start with `PermissionError: [Errno 1] Operation not permitted` while binding `127.0.0.1`; rerun the same command with sandbox approval. Treat that as an environment permission issue, not a test failure.

## Things to verify before declaring done

- If you touched [src/lib.rs](src/lib.rs): re-ran `./scripts/build-static-wasm.sh` before browser/e2e testing. Do not commit [frontend/chopsticks.wasm](frontend/chopsticks.wasm) or [frontend/bot_cache.js](frontend/bot_cache.js); they are generated and ignored.
- If you touched repetition / legal-move logic: mirrored the change across all three sites listed above.
- If you touched the frontend: opened [frontend/index.html](frontend/index.html) in a browser and played a turn. No CI catches behavioral regressions.
- If you touched JS under [frontend/](frontend/), [tests/](tests/), or [scripts/](scripts/): run `npm run format:check`, `npm run lint`, and `npm run test:unit`; use `npm run format` / `npm run lint:fix` for fixes.
- If you touched Rust: run `cargo fmt --check` and `cargo test`.
- If you touched any markdown file: run `npm run lint:md` and fix any errors.
- If you start a local web server or any other long-running process for agentic testing, stop it before declaring done. Do not leave software running for the user to clean up.

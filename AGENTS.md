# Agent Notes

Operational context for an agent (Claude, Codex, etc.) working in this repo. Pairs with [README.md](README.md) (human onboarding) and [TODO.md](TODO.md) (suggested work).

## Repo shape

- [src/lib.rs](src/lib.rs) — Rust solver compiled to `wasm32-unknown-unknown`. Exposes `chopsticks_bot_next_state` and `chopsticks_bot_ranked_next_state` to JS.
- [src/main.rs](src/main.rs) — native CLI that uses `rusqlite` to precompute a solve database. **Gated by `cfg(not(target_arch = "wasm32"))`** in [Cargo.toml](Cargo.toml); it does **not** ship to the browser.
- [frontend/](frontend/) — what GitHub Pages serves. Plain HTML/CSS/JS, no bundler.
- [scripts/](scripts/) — Node build helpers (`.mjs`) and the top-level shell script.
- [.github/workflows/static.yml](.github/workflows/static.yml) — uploads `frontend/` to Pages on push to `master`. **Does not run the build script.**

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

These are committed to git so the no-CI-build Pages deploy works. Any change to [src/lib.rs](src/lib.rs) requires re-running `./scripts/build-static-wasm.sh` and committing the regenerated files, otherwise the deployed site silently ships a stale bot.

## Game-logic duplication

The repetition / draw rule and legal-move enumeration exist in **three** places and must stay in sync:

- [src/lib.rs](src/lib.rs) — authoritative solver.
- [scripts/prebuild-cache.mjs](scripts/prebuild-cache.mjs) — replays user-side moves to decide which positions to cache.
- [frontend/script.js](frontend/script.js) — client enforcement (`wouldRepeat`, `hasLegalUserMove`, rearrange validation).

Constants worth knowing: `MODULUS = 5`, `REPETITION_LIMIT = 3` (a position occurring a 3rd time is illegal → draw if no other move).

State encoding used between Rust and JS: a single u16 with nibbles `user[0] | user[1]<<4 | opponent[0]<<8 | opponent[1]<<12`. See `applyPackedHands` / `packedToState` in [frontend/script.js](frontend/script.js).

Hand pairs are canonicalized by sorting ascending (`canonicalPair` / `sortedPair`) before hashing or comparing — `[3,1]` and `[1,3]` are the same position.

## Rules reference

[rules.md](rules.md) is the gameplay spec. It is **not** consumed by code — purely a reference doc.

## Deploy

Push to `master` → [.github/workflows/static.yml](.github/workflows/static.yml) uploads `frontend/` to Pages. No build step in CI. Live site is served from the `frontend/` directory at the root path; there is a [frontend/CNAME](frontend/CNAME) for the custom domain.

## Conventions

- JS formatting is controlled by Prettier through `npm run format` / `npm run format:check`; do not hand-format around it.
- Rust formatting uses `cargo fmt` with the repo's [rustfmt.toml](rustfmt.toml).
- JS linting is configured in [eslint.config.js](eslint.config.js); run `npm run lint` or `npm run lint:fix`.
- Rust unit tests exist in [src/lib.rs](src/lib.rs) and [src/main.rs](src/main.rs); run `cargo test`.
- There is no frontend bundler. `package.json` is for development tooling (`prettier`, `eslint`, `globals`) and hook setup, not for shipping bundled assets.
- Frontend uses `<script src>` globals, not ES modules. New code should match unless the task is explicitly to modularize.

## Things to verify before declaring done

- If you touched [src/lib.rs](src/lib.rs): re-ran `./scripts/build-static-wasm.sh` and committed [frontend/chopsticks.wasm](frontend/chopsticks.wasm) + [frontend/bot_cache.js](frontend/bot_cache.js).
- If you touched repetition / legal-move logic: mirrored the change across all three sites listed above.
- If you touched the frontend: opened [frontend/index.html](frontend/index.html) in a browser and played a turn. No CI catches behavioral regressions.
- If you touched JS under [frontend/script.js](frontend/script.js) or [scripts/](scripts/): run `npm run format:check` and `npm run lint`; use `npm run format` / `npm run lint:fix` for fixes.
- If you touched Rust: run `cargo fmt --check` and `cargo test`.
- If you touched any markdown file: run `npx markdownlint-cli2 "*.md"` and fix any errors.
- If you start a local web server or any other long-running process for agentic testing, stop it before declaring done. Do not leave software running for the user to clean up.

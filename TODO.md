# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

- [ ] **End-of-game UI.** A loss/draw currently just freezes the board ([frontend/script.js:303](frontend/script.js#L303), [frontend/script.js:314](frontend/script.js#L314)). Add a win/lose/draw banner and a "play again" button. Reloading should not be the only way to restart.
- [ ] **Touch support.** The only interaction is HTML5 drag-and-drop ([frontend/script.js:449-487](frontend/script.js#L449-L487)), which doesn't fire on mobile/tablet touch. Add pointer/touch handlers, or a tap-attacker-then-tap-target fallback (which also helps keyboard users).
- [ ] **Status text.** Nothing tells the player whose turn it is, that the bot is thinking, or that the game ended. Also: page `<title>` is "Game" ([frontend/index.html:5](frontend/index.html#L5)) — rename to "Chopsticks".
- [ ] **Keyboard / accessibility.** `aria-label` is set per hand ([frontend/script.js:99](frontend/script.js#L99)), but drag-and-drop isn't reachable by keyboard. A click-to-select-attacker, click-to-target model solves both this and touch in one shot.

## Deploy / build correctness

- [ ] **CI doesn't verify generated artifacts are fresh.** [.github/workflows/static.yml](.github/workflows/static.yml) just uploads `frontend/`. If someone edits [src/lib.rs](src/lib.rs) and forgets to run the build script, the deploy silently ships a stale bot. Pick one:
  - Run `./scripts/build-static-wasm.sh` in CI and stop tracking [frontend/bot_wasm.js](frontend/bot_wasm.js) / [frontend/bot_cache.js](frontend/bot_cache.js) (~115KB of generated JS out of git).
  - Or keep them tracked and add a `--check` mode that rebuilds and `git diff --exit-code`s, failing CI on staleness.
- [ ] **Drop base64-embedded WASM.** [frontend/bot_wasm.js](frontend/bot_wasm.js) is 113KB; the raw `.wasm` is ~85KB and gzips well. Ship `chopsticks.wasm` as a static asset and use `WebAssembly.instantiateStreaming(fetch(...))`.
- [ ] **Tune release profile.** [Cargo.toml](Cargo.toml) has no `[profile.release]`. Add `lto = true`, `codegen-units = 1`, `opt-level = "z"`, `strip = true` to shrink the WASM.

## Code / structure

- [ ] **Replace script-tag globals with ES modules.** `window.chopsticksBotWasmBase64`, `window.chopsticksPrebuiltBotCache`, and `window.chopsticksPrebuiltBotCacheDepth` are all globals. Switch to `<script type="module">` and split [frontend/script.js](frontend/script.js) (530 lines covering rendering, drag, rearrange, repetition tracking, bot caching, WASM loading) into focused modules.
- [ ] **Tests.** The Rust solver in [src/lib.rs](src/lib.rs) is doing real minimax work — add regression tests against known terminal positions. Same for the repetition-rule logic in JS (`wouldRepeat`, `hasLegalUserMove`).
- [ ] **Formatter / linter config.** No `rustfmt.toml`, no eslint/prettier. Cheap to add, prevents drift.

## Smaller polish

- [ ] Favicon + meta description + OG tags on [frontend/index.html](frontend/index.html).
- [ ] Prune unreachable entries from `repetitionCounts` ([frontend/script.js:26](frontend/script.js#L26)) — grows unbounded per game; fine in practice, but tidy.
- [ ] Surface [rules.md](rules.md) from the UI — a "Rules" link or expandable section.

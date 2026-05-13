# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

## Deploy / build correctness

- CI does not run `npm run lint:md`, even though [AGENTS.md](AGENTS.md) says it is the
  pre-merge check for markdown changes. Add a step to
  [.github/workflows/static.yml](.github/workflows/static.yml) so broken markdown
  cannot land.
- Git hooks ([.githooks/pre-commit](.githooks/pre-commit) and
  [.githooks/pre-push](.githooks/pre-push)) check formatting and lints but not
  the JS unit tests. `npm run test:unit` is fast (Node's built-in runner) — add
  it at least to `pre-push` so the rules-module contract is verified locally.

## Code / structure

- `chopsticks_bot_outcome`, `chopsticks_bot_cache_size`, and
  `chopsticks_bot_clear_cache` in [src/lib.rs](src/lib.rs) are exported via
  `#[unsafe(no_mangle)] pub extern "C"` but have **no JS callers**. The two
  cache helpers are only used by Rust unit tests via `super::*`; `_outcome` is
  unused. Drop the FFI attributes (or delete `_outcome` entirely) so they stop
  bloating the shipped WASM and the public ABI surface.
- [src/main.rs](src/main.rs) and [src/lib.rs](src/lib.rs) duplicate `State`,
  `Move`, `Outcome`, `Evaluation`, `legal_moves`, `reachable_graph`,
  `solve_outcomes`, and `best_move_for`. Move the shared core into the lib
  (under a `#[cfg(not(target_arch = "wasm32"))]`-friendly module) and have
  `main.rs` reuse it, keeping the CLI-only `MoveKind::Hit` fields (`amount`,
  `before`, `after`) and SQLite layer in `main.rs`. This is the single biggest
  source of "edit three places" risk.

## Smaller polish

- [src/main.rs](src/main.rs)'s `MAX_CANONICAL_STATES = 450` is a fudged progress
  total. The reachable graph from the initial position is much smaller (~150
  canonical positions × 2 turns ≈ 300, and even fewer are reached). Either
  compute the denominator after enumeration so progress is accurate, or drop
  the percentage display.
- [scripts/prebuild-cache.mjs](scripts/prebuild-cache.mjs) reuses the existing
  cache by regex-matching `chopsticksPrebuiltBotCache = [...]` out of the
  generated file. If anyone reformats `bot_cache.js` (e.g. Prettier on
  `frontend/**/*.js`), the regex breaks silently and the cache rebuilds from
  scratch. The file is already in `.gitignore` and Prettier is currently scoped
  to JS, but worth either pinning the format explicitly (e.g. a sentinel
  comment) or storing the cache as JSON next to the generated JS.
- [frontend/bot.js](frontend/bot.js) sets `botCacheLimit = Math.max(10, prebuiltBotMoveCache.size)`,
  which effectively pins the runtime LRU to the prebuilt cache's size (often
  thousands). The two caches are independent maps; the runtime cache only ever
  holds history-aware keys for the current game. Decide on an intentional LRU
  cap (e.g. a few dozen) and drop the dependence on the prebuilt cache size.

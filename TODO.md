# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

## Deploy / build correctness

## Code / structure

- Another agent at one point told me the following task that might be out of
  date or not necessary or even a bad idea-- see if you agree:
  `chopsticks_bot_outcome`, `chopsticks_bot_cache_size`, and
  `chopsticks_bot_clear_cache` in [src/lib.rs](src/lib.rs) are exported via
  `#[unsafe(no_mangle)] pub extern "C"` but have **no JS callers**. The two
  cache helpers are only used by Rust unit tests via `super::*`; `_outcome` is
  unused. Drop the FFI attributes (or delete `_outcome` entirely) so they stop
  bloating the shipped WASM and the public ABI surface.

## Smaller polish

- Another agent at one point told me the following task that might be out of
  date or not necessary or even a bad idea-- see if you agree:
  [src/main.rs](src/main.rs)'s `MAX_CANONICAL_STATES = 450` is a fudged progress
  total. The reachable graph from the initial position is much smaller (~150
  canonical positions × 2 turns ≈ 300, and even fewer are reached). Either
  compute the denominator after enumeration so progress is accurate, or drop
  the percentage display.
- Another agent at one point told me the following task that might be out of
  date or not necessary or even a bad idea-- see if you agree:
  [frontend/bot.js](frontend/bot.js) sets `botCacheLimit = Math.max(10, prebuiltBotMoveCache.size)`,
  which effectively pins the runtime LRU to the prebuilt cache's size (often
  thousands). The two caches are independent maps; the runtime cache only ever
  holds history-aware keys for the current game. Decide on an intentional LRU
  cap (e.g. a few dozen) and drop the dependence on the prebuilt cache size.

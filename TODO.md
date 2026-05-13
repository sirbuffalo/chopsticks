# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

## Deploy / build correctness

## Code / structure

- [ ] **Rust solver regression tests.** Add table-driven unit tests in [src/lib.rs](src/lib.rs) for stable rules and solver edge cases before changing minimax or ranking logic:
  - terminal states evaluate from the side to move correctly: current player dead is a loss, opponent dead is a win, and `best_move` returns no move.
  - immediate winning hits are selected when available, including the packed WASM export shape used by [frontend/bot.js](frontend/bot.js).
  - legal moves stay canonical and deduplicated for symmetric hands, while split/rearrange moves preserve the hand total without modulo wrapping.
  These should avoid asserting long forced line depths or heuristic tie-breaks unless the position has only one legal best move.
- [ ] **JS rules unit tests.** Add a small Node `node:test` suite for [frontend/rules.js](frontend/rules.js), plus an `npm run test:unit` script. Cover:
  - `repetitionKey` and `recordPosition` canonicalize swapped hand order but keep `user` and `bot` turns distinct.
  - `wouldRepeat` becomes true only after two prior occurrences, making the third occurrence illegal.
  - `hasLegalUserMove` is false for terminal dead-hand states, true when either a hit or split avoids repetition, and false when every hit and split would repeat.
  - `applyPackedHands` and `packedToState` preserve the Rust/JS u16 nibble contract.
- [ ] **Bot repetition fallback tests.** Add focused Playwright coverage around [frontend/bot.js](frontend/bot.js) with mocked `bot_cache.js` and WASM exports. Prove the bot skips prebuilt and top-ranked moves that would repeat, uses the first ranked non-repeating move, and returns `null` so the app declares a draw when no ranked move avoids repetition.
- [ ] **Test command wiring.** Once the focused suites above exist, wire CI to run `cargo test`, `npm run test:unit`, `npm run format:check`, `npm run lint`, and the existing Playwright tests before deployment.

## Smaller polish

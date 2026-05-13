# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

- [ ] **Keyboard / accessibility.** `aria-label` is set per hand ([frontend/script.js:99](frontend/script.js#L99)), but drag-and-drop isn't reachable by keyboard. A click-to-select-attacker, click-to-target model solves both this and touch in one shot.

## Deploy / build correctness

- [ ] **Tune release profile.** [Cargo.toml](Cargo.toml) has no `[profile.release]`. Add `lto = true`, `codegen-units = 1`, `opt-level = "z"`, `strip = true` to shrink the WASM.

## Code / structure

- [ ] **Tests.** The Rust solver in [src/lib.rs](src/lib.rs) is doing real minimax work — add regression tests against known terminal positions. Same for the repetition-rule logic in JS (`wouldRepeat`, `hasLegalUserMove`).

## Smaller polish

- [ ] Prune unreachable entries from `repetitionCounts` ([frontend/script.js:26](frontend/script.js#L26)) — grows unbounded per game; fine in practice, but tidy.
- [ ] Surface [rules.md](rules.md) from the UI — a "Rules" link or expandable section.

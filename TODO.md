# TODO

Suggested next steps, roughly ordered by value.

## Player-facing gaps

- [x] **Keyboard / accessibility.** Hands support click-to-select and keyboard activation for choosing an attacker and target.

## Deploy / build correctness

## Code / structure

- [ ] **Tests.** The Rust solver in [src/lib.rs](src/lib.rs) is doing real minimax work — add regression tests against known terminal positions. Same for the repetition-rule logic in JS (`wouldRepeat`, `hasLegalUserMove`).

## Smaller polish

- [ ] Surface [rules.md](rules.md) from the UI — a "Rules" link or expandable section.

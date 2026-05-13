import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPackedHands,
  hasLegalUserMove,
  packedToState,
  recordPosition,
  repetitionKey,
  wouldRepeat,
} from "../../frontend/rules.js";

test("repetition keys canonicalize hands while preserving turns", () => {
  const first = { user: [3, 1], opponent: [4, 2] };
  const swapped = { user: [1, 3], opponent: [2, 4] };

  assert.equal(repetitionKey("user", first), repetitionKey("user", swapped));
  assert.notEqual(repetitionKey("user", first), repetitionKey("bot", first));
});

test("recordPosition counts canonical hand order but keeps turns distinct", () => {
  const counts = new Map();
  const first = { user: [3, 1], opponent: [4, 2] };
  const swapped = { user: [1, 3], opponent: [2, 4] };

  recordPosition(counts, "user", first);
  recordPosition(counts, "user", swapped);
  recordPosition(counts, "bot", swapped);

  assert.equal(counts.get(repetitionKey("user", first)), 2);
  assert.equal(counts.get(repetitionKey("bot", first)), 1);
  assert.equal(counts.size, 2);
});

test("wouldRepeat becomes true only for the third occurrence", () => {
  const counts = new Map();
  const state = { user: [1, 2], opponent: [3, 4] };

  assert.equal(wouldRepeat(counts, "user", state), false);

  recordPosition(counts, "user", state);
  assert.equal(wouldRepeat(counts, "user", state), false);

  recordPosition(counts, "user", state);
  assert.equal(wouldRepeat(counts, "user", state), true);
});

test("hasLegalUserMove is false for terminal dead-hand states", () => {
  assert.equal(
    hasLegalUserMove({ user: [0, 0], opponent: [1, 1] }, () => false),
    false,
  );
  assert.equal(
    hasLegalUserMove({ user: [1, 1], opponent: [0, 0] }, () => false),
    false,
  );
});

test("hasLegalUserMove is true when a hit avoids repetition", () => {
  assert.equal(
    hasLegalUserMove({ user: [1, 0], opponent: [1, 0] }, () => false),
    true,
  );
});

test("hasLegalUserMove is true when a split avoids repetition", () => {
  const repeatingHitKey = repetitionKey("bot", {
    user: [1, 1],
    opponent: [0, 2],
  });

  assert.equal(
    hasLegalUserMove({ user: [1, 1], opponent: [1, 0] }, (turn, candidate) => {
      return repetitionKey(turn, candidate) === repeatingHitKey;
    }),
    true,
  );
});

test("hasLegalUserMove is false when every hit and split repeats", () => {
  assert.equal(
    hasLegalUserMove({ user: [1, 1], opponent: [1, 1] }, () => true),
    false,
  );
});

test("packed hand helpers preserve the Rust and JS u16 nibble contract", () => {
  const state = { user: [0, 0], opponent: [0, 0] };
  const packed = 0x4312;

  applyPackedHands(state, packed);
  assert.deepEqual(state, {
    user: [2, 1],
    opponent: [3, 4],
  });

  assert.deepEqual(packedToState(packed), {
    user: [1, 2],
    opponent: [3, 4],
  });
});

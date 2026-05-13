export const MODULUS = 5;
export const REPETITION_LIMIT = 3;

export function cloneState(state) {
  return {
    user: [...state.user],
    opponent: [...state.opponent],
  };
}

export function canonicalPair(hands) {
  return [...hands].sort((left, right) => left - right);
}

export const sortedPair = canonicalPair;

export function hasLiveHands(state, person) {
  return state[person].some((value) => value > 0);
}

export function repetitionKey(turn, candidate) {
  const user = canonicalPair(candidate.user);
  const opponent = canonicalPair(candidate.opponent);

  return `${turn}:${user[0]},${user[1]}:${opponent[0]},${opponent[1]}`;
}

export function wouldRepeat(repetitionCounts, turn, candidate) {
  return (
    (repetitionCounts.get(repetitionKey(turn, candidate)) ?? 0) >=
    REPETITION_LIMIT - 1
  );
}

export function recordPosition(repetitionCounts, turn, candidate) {
  const key = repetitionKey(turn, candidate);
  repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
}

export function applyPackedHands(state, packed) {
  state.user[0] = packed & 0xf;
  state.user[1] = (packed >> 4) & 0xf;
  state.opponent[0] = (packed >> 8) & 0xf;
  state.opponent[1] = (packed >> 12) & 0xf;
}

export function packedToState(packed) {
  return {
    user: canonicalPair([packed & 0xf, (packed >> 4) & 0xf]),
    opponent: canonicalPair([(packed >> 8) & 0xf, (packed >> 12) & 0xf]),
  };
}

export function hasLegalUserMove(state, repeats) {
  if (!hasLiveHands(state, "user") || !hasLiveHands(state, "opponent")) {
    return false;
  }

  for (let attacker = 0; attacker < 2; attacker += 1) {
    const amount = state.user[attacker];
    if (amount === 0) {
      continue;
    }

    for (let target = 0; target < 2; target += 1) {
      const before = state.opponent[target];
      if (before === 0) {
        continue;
      }

      const candidate = cloneState(state);
      candidate.opponent[target] = (before + amount) % MODULUS;
      candidate.opponent = canonicalPair(candidate.opponent);

      if (!repeats("bot", candidate)) {
        return true;
      }
    }
  }

  const total = state.user[0] + state.user[1];
  const before = canonicalPair(state.user);

  for (let left = 0; left < MODULUS; left += 1) {
    for (let right = left; right < MODULUS; right += 1) {
      const after = [left, right];
      if (
        left + right === total &&
        (after[0] !== before[0] || after[1] !== before[1]) &&
        !repeats("bot", {
          user: after,
          opponent: canonicalPair(state.opponent),
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function splitRange(total) {
  return {
    min: Math.max(0, total - (MODULUS - 1)),
    max: Math.min(MODULUS - 1, total),
  };
}

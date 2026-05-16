use std::cell::RefCell;
use std::collections::HashMap;

mod core;

pub use core::{
    Evaluation, MODULUS, Move, MoveKind, Outcome, SolveProgress, State, best_move_for,
    best_ranked_move_for, depth_limited_best_move, depth_limited_best_tied_moves,
    depth_limited_ranked_moves, depth_limited_state_score, reachable_graph,
    reachable_graph_with_progress, solve_outcomes, solve_outcomes_with_progress,
};

thread_local! {
    static SOLVED_CACHE: RefCell<HashMap<State, CachedMove>> = RefCell::new(HashMap::new());
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CachedMove {
    evaluation: Evaluation,
    next: Option<State>,
}

pub fn best_move(state: State) -> (Evaluation, Option<Move>) {
    if let Some(cached) = cached_move(state) {
        let best_move = ranked_moves_from_cache(state)
            .and_then(|moves| moves.into_iter().next())
            .or_else(|| {
                cached
                    .next
                    .and_then(|next| move_for_cached_next(state, Some(next)))
            });
        cache_best_next(
            state,
            cached.evaluation,
            best_move.as_ref().map(|best_move| best_move.next),
        );

        return (cached.evaluation, best_move);
    }

    let graph = reachable_graph(state);
    let outcomes = solve_outcomes(&graph);

    cache_solved_graph(&graph, &outcomes);

    let evaluation = *outcomes
        .get(&state)
        .expect("root state should have an outcome after solving");
    let best_move = ranked_moves_from_cache(state)
        .and_then(|moves| moves.into_iter().next())
        .or_else(|| best_ranked_move_for(state, &outcomes));
    cache_best_next(
        state,
        evaluation,
        best_move.as_ref().map(|best_move| best_move.next),
    );

    (evaluation, best_move)
}

fn cached_move(state: State) -> Option<CachedMove> {
    SOLVED_CACHE.with(|cache| cache.borrow().get(&state).copied())
}

fn move_for_cached_next(state: State, next: Option<State>) -> Option<Move> {
    next.and_then(|next| {
        state
            .legal_moves()
            .into_iter()
            .find(|candidate| candidate.next == next)
    })
}

fn ranked_moves_from_cache(state: State) -> Option<Vec<Move>> {
    if state.terminal().is_some() {
        return Some(Vec::new());
    }

    let mut moves = state.legal_moves();
    let mut child_outcomes = HashMap::new();

    for candidate in &moves {
        let cached = cached_move(candidate.next)?;
        child_outcomes.insert(candidate.next, cached.evaluation);
    }

    moves.sort_by(|left, right| core::compare_moves_by_rank(state, right, left, &child_outcomes));

    Some(moves)
}

fn outcome_ranked_moves_from_cache(state: State) -> Option<Vec<Move>> {
    if state.terminal().is_some() {
        return Some(Vec::new());
    }

    let mut moves = state.legal_moves();
    let mut child_outcomes = HashMap::new();

    for candidate in &moves {
        let cached = cached_move(candidate.next)?;
        child_outcomes.insert(candidate.next, cached.evaluation);
    }

    moves.sort_by_key(|candidate| {
        let reply = child_outcomes
            .get(&candidate.next)
            .copied()
            .unwrap_or_else(|| Evaluation::terminal(Outcome::Draw));
        Evaluation::after_reply(reply)
    });
    moves.reverse();

    Some(moves)
}

fn cache_best_next(state: State, evaluation: Evaluation, next: Option<State>) {
    SOLVED_CACHE.with(|cache| {
        cache
            .borrow_mut()
            .insert(state, CachedMove { evaluation, next });
    });
}

fn cache_solved_graph(graph: &HashMap<State, Vec<Move>>, outcomes: &HashMap<State, Evaluation>) {
    SOLVED_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();

        for state in graph.keys() {
            let evaluation = *outcomes
                .get(state)
                .expect("every reachable state should have an outcome");

            cache.entry(*state).or_insert(CachedMove {
                evaluation,
                next: None,
            });
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_next_state(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
) -> u32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );
    let next = best_move(state)
        .1
        .map(|best_move| best_move.next)
        .unwrap_or(state);

    pack_hands(next.hands)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_ranked_next_state(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
    rank: u32,
) -> u32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    let moves = if cached_move(state).is_some() {
        outcome_ranked_moves_from_cache(state).unwrap_or_default()
    } else {
        let _ = best_move(state);
        outcome_ranked_moves_from_cache(state).unwrap_or_default()
    };

    moves
        .get(rank as usize)
        .map(|best_move| pack_hands(best_move.next.hands))
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_depth_limited_next_state(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
    depth: u32,
) -> u32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    depth_limited_best_move(state, clamp_depth(depth))
        .map(|best_move| pack_hands(best_move.next.hands))
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_depth_limited_ranked_next_state(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
    depth: u32,
    rank: u32,
) -> u32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    depth_limited_ranked_moves(state, clamp_depth(depth))
        .get(rank as usize)
        .map(|best_move| pack_hands(best_move.next.hands))
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_depth_limited_random_tied_next_state(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
    depth: u32,
    seed: u32,
) -> u32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );
    let tied_moves = depth_limited_best_tied_moves(state, clamp_depth(depth));

    tied_moves
        .get((seed as usize) % tied_moves.len().max(1))
        .map(|best_move| pack_hands(best_move.next.hands))
        .unwrap_or(u32::MAX)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_depth_limited_score(
    turn: u32,
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
    depth: u32,
) -> i32 {
    let state = State::new(
        if turn == 0 { 0 } else { 1 },
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    depth_limited_state_score(state, clamp_depth(depth))
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_outcome(
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
) -> i32 {
    let state = State::new(
        1,
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    match best_move(state).0.outcome {
        Outcome::Win => 1,
        Outcome::Draw => 0,
        Outcome::Loss => -1,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_outcome(
    turn: u32,
    user_left: u32,
    user_right: u32,
    opponent_left: u32,
    opponent_right: u32,
) -> i32 {
    let state = State::new(
        if turn == 0 { 0 } else { 1 },
        [
            [clamp_hand(user_left), clamp_hand(user_right)],
            [clamp_hand(opponent_left), clamp_hand(opponent_right)],
        ],
    );

    match best_move(state).0.outcome {
        Outcome::Win => 1,
        Outcome::Draw => 0,
        Outcome::Loss => -1,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_cache_size() -> u32 {
    SOLVED_CACHE.with(|cache| cache.borrow().len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn chopsticks_bot_clear_cache() {
    SOLVED_CACHE.with(|cache| cache.borrow_mut().clear());
}

fn clamp_hand(value: u32) -> u8 {
    value.min(u32::from(MODULUS - 1)) as u8
}

fn clamp_depth(value: u32) -> u8 {
    value.min(u32::from(u8::MAX)) as u8
}

fn pack_hands(hands: [[u8; 2]; 2]) -> u32 {
    u32::from(hands[0][0])
        | (u32::from(hands[0][1]) << 4)
        | (u32::from(hands[1][0]) << 8)
        | (u32::from(hands[1][1]) << 12)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn terminal_states_evaluate_from_the_side_to_move() {
        struct Case {
            name: &'static str,
            state: State,
            outcome: Outcome,
        }

        let cases = [
            Case {
                name: "current player dead is a loss",
                state: State::new(0, [[0, 0], [1, 1]]),
                outcome: Outcome::Loss,
            },
            Case {
                name: "opponent dead is a win",
                state: State::new(0, [[1, 1], [0, 0]]),
                outcome: Outcome::Win,
            },
            Case {
                name: "same hands invert when turn changes",
                state: State::new(1, [[1, 1], [0, 0]]),
                outcome: Outcome::Loss,
            },
        ];

        for case in cases {
            chopsticks_bot_clear_cache();

            assert_eq!(case.state.terminal(), Some(case.outcome), "{}", case.name);

            let (evaluation, best_move) = best_move(case.state);
            assert_eq!(
                evaluation,
                Evaluation::terminal(case.outcome),
                "{}",
                case.name
            );
            assert!(best_move.is_none(), "{}", case.name);
        }
    }

    #[test]
    fn immediate_winning_hits_are_selected() {
        struct Case {
            name: &'static str,
            state: State,
            next: State,
        }

        let cases = [
            Case {
                name: "player zero kills player one's last hand",
                state: State::new(0, [[1, 4], [0, 1]]),
                next: State::new(1, [[1, 4], [0, 0]]),
            },
            Case {
                name: "player one kills player zero's last hand",
                state: State::new(1, [[0, 1], [1, 4]]),
                next: State::new(0, [[0, 0], [1, 4]]),
            },
        ];

        for case in cases {
            chopsticks_bot_clear_cache();

            let (evaluation, best_move) = best_move(case.state);

            assert_eq!(
                evaluation,
                Evaluation {
                    outcome: Outcome::Win,
                    plies: 1,
                },
                "{}",
                case.name
            );
            assert_eq!(
                best_move.map(|candidate| candidate.next),
                Some(case.next),
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn wasm_export_packs_immediate_winning_hit_reply() {
        chopsticks_bot_clear_cache();

        let packed = chopsticks_bot_next_state(0, 1, 1, 4);

        assert_eq!(packed, pack_hands([[0, 0], [1, 4]]));
    }

    #[test]
    fn wasm_export_returns_a_packed_bot_reply() {
        chopsticks_bot_clear_cache();
        let packed = chopsticks_bot_next_state(0, 1, 0, 1);

        assert_eq!(packed, pack_hands([[0, 2], [0, 1]]));
        assert!(chopsticks_bot_cache_size() > 0);
    }

    #[test]
    fn hits_use_remainders() {
        let state = State::new(0, [[4, 4], [1, 4]]);
        let moves = state.legal_moves();

        assert!(
            moves
                .iter()
                .any(|candidate| candidate.next.hands[1] == [0, 4])
        );
    }

    #[test]
    fn splits_can_revive_a_dead_hand() {
        let state = State::new(0, [[0, 4], [1, 1]]);
        let moves = state.legal_moves();

        assert!(
            moves
                .iter()
                .any(|candidate| candidate.next.hands[0] == [2, 2])
        );
    }

    #[test]
    fn legal_moves_are_canonical_and_deduplicated_for_symmetric_hands() {
        let state = State::new(0, [[1, 1], [1, 1]]);
        let moves = state.legal_moves();
        let unique_next_states = moves
            .iter()
            .map(|candidate| candidate.next)
            .collect::<HashSet<_>>();

        assert_eq!(unique_next_states.len(), moves.len());
        assert_eq!(
            moves
                .iter()
                .filter(|candidate| matches!(&candidate.kind, MoveKind::Hit { .. }))
                .count(),
            1
        );
        assert!(
            moves
                .iter()
                .any(|candidate| candidate.next == State::new(1, [[1, 1], [1, 2]]))
        );
        assert!(moves.iter().any(|candidate| matches!(
            &candidate.kind,
            MoveKind::Split {
                before: [1, 1],
                after: [0, 2],
            }
        )));

        for candidate in moves {
            assert!(
                candidate
                    .next
                    .hands
                    .iter()
                    .all(|hands| hands[0] <= hands[1])
            );
        }
    }

    #[test]
    fn split_moves_preserve_total_without_modulo_wrapping() {
        struct Case {
            hands: [u8; 2],
            expected_splits: &'static [[u8; 2]],
        }

        let cases = [
            Case {
                hands: [0, 4],
                expected_splits: &[[1, 3], [2, 2]],
            },
            Case {
                hands: [4, 4],
                expected_splits: &[],
            },
        ];

        for case in cases {
            let state = State::new(0, [case.hands, [1, 1]]);
            let splits = state
                .legal_moves()
                .into_iter()
                .filter_map(|candidate| match candidate.kind {
                    MoveKind::Split { after, .. } => Some(after),
                    MoveKind::Hit { .. } => None,
                })
                .collect::<Vec<_>>();
            let total = case.hands[0] + case.hands[1];

            assert_eq!(splits, case.expected_splits);
            assert!(splits.iter().all(|after| after[0] + after[1] == total));
        }
    }
}

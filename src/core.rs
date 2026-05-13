use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt;

pub const MODULUS: u8 = 5;
const POSITION_LOOKAHEAD_PLIES: u8 = 12;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct State {
    pub turn: usize,
    pub hands: [[u8; 2]; 2],
}

impl State {
    pub fn new(turn: usize, mut hands: [[u8; 2]; 2]) -> Self {
        hands[0].sort();
        hands[1].sort();
        Self { turn, hands }
    }

    pub fn initial() -> Self {
        Self::new(0, [[1, 1], [1, 1]])
    }

    pub fn opponent(self) -> usize {
        1 - self.turn
    }

    fn is_dead(self, player: usize) -> bool {
        self.hands[player] == [0, 0]
    }

    pub fn terminal(self) -> Option<Outcome> {
        if self.is_dead(self.turn) {
            Some(Outcome::Loss)
        } else if self.is_dead(self.opponent()) {
            Some(Outcome::Win)
        } else {
            None
        }
    }

    pub fn key(self) -> String {
        format!(
            "{}:{}{}:{}{}",
            self.turn, self.hands[0][0], self.hands[0][1], self.hands[1][0], self.hands[1][1]
        )
    }

    pub fn from_key(key: &str) -> Result<Self, String> {
        let mut parts = key.split([':', ' ']).filter(|part| !part.is_empty());
        let turn = parts
            .next()
            .ok_or_else(|| "missing turn".to_string())?
            .parse::<usize>()
            .map_err(|_| "turn must be 0 or 1".to_string())?;
        let current = parse_pair(
            parts
                .next()
                .ok_or_else(|| "missing player 0 hand pair".to_string())?,
        )?;
        let other = parse_pair(
            parts
                .next()
                .ok_or_else(|| "missing player 1 hand pair".to_string())?,
        )?;

        if parts.next().is_some() {
            return Err("too many state fields".to_string());
        }

        if turn > 1 {
            return Err("turn must be 0 or 1".to_string());
        }

        Ok(Self::new(turn, [current, other]))
    }

    pub fn legal_moves(self) -> Vec<Move> {
        let mut moves = Vec::new();
        let mut seen = HashMap::new();
        self.add_hit_moves(&mut moves, &mut seen);
        self.add_split_moves(&mut moves, &mut seen);
        moves
    }

    fn add_hit_moves(self, moves: &mut Vec<Move>, seen: &mut HashMap<State, usize>) {
        let us = self.turn;
        let them = self.opponent();

        for attacker in 0..2 {
            let attack_value = self.hands[us][attacker];
            if attack_value == 0 {
                continue;
            }

            for target in 0..2 {
                let target_value = self.hands[them][target];
                if target_value == 0 {
                    continue;
                }

                let mut next = self.hands;
                next[them][target] = (target_value + attack_value) % MODULUS;
                let next_state = State::new(them, next);
                push_unique(
                    moves,
                    seen,
                    Move {
                        kind: MoveKind::Hit { attacker, target },
                        next: next_state,
                    },
                );
            }
        }
    }

    fn add_split_moves(self, moves: &mut Vec<Move>, seen: &mut HashMap<State, usize>) {
        let us = self.turn;
        let total = self.hands[us][0] + self.hands[us][1];

        if total == 0 {
            return;
        }

        for left in 0..MODULUS {
            for right in left..MODULUS {
                if left + right != total || [left, right] == self.hands[us] {
                    continue;
                }

                let mut next = self.hands;
                next[us] = [left, right];
                let next_state = State::new(self.opponent(), next);
                push_unique(
                    moves,
                    seen,
                    Move {
                        kind: MoveKind::Split {
                            before: self.hands[us],
                            after: [left, right],
                        },
                        next: next_state,
                    },
                );
            }
        }
    }
}

fn parse_pair(value: &str) -> Result<[u8; 2], String> {
    let digits: Vec<u8> = value
        .chars()
        .map(|ch| {
            ch.to_digit(10)
                .ok_or_else(|| "hand pairs must be two digits in 0..4".to_string())
                .and_then(|digit| {
                    u8::try_from(digit)
                        .map_err(|_| "hand pairs must be two digits in 0..4".to_string())
                })
        })
        .collect::<Result<_, _>>()?;

    if digits.len() != 2 || digits.iter().any(|digit| *digit >= MODULUS) {
        return Err("hand pairs must be two digits in 0..4".to_string());
    }

    Ok([digits[0], digits[1]])
}

fn push_unique(moves: &mut Vec<Move>, seen: &mut HashMap<State, usize>, candidate: Move) {
    if seen.insert(candidate.next, moves.len()).is_none() {
        moves.push(candidate);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Move {
    pub kind: MoveKind,
    pub next: State,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MoveKind {
    Hit { attacker: usize, target: usize },
    Split { before: [u8; 2], after: [u8; 2] },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    Win,
    Draw,
    Loss,
}

impl Outcome {
    fn score(self) -> i8 {
        match self {
            Outcome::Win => 1,
            Outcome::Draw => 0,
            Outcome::Loss => -1,
        }
    }

    fn invert(self) -> Self {
        match self {
            Outcome::Win => Outcome::Loss,
            Outcome::Draw => Outcome::Draw,
            Outcome::Loss => Outcome::Win,
        }
    }
}

impl fmt::Display for Outcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Outcome::Win => write!(f, "win"),
            Outcome::Draw => write!(f, "draw"),
            Outcome::Loss => write!(f, "loss"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Evaluation {
    pub outcome: Outcome,
    pub plies: u16,
}

impl Evaluation {
    pub fn terminal(outcome: Outcome) -> Self {
        Self { outcome, plies: 0 }
    }

    pub fn after_reply(reply: Self) -> Self {
        Self {
            outcome: reply.outcome.invert(),
            plies: reply.plies.saturating_add(1),
        }
    }
}

impl Ord for Evaluation {
    fn cmp(&self, other: &Self) -> Ordering {
        let score_order = self.outcome.score().cmp(&other.outcome.score());
        if score_order != Ordering::Equal {
            return score_order;
        }

        match self.outcome {
            Outcome::Win => other.plies.cmp(&self.plies),
            Outcome::Draw => Ordering::Equal,
            Outcome::Loss => self.plies.cmp(&other.plies),
        }
    }
}

impl PartialOrd for Evaluation {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MoveRank {
    evaluation: Evaluation,
    pressure: i32,
}

impl Ord for MoveRank {
    fn cmp(&self, other: &Self) -> Ordering {
        self.evaluation
            .cmp(&other.evaluation)
            .then_with(|| self.pressure.cmp(&other.pressure))
    }
}

impl PartialOrd for MoveRank {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn reachable_graph(root: State) -> HashMap<State, Vec<Move>> {
    reachable_graph_with_progress(root, |_| {})
}

pub fn reachable_graph_with_progress(
    root: State,
    mut progress: impl FnMut(usize),
) -> HashMap<State, Vec<Move>> {
    let mut graph = HashMap::new();
    let mut seen = HashSet::new();
    let mut stack = vec![root];

    while let Some(state) = stack.pop() {
        if !seen.insert(state) {
            continue;
        }

        let moves = if state.terminal().is_some() {
            Vec::new()
        } else {
            state.legal_moves()
        };

        for candidate in &moves {
            stack.push(candidate.next);
        }

        graph.insert(state, moves);
        progress(seen.len());
    }

    graph
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SolveProgress {
    Round { round: usize, solved: usize },
    DrawClassification { solved: usize },
}

pub fn solve_outcomes(graph: &HashMap<State, Vec<Move>>) -> HashMap<State, Evaluation> {
    solve_outcomes_with_progress(graph, |_| {})
}

pub fn solve_outcomes_with_progress(
    graph: &HashMap<State, Vec<Move>>,
    mut progress: impl FnMut(SolveProgress),
) -> HashMap<State, Evaluation> {
    let mut outcomes = HashMap::new();

    for state in graph.keys() {
        if let Some(outcome) = state.terminal() {
            outcomes.insert(*state, Evaluation::terminal(outcome));
        }
    }
    progress(SolveProgress::Round {
        round: 0,
        solved: outcomes.len(),
    });

    let mut changed = true;
    let mut round = 0;
    while changed {
        changed = false;
        round += 1;

        for (state, moves) in graph {
            if outcomes.contains_key(state) {
                continue;
            }

            if moves.is_empty() {
                outcomes.insert(*state, Evaluation::terminal(Outcome::Loss));
                changed = true;
                continue;
            }

            let child_evaluations = moves
                .iter()
                .map(|candidate| outcomes.get(&candidate.next).copied())
                .collect::<Vec<_>>();

            if let Some(best_win) = child_evaluations
                .iter()
                .flatten()
                .filter(|child| child.outcome == Outcome::Loss)
                .map(|child| Evaluation::after_reply(*child))
                .max()
            {
                outcomes.insert(*state, best_win);
                changed = true;
            } else if child_evaluations
                .iter()
                .all(|child| child.is_some_and(|evaluation| evaluation.outcome == Outcome::Win))
            {
                let slowest_loss = child_evaluations
                    .into_iter()
                    .flatten()
                    .map(Evaluation::after_reply)
                    .max()
                    .expect("non-empty move list should have child evaluations");
                outcomes.insert(*state, slowest_loss);
                changed = true;
            }
        }

        progress(SolveProgress::Round {
            round,
            solved: outcomes.len(),
        });
    }

    for state in graph.keys() {
        outcomes
            .entry(*state)
            .or_insert_with(|| Evaluation::terminal(Outcome::Draw));
    }
    progress(SolveProgress::DrawClassification {
        solved: outcomes.len(),
    });

    outcomes
}

pub fn best_move_for(state: State, outcomes: &HashMap<State, Evaluation>) -> Option<Move> {
    if state.terminal().is_some() {
        return None;
    }

    state.legal_moves().into_iter().max_by_key(|candidate| {
        let reply = outcomes
            .get(&candidate.next)
            .copied()
            .unwrap_or_else(|| Evaluation::terminal(Outcome::Draw));
        Evaluation::after_reply(reply)
    })
}

pub fn best_ranked_move_for(state: State, outcomes: &HashMap<State, Evaluation>) -> Option<Move> {
    if state.terminal().is_some() {
        return None;
    }

    state
        .legal_moves()
        .into_iter()
        .max_by_key(|candidate| move_rank(state, candidate, outcomes))
}

pub(crate) fn compare_moves_by_rank(
    state: State,
    left: &Move,
    right: &Move,
    outcomes: &HashMap<State, Evaluation>,
) -> Ordering {
    move_rank(state, left, outcomes).cmp(&move_rank(state, right, outcomes))
}

fn move_rank(state: State, candidate: &Move, outcomes: &HashMap<State, Evaluation>) -> MoveRank {
    let reply = outcomes
        .get(&candidate.next)
        .copied()
        .unwrap_or_else(|| Evaluation::terminal(Outcome::Draw));
    MoveRank {
        evaluation: Evaluation::after_reply(reply),
        pressure: pressure_search(
            candidate.next,
            state.turn,
            POSITION_LOOKAHEAD_PLIES.saturating_sub(1),
            &mut HashSet::new(),
        ),
    }
}

fn pressure_search(state: State, player: usize, depth: u8, seen: &mut HashSet<State>) -> i32 {
    if let Some(outcome) = state.terminal() {
        return terminal_pressure(outcome, state.turn == player);
    }

    if depth == 0 || !seen.insert(state) {
        return position_pressure(state, player);
    }

    let moves = state.legal_moves();
    if moves.is_empty() {
        seen.remove(&state);
        return position_pressure(state, player);
    }

    let score = if state.turn == player {
        moves
            .into_iter()
            .map(|candidate| pressure_search(candidate.next, player, depth - 1, seen))
            .max()
            .expect("non-empty move list should have a max")
    } else {
        moves
            .into_iter()
            .map(|candidate| pressure_search(candidate.next, player, depth - 1, seen))
            .min()
            .expect("non-empty move list should have a min")
    };

    seen.remove(&state);
    score
}

fn terminal_pressure(outcome: Outcome, terminal_turn_is_player: bool) -> i32 {
    match (outcome, terminal_turn_is_player) {
        (Outcome::Win, true) | (Outcome::Loss, false) => 10_000,
        (Outcome::Loss, true) | (Outcome::Win, false) => -10_000,
        (Outcome::Draw, _) => 0,
    }
}

fn position_pressure(state: State, player: usize) -> i32 {
    let opponent = 1 - player;
    let ours = state.hands[player];
    let theirs = state.hands[opponent];

    let our_live = live_count(ours);
    let their_live = live_count(theirs);
    let our_total = hand_total(ours);
    let their_total = hand_total(theirs);
    let our_threats = immediate_hit_kills(state, player);
    let their_threats = immediate_hit_kills(state, opponent);
    let our_flexibility = state_with_turn(state, player).legal_moves().len() as i32;
    let their_flexibility = state_with_turn(state, opponent).legal_moves().len() as i32;

    (their_live - our_live) * -120
        + (our_total - their_total) * 18
        + (our_threats - their_threats) * 45
        + (our_flexibility - their_flexibility) * 4
        + split_balance(ours)
        - split_balance(theirs)
}

fn state_with_turn(state: State, turn: usize) -> State {
    State {
        turn,
        hands: state.hands,
    }
}

fn live_count(hands: [u8; 2]) -> i32 {
    hands.iter().filter(|hand| **hand > 0).count() as i32
}

fn hand_total(hands: [u8; 2]) -> i32 {
    hands.iter().map(|hand| i32::from(*hand)).sum()
}

fn split_balance(hands: [u8; 2]) -> i32 {
    if hands[0] == 0 || hands[1] == 0 {
        -8
    } else {
        -i32::from(hands[0].abs_diff(hands[1]))
    }
}

fn immediate_hit_kills(state: State, attacker: usize) -> i32 {
    let defender = 1 - attacker;
    let mut kills = 0;

    for attack_hand in state.hands[attacker] {
        if attack_hand == 0 {
            continue;
        }

        for target_hand in state.hands[defender] {
            if target_hand > 0 && (target_hand + attack_hand) % MODULUS == 0 {
                kills += 1;
            }
        }
    }

    kills
}

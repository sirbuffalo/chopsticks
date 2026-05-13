use rusqlite::{Connection, OptionalExtension, params};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fmt;
use std::io::{self, Write};
use std::path::Path;
use std::time::{Duration, Instant};

const MODULUS: u8 = 5;
const DRAW_REPETITIONS: u8 = 3;
const MAX_CANONICAL_STATES: usize = 450;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct State {
    turn: usize,
    hands: [[u8; 2]; 2],
}

impl State {
    fn new(turn: usize, mut hands: [[u8; 2]; 2]) -> Self {
        hands[0].sort();
        hands[1].sort();
        Self { turn, hands }
    }

    fn initial() -> Self {
        Self::new(0, [[1, 1], [1, 1]])
    }

    fn opponent(self) -> usize {
        1 - self.turn
    }

    fn is_dead(self, player: usize) -> bool {
        self.hands[player] == [0, 0]
    }

    fn terminal(self) -> Option<Outcome> {
        if self.is_dead(self.turn) {
            Some(Outcome::Loss)
        } else if self.is_dead(self.opponent()) {
            Some(Outcome::Win)
        } else {
            None
        }
    }

    fn key(self) -> String {
        format!(
            "{}:{}{}:{}{}",
            self.turn, self.hands[0][0], self.hands[0][1], self.hands[1][0], self.hands[1][1]
        )
    }

    fn from_key(key: &str) -> Result<Self, String> {
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

    fn legal_moves(self) -> Vec<Move> {
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
                let after = (target_value + attack_value) % MODULUS;
                next[them][target] = after;
                let next_state = State::new(them, next);
                let label = MoveKind::Hit {
                    attacker,
                    target,
                    amount: attack_value,
                    before: target_value,
                    after,
                };
                push_unique(moves, seen, label, next_state);
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
                let label = MoveKind::Split {
                    before: self.hands[us],
                    after: [left, right],
                };
                push_unique(moves, seen, label, next_state);
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

fn push_unique(
    moves: &mut Vec<Move>,
    seen: &mut HashMap<State, usize>,
    kind: MoveKind,
    next: State,
) {
    if seen.insert(next, moves.len()).is_none() {
        moves.push(Move { kind, next });
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Move {
    kind: MoveKind,
    next: State,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MoveKind {
    Hit {
        attacker: usize,
        target: usize,
        amount: u8,
        before: u8,
        after: u8,
    },
    Split {
        before: [u8; 2],
        after: [u8; 2],
    },
}

impl fmt::Display for MoveKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MoveKind::Hit {
                attacker,
                target,
                amount,
                before,
                after,
            } => write!(
                f,
                "hit with hand {} ({} fingers) into opponent hand {}: {} -> {}",
                attacker + 1,
                amount,
                target + 1,
                before,
                after
            ),
            MoveKind::Split { before, after } => {
                write!(
                    f,
                    "split own hands {}{} -> {}{}",
                    before[0], before[1], after[0], after[1]
                )
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Outcome {
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
struct Evaluation {
    outcome: Outcome,
    plies: u16,
}

impl Evaluation {
    fn terminal(outcome: Outcome) -> Self {
        Self { outcome, plies: 0 }
    }

    fn after_reply(reply: Self) -> Self {
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

struct Solver {
    db: Connection,
}

struct ProgressReporter {
    enabled: bool,
    start: Instant,
    last: Instant,
}

#[derive(Clone, Debug)]
struct CachedEvaluation {
    evaluation: Evaluation,
    best_next_state_key: Option<String>,
}

impl ProgressReporter {
    fn new(enabled: bool) -> Self {
        let now = Instant::now();
        Self {
            enabled,
            start: now,
            last: now,
        }
    }

    fn phase(&mut self, message: impl fmt::Display) {
        if !self.enabled {
            return;
        }

        eprintln!("[{}] {message}", format_duration(self.start.elapsed()));
        self.last = Instant::now();
        let _ = io::stderr().flush();
    }

    fn tick(&mut self, phase: &str, done: usize, total: Option<usize>) {
        if !self.enabled || self.last.elapsed() < PROGRESS_INTERVAL {
            return;
        }

        self.print_progress(phase, done, total);
    }

    fn force(&mut self, phase: &str, done: usize, total: Option<usize>) {
        if !self.enabled {
            return;
        }

        self.print_progress(phase, done, total);
    }

    fn print_progress(&mut self, phase: &str, done: usize, total: Option<usize>) {
        let elapsed = self.start.elapsed();
        match total {
            Some(total) => eprintln!(
                "[{}] {phase}: {done}/{total} ({:.0}%){}",
                format_duration(elapsed),
                percentage(done, total),
                eta_suffix(done, total, elapsed)
            ),
            None => eprintln!("[{}] {phase}: {done}", format_duration(elapsed)),
        }
        self.last = Instant::now();
        let _ = io::stderr().flush();
    }
}

impl Solver {
    fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS state_evaluations (
                state_key TEXT PRIMARY KEY,
                outcome TEXT NOT NULL CHECK(outcome IN ('win', 'draw', 'loss')),
                plies INTEGER NOT NULL,
                best_next_state_key TEXT
            );
            ",
        )?;
        Ok(Self { db })
    }

    fn best_move_with_progress(
        &mut self,
        state: State,
        progress: &mut ProgressReporter,
    ) -> rusqlite::Result<(Evaluation, Option<Move>)> {
        progress.phase(format!("checking SQLite cache for {}", state.key()));
        if let Some(cached) = self.cached(state)? {
            progress.phase("cache hit");
            return Ok((
                cached.evaluation,
                Self::move_for_cached_next(state, cached.best_next_state_key),
            ));
        }

        progress.phase("cache miss; enumerating reachable game states");
        let graph = reachable_graph(state, progress);
        progress.force("state enumeration", graph.len(), Some(MAX_CANONICAL_STATES));

        progress.phase(format!("solving {} reachable states", graph.len()));
        let outcomes = solve_outcomes(&graph, progress);

        progress.phase("writing solved states to SQLite");
        for (index, graph_state) in graph.keys().enumerate() {
            let evaluation = *outcomes
                .get(graph_state)
                .expect("every reachable state should have an outcome");
            let best_next_state_key =
                best_move_for(*graph_state, &outcomes).map(|best_move| best_move.next.key());
            self.cache(*graph_state, evaluation, best_next_state_key.as_deref())?;
            progress.tick("SQLite cache writes", index + 1, Some(graph.len()));
        }
        progress.force("SQLite cache writes", graph.len(), Some(graph.len()));

        let evaluation = *outcomes
            .get(&state)
            .expect("root state should have an outcome after solving");
        let best_move = best_move_for(state, &outcomes);
        progress.phase("done");

        Ok((evaluation, best_move))
    }

    fn move_for_cached_next(state: State, best_next_state_key: Option<String>) -> Option<Move> {
        best_next_state_key.and_then(|best_next_state_key| {
            state
                .legal_moves()
                .into_iter()
                .find(|candidate| candidate.next.key() == best_next_state_key)
        })
    }

    fn cached(&self, state: State) -> rusqlite::Result<Option<CachedEvaluation>> {
        self.db
            .query_row(
                "SELECT outcome, plies, best_next_state_key FROM state_evaluations WHERE state_key = ?1",
                params![state.key()],
                |row| {
                    let outcome: String = row.get(0)?;
                    let plies: u16 = row.get(1)?;
                    let best_next_state_key: Option<String> = row.get(2)?;
                    Ok(CachedEvaluation {
                        evaluation: Evaluation {
                            outcome: outcome_from_db(&outcome),
                            plies,
                        },
                        best_next_state_key,
                    })
                },
            )
            .optional()
    }

    fn cache(
        &self,
        state: State,
        evaluation: Evaluation,
        best_next_state_key: Option<&str>,
    ) -> rusqlite::Result<()> {
        self.db.execute(
            "
            INSERT INTO state_evaluations (state_key, outcome, plies, best_next_state_key)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(state_key) DO UPDATE SET
                outcome = excluded.outcome,
                plies = excluded.plies,
                best_next_state_key = excluded.best_next_state_key
            ",
            params![
                state.key(),
                evaluation.outcome.to_string(),
                evaluation.plies,
                best_next_state_key
            ],
        )?;
        Ok(())
    }
}

fn reachable_graph(root: State, progress: &mut ProgressReporter) -> HashMap<State, Vec<Move>> {
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
        progress.tick("state enumeration", seen.len(), Some(MAX_CANONICAL_STATES));
    }

    graph
}

fn solve_outcomes(
    graph: &HashMap<State, Vec<Move>>,
    progress: &mut ProgressReporter,
) -> HashMap<State, Evaluation> {
    let mut outcomes = HashMap::new();

    for state in graph.keys() {
        if let Some(outcome) = state.terminal() {
            outcomes.insert(*state, Evaluation::terminal(outcome));
        }
    }
    progress.force("outcome solving round 0", outcomes.len(), Some(graph.len()));

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

        progress.force(
            &format!("outcome solving round {round}"),
            outcomes.len(),
            Some(graph.len()),
        );
    }

    for state in graph.keys() {
        outcomes
            .entry(*state)
            .or_insert_with(|| Evaluation::terminal(Outcome::Draw));
    }
    progress.force("draw classification", outcomes.len(), Some(graph.len()));

    outcomes
}

fn best_move_for(state: State, outcomes: &HashMap<State, Evaluation>) -> Option<Move> {
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

fn outcome_from_db(value: &str) -> Outcome {
    match value {
        "win" => Outcome::Win,
        "draw" => Outcome::Draw,
        "loss" => Outcome::Loss,
        _ => panic!("invalid outcome in database: {value}"),
    }
}

fn percentage(done: usize, total: usize) -> f64 {
    if total == 0 {
        100.0
    } else {
        (done as f64 / total as f64) * 100.0
    }
}

fn eta_suffix(done: usize, total: usize, elapsed: Duration) -> String {
    if done == 0 || done >= total {
        return String::new();
    }

    let seconds_per_item = elapsed.as_secs_f64() / done as f64;
    let remaining = seconds_per_item * (total - done) as f64;
    format!(
        ", ETA {}",
        format_duration(Duration::from_secs_f64(remaining))
    )
}

fn format_duration(duration: Duration) -> String {
    let total_seconds = duration.as_secs();
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;

    if minutes == 0 {
        format!(
            "{seconds}.{tenths}s",
            tenths = duration.subsec_millis() / 100
        )
    } else {
        format!("{minutes}m {seconds:02}s")
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        print_help();
        return Ok(());
    }
    let quiet = args.iter().any(|arg| arg == "--quiet");

    let db_path = args
        .iter()
        .position(|arg| arg == "--db")
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
        .unwrap_or("chopsticks.sqlite");

    let state = args
        .iter()
        .position(|arg| arg == "--state")
        .and_then(|index| args.get(index + 1))
        .map(|value| State::from_key(value))
        .transpose()?
        .unwrap_or_else(State::initial);

    let mut solver = Solver::open(db_path)?;
    let mut progress = ProgressReporter::new(!quiet);
    let (evaluation, best_move) = solver.best_move_with_progress(state, &mut progress)?;

    println!("state: {}", state.key());
    println!(
        "result with perfect play: {} in {} ply",
        evaluation.outcome, evaluation.plies
    );

    if let Some(best_move) = best_move {
        println!("best move: {}", best_move.kind);
        println!("next state: {}", best_move.next.key());
    } else {
        println!("best move: none");
    }

    Ok(())
}

fn print_help() {
    println!(
        "chopsticks bot\n\n\
         Usage:\n  \
         chopsticks [--db chopsticks.sqlite] [--state TURN:AB:CD] [--quiet]\n\n\
         State format:\n  \
         TURN is 0 or 1. AB is player 0's sorted hands. CD is player 1's sorted hands.\n  \
         Example: 0:11:11 is the starting position.\n\n\
         Rules:\n  \
         Hits use remainders modulo 5. Splits redistribute a player's own hand total.\n  \
         {DRAW_REPETITIONS}-fold repetition is scored as a draw.\n\n\
         Progress:\n  \
         Solver progress and ETA are printed to stderr unless --quiet is set."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn terminal_player_to_move_with_no_hands_loses() {
        let state = State::new(1, [[1, 1], [0, 0]]);

        assert_eq!(state.terminal(), Some(Outcome::Loss));
    }

    #[test]
    fn parser_accepts_compact_state_keys() {
        let state = State::from_key("1:04:23").unwrap();

        assert_eq!(state.turn, 1);
        assert_eq!(state.hands, [[0, 4], [2, 3]]);
    }

    #[test]
    fn solver_handles_initial_state() {
        let mut solver = Solver::open(":memory:").unwrap();
        let mut progress = ProgressReporter::new(false);
        let (evaluation, best_move) = solver
            .best_move_with_progress(State::initial(), &mut progress)
            .unwrap();

        assert!(matches!(
            evaluation.outcome,
            Outcome::Win | Outcome::Draw | Outcome::Loss
        ));
        assert!(best_move.is_some());
    }

    #[test]
    fn cyclic_positions_are_draws() {
        let mut solver = Solver::open(":memory:").unwrap();
        let state = State::new(0, [[1, 3], [1, 3]]);
        let mut progress = ProgressReporter::new(false);
        let (evaluation, best_move) = solver
            .best_move_with_progress(state, &mut progress)
            .unwrap();

        assert_eq!(evaluation.outcome, Outcome::Draw);
        assert!(best_move.is_some());
    }
}

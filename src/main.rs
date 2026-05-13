use chopsticks::{
    Evaluation, MODULUS, Move, MoveKind as CoreMoveKind, Outcome, SolveProgress, State,
    best_move_for, reachable_graph_with_progress, solve_outcomes_with_progress,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::env;
use std::fmt;
use std::io::{self, Write};
use std::path::Path;
use std::time::{Duration, Instant};

const DRAW_REPETITIONS: u8 = 3;
const MAX_CANONICAL_STATES: usize = 450;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

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

impl MoveKind {
    fn from_core(state: State, best_move: &Move) -> Self {
        match &best_move.kind {
            CoreMoveKind::Hit { attacker, target } => {
                let amount = state.hands[state.turn][*attacker];
                let before = state.hands[state.opponent()][*target];
                let after = (before + amount) % MODULUS;

                Self::Hit {
                    attacker: *attacker,
                    target: *target,
                    amount,
                    before,
                    after,
                }
            }
            CoreMoveKind::Split { before, after } => Self::Split {
                before: *before,
                after: *after,
            },
        }
    }
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
        let graph = reachable_graph_with_progress(state, |seen| {
            progress.tick("state enumeration", seen, Some(MAX_CANONICAL_STATES));
        });
        progress.force("state enumeration", graph.len(), Some(MAX_CANONICAL_STATES));

        progress.phase(format!("solving {} reachable states", graph.len()));
        let outcomes = solve_outcomes_with_progress(&graph, |event| match event {
            SolveProgress::Round { round, solved } => progress.force(
                &format!("outcome solving round {round}"),
                solved,
                Some(graph.len()),
            ),
            SolveProgress::DrawClassification { solved } => {
                progress.force("draw classification", solved, Some(graph.len()));
            }
        });

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
        println!("best move: {}", MoveKind::from_core(state, &best_move));
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

use anchor_lang::prelude::*;

#[error_code]
pub enum CustomError {
    #[msg("The game is currently inactive.")]
    GameNotActive,
    #[msg("Guess must be 0 (Heads) or 1 (Tails).")]
    InvalidGuess,
    #[msg("Server seed hash does not match the commitment. The House tried to cheat!")]
    SeedMismatch,
    #[msg("Mine count must be between 1 and 24.")]
    InvalidMineCount,
    #[msg("Bet amount must be greater than 0.")]
    InvalidBetAmount,
    #[msg("Game has already been resolved or closed.")]
    GameAlreadyResolved,
    #[msg("Math logic overflowed during calculation.")]
    MathOverflow,
    #[msg("Resolution state must be either a cashout or a bust.")]
    InvalidResolutionState,
}
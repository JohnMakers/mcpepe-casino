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
    #[msg("The total wager does not match the sum of the individual bets.")]
    WagerMismatch,
    #[msg("The vault does not have enough funds to pay out the winnings.")]
    InsufficientVaultFunds,
    #[msg("Invalid difficulty level. Must be 0 (Easy), 1 (Medium), or 2 (Hard).")]
    InvalidDifficulty,
    #[msg("Maximum steps (24) reached. Cash out now!")]
    MaxStepsReached,
    #[msg("No profits to withdraw. You must pump at least once.")]
    NoProfitsToWithdraw,
}
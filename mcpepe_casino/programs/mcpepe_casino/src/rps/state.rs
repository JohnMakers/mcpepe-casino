use anchor_lang::prelude::*;

#[account]
pub struct RpsHouseConfig {
    pub treasury_pubkey: Pubkey,
    pub max_payout: u64,
    pub bump: u8,
}

#[account]
pub struct RpsGameState {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub current_streak: u8,
    pub is_active: bool,
    pub player_move: u8, // 1: Rock, 2: Paper, 3: Scissors
    pub bump: u8,
    /// 🔒 C-8: SHA256(house_move || secret_salt) committed by the House before
    /// the player's move is locked in. resolve_hand must reveal a preimage that
    /// hashes to this exact value — closes the "trusted commitment arg" hole.
    pub pending_commitment: [u8; 32],
    /// True once the house has committed for the current round.
    pub commitment_set: bool,
}

impl RpsGameState {
    // discriminator + Pubkey + u64 + u8*4 + [u8;32] + bool
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 1 + 1 + 32 + 1;
}
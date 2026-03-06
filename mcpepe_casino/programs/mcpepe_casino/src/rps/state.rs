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
}

impl RpsGameState {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 1 + 1;
}
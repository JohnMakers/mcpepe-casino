use anchor_lang::prelude::*;

#[account]
pub struct VacationState {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub nonce: u64,
    pub is_bonus_buy: bool,
    pub bump: u8,
}

impl VacationState {
    // 8 + 32 + 8 + 32 + 36 + 8 + 1 (bool) + 1 (bump)
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 36 + 8 + 1 + 1;
}
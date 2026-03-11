use anchor_lang::prelude::*;

#[account]
pub struct PumpGameState {
    pub player: Pubkey,
    pub authority: Pubkey,
    pub bet_amount: u64,
    pub difficulty: u8, // 0 = Easy, 1 = Medium, 2 = Hard
    pub current_step: u8,
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub nonce: u64,
    pub is_active: bool,
    pub cashed_out: bool,
}
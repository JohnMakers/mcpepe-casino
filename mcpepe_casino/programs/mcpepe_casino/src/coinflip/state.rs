use anchor_lang::prelude::*;

#[account]
pub struct GameState {
    pub authority: Pubkey,
    pub server_seed_hash: [u8; 32],
    pub is_active: bool,
    pub force: [u8; 32],
    pub player: Pubkey,
    pub guess: u8,
    pub bet_amount: u64,
    pub client_seed: String,
}
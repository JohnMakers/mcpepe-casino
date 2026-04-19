use anchor_lang::prelude::*;

#[account]
pub struct PatriotsState {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub nonce: u64,
    pub bump: u8,
}

impl PatriotsState {
    // 8 (discriminator) + 32 (pubkey) + 8 (u64) + 32 (hash) + 36 (string max) + 8 (u64) + 1 (bump)
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 36 + 8 + 1;
}
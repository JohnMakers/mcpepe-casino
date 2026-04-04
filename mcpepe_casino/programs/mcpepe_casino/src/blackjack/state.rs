use anchor_lang::prelude::*;

#[account]
pub struct BlackjackGame {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub active: bool,
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub nonce: u64,
}

impl BlackjackGame {
    // 8 (discriminator) + 32 (pubkey) + 8 (bet) + 1 (active) + 32 (hash) + 36 (String up to 32 chars) + 8 (nonce)
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 32 + 36 + 8;
}
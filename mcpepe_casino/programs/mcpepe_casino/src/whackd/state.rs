use anchor_lang::prelude::*;

#[account]
pub struct WhackdGame {
    pub player: Pubkey,
    pub authority: Pubkey,
    pub bet_amount: u64,
    pub mine_count: u8,
    pub revealed_mask: u32,
    pub bomb_mask: u32, 
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub state: u8, // 0 = InProgress, 1 = CashedOut, 2 = Bust
}
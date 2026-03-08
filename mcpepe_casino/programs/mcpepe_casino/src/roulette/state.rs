use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BetType {
    StraightUp, // 35:1
    Split,      // 17:1
    Street,     // 11:1
    Corner,     // 8:1
    Line,       // 5:1
    Basket,     // 6:1 (0, 1, 2, 3)
    Column,     // 2:1
    Dozen,      // 2:1
    RedBlack,   // 1:1
    OddEven,    // 1:1
    HighLow,    // 1:1
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RouletteBet {
    pub bet_type: BetType,
    pub data: [u8; 4], // Stores numbers or identifiers (e.g., [0,0,0,0] for Red, or [1,2,3,4] for Corner)
    pub amount: u64,
}

#[account]
pub struct RouletteGameState {
    pub authority: Pubkey,
    pub player: Pubkey,
    pub server_seed_hash: [u8; 32],
    pub client_seed: String,
    pub nonce: u64,
    pub is_active: bool,
    pub bets: Vec<RouletteBet>, 
    pub total_wager: u64,
}
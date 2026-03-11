use anchor_lang::prelude::*;

pub mod errors;
pub mod coinflip;
pub mod whackd; 
pub mod rps;
pub mod roulette;
pub mod pumpit;


use coinflip::*;
use whackd::*;  
use rps::*;
use roulette::*;
use pumpit::*;

declare_id!("7pKD7FV7Pebd8ZSYgzoTHE79aFnoPLGnudHH4fpvxgSw");

#[program]
pub mod mcpepe_casino {
    use super::*;

    // --- COINFLIP ROUTES ---
    pub fn initialize_game(ctx: Context<InitializeGame>, server_seed_hash: [u8; 32]) -> Result<()> {
        coinflip::initialize_game(ctx, server_seed_hash)
    }

    pub fn play_coinflip(ctx: Context<PlayCoinflip>, client_seed: String, guess: u8, bet_amount: u64) -> Result<()> {
        coinflip::play_coinflip(ctx, client_seed, guess, bet_amount)
    }

    pub fn resolve_coinflip(ctx: Context<ResolveCoinflip>, unhashed_server_seed: String) -> Result<()> {
        coinflip::resolve_coinflip(ctx, unhashed_server_seed)
    }

    pub fn withdraw_profits(ctx: Context<WithdrawProfits>, amount: u64) -> Result<()> {
        coinflip::withdraw_profits(ctx, amount)
    }

    // --- WHACKD ROUTES ---
    pub fn start_whackd(ctx: Context<StartWhackd>, bet_amount: u64, mine_count: u8, server_seed_hash: [u8; 32], client_seed: String) -> Result<()> {
        whackd::start_whackd(ctx, bet_amount, mine_count, server_seed_hash, client_seed)
    }

    pub fn resolve_whackd(ctx: Context<ResolveWhackd>, unhashed_server_seed: String, revealed_mask: u32, is_cashout: bool) -> Result<()> {
        whackd::resolve_whackd(ctx, unhashed_server_seed, revealed_mask, is_cashout)
    }

    pub fn cancel_abandoned_whackd(ctx: Context<CancelWhackd>) -> Result<()> {
        whackd::cancel_abandoned_whackd(ctx)
    }

    // --- ROCK PAPER SCISSORS ROUTES ---
    pub fn initialize_rps_game(ctx: Context<InitializeRpsGame>) -> Result<()> {
        rps::initialize_rps_game(ctx)
    }

    pub fn rps_play_hand(ctx: Context<PlayHand>, bet_amount: u64, player_move: u8) -> Result<()> {
        rps::play_hand(ctx, bet_amount, player_move)
    }

    pub fn rps_resolve_hand(ctx: Context<ResolveHand>, house_move: u8, secret_salt: [u8; 16], hashed_commitment: [u8; 32]) -> Result<()> {
        rps::resolve_hand(ctx, house_move, secret_salt, hashed_commitment)
    }

    pub fn rps_settle_streak(ctx: Context<SettleStreak>) -> Result<()> {
        rps::settle_streak(ctx)
    }

    // --- ROULETTE ROUTES ---
    pub fn start_roulette(
        ctx: Context<StartRoulette>, 
        server_seed_hash: [u8; 32], 
        client_seed: String, 
        nonce: u64, 
        bets: Vec<RouletteBet>, 
        total_wager: u64
    ) -> Result<()> {
        roulette::start_roulette(ctx, server_seed_hash, client_seed, nonce, bets, total_wager)
    }

    pub fn resolve_roulette(
        ctx: Context<ResolveRoulette>, 
        unhashed_server_seed: String
    ) -> Result<()> {
        roulette::resolve_roulette(ctx, unhashed_server_seed)
    }

    // --- PUMP IT ROUTES ---
    pub fn start_pump(
        ctx: Context<StartPump>,
        bet_amount: u64,
        difficulty: u8,
        server_seed_hash: [u8; 32],
        client_seed: String,
        nonce: u64,
    ) -> Result<()> {
        pumpit::start_pump(ctx, bet_amount, difficulty, server_seed_hash, client_seed, nonce)
    }

    pub fn process_pump(ctx: Context<ProcessPump>, unhashed_server_seed: String) -> Result<()> {
        pumpit::process_pump(ctx, unhashed_server_seed)
    }

    pub fn cash_out_pump(ctx: Context<CashOutPump>, final_multiplier_bps: u64) -> Result<()> {
        pumpit::cash_out(ctx, final_multiplier_bps)
    }
}
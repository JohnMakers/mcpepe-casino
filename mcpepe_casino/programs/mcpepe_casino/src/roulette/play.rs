use anchor_lang::prelude::*;
use crate::roulette::state::{RouletteGameState, RouletteBet, BetType};
use crate::errors::CustomError;

pub fn start_roulette(
    ctx: Context<StartRoulette>,
    server_seed_hash: [u8; 32],
    client_seed: String,
    nonce: u64,
    bets: Vec<RouletteBet>,
    total_wager: u64,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    
    let calculated_wager: u64 = bets.iter().map(|b| b.amount).sum();
    require!(calculated_wager == total_wager, CustomError::WagerMismatch); 
    
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, total_wager)?;

    game_state.authority = ctx.accounts.authority.key();
    game_state.player = ctx.accounts.player.key();
    game_state.server_seed_hash = server_seed_hash;
    game_state.client_seed = client_seed;
    game_state.nonce = nonce;
    game_state.bets = bets;
    game_state.total_wager = total_wager;
    game_state.is_active = true;

    Ok(())
}

pub fn resolve_roulette(ctx: Context<ResolveRoulette>, unhashed_server_seed: String) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, CustomError::GameNotActive);

    let revealed_hash = anchor_lang::solana_program::hash::hash(unhashed_server_seed.as_bytes());
    require!(
        game_state.server_seed_hash == revealed_hash.to_bytes(),
        CustomError::SeedMismatch
    );

    let mut combined_data = String::new();
    combined_data.push_str(&unhashed_server_seed);
    combined_data.push_str(&game_state.client_seed);
    combined_data.push_str(&game_state.nonce.to_string());
    
    let outcome_hash = anchor_lang::solana_program::hash::hash(combined_data.as_bytes());
    let hash_bytes = outcome_hash.to_bytes();
    let raw_number = u32::from_le_bytes([hash_bytes[0], hash_bytes[1], hash_bytes[2], hash_bytes[3]]);
    let winning_number = (raw_number % 37) as u8;

    let mut total_payout: u64 = 0;

    msg!("=== ROULETTE RESOLUTION ===");
    msg!("Winning Number: {}", winning_number);

    for bet in &game_state.bets {
        if is_winning_bet(bet, winning_number) {
            let multiplier = get_multiplier(&bet.bet_type);
            let win_amount = bet.amount.checked_mul(multiplier).unwrap();
            total_payout = total_payout.checked_add(win_amount).unwrap();
            msg!("Winner! Bet Type: {:?}, Data: {:?}, Payout: {}", bet.bet_type, bet.data, win_amount);
        }
    }

    msg!("Total Payout Calculated: {} lamports", total_payout);

    if total_payout > 0 {
        let vault_balance = ctx.accounts.vault.lamports();
        require!(vault_balance >= total_payout, CustomError::InsufficientVaultFunds);

        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(cpi_context, total_payout)?;
        msg!("Transfer Successful!");
    }

    game_state.is_active = false;
    Ok(())
}

// --- HELPER FUNCTIONS ---
fn is_winning_bet(bet: &RouletteBet, winning_number: u8) -> bool {
    match bet.bet_type {
        BetType::StraightUp => bet.data[0] == winning_number,
        BetType::Split => bet.data[0] == winning_number || bet.data[1] == winning_number,
        BetType::Street => bet.data[0] == winning_number || bet.data[1] == winning_number || bet.data[2] == winning_number,
        BetType::Corner => bet.data.contains(&winning_number),
        BetType::Line => winning_number >= bet.data[0] && winning_number <= bet.data[0] + 5 && winning_number != 0,
        BetType::Basket => winning_number <= 3, 
        BetType::Column => {
            if winning_number == 0 { false }
            else if bet.data[0] == 1 { winning_number % 3 == 1 } 
            else if bet.data[0] == 2 { winning_number % 3 == 2 } 
            else if bet.data[0] == 3 { winning_number % 3 == 0 } 
            else { false }
        },
        BetType::Dozen => {
            if winning_number == 0 { false }
            else if bet.data[0] == 1 { winning_number >= 1 && winning_number <= 12 }
            else if bet.data[0] == 2 { winning_number >= 13 && winning_number <= 24 }
            else if bet.data[0] == 3 { winning_number >= 25 && winning_number <= 36 }
            else { false }
        },
        BetType::RedBlack => {
            if winning_number == 0 { return false; }
            let is_red = matches!(winning_number, 1|3|5|7|9|12|14|16|18|19|21|23|25|27|30|32|34|36);
            if bet.data[0] == 0 { is_red } else { !is_red } 
        },
        BetType::OddEven => {
            if winning_number == 0 { return false; }
            if bet.data[0] == 0 { winning_number % 2 != 0 } else { winning_number % 2 == 0 } 
        },
        BetType::HighLow => {
            if winning_number == 0 { return false; }
            if bet.data[0] == 0 { winning_number >= 1 && winning_number <= 18 } 
            else { winning_number >= 19 && winning_number <= 36 } 
        },
    }
}

fn get_multiplier(bet_type: &BetType) -> u64 {
    match bet_type {
        BetType::StraightUp => 36, 
        BetType::Split => 18,
        BetType::Street => 12,
        BetType::Corner => 9,
        BetType::Line => 6,
        BetType::Basket => 7,
        BetType::Column => 3,
        BetType::Dozen => 3,
        BetType::RedBlack | BetType::OddEven | BetType::HighLow => 2,
    }
}

// --- ACCOUNTS ---
#[derive(Accounts)]
#[instruction(server_seed_hash: [u8; 32], client_seed: String, nonce: u64, bets: Vec<RouletteBet>)]
pub struct StartRoulette<'info> {
    #[account(init, payer = player, space = 1024)] 
    pub game_state: Box<Account<'info, RouletteGameState>>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: Master Authority
    pub authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveRoulette<'info> {
    #[account(mut, has_one = authority, has_one = player, close = player)]
    pub game_state: Box<Account<'info, RouletteGameState>>,
    #[account(mut)]
    pub player: SystemAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
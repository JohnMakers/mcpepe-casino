use anchor_lang::prelude::*;
use crate::pumpit::state::PumpGameState;
use crate::errors::CustomError;
use anchor_lang::solana_program::hash::hash;

pub fn start_pump(
    ctx: Context<StartPump>,
    bet_amount: u64,
    difficulty: u8,
    server_seed_hash: [u8; 32],
    client_seed: String,
    nonce: u64,
) -> Result<()> {
    require!(difficulty <= 2, CustomError::InvalidDifficulty);

    let game_state = &mut ctx.accounts.game_state;
    
    // Transfer bet from player to vault
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

    game_state.player = ctx.accounts.player.key();
    game_state.authority = ctx.accounts.authority.key();
    game_state.bet_amount = bet_amount;
    game_state.difficulty = difficulty;
    game_state.current_step = 0;
    game_state.server_seed_hash = server_seed_hash;
    game_state.client_seed = client_seed;
    game_state.nonce = nonce;
    game_state.is_active = true;
    game_state.cashed_out = false;

    Ok(())
}

pub fn process_pump(ctx: Context<ProcessPump>, unhashed_server_seed: String) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, CustomError::GameNotActive);
    require!(game_state.current_step < 24, CustomError::MaxStepsReached);

    let revealed_hash = hash(unhashed_server_seed.as_bytes());
    require!(
        game_state.server_seed_hash == revealed_hash.to_bytes(),
        CustomError::SeedMismatch
    );

    let mut combined_data = String::new();
    combined_data.push_str(&unhashed_server_seed);
    combined_data.push_str(&game_state.client_seed);
    combined_data.push_str(&game_state.nonce.to_string());
    combined_data.push_str(&game_state.current_step.to_string());
    
    let outcome_hash = hash(combined_data.as_bytes());
    let hash_bytes = outcome_hash.to_bytes();

    let mut roll_bytes = [0u8; 4];
    roll_bytes.copy_from_slice(&hash_bytes[0..4]);
    let numeric_value = u32::from_be_bytes(roll_bytes);
    let roll = numeric_value % 10000;

    // NEW LOGIC: Extract Base Chance and Decay Rate (Base, Decay)
let (base_chance, decay_rate): (u32, u32) = match game_state.difficulty {
        0 => (9600, 100), // Easy: 96% start, -1% per step
        1 => (8800, 200), // Medium: 88% start, -2% per step
        2 => (6500, 200), // Hard: 65% start, -2% per step
        _ => return err!(CustomError::InvalidDifficulty),
    };

    // Calculate dynamic threshold: Base - (Decay * Current_Step)
    let step_penalty = decay_rate.checked_mul(game_state.current_step as u32).unwrap();
    let probability_threshold = base_chance.checked_sub(step_penalty).unwrap();

    // Win Condition Evaluation
    if roll < probability_threshold {
        game_state.current_step += 1;
    } else {
        game_state.is_active = false;
        game_state.cashed_out = false; 
    }

    Ok(())
}

pub fn cash_out(ctx: Context<CashOutPump>, final_multiplier_bps: u64) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, CustomError::GameNotActive);
    require!(game_state.current_step > 0, CustomError::NoProfitsToWithdraw);

    // final_multiplier_bps is the float multiplier * 10000 passed from the backend/client
    // e.g. 1.0309x -> 10309
    let payout = (game_state.bet_amount as u128)
        .checked_mul(final_multiplier_bps as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap() as u64;

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
    anchor_lang::system_program::transfer(cpi_context, payout)?;

    game_state.is_active = false;
    game_state.cashed_out = true;

    Ok(())
}

#[derive(Accounts)]
pub struct StartPump<'info> {
    #[account(init, payer = player, space = 8 + std::mem::size_of::<PumpGameState>() + 64)]
    pub game_state: Account<'info, PumpGameState>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: Safe via backend signing
    pub authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPump<'info> {
    #[account(mut, has_one = authority)]
    pub game_state: Account<'info, PumpGameState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CashOutPump<'info> {
    #[account(mut, has_one = player, has_one = authority, close = authority)]
    pub game_state: Account<'info, PumpGameState>,
    #[account(mut)]
    pub player: SystemAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
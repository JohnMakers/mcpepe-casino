use anchor_lang::prelude::*;
use crate::coinflip::state::GameState;
use crate::errors::CustomError;

pub fn initialize_game(ctx: Context<InitializeGame>, server_seed_hash: [u8; 32]) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    game_state.authority = ctx.accounts.authority.key();
    game_state.server_seed_hash = server_seed_hash;
    game_state.is_active = true;
    Ok(())
}

pub fn play_coinflip(
    ctx: Context<PlayCoinflip>, 
    client_seed: String, 
    guess: u8, 
    bet_amount: u64
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, CustomError::GameNotActive);
    require!(guess == 0 || guess == 1, CustomError::InvalidGuess);

    // CPI: Transfer wager from Player directly to the autonomous House Vault (PDA)
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

    game_state.is_active = false;
    game_state.player = ctx.accounts.player.key();
    game_state.guess = guess;
    game_state.bet_amount = bet_amount;
    game_state.client_seed = client_seed;
    
    Ok(())
}

pub fn withdraw_profits(ctx: Context<WithdrawProfits>, amount: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let authority = &ctx.accounts.authority;

    // Extract SOL directly from the PDA by modifying lamport balances
    **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **authority.to_account_info().try_borrow_mut_lamports()? += amount;

    Ok(())
}    

pub fn resolve_coinflip(ctx: Context<ResolveCoinflip>, unhashed_server_seed: String) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;

    // 1. Hash the revealed seed exactly the same way the frontend did
    let revealed_hash = anchor_lang::solana_program::hash::hash(unhashed_server_seed.as_bytes());

    // 2. Cryptographic Check
    require!(
        game_state.server_seed_hash == revealed_hash.to_bytes(),
        CustomError::SeedMismatch
    );

    // 3. Combine Server Seed and Client Seed
    let mut combined_data = String::new();
    combined_data.push_str(&unhashed_server_seed);
    combined_data.push_str(&game_state.client_seed);
    
    let outcome_hash = anchor_lang::solana_program::hash::hash(combined_data.as_bytes());
    let winning_result = outcome_hash.to_bytes()[0] % 2; 

    // 4. Execute Payout Logic
    if winning_result == game_state.guess {
        let payout = game_state.bet_amount.checked_mul(2).unwrap();
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += payout;
    }

    game_state.is_active = false;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(init, payer = authority, space = 250)]
    pub game_state: Account<'info, GameState>,
    #[account(mut)]
    pub authority: Signer<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlayCoinflip<'info> {
    #[account(mut, has_one = authority)]
    pub game_state: Account<'info, GameState>,
    #[account(mut)]
    pub player: Signer<'info>, 
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: Safe via constraint
    pub authority: UncheckedAccount<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveCoinflip<'info> {
    #[account(mut, has_one = authority, has_one = player, close = vault)]
    pub game_state: Account<'info, GameState>,
    #[account(mut)]
    pub player: SystemAccount<'info>, 
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub authority: Signer<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawProfits<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>, 
}
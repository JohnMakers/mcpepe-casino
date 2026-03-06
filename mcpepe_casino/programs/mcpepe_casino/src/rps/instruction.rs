use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::rps::state::*;
use solana_program::hash::hash;

const MULTIPLIERS: [u64; 6] = [19, 36, 68, 130, 245, 465];

#[derive(Accounts)]
pub struct InitializeRpsGame<'info> {
    #[account(
        init,
        payer = player,
        space = RpsGameState::SPACE,
        seeds = [b"rps_game", player.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, RpsGameState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlayHand<'info> {
    #[account(mut, has_one = player)]
    pub game_state: Account<'info, RpsGameState>,
    #[account(
        mut,
        seeds = [b"rps_vault"],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveHand<'info> {
    #[account(mut)]
    pub game_state: Account<'info, RpsGameState>,
    // 🔥 THE FIX: Removed the hardcoded string that was panicking the contract!
    #[account(mut)]
    pub house_authority: Signer<'info>, 
}

#[derive(Accounts)]
pub struct SettleStreak<'info> {
    #[account(mut, has_one = player)]
    pub game_state: Account<'info, RpsGameState>,
    #[account(
        mut,
        seeds = [b"rps_vault"],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_rps_game(ctx: Context<InitializeRpsGame>) -> Result<()> { 
    let game_state = &mut ctx.accounts.game_state;
    game_state.player = ctx.accounts.player.key();
    game_state.current_streak = 0;
    game_state.is_active = false;
    game_state.bump = ctx.bumps.game_state;
    Ok(())
}

pub fn play_hand(ctx: Context<PlayHand>, bet_amount: u64, player_move: u8) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    
    require!(player_move >= 1 && player_move <= 3, GameError::InvalidMove);
    require!(!game_state.is_active, GameError::GameAlreadyActive);
    
    if game_state.current_streak == 0 {
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, bet_amount)?;
        game_state.bet_amount = bet_amount;
    }

    game_state.player_move = player_move;
    game_state.is_active = true; 
    
    Ok(())
}

pub fn resolve_hand(ctx: Context<ResolveHand>, house_move: u8, secret_salt: [u8; 16], hashed_commitment: [u8; 32]) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, GameError::GameNotActive);
    
    let mut preimage = Vec::new();
    preimage.push(house_move);
    preimage.extend_from_slice(&secret_salt);
    let verify_hash = hash(&preimage);
    require!(verify_hash.to_bytes() == hashed_commitment, GameError::InvalidHash);

    let p_move = game_state.player_move;
    let h_move = house_move;

    let is_win = (p_move == 1 && h_move == 3) || 
                 (p_move == 2 && h_move == 1) || 
                 (p_move == 3 && h_move == 2);
    
    let is_tie = p_move == h_move;

    if is_win {
        game_state.current_streak += 1;
        game_state.is_active = false; 
    } else if is_tie {
        game_state.is_active = false;
    } else {
        game_state.current_streak = 0;
        game_state.is_active = false;
        game_state.bet_amount = 0;
    }

    Ok(())
}

pub fn settle_streak(ctx: Context<SettleStreak>) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(!game_state.is_active, GameError::GameIsActive);
    require!(game_state.current_streak > 0, GameError::NoWinnings);

    let streak_idx = (game_state.current_streak - 1) as usize;
    let multiplier = MULTIPLIERS[streak_idx];
    
    let payout = (game_state.bet_amount * multiplier) / 10;

    let vault_bump = ctx.bumps.vault;
    let seeds = &[b"rps_vault".as_ref(), &[vault_bump]];
    let signer = &[&seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.player.to_account_info(),
        },
        signer,
    );
    transfer(cpi_context, payout)?;

    game_state.current_streak = 0;
    game_state.bet_amount = 0;

    Ok(())
}

#[error_code]
pub enum GameError {
    #[msg("Invalid move selected.")]
    InvalidMove,
    #[msg("Game is already active. Awaiting house resolution.")]
    GameAlreadyActive,
    #[msg("Game is not active.")]
    GameNotActive,
    #[msg("House commitment hash mismatch.")]
    InvalidHash,
    #[msg("No winnings to claim.")]
    NoWinnings,
    #[msg("Cannot settle while round is active.")]
    GameIsActive,
    #[msg("Invalid House Authority signer.")]
    InvalidAuthority,
}
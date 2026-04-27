use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::rps::state::*;
use crate::constants::HOUSE_AUTHORITY;
use crate::errors::CustomError;
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
    // 🔒 C-8 FIX: only the canonical House key may resolve a hand.
    #[account(mut, address = HOUSE_AUTHORITY @ CustomError::UnauthorizedHouse)]
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

pub fn play_hand(
    ctx: Context<PlayHand>,
    bet_amount: u64,
    player_move: u8,
    hashed_commitment: [u8; 32],
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;

    require!(player_move >= 1 && player_move <= 3, GameError::InvalidMove);
    require!(!game_state.is_active, GameError::GameAlreadyActive);

    // 🔒 C-8 FIX (revised): the player records the House's pre-generated
    // commitment as part of the same transaction that locks their move. The
    // commitment was produced by the backend BEFORE the player's move was
    // known (via /api/rps/commitment), so the House cannot retroactively
    // choose a winning house_move at resolve time. resolve_hand verifies the
    // revealed (move, salt) preimage against this stored commitment.
    game_state.pending_commitment = hashed_commitment;
    game_state.commitment_set = true;

    // 🔥 Prevent double charging. Only take SOL if there is no locked bet.
    if game_state.bet_amount == 0 {
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

pub fn resolve_hand(ctx: Context<ResolveHand>, house_move: u8, secret_salt: [u8; 16]) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    require!(game_state.is_active, GameError::GameNotActive);
    require!(game_state.commitment_set, GameError::CommitmentMissing);
    require!(house_move >= 1 && house_move <= 3, GameError::InvalidMove);

    // 🔒 C-8 FIX: verify reveal against the *stored* commitment that was
    // written by `commit_hand` BEFORE the player locked their move. The
    // hashed_commitment can no longer be supplied as an argument.
    let mut preimage = Vec::with_capacity(1 + 16);
    preimage.push(house_move);
    preimage.extend_from_slice(&secret_salt);
    let verify_hash = hash(&preimage);
    require!(
        verify_hash.to_bytes() == game_state.pending_commitment,
        GameError::InvalidHash
    );

    // Consume the commitment — house must commit again for the next hand.
    game_state.commitment_set = false;
    game_state.pending_commitment = [0u8; 32];

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
    #[msg("House has not committed for the current round.")]
    CommitmentMissing,
}
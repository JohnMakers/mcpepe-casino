use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::snowstorm::state::SnowstormState;
use crate::constants::HOUSE_AUTHORITY;
use crate::errors::CustomError;

#[error_code]
pub enum SnowstormError {
    #[msg("Server seed hash does not match the provided unhashed seed.")]
    InvalidServerSeed,
    #[msg("Vault does not have enough funds to cover the payout.")]
    InsufficientVaultFunds,
}

#[derive(Accounts)]
#[instruction(bet_amount: u64, server_seed_hash: [u8; 32], client_seed: String, nonce: u64)]
pub struct StartSnowstorm<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        init,
        payer = player,
        space = SnowstormState::SPACE,
        seeds = [b"snowstorm", player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub game_state: Account<'info, SnowstormState>,
    /// CHECK: Safe, just receiving funds
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn start_snowstorm(
    ctx: Context<StartSnowstorm>,
    bet_amount: u64,
    server_seed_hash: [u8; 32],
    client_seed: String,
    nonce: u64,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    game_state.player = ctx.accounts.player.key();
    game_state.bet_amount = bet_amount;
    game_state.server_seed_hash = server_seed_hash;
    game_state.client_seed = client_seed;
    game_state.nonce = nonce;
    game_state.bump = ctx.bumps.game_state;

    // Escrow the bet to the house vault
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    system_program::transfer(cpi_context, bet_amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ResolveSnowstorm<'info> {
    #[account(
        mut,
        seeds = [b"snowstorm", game_state.player.as_ref(), &game_state.nonce.to_le_bytes()],
        bump = game_state.bump,
        close = house // Close PDA and refund rent to the house
    )]
    pub game_state: Account<'info, SnowstormState>,
    // 🔒 CR-3 FIX: only the canonical House key may resolve a snowstorm spin
    // and receive the rent refund via `close = house`.
    #[account(mut, address = HOUSE_AUTHORITY @ CustomError::UnauthorizedHouse)]
    pub house: Signer<'info>,
    /// CHECK: Safe
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    /// CHECK: The player receiving the payout
    #[account(mut, address = game_state.player)]
    pub player: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// 🔒 RECOVERY: lets a player reclaim a stuck Snowstorm round when the House
/// fails to resolve. Refunds the escrowed bet and closes the PDA back to the
/// player. Safe because Snowstorm is an atomic spin — the player has zero
/// outcome information when calling this.
#[derive(Accounts)]
pub struct CancelStuckSnowstorm<'info> {
    #[account(
        mut,
        close = player,
        seeds = [b"snowstorm", game_state.player.as_ref(), &game_state.nonce.to_le_bytes()],
        bump = game_state.bump,
        has_one = player,
    )]
    pub game_state: Account<'info, SnowstormState>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: vault PDA, source of the refund
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn cancel_stuck_snowstorm(ctx: Context<CancelStuckSnowstorm>) -> Result<()> {
    let refund = ctx.accounts.game_state.bet_amount;
    if refund > 0 {
        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        require!(
            ctx.accounts.vault.lamports() >= refund,
            SnowstormError::InsufficientVaultFunds
        );

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            signer,
        );
        system_program::transfer(cpi_context, refund)?;
    }
    Ok(())
}

pub fn resolve_snowstorm(
    ctx: Context<ResolveSnowstorm>,
    unhashed_server_seed: String,
    payout: u64,
) -> Result<()> {
    let game_state = &ctx.accounts.game_state;

    // 1. Provably Fair Verification (Security Constraint)
    let seed_bytes = unhashed_server_seed.as_bytes();
    let hash = anchor_lang::solana_program::hash::hash(seed_bytes);
    require!(
        hash.to_bytes() == game_state.server_seed_hash,
        SnowstormError::InvalidServerSeed
    );

    // 🔒 CR-3 FIX: enforce documented 800x max-win cap on chain. Even if the
    // house key is compromised, payouts above the cap are rejected.
    const MAX_WIN_MULTIPLIER: u128 = 800;
    let max_payout = (game_state.bet_amount as u128)
        .checked_mul(MAX_WIN_MULTIPLIER)
        .ok_or(CustomError::MathOverflow)?;
    require!((payout as u128) <= max_payout, CustomError::PayoutTooLarge);

    // 2. Transfer Winnings if > 0
    if payout > 0 {
        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        require!(ctx.accounts.vault.lamports() >= payout, SnowstormError::InsufficientVaultFunds);

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            signer,
        );
        system_program::transfer(cpi_context, payout)?;
    }

    Ok(())
}
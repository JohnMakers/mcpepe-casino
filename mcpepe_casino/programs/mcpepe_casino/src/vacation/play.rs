use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::vacation::state::VacationState;
use crate::constants::HOUSE_AUTHORITY;
use crate::errors::CustomError;

#[error_code]
pub enum VacationError {
    #[msg("Server seed hash does not match the provided unhashed seed.")]
    InvalidServerSeed,
    #[msg("Vault does not have enough funds to cover the payout.")]
    InsufficientVaultFunds,
}

#[derive(Accounts)]
#[instruction(bet_amount: u64, server_seed_hash: [u8; 32], client_seed: String, nonce: u64, is_bonus_buy: bool)]
pub struct StartVacation<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        init,
        payer = player,
        space = VacationState::SPACE,
        seeds = [b"vacation", player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub game_state: Account<'info, VacationState>,
    /// CHECK: Safe, just receiving funds
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn start_vacation(
    ctx: Context<StartVacation>,
    bet_amount: u64,
    server_seed_hash: [u8; 32],
    client_seed: String,
    nonce: u64,
    is_bonus_buy: bool,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    game_state.player = ctx.accounts.player.key();
    game_state.bet_amount = bet_amount;
    game_state.server_seed_hash = server_seed_hash;
    game_state.client_seed = client_seed;
    game_state.nonce = nonce;
    game_state.is_bonus_buy = is_bonus_buy;
    game_state.bump = ctx.bumps.game_state;

    // If Bonus Buy, exact total cost (100x) is calculated and passed from frontend
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
pub struct ResolveVacation<'info> {
    #[account(
        mut,
        close = house,
        seeds = [b"vacation", player.key().as_ref(), &game_state.nonce.to_le_bytes()],
        bump = game_state.bump
    )]
    pub game_state: Account<'info, VacationState>,
    // 🔒 CR-4 FIX: only the canonical House key may resolve a vacation spin
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

/// 🔒 RECOVERY: lets a player reclaim a stuck Vacation round when the House
/// fails to resolve. Refunds the escrowed bet and closes the PDA back to the
/// player. Safe because Vacation is an atomic spin — the player has zero
/// outcome information when calling this.
#[derive(Accounts)]
pub struct CancelStuckVacation<'info> {
    #[account(
        mut,
        close = player,
        seeds = [b"vacation", player.key().as_ref(), &game_state.nonce.to_le_bytes()],
        bump = game_state.bump,
        has_one = player,
    )]
    pub game_state: Account<'info, VacationState>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: vault PDA, source of the refund
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn cancel_stuck_vacation(ctx: Context<CancelStuckVacation>) -> Result<()> {
    let refund = ctx.accounts.game_state.bet_amount;
    if refund > 0 {
        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        require!(
            ctx.accounts.vault.lamports() >= refund,
            VacationError::InsufficientVaultFunds
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

pub fn resolve_vacation(
    ctx: Context<ResolveVacation>,
    unhashed_server_seed: String,
    payout: u64,
) -> Result<()> {
    let game_state = &ctx.accounts.game_state;

    // 1. Provably Fair Verification
    let seed_bytes = unhashed_server_seed.as_bytes();
    let hash = anchor_lang::solana_program::hash::hash(seed_bytes);
    require!(
        hash.to_bytes() == game_state.server_seed_hash,
        VacationError::InvalidServerSeed
    );

    // 🔒 CR-4 FIX: enforce documented 5,000x max-win cap on chain. The cap is
    // expressed against the BASE bet, which depends on whether this round was
    // a Bonus Buy (escrowed bet = 100 × base) or a normal spin.
    // CR-7 FIX: derive base_bet from the on-chain `is_bonus_buy` flag (recorded
    // at start_vacation) instead of trusting any off-chain assertion.
    const MAX_WIN_MULTIPLIER: u128 = 5_000;
    let base_bet: u128 = if game_state.is_bonus_buy {
        (game_state.bet_amount as u128) / 100
    } else {
        game_state.bet_amount as u128
    };
    let max_payout = base_bet
        .checked_mul(MAX_WIN_MULTIPLIER)
        .ok_or(CustomError::MathOverflow)?;
    require!((payout as u128) <= max_payout, CustomError::PayoutTooLarge);

    // 2. Transfer Winnings if > 0
    if payout > 0 {
        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        require!(ctx.accounts.vault.lamports() >= payout, VacationError::InsufficientVaultFunds);

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
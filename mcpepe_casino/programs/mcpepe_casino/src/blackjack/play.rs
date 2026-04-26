use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::blackjack::state::BlackjackGame;
use crate::constants::HOUSE_AUTHORITY;
use crate::errors::CustomError;

#[derive(Accounts)]
#[instruction(bet_amount: u64, server_seed_hash: [u8; 32], client_seed: String, nonce: u64)]
pub struct StartBlackjack<'info> {
    #[account(
        init,
        payer = player,
        space = BlackjackGame::SPACE,
        seeds = [b"blackjack", player.key().as_ref()],
        bump
    )]
    pub game: Account<'info, BlackjackGame>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Vault PDA
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IncreaseBlackjackBet<'info> {
    #[account(
        mut,
        seeds = [b"blackjack", player.key().as_ref()],
        bump,
        has_one = player,
        constraint = game.active == true
    )]
    pub game: Account<'info, BlackjackGame>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Vault PDA
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveBlackjack<'info> {
    #[account(
        mut,
        seeds = [b"blackjack", player.key().as_ref()],
        bump,
        has_one = player,
        close = player // Closes the state account and refunds rent to the player
    )]
    pub game: Account<'info, BlackjackGame>,
    // 🔒 C-6 FIX: only the canonical House key may resolve a blackjack hand.
    #[account(mut, address = HOUSE_AUTHORITY @ CustomError::UnauthorizedHouse)]
    pub house: Signer<'info>,
    /// CHECK: Vault PDA
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: Player receiving payout
    #[account(mut)]
    pub player: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelBlackjack<'info> {
    #[account(
        mut,
        seeds = [b"blackjack", player.key().as_ref()],
        bump,
        has_one = player,
        close = player // Closes the account and refunds rent
    )]
    pub game: Account<'info, BlackjackGame>,
    #[account(mut)]
    pub player: Signer<'info>,
}

pub fn start_blackjack(
    ctx: Context<StartBlackjack>,
    bet_amount: u64,
    server_seed_hash: [u8; 32],
    client_seed: String,
    nonce: u64,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.player = ctx.accounts.player.key();
    game.bet_amount = bet_amount;
    game.active = true;
    game.server_seed_hash = server_seed_hash;
    game.client_seed = client_seed;
    game.nonce = nonce;

    // Escrow initial bet to the House Vault
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    transfer(cpi_context, bet_amount)?;

    Ok(())
}

// Allows Doubles/Splits/Insurance
pub fn increase_blackjack_bet(
    ctx: Context<IncreaseBlackjackBet>,
    additional_amount: u64,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.bet_amount = game.bet_amount.checked_add(additional_amount).unwrap();

    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    transfer(cpi_context, additional_amount)?;

    Ok(())
}

pub fn resolve_blackjack(
    ctx: Context<ResolveBlackjack>,
    unhashed_server_seed: String,
    payout: u64,
) -> Result<()> {
    let game = &ctx.accounts.game;

    // Verify Provably Fair Seed exactly matches what was committed
    let hash = anchor_lang::solana_program::hash::hash(unhashed_server_seed.as_bytes());
    require!(hash.to_bytes() == game.server_seed_hash, CustomError::SeedMismatch);

    // 🔒 C-6 FIX: hard upper bound on the payout the (already-trusted) house can
    // request. The biggest legitimate blackjack outcome is split + double-down +
    // insurance, which caps at ~5x the original bet. This prevents a compromised
    // house key from issuing arbitrary transfers from the shared vault.
    let max_payout = (game.bet_amount as u128)
        .checked_mul(5)
        .ok_or(CustomError::MathOverflow)?;
    require!((payout as u128) <= max_payout, CustomError::PayoutTooLarge);

    if payout > 0 {
        let bump = ctx.bumps.vault;
        let seeds = &[b"vault".as_ref(), &[bump]];
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
    }
    
    Ok(())
}

pub fn cancel_blackjack(_ctx: Context<CancelBlackjack>) -> Result<()> {
    // Emergency route to close a corrupted PDA and refund the player
    Ok(())
}
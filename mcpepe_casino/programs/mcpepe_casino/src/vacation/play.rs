use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::vacation::state::VacationState;

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
    #[account(mut)]
    pub house: Signer<'info>,
    /// CHECK: Safe
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,
    /// CHECK: The player receiving the payout
    #[account(mut, address = game_state.player)]
    pub player: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
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
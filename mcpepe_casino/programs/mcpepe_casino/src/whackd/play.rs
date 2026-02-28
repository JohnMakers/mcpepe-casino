use anchor_lang::prelude::*;
use crate::whackd::state::WhackdGame;
use crate::errors::CustomError;

pub fn start_whackd(
    ctx: Context<StartWhackd>,
    bet_amount: u64,
    mine_count: u8,
    server_seed_hash: [u8; 32],
    client_seed: String,
) -> Result<()> {
    require!(mine_count >= 1 && mine_count <= 24, CustomError::InvalidMineCount);
    require!(bet_amount > 0, CustomError::InvalidBetAmount);

    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

    let game = &mut ctx.accounts.whackd_game;
    game.player = ctx.accounts.player.key();
    game.authority = ctx.accounts.authority.key();
    game.bet_amount = bet_amount;
    game.mine_count = mine_count;
    game.server_seed_hash = server_seed_hash;
    game.client_seed = client_seed;
    game.state = 0; 
    
    Ok(())
}

pub fn resolve_whackd(
    ctx: Context<ResolveWhackd>,
    unhashed_server_seed: String,
    revealed_mask: u32,
    is_cashout: bool,
) -> Result<()> {
    let game = &mut ctx.accounts.whackd_game;
    require!(game.state == 0, CustomError::GameAlreadyResolved);

    let revealed_hash = anchor_lang::solana_program::hash::hash(unhashed_server_seed.as_bytes());
    require!(game.server_seed_hash == revealed_hash.to_bytes(), CustomError::SeedMismatch);

    let mut combined_data = String::new();
    combined_data.push_str(&unhashed_server_seed);
    combined_data.push_str(&game.client_seed);
    let hash_bytes = anchor_lang::solana_program::hash::hash(combined_data.as_bytes()).to_bytes();

    let mut board: [u8; 25] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24];
    for i in (1..25).rev() {
        let rand_byte = hash_bytes[i % 32] as usize; 
        let j = rand_byte % (i + 1);
        board.swap(i, j);
    }

    let mut actual_bomb_mask: u32 = 0;
    for i in 0..game.mine_count as usize {
        actual_bomb_mask |= 1 << board[i];
    }

    let hit_bomb = (revealed_mask & actual_bomb_mask) != 0;
    let successful_reveals = revealed_mask.count_ones() as u8;

    if hit_bomb {
        game.state = 2; 
        game.revealed_mask = revealed_mask;
        game.bomb_mask = actual_bomb_mask; 
    } else if is_cashout {
        game.state = 1; 
        game.revealed_mask = revealed_mask;
        game.bomb_mask = actual_bomb_mask;

        let payout = calculate_payout(game.bet_amount, game.mine_count, successful_reveals)?;

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += payout;
    } else {
        return err!(CustomError::InvalidResolutionState);
    }

    Ok(())
}

pub fn cancel_abandoned_whackd(ctx: Context<CancelWhackd>) -> Result<()> {
    let game = &mut ctx.accounts.whackd_game;
    require!(game.state == 0, CustomError::GameAlreadyResolved);
    game.state = 2; 
    Ok(())
}

fn calculate_payout(bet_amount: u64, mine_count: u8, successful_reveals: u8) -> Result<u64> {
    if successful_reveals == 0 {
        return Ok(bet_amount);
    }
    let mut num: u128 = 1;
    let mut den: u128 = 1;
    for i in 0..successful_reveals {
        num = num.checked_mul((25 - i) as u128).ok_or(CustomError::MathOverflow)?;
        den = den.checked_mul((25 - mine_count - i) as u128).ok_or(CustomError::MathOverflow)?;
    }
    let payout = (bet_amount as u128)
        .checked_mul(num).ok_or(CustomError::MathOverflow)?
        .checked_mul(98).ok_or(CustomError::MathOverflow)?
        .checked_div(den).ok_or(CustomError::MathOverflow)?
        .checked_div(100).ok_or(CustomError::MathOverflow)? as u64;

    Ok(payout)
}

#[derive(Accounts)]
pub struct StartWhackd<'info> {
    #[account(init, payer = player, space = 8 + std::mem::size_of::<WhackdGame>() + 64)]
    pub whackd_game: Account<'info, WhackdGame>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Used as a reference for house authority
    pub authority: UncheckedAccount<'info>, 
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveWhackd<'info> {
    #[account(mut, has_one = authority, has_one = player)]
    pub whackd_game: Account<'info, WhackdGame>,
    /// CHECK: Target for payout
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    pub authority: Signer<'info>, 
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelWhackd<'info> {
    #[account(mut, has_one = authority)]
    pub whackd_game: Account<'info, WhackdGame>,
    pub authority: Signer<'info>, 
}
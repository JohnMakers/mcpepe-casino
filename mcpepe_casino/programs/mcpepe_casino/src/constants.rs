use anchor_lang::prelude::*;

// =============================================================================
//  HOUSE AUTHORITY  -  SINGLE SOURCE OF TRUTH
// -----------------------------------------------------------------------------
//  Every privileged instruction (resolve_*, withdraw_profits, cancel_*) must
//  pin its `authority` / `house` signer to this exact pubkey via the
//  `#[account(address = HOUSE_AUTHORITY)]` constraint.
//
//  ⚠ DEV NOTE: rotate this constant before mainnet deploy and redeploy the
//  program; the dev / treasury team will manage the actual key custody.
// =============================================================================
#[constant]
pub const HOUSE_AUTHORITY: Pubkey =
    anchor_lang::solana_program::pubkey!("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");

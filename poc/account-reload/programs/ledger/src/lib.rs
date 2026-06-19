use anchor_lang::prelude::*;

declare_id!("4pyR4Qz6qG5bssfvxpuVHNH9cXEpzaWfVi9itRf4N75W");

#[program]
pub mod ledger {
    use super::*;

    /// Create the vault PDA with a starting balance.
    pub fn initialize(ctx: Context<Initialize>, balance: u64) -> Result<()> {
        ctx.accounts.vault.balance = balance;
        Ok(())
    }

    /// Debit the vault. This is the CPI a consumer makes; it mutates on-chain
    /// state, which is exactly what a stale in-memory copy held by the caller
    /// would miss after the call returns.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.balance = vault
            .balance
            .checked_sub(amount)
            .ok_or(error!(Err::InsufficientFunds))?;
        Ok(())
    }
}

#[account]
pub struct Vault {
    pub balance: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
}

#[error_code]
pub enum Err {
    #[msg("insufficient vault balance")]
    InsufficientFunds,
}

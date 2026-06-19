use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;

declare_id!("8dJNdscBqPXKbqoAamLHDsKqpsDip8PkAcVsGhvGFBhh");

#[program]
pub mod vault_fixed {
    use super::*;

    /// FIXED: identical to the vulnerable variant EXCEPT `authority` must SIGN.
    /// Since `authority` is a seed of the vault PDA the program signs for,
    /// requiring its signature means only the real owner can move funds -- an
    /// attacker cannot forge it, so the seed component is now a verified source.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let (vault_pda, bump) =
            Pubkey::find_program_address(&[b"vault", authority.as_ref()], ctx.program_id);
        require_keys_eq!(ctx.accounts.vault.key(), vault_pda, Err::WrongVault);

        let ix = system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.recipient.key(),
            amount,
        );
        let bump_arr = [bump];
        let signer_seeds: &[&[u8]] = &[b"vault", authority.as_ref(), &bump_arr];
        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: the vault PDA (system-owned, holds lamports); verified against the
    /// derived canonical address inside withdraw.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// LOAD-BEARING FIX: the authority must sign. It is a seed of the vault PDA the
    /// program signs for, so its signature is what authorizes moving these funds.
    pub authority: Signer<'info>,
    /// CHECK: lamport recipient.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum Err {
    #[msg("vault is not the canonical PDA for this authority")]
    WrongVault,
}

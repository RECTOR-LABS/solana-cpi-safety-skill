use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;

declare_id!("HjHLkyZVc3x64fEeFBvg7KktaCLttRzxo8St9GTAezhZ");

#[program]
pub mod vault_vulnerable {
    use super::*;

    /// VULNERABLE: moves lamports out of the vault PDA by signing as that PDA with
    /// seeds [b"vault", authority]. The bump is canonical and the vault address is
    /// verified, but `authority` is an UncheckedAccount that is NEVER required to
    /// sign. Because `authority` is a SEED of the PDA the program signs for, an
    /// attacker passes the victim's authority pubkey (no signature) and the program
    /// signs for the victim's vault -- draining it. Every seed component fed to
    /// invoke_signed must come from a verified/pinned source (here: the authority
    /// must be the signer).
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
    /// CHECK: BUG -- used as a PDA seed but never required to sign. The hole: an
    /// attacker supplies the victim's pubkey here without the victim's signature.
    pub authority: UncheckedAccount<'info>,
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

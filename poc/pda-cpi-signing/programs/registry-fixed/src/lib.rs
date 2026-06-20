use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;

declare_id!("EmpKLgcp3N1ijKd4hcuS2NnqNhNkymRacYvQMd2aGkRK");

/// Registry record layout: user pubkey (32 bytes) followed by the bump (1 byte).
const REGISTRY_SPACE: u64 = 32 + 1;

#[program]
pub mod registry_fixed {
    use super::*;

    /// FIXED: the program derives the CANONICAL bump itself via
    /// find_program_address and requires the passed registry account to equal
    /// that canonical PDA. A caller-chosen non-canonical address is rejected
    /// (WrongRegistry), so only one registry address is ever creatable per user
    /// and the duplicate-account attack is impossible. A second canonical
    /// registration fails when System create_account hits the already-existing
    /// account. Never feed a caller-supplied bump into invoke_signed seeds
    /// without proving it is the canonical one.
    pub fn register(ctx: Context<RegisterFixed>) -> Result<()> {
        let user = ctx.accounts.user.key();
        let (expected, bump) =
            Pubkey::find_program_address(&[b"reg", user.as_ref()], ctx.program_id);
        require_keys_eq!(ctx.accounts.registry.key(), expected, Err::WrongRegistry);

        let rent = Rent::get()?.minimum_balance(REGISTRY_SPACE as usize);
        let ix = system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.registry.key(),
            rent,
            REGISTRY_SPACE,
            ctx.program_id,
        );
        // Only the canonical bump the program derived is ever used.
        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[b"reg", user.as_ref(), &bump_seed];
        invoke_signed(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.registry.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;
        let mut data = ctx.accounts.registry.try_borrow_mut_data()?;
        data[..32].copy_from_slice(user.as_ref());
        data[32] = bump;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterFixed<'info> {
    /// CHECK: registry PDA to create; verified against the canonical PDA inside register.
    #[account(mut)]
    pub registry: UncheckedAccount<'info>,
    /// CHECK: used only as a PDA seed (the user being registered).
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum Err {
    #[msg("registry is not the canonical PDA for this user")]
    WrongRegistry,
}

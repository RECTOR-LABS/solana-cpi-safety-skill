use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;

declare_id!("9H3yopRSRF26RFoupWbpFXAuhcSktmE1jKJXbciB7zEu");

/// Registry record layout: user pubkey (32 bytes) followed by the bump (1 byte).
const REGISTRY_SPACE: u64 = 32 + 1;

#[program]
pub mod registry_vulnerable {
    use super::*;

    /// VULNERABLE: creates the intended one-per-user registry account by signing
    /// a System create_account CPI as the PDA with seeds [b"reg", user, [bump]].
    /// The `bump` is CALLER-SUPPLIED and never checked against the canonical bump
    /// (`find_program_address`). A seed set has one canonical (highest) off-curve
    /// bump plus several lower off-curve bumps, each a DISTINCT valid PDA. The
    /// attacker registers the same user twice -- canonical bump, then a
    /// non-canonical one -- minting two registry accounts for one user and
    /// breaking the one-per-user invariant (double claim/vote/airdrop).
    ///
    /// Anchor's `#[account(init, bump = <expr>)]` is REJECTED at compile time
    /// ("bump targets should not be provided with init"): Anchor forces the
    /// canonical bump on init. That is precisely why this hole only appears in
    /// manual invoke_signed / native code that trusts a caller-supplied bump.
    pub fn register(ctx: Context<RegisterVuln>, bump: u8) -> Result<()> {
        let user = ctx.accounts.user.key();
        let rent = Rent::get()?.minimum_balance(REGISTRY_SPACE as usize);
        let ix = system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.registry.key(),
            rent,
            REGISTRY_SPACE,
            ctx.program_id,
        );
        // The attacker-chosen bump goes straight into the signer seeds.
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
pub struct RegisterVuln<'info> {
    /// CHECK: registry PDA to create; its address is whatever the caller derived
    /// from their chosen bump. Created and signed for via invoke_signed.
    #[account(mut)]
    pub registry: UncheckedAccount<'info>,
    /// CHECK: used only as a PDA seed (the user being registered).
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

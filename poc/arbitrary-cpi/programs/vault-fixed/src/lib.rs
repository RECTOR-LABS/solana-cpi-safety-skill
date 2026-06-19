use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::instruction::Instruction;

declare_id!("7Me49SEKUQJ9UEgzfSYMFL1W26nQZSF8n5epwSBGoMzo"); // replaced by `anchor keys sync`

/// The only program this vault will CPI as its token program. Pinned to the
/// real_token program id after `anchor keys sync`.
pub const TRUSTED_TOKEN: Pubkey = pubkey!("8P8ZC7vFPBYfMbXShhJC8qV6BicFdM7usCuTDQtnZUR4");

#[program]
pub mod vault_fixed {
    use super::*;

    /// FIXED: identical to the vulnerable variant EXCEPT it pins `token_program`
    /// to TRUSTED_TOKEN before the CPI. require_keys_eq! rejects any substituted
    /// program (e.g. fake_token) before a single instruction executes, closing the
    /// arbitrary-CPI hole. That key check is the load-bearing defense.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        // LOAD-BEARING FIX: refuse to CPI anything but the trusted token program.
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            TRUSTED_TOKEN,
            Err::WrongTokenProgram
        );

        let ix = Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![],
            data: TRANSFER_DISCRIMINATOR.to_vec(),
        };
        invoke(&ix, &[ctx.accounts.token_program.to_account_info()])?;
        Ok(())
    }
}

/// Anchor instruction discriminator for "transfer":
/// first 8 bytes of SHA-256("global:transfer") — precomputed const.
/// Verification: sha256("global:transfer")[0..8] == [0xa3,0x34,0xc8,0xe7,0x8c,0x03,0x45,0xba]
const TRANSFER_DISCRIMINATOR: [u8; 8] = [0xa3, 0x34, 0xc8, 0xe7, 0x8c, 0x03, 0x45, 0xba];

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: validated against TRUSTED_TOKEN inside withdraw
    pub token_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[error_code]
pub enum Err {
    #[msg("token_program must be the trusted SPL Token program")]
    WrongTokenProgram,
}

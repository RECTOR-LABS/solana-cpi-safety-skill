use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::instruction::Instruction;

declare_id!("AsG9s8ZnxvmnoXRST8kK2WcP5MBAxu7VRFqVwap7jJqM"); // replaced by `anchor keys sync`

#[program]
pub mod vault_vulnerable {
    use super::*;

    /// VULNERABLE: CPIs the `token_program` account supplied by the caller using
    /// the SPL-Token `transfer` interface, WITHOUT verifying which program that
    /// account actually is. An attacker can pass any program exposing a matching
    /// `transfer` discriminator (e.g. fake_token) and the vault will execute it,
    /// trusting it as the real token program. This is the arbitrary-CPI hole.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
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
    /// CHECK: intentionally unvalidated in the vulnerable variant
    pub token_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

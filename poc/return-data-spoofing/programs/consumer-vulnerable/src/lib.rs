use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, get_return_data, set_return_data};
use anchor_lang::solana_program::instruction::Instruction;

declare_id!("3kcfr8RXrCSP11tHyhm9j6WRBP3vTRBgZLDLWj5LocYb"); // replaced by `anchor keys sync`

#[program]
pub mod consumer_vulnerable {
    use super::*;

    /// VULNERABLE: CPIs the supplied oracle program using the `quote` interface,
    /// then trusts the returned bytes WITHOUT verifying which program produced them.
    /// An attacker can pass a malicious oracle and this program will adopt the
    /// spoofed price as if it were legitimate.
    pub fn consume_price(ctx: Context<ConsumePrice>) -> Result<()> {
        let ix = Instruction {
            program_id: ctx.accounts.oracle_program.key(),
            accounts: vec![],
            data: quote_discriminator().to_vec(),
        };
        invoke(&ix, &[ctx.accounts.oracle_program.to_account_info()])?;

        // BUG: the producer field from get_return_data() is ignored entirely.
        // Any program that set return data during this CPI will be trusted.
        let (_producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;
        let price = u64::from_le_bytes(
            bytes
                .get(..8)
                .ok_or(error!(Err::BadData))?
                .try_into()
                .map_err(|_| error!(Err::BadData))?,
        );
        msg!("price = {}", price);

        // Re-expose the adopted price as our own return data so tests can read it.
        set_return_data(&price.to_le_bytes());
        Ok(())
    }
}

/// Anchor instruction discriminator for "quote":
/// first 8 bytes of SHA-256("global:quote") — precomputed const.
/// Verification: sha256("global:quote")[0..8] == [0x95,0x2a,0x6d,0xf7,0x86,0x92,0xd5,0x7b]
fn quote_discriminator() -> [u8; 8] {
    [0x95, 0x2a, 0x6d, 0xf7, 0x86, 0x92, 0xd5, 0x7b]
}

#[derive(Accounts)]
pub struct ConsumePrice<'info> {
    /// CHECK: oracle program invoked via CPI; intentionally unvalidated in the
    /// vulnerable variant to demonstrate the attack surface.
    pub oracle_program: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}

#[error_code]
pub enum Err {
    #[msg("CPI produced no return data")]
    NoReturnData,
    #[msg("Return data too short to parse a u64")]
    BadData,
}

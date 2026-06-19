use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, get_return_data, set_return_data};
use anchor_lang::solana_program::instruction::Instruction;

declare_id!("AVJRKqzgt7msS6a9zNGxv2iNHfbfHW8wnoEYABQkNfy1"); // replaced by `anchor keys sync`

/// The only oracle program whose return data this consumer will accept.
/// Set to the price_oracle program id after `anchor keys sync`.
pub const EXPECTED_ORACLE: Pubkey = pubkey!("CyhyMsDRy72WbGMsfrYqzoPWX1UT7RQQ5PBqE65sN4Q7");

#[program]
pub mod consumer_fixed {
    use super::*;

    /// FIXED: CPIs the supplied oracle program using the `quote` interface,
    /// then verifies BOTH that (a) the return-data producer matches EXPECTED_ORACLE
    /// and (b) the oracle_program account itself is EXPECTED_ORACLE before trusting
    /// the price. Either check alone would be bypassable; together they close
    /// the return-data spoofing attack surface.
    pub fn consume_price(ctx: Context<ConsumePrice>) -> Result<()> {
        let ix = Instruction {
            program_id: ctx.accounts.oracle_program.key(),
            accounts: vec![],
            data: quote_discriminator().to_vec(),
        };
        invoke(&ix, &[ctx.accounts.oracle_program.to_account_info()])?;

        let (producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;

        // FIX: confirm the runtime-reported producer is the trusted oracle.
        require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer);
        // FIX: also confirm the account passed by the caller is the trusted oracle
        // (guards against a scenario where a rogue intermediate program re-sets
        // return data with the correct producer id but different account).
        require_keys_eq!(
            ctx.accounts.oracle_program.key(),
            EXPECTED_ORACLE,
            Err::UntrustedProducer
        );

        let price = u64::from_le_bytes(
            bytes
                .get(..8)
                .ok_or(error!(Err::BadData))?
                .try_into()
                .map_err(|_| error!(Err::BadData))?,
        );
        msg!("price = {}", price);

        // Re-expose the verified price as our own return data so tests can read it.
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
    /// CHECK: validated against EXPECTED_ORACLE inside consume_price — only
    /// the pinned price_oracle program is accepted.
    pub oracle_program: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}

#[error_code]
pub enum Err {
    #[msg("CPI produced no return data")]
    NoReturnData,
    #[msg("Return data too short to parse a u64")]
    BadData,
    #[msg("Return data originated from an untrusted oracle program")]
    UntrustedProducer,
}

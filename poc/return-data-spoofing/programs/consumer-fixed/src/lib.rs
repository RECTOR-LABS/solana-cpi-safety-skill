use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, get_return_data, set_return_data};
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

declare_id!("AVJRKqzgt7msS6a9zNGxv2iNHfbfHW8wnoEYABQkNfy1"); // replaced by `anchor keys sync`

/// The only oracle program whose return data this consumer will accept.
/// Set to the price_oracle program id after `anchor keys sync`.
pub const EXPECTED_ORACLE: Pubkey = pubkey!("CyhyMsDRy72WbGMsfrYqzoPWX1UT7RQQ5PBqE65sN4Q7");

#[program]
pub mod consumer_fixed {
    use super::*;

    /// FIXED: CPIs the supplied oracle program using the `quote` interface, then
    /// verifies the return-data producer matches EXPECTED_ORACLE before trusting the
    /// price. That producer check is the load-bearing defense — the runtime stamps the
    /// producer id and the caller cannot forge it, so a substituted or stale value is
    /// caught. The second check, on the oracle_program account, is defense-in-depth
    /// (the arbitrary-CPI control), not what closes the spoofing hole.
    pub fn consume_price(ctx: Context<ConsumePrice>) -> Result<()> {
        let ix = Instruction {
            program_id: ctx.accounts.oracle_program.key(),
            accounts: vec![],
            data: quote_discriminator().to_vec(),
        };
        invoke(&ix, &[ctx.accounts.oracle_program.to_account_info()])?;

        let (producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;

        // LOAD-BEARING FIX: confirm the runtime-reported producer is the trusted
        // oracle. This is the check that actually closes return-data spoofing — the
        // producer id is stamped by the runtime and cannot be forged by the caller,
        // so a substituted or stale value fails here.
        require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer);
        // DEFENSE-IN-DEPTH: also confirm the account the caller passed is the trusted
        // oracle. A distinct error (UntrustedCallee) keeps this separable from the
        // producer check above, so the DEFENSE test can prove the producer check is
        // what rejects a spoofed value. This is the arbitrary-CPI control (see
        // skill/arbitrary-cpi.md); for true fail-fast, pin the callee before `invoke`.
        // Complementary to, not a substitute for, the producer check.
        require_keys_eq!(
            ctx.accounts.oracle_program.key(),
            EXPECTED_ORACLE,
            Err::UntrustedCallee
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

    /// FIXED (Variant B - deeper-stack leak): CPIs a benign-looking `relay` that
    /// internally CPIs a deeper oracle. The relay sets no return data, so the slot
    /// carries the DEEP program's bytes. The producer check still authenticates the
    /// source: a deeper attacker is rejected, only EXPECTED_ORACLE is accepted --
    /// proving the producer check matters even when you only called the relay.
    pub fn consume_via_relay(ctx: Context<ConsumeViaRelay>) -> Result<()> {
        let ix = Instruction {
            program_id: ctx.accounts.relay_program.key(),
            accounts: vec![AccountMeta::new_readonly(ctx.accounts.deep_oracle.key(), false)],
            data: quote_discriminator().to_vec(),
        };
        invoke(
            &ix,
            &[
                ctx.accounts.relay_program.to_account_info(),
                ctx.accounts.deep_oracle.to_account_info(),
            ],
        )?;

        // LOAD-BEARING FIX: authenticate the producer even though we called the
        // relay -- the bytes actually came from the deepest setter, not the relay.
        let (producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;
        require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer);
        let price = u64::from_le_bytes(
            bytes
                .get(..8)
                .ok_or(error!(Err::BadData))?
                .try_into()
                .map_err(|_| error!(Err::BadData))?,
        );
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

#[derive(Accounts)]
pub struct ConsumeViaRelay<'info> {
    /// CHECK: the relay program invoked via CPI (a benign-looking passthrough).
    pub relay_program: UncheckedAccount<'info>,
    /// CHECK: the deeper oracle the relay will invoke; forwarded through.
    pub deep_oracle: UncheckedAccount<'info>,
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
    #[msg("The CPI callee was not the trusted oracle program")]
    UntrustedCallee,
}

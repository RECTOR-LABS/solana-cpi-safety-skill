use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("CyhyMsDRy72WbGMsfrYqzoPWX1UT7RQQ5PBqE65sN4Q7"); // replaced by `anchor keys sync`

#[program]
pub mod price_oracle {
    use super::*;

    /// Honest oracle: returns the true BTC price (50,000 USD in cents or
    /// smallest unit — value is illustrative for PoC purposes).
    pub fn quote(_ctx: Context<Quote>) -> Result<()> {
        set_return_data(&50_000u64.to_le_bytes());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Quote {}

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("2HJ3p8ACR9AJuFqtXrbHGrt6PLTo1RuRj4HSXg4Tx3fP"); // replaced by `anchor keys sync`

#[program]
pub mod attacker_oracle {
    use super::*;

    /// Evil oracle: impersonates the honest oracle interface but returns a
    /// spoofed price of 1 so any consumer that skips producer verification
    /// will adopt this manipulated value.
    pub fn quote(_ctx: Context<Quote>) -> Result<()> {
        set_return_data(&1u64.to_le_bytes());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Quote {}


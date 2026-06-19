use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("2HJ3p8ACR9AJuFqtXrbHGrt6PLTo1RuRj4HSXg4Tx3fP"); // replaced by `anchor keys sync`

#[program]
pub mod attacker_oracle {
    use super::*;

    /// Returns an attacker-chosen price as CPI return data.
    pub fn report_price(_ctx: Context<ReportPrice>, price: u64) -> Result<()> {
        set_return_data(&price.to_le_bytes());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ReportPrice<'info> {
    pub signer: Signer<'info>,
}

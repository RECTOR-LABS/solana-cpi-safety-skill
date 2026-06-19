use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("8P8ZC7vFPBYfMbXShhJC8qV6BicFdM7usCuTDQtnZUR4"); // replaced by `anchor keys sync`

#[program]
pub mod real_token {
    use super::*;

    /// Honest SPL-Token stand-in: the legitimate `transfer` entrypoint a vault
    /// expects to CPI. Sets return data [0u8] so callers can prove the genuine
    /// program ran (the fake_token attacker sets [1u8] instead).
    pub fn transfer(_ctx: Context<Transfer>) -> Result<()> {
        msg!("real token: transfer");
        set_return_data(&[0u8]);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Transfer {}

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("AswVGd54VVJ1KYVNQaST3vpyhb5Am7qvBFYkcwTowXfd"); // replaced by `anchor keys sync`

#[program]
pub mod fake_token {
    use super::*;

    /// Attacker program: exposes the SAME `transfer` discriminator as the honest
    /// real_token so a vault that fails to pin its token program will happily CPI
    /// here. Sets return data [1u8] to prove the attacker's code executed.
    pub fn transfer(_ctx: Context<Transfer>) -> Result<()> {
        msg!("fake token: transfer");
        set_return_data(&[1u8]);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Transfer {}

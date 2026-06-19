use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::instruction::Instruction;

declare_id!("79fwyyBCpKpodVJpAMrqQzG7D1vrn9UJ8WitCugYGV2w");

#[program]
pub mod relay {
    use super::*;

    /// A benign-looking passthrough: invokes a deeper oracle's `quote`, then
    /// returns WITHOUT setting its own return data. Because the runtime clears the
    /// return-data slot on CPI entry but not on return, the deeper oracle's
    /// (producer, bytes) survive and leak back to whoever called this relay. This
    /// is Variant B: a legitimate-looking callee can still surface a deeper
    /// program's return data.
    pub fn quote(ctx: Context<Relay>) -> Result<()> {
        let ix = Instruction {
            program_id: ctx.accounts.deep_oracle.key(),
            accounts: vec![],
            data: quote_discriminator().to_vec(),
        };
        invoke(&ix, &[ctx.accounts.deep_oracle.to_account_info()])?;
        Ok(())
    }
}

/// Anchor instruction discriminator for "quote": sha256("global:quote")[0..8].
fn quote_discriminator() -> [u8; 8] {
    [0x95, 0x2a, 0x6d, 0xf7, 0x86, 0x92, 0xd5, 0x7b]
}

#[derive(Accounts)]
pub struct Relay<'info> {
    /// CHECK: the deeper oracle this relay invokes; its return data leaks back to
    /// the relay's caller.
    pub deep_oracle: UncheckedAccount<'info>,
}

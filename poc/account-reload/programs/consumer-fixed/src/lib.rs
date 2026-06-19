use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, set_return_data};

declare_id!("B7iVMsi2xxwdAhuR7GVLJgsrPwdUtmf15cTuxHLJkPSY");

/// The trusted ledger program this consumer will CPI. Pinned so the demo
/// isolates the reload bug (the arbitrary-CPI control is not the subject here).
pub const EXPECTED_LEDGER: Pubkey = pubkey!("4pyR4Qz6qG5bssfvxpuVHNH9cXEpzaWfVi9itRf4N75W");

#[program]
pub mod consumer_fixed {
    use super::*;

    /// FIXED: identical to the vulnerable variant EXCEPT it re-reads the vault
    /// AFTER the withdraw CPI, so the solvency check sees the post-withdraw
    /// balance. With a typed `Account<'info, Vault>` the equivalent fix is
    /// `ctx.accounts.vault.reload()?` before reading the field.
    pub fn process(ctx: Context<Process>, amount: u64, min_balance: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.ledger_program.key(),
            EXPECTED_LEDGER,
            Err::WrongLedger
        );

        // CPI debits the vault on-chain.
        withdraw_cpi(&ctx.accounts.ledger_program, &ctx.accounts.vault, amount)?;

        // LOAD-BEARING FIX: re-read the vault after the CPI (Anchor: `.reload()?`)
        // so the check reflects the drained balance, not a stale snapshot.
        let fresh = read_balance(&ctx.accounts.vault)?;

        require!(fresh >= min_balance, Err::Insolvent);
        msg!("solvency check passed against fresh balance {}", fresh);
        set_return_data(&fresh.to_le_bytes());
        Ok(())
    }
}

/// Read the `balance: u64` field of a ledger Vault account (8-byte Anchor
/// discriminator, then the u64).
fn read_balance(vault: &UncheckedAccount<'_>) -> Result<u64> {
    let data = vault.try_borrow_data()?;
    let raw: [u8; 8] = data
        .get(8..16)
        .ok_or(error!(Err::BadVaultData))?
        .try_into()
        .map_err(|_| error!(Err::BadVaultData))?;
    Ok(u64::from_le_bytes(raw))
}

/// Anchor discriminator for ledger's `withdraw`: sha256("global:withdraw")[0..8].
const WITHDRAW_DISCRIMINATOR: [u8; 8] = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

fn withdraw_cpi<'a>(ledger: &UncheckedAccount<'a>, vault: &UncheckedAccount<'a>, amount: u64) -> Result<()> {
    let mut data = WITHDRAW_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: ledger.key(),
        accounts: vec![AccountMeta::new(vault.key(), false)],
        data,
    };
    invoke(&ix, &[vault.to_account_info(), ledger.to_account_info()])?;
    Ok(())
}

#[derive(Accounts)]
pub struct Process<'info> {
    /// CHECK: the ledger-owned vault PDA; read raw and passed to the withdraw CPI.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: validated against EXPECTED_LEDGER before the CPI.
    pub ledger_program: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}

#[error_code]
pub enum Err {
    #[msg("ledger_program is not the trusted ledger")]
    WrongLedger,
    #[msg("vault data too short to read balance")]
    BadVaultData,
    #[msg("vault is insolvent after the withdrawal")]
    Insolvent,
}

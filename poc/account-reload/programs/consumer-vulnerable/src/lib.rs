use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, set_return_data};

declare_id!("51YsAXYZDms5gXcKYLvR2zyKU7qPZY58uupwJcyPF2TE");

/// The trusted ledger program this consumer will CPI. Pinned so the demo
/// isolates the reload bug (the arbitrary-CPI control is not the subject here).
pub const EXPECTED_LEDGER: Pubkey = pubkey!("4pyR4Qz6qG5bssfvxpuVHNH9cXEpzaWfVi9itRf4N75W");

#[program]
pub mod consumer_vulnerable {
    use super::*;

    /// VULNERABLE: snapshots the vault balance BEFORE the withdraw CPI, then runs
    /// the solvency check against that pre-CPI snapshot. The CPI has already
    /// drained the vault, but the check never sees it -- a drained vault passes.
    /// This is the "stale account after CPI" bug: state read before a CPI must be
    /// re-read afterward (Anchor: `account.reload()?`).
    pub fn process(ctx: Context<Process>, amount: u64, min_balance: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.ledger_program.key(),
            EXPECTED_LEDGER,
            Err::WrongLedger
        );

        // Snapshot before the CPI.
        let stale = read_balance(&ctx.accounts.vault)?;

        // CPI debits the vault on-chain.
        withdraw_cpi(&ctx.accounts.ledger_program, &ctx.accounts.vault, amount)?;

        // BUG: the solvency check uses the pre-CPI snapshot, not the live balance.
        require!(stale >= min_balance, Err::Insolvent);
        msg!("solvency check passed against stale balance {}", stale);
        set_return_data(&stale.to_le_bytes());
        Ok(())
    }
}

/// Read the `balance: u64` field of a ledger Vault account (8-byte Anchor
/// discriminator, then the u64). Reading raw avoids a cross-program type
/// dependency; the staleness here is explicit (snapshot vs re-read), the same
/// hazard Anchor's `Account<T>` has until you call `.reload()`.
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

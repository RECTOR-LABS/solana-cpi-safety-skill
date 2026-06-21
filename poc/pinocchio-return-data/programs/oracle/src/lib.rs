use pinocchio::{cpi::set_return_data, entrypoint, AccountView, Address, ProgramResult};

entrypoint!(process_instruction);

/// Honest oracle (the trusted producer).
///
/// Sets its return data to the true price (50,000 in the smallest unit; the
/// value is illustrative for the PoC). It takes no accounts and ignores its
/// instruction data, so a CPI to this program yields
/// `(producer = this program id, data = 50_000u64 little-endian)`.
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    set_return_data(&50_000u64.to_le_bytes());
    Ok(())
}

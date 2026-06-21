use pinocchio::{cpi::set_return_data, entrypoint, AccountView, Address, ProgramResult};

entrypoint!(process_instruction);

/// Malicious oracle (the spoofer).
///
/// Impersonates the honest oracle's interface but returns a spoofed price of 1.
/// A consumer that reads CPI return data without verifying the producing program
/// id will adopt this manipulated value as if it came from the trusted oracle.
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    set_return_data(&1u64.to_le_bytes());
    Ok(())
}

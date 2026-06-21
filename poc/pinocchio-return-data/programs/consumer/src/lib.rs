use pinocchio::{
    cpi::{get_return_data, invoke, set_return_data},
    entrypoint,
    error::ProgramError,
    instruction::InstructionView,
    AccountView, Address, ProgramResult,
};

entrypoint!(process_instruction);

/// The only oracle program whose return data this consumer accepts in the
/// CHECKED path. These are the bytes of the committed
/// `target/deploy/oracle-keypair.json` public key
/// (`5iZa8uWeV7q6T4uHnkCHoNFMDuKFyzQvAm4CuuYLMh1v`). The runtime stamps the
/// producing program id onto return data and the caller cannot forge it, so
/// pinning it here is the load-bearing fix against CPI return-data spoofing.
const TRUSTED_ORACLE: Address = Address::new_from_array([
    70, 20, 99, 174, 126, 220, 103, 91, 169, 17, 178, 146, 159, 1, 73, 51, 134, 236, 30, 209, 74,
    241, 230, 17, 62, 56, 118, 63, 210, 149, 55, 133,
]);

// Custom program error codes (surfaced by the runtime as "custom program error: 0x..").
const ERR_NO_RETURN_DATA: u32 = 1;
const ERR_BAD_DATA: u32 = 2;
const ERR_UNTRUSTED_PRODUCER: u32 = 3;

/// Single-byte instruction discriminator (Pinocchio convention -- no 8-byte
/// Anchor hash):
///   byte 0 = consume_unchecked  (VULNERABLE: trusts return data, never checks the producer)
///   byte 1 = consume_checked    (FIXED: verifies the return-data producer is TRUSTED_ORACLE)
pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [oracle, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let checked = match instruction_data.first().copied() {
        Some(0) => false,
        Some(1) => true,
        _ => return Err(ProgramError::InvalidInstructionData),
    };

    // Attack surface: CPI the CALLER-SUPPLIED oracle program. The consumer
    // invokes whatever program id was passed as `oracle` (no accounts, no data --
    // the oracle simply publishes a price via return data).
    let ix = InstructionView {
        program_id: oracle.address(),
        accounts: &[],
        data: &[],
    };
    invoke::<0>(&ix, &[])?;

    // Read whatever the CPI left in the per-transaction return-data slot.
    let return_data = get_return_data().ok_or(ProgramError::Custom(ERR_NO_RETURN_DATA))?;

    if checked {
        // LOAD-BEARING FIX (the crown-jewel defense): the runtime stamps the
        // producing program id onto return data and the caller cannot forge it.
        // Pinning it to the trusted oracle rejects a substituted attacker oracle
        // -- and any stale value leaked from a deeper CPI -- outright.
        if return_data.program_id() != &TRUSTED_ORACLE {
            log("UntrustedProducer: return-data producer is not the trusted oracle");
            return Err(ProgramError::Custom(ERR_UNTRUSTED_PRODUCER));
        }
    }

    let price = u64::from_le_bytes(
        return_data
            .as_slice()
            .get(..8)
            .ok_or(ProgramError::Custom(ERR_BAD_DATA))?
            .try_into()
            .map_err(|_| ProgramError::Custom(ERR_BAD_DATA))?,
    );

    // Re-expose the adopted price as our own return data so the test can read the
    // value the consumer actually trusted.
    set_return_data(&price.to_le_bytes());
    Ok(())
}

/// Log a message via the `sol_log_` syscall. Pinocchio's core crate ships no
/// `msg!` helper, so the producer-mismatch rejection logs through the raw
/// syscall (the same one Pinocchio's own panic handler uses). Compiled out when
/// not building for the Solana VM.
#[inline(always)]
fn log(message: &str) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_(message.as_ptr(), message.len() as u64);
    }
    #[cfg(not(target_os = "solana"))]
    let _ = message;
}

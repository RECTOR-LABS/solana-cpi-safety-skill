# PDA CPI Signing

`invoke_signed` allows a program to authorize a CPI on behalf of a program-derived address (PDA) by supplying the seeds and bump that produce that PDA. The risks are: signing with a non-canonical bump, and signing with seeds that are partially or fully attacker-influenced. Either mistake lets an attacker steer which PDA is treated as the authorized signer, enabling forged authority or signing for an address the program never intended to control.

---

## 1. What it is — `invoke_signed` and PDA authority

A PDA is a public key with no private key, derived deterministically from a seed list and a program id. Because no private key exists, the only way to authorize a CPI as a PDA is for the program that owns it to supply the seeds and bump to `invoke_signed`. The runtime re-derives the address from those seeds, confirms it matches the PDA account in the instruction, and grants signing authority.

Two properties of PDA derivation matter here:

**Canonical bump.** `find_program_address(seeds, program_id)` iterates bumps from 255 down to 0 and returns the first bump that produces a valid off-curve address. That first valid bump is the *canonical bump*. There is exactly one canonical bump per (seeds, program_id) pair. However, `create_program_address(seeds_with_bump, program_id)` can produce a valid off-curve address for multiple bump values — it does not search; it evaluates exactly the bump you supply. A non-canonical bump therefore produces a *different* PDA from the canonical one, not an error.

**Seed composition.** The derived address depends on every byte of every seed. If any seed byte is attacker-supplied — from instruction data, from an account field that the attacker controls, or from a remaining-accounts slot — the attacker can steer the derived address to one they have pre-arranged, granting them signing authority under the attacker-chosen PDA rather than the program-intended one.

---

## 2. Why it is exploitable

### Non-canonical bump

A program stores a bump in an account field or accepts it from instruction data, then passes it to `invoke_signed`. An attacker can supply a non-canonical bump that produces a different PDA — one the program never initialized or intended to control. If the program does not independently verify that the PDA account in the instruction was derived from the canonical bump, the attacker can:

- Authorize a CPI as an address the program should not control.
- Sign for a PDA that holds attacker-placed state (e.g. a fake vault the attacker seeded at the non-canonical address) rather than the legitimate program vault.
- Bypass authority checks that assume a unique PDA per seed set: if two bumps produce two valid PDAs, code that checks "is the signer a PDA of this program?" accepts either, but the program's logic was written for only one.

The canonical bump uniquely identifies the intended PDA for a given seed set. Accepting any other bump is accepting a different address.

### Attacker-influenced seeds

If any seed component is attacker-controlled, the attacker can construct seeds that derive a PDA for which they have pre-staged state or that collides with another program's authority address. Concrete scenarios:

- Instruction data supplies a `user_id` used as a seed. The attacker chooses a `user_id` that, combined with the program's fixed seeds, derives a PDA that is the authority for a vault belonging to a different user.
- A remaining-accounts slot supplies an account whose key is used as a seed. The attacker passes an account with a key chosen to produce a target PDA.
- A `mint` address used as a seed is attacker-supplied. The attacker uses the mint address of a high-value account they want to drain.

In all cases, the result is the same: `invoke_signed` is called with the program's signing authority on behalf of an address the attacker chose, not the address the developer intended.

---

## 3. Detection heuristics

```bash
# All invoke_signed call sites
rg -n 'invoke_signed\s*\(' --type rust

# create_program_address usage — accepts arbitrary bumps, red flag unless
# the bump was obtained from find_program_address in the same scope
rg -n 'create_program_address\s*\(' --type rust

# Bumps sourced from instruction data or accounts (rather than ctx.bumps)
# Look for bump fields on instruction structs or account data structs
rg -n 'bump\s*[:=]' --type rust

# Anchor: confirm ctx.bumps is used rather than a caller-supplied bump
rg -n 'ctx\.bumps\.' --type rust
```

Flag a finding when any of the following hold:

- **`invoke_signed` is called with a bump that does not come from canonical derivation.** Canonical sources are: `ctx.bumps.x` in Anchor (the bump stored and verified by the Accounts struct derivation), or a bump previously obtained from `find_program_address` in the same program. A bump from instruction data, an account field, or `remaining_accounts` is attacker-supplied.
- **`create_program_address` is called with a bump that was not returned by `find_program_address`.** `create_program_address` does not iterate — it accepts any bump including non-canonical ones. Its only legitimate use is when you already hold a canonical bump (e.g. stored in a PDA's data field and verified at initialization). If the bump originates from the caller, it is a finding.
- **Any seed component of `invoke_signed`'s `signers_seeds` traces back to an account field, instruction data, or `remaining_accounts` that the attacker could supply.** Seeds that include a mint address, a user pubkey, or any other untrusted input must be validated (e.g. confirmed against a config account or a hardcoded set of allowed values) before being used in `signers_seeds`.
- **A stored bump is used in `invoke_signed` but was never verified as canonical at the time it was stored.** If the program's initialization instruction accepted the bump from the caller and wrote it into the PDA's data without calling `find_program_address` to confirm, every subsequent `invoke_signed` using that bump is at risk.

---

## 4. Safe pattern — Anchor

Anchor derives and verifies the canonical bump automatically when you declare the PDA in the Accounts struct with `seeds` and `bump`. The verified canonical bump is then available via `ctx.bumps.my_pda`. Always use `ctx.bumps` in the `signers_seeds` slice — never accept a bump from instruction input.

**Vulnerable — bump from instruction data:**

```rust
#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: no seed or bump constraint — Anchor does not verify canonicity
    #[account(mut)]
    pub vault_pda: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn execute(ctx: Context<Execute>, bump: u8) -> Result<()> {
    // BUG: bump comes from the caller's instruction data.
    // An attacker can supply a non-canonical bump, causing invoke_signed
    // to authorize a CPI as a different PDA than the program intended.
    invoke_signed(
        &some_instruction(&ctx.accounts.vault_pda.key()),
        &[ctx.accounts.vault_pda.to_account_info()],
        &[&[b"vault", &[bump]]],  // attacker-supplied bump
    )?;
    Ok(())
}
```

**Fixed — canonical bump from Anchor's Accounts derivation:**

```rust
#[derive(Accounts)]
pub struct Execute<'info> {
    // The seeds and bump constraints cause Anchor to:
    // 1. Derive the canonical PDA from [b"vault"] at deserialization time.
    // 2. Verify that vault_pda.key() matches the canonical address.
    // 3. Store the canonical bump in ctx.bumps.vault_pda.
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    pub vault_pda: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
    // FIX: use the canonical bump that Anchor derived and verified.
    // ctx.bumps.vault_pda is the bump from find_program_address — it cannot
    // be forged by the caller because Anchor already verified vault_pda.key()
    // against the canonical derivation before this function body ran.
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", &[ctx.bumps.vault_pda]]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        /* transfer or other cpi accounts */,
        signer_seeds,
    );
    // dispatch the CPI — vault_pda is authorized as the canonical PDA signer
    system_program::transfer(cpi_ctx, amount)?;
    Ok(())
}
```

The Accounts struct constraint (`seeds = [b"vault"], bump`) is the load-bearing line: Anchor re-derives the canonical PDA and fails account validation if `vault_pda.key()` does not match. No instruction-supplied bump can pass that check. `ctx.bumps.vault_pda` is guaranteed to be the canonical bump.

**On stored bumps.** A common and safe pattern is to derive the canonical bump once (at PDA initialization) with `find_program_address`, store it in the PDA's data account, then use it in subsequent instructions via `seeds = [...], bump = vault_state.bump`. This is safe only when the bump was written at initialization under the `seeds + bump` constraint (so Anchor verified canonicity at that point). Never write a bump supplied by the caller into the PDA's state without verifying it via `find_program_address` first.

---

## 5. Safe pattern — native / Pinocchio

Without Anchor, derive the canonical bump with `find_program_address` and pass the result to `invoke_signed`. Do not call `create_program_address` with a caller-supplied bump.

**Vulnerable — `create_program_address` with an attacker-supplied bump:**

```rust
// BUG: bump comes from instruction data. create_program_address evaluates
// exactly the bump supplied — it does not search for the canonical one.
// A non-canonical bump produces a different PDA.
let vault_pda = Pubkey::create_program_address(
    &[b"vault", &[attacker_supplied_bump]],
    program_id,
)?;

invoke_signed(
    &transfer_ix,
    &[vault_account.clone(), destination.clone()],
    &[&[b"vault", &[attacker_supplied_bump]]],
)?;
```

**Fixed — canonical derivation with `find_program_address`:**

```rust
// FIX: find_program_address returns (address, canonical_bump).
// It iterates from bump=255 downward and returns the first valid address.
// There is exactly one canonical bump; the result is deterministic and
// cannot be influenced by the caller.
let (expected_pda, canonical_bump) =
    Pubkey::find_program_address(&[b"vault"], program_id);

// Confirm the account passed by the caller is actually the canonical PDA.
// Without this check, an attacker could pass a different account that happens
// to be a PDA at a non-canonical bump, satisfying the invoke_signed signature
// check while being a different address than the program intended.
if vault_account.key != &expected_pda {
    return Err(ProgramError::Custom(ErrCode::InvalidVaultAddress as u32));
}

// Safe: signers_seeds use the canonical bump, and we verified vault_account
// is actually the canonical PDA before reaching this point.
invoke_signed(
    &transfer_ix,
    &[vault_account.clone(), destination.clone()],
    &[&[b"vault", &[canonical_bump]]],
)?;
```

**Pinocchio note.** Pinocchio programs use the same `invoke_signed` syscall surface as native programs. The signing model is identical: supply `signers_seeds` that the runtime uses to re-derive and match the PDA. Derive the bump canonically with `find_program_address` (or from a stored canonical bump) and apply the same `vault_account.key == expected_pda` pre-check. Pinocchio's zero-copy account access does not change the trust model for signer seeds.

**On stored canonical bumps in native programs.** If the program stores the canonical bump in the PDA's data account at initialization (where it was set from `find_program_address`), it is safe to read that stored bump and pass it to subsequent `invoke_signed` calls — as long as the initialization instruction itself verified the bump via `find_program_address` and wrote only that value. Never accept a bump from the instruction data of a non-initialization instruction.

---

## 6. Relationship and cross-references

This class is about **signing authority integrity** — ensuring that `invoke_signed` authorizes a CPI exactly on behalf of the address the program intended, not one steered by an attacker.

- **`arbitrary-cpi.md`** — concerns which program is invoked; this document concerns which PDA signs for it. A program that pins its callee (the control in `arbitrary-cpi.md`) but signs with an attacker-supplied bump is still exposed: the right program executes, but with authority over the wrong PDA.
- **`cpi-return-data-spoofing.md`** — concerns what bytes the callee returns after the CPI completes. PDA signing safety is a pre-CPI concern (authentication of the signer); return-data spoofing is a post-CPI concern (authentication of the output). They are independent failure modes but can combine: an attacker who compromises PDA signing authority can issue CPIs that write attacker-controlled data, then a return-data spoofing gap turns that data into a trusted value.

A runnable PoC ships in `poc/pda-cpi-signing/`: a vault PDA derived from `[b"vault", authority]` holds lamports, and `withdraw` signs a transfer out of it via `invoke_signed` with the canonical bump. The LiteSVM suite proves all three cases — EXPLOIT (the vulnerable program never requires `authority`, a seed of the PDA it signs for, to sign, so an attacker drains a victim's vault by passing the victim's pubkey unsigned), DEFENSE (the fixed program makes `authority` a `Signer`, rejecting the unsigned drain), and POSITIVE CONTROL (the real authority withdraws from its own vault). Run it with `cd poc/pda-cpi-signing && npm test`. A second test file (`non-canonical-bump.test.ts`) ships the non-canonical-bump variant: a one-per-user `[b"reg", user]` registry whose vulnerable program creates the account via `invoke_signed` with a caller-supplied bump, so an attacker registers the same user twice — canonical bump, then a lower off-curve (non-canonical) bump — minting two distinct PDAs for one user and breaking the one-per-user invariant. The fixed program derives the canonical bump with `find_program_address` and rejects any other target (`WrongRegistry`). Same EXPLOIT/DEFENSE/POSITIVE-CONTROL shape; the test computes the non-canonical bump in TypeScript via a manual `create_program_address` (sha256 plus an off-curve check), self-verified against the canonical PDA. Note that Anchor's `#[account(init, bump = <expr>)]` is rejected at compile time, so this facet is demonstrated with manual `invoke_signed` — the native shape where it occurs.

---

## See also

- `arbitrary-cpi.md` — pinning the program invoked during CPI; complementary to PDA signing safety.
- `cpi-return-data-spoofing.md` — authenticating return data after CPI; a related post-CPI trust failure.
- `cpi-checklist.md` — consolidated CPI-safety review checklist.
- `poc-harness.md` — the LiteSVM harness used by `poc/pda-cpi-signing/` and the other PoC suites.

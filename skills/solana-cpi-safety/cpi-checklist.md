# CPI Safety Checklist

This is the single source of truth for CPI-safety review checks across this skill. The `audit-cpi` command and the `cpi-auditor` agent cite this file and do not restate its contents.

---

## Section 1 — Return-Data Trust

**Class:** CPI return-data spoofing (novel class; see `cpi-return-data-spoofing.md` for full treatment)

**Detection signal:**

```bash
rg -n 'get_return_data|sol_get_return_data' --type rust
# Throwaway producer binding — strong smell:
rg -n 'let\s*\(\s*_+\s*,' --type rust | grep 'get_return_data'
```

**Checks to perform at each site:**

- [ ] Is the producer `Pubkey` from `get_return_data()` compared against a pinned constant (or governance-held key) before any byte of data is parsed?
  - Signal of failure: `let (_producer, bytes) = get_return_data()...` — producer discarded.
  - Signal of failure: producer compared to a caller-supplied account key (circular; no protection).
  - Safe pattern: `require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer)` before parsing `bytes`.
  - Severity: **Critical**

- [ ] Is `get_return_data()` returning `None` handled explicitly (not `.unwrap()` or ignored)?
  - Safe pattern: `.ok_or(error!(Err::NoReturnData))?`
  - Severity: **High**

- [ ] If the callee is caller-supplied, is the callee pinned against the same constant before the `invoke` (callee-pin, the complementary arbitrary-CPI control)?
  - A producer check alone closes the spoofing hole; a callee pin is defense-in-depth (fail fast).
  - Severity: **High** (if producer check also absent: Critical; if producer check present: defense-in-depth gap, High)

- [ ] Could the slot hold a stale value surfaced from a *deeper* CPI (Variant B)? The slot is cleared on CPI entry but not on return, so a callee that returns without overwriting can forward a deeper program's return data.
  - The producer check rejects any stale value whose producer is not EXPECTED_ORACLE. Handle `None` (an immediate callee that set nothing yields None, not stale data).
  - Freshness caveat: if the trusted oracle can be invoked deeper in the call tree, the producer can match while the bytes belong to another call — bind the data to this call (clear-before, require-non-empty-after).
  - Severity: **High**

---

## Section 2 — Arbitrary CPI / Program Substitution

**Class:** Caller-supplied program id invoked without pinning; fake-SPL variant (see `arbitrary-cpi.md`)

**Detection signal:**

```bash
rg -n 'invoke\s*\(|invoke_signed\s*\(' --type rust
rg -n 'CpiContext::new' --type rust
rg -n 'UncheckedAccount|AccountInfo' --type rust
```

**Checks to perform at each site:**

- [ ] Does the CPI's target program id come from a caller-supplied account? If so, is it compared against a pinned constant before `invoke` / `invoke_signed` / `CpiContext` dispatch?
  - Signal of failure: `program_id: ctx.accounts.token_program.key()` where `token_program` is `UncheckedAccount`.
  - Safe pattern (Anchor): `Program<'info, Token>` — pins at deserialization time.
  - Safe pattern (explicit): `require_keys_eq!(ctx.accounts.token_program.key(), spl_token::ID, Err::WrongProgram)` before constructing the instruction.
  - Severity: **Critical**

- [ ] For token accounts passed to CPIs, is the account's `owner` field verified to equal `spl_token::ID` (or the appropriate program id) before use (fake-SPL guard)?
  - Signal of failure: token account deserialized from `UncheckedAccount` without an explicit owner check.
  - Safe pattern: `Account<'info, TokenAccount>` in Anchor; or `token_account.owner == spl_token::ID` in native.
  - Severity: **High**

- [ ] After pinning the callee, is `get_return_data()` (if used) also producer-checked? (Cross-ref Section 1 — pinning the callee does not close the return-data spoofing hole.)
  - Severity: **Critical** if return data is consumed without a producer check.

---

## Section 3 — Account Reload After CPI

**Class:** Stale deserialized account state read after CPI (see `account-reload.md`)

**Detection signal:**

```bash
rg -n 'invoke\s*\(|CpiContext::new' --type rust
# Confirm reload coverage:
rg -n '\.reload\(\)' --type rust
```

**Checks to perform at each CPI site:**

- [ ] Is any field of a deserialized account (`ctx.accounts.x.field`, or a `VaultState` struct) read after a CPI without an intervening `.reload()?` (Anchor) or re-borrow + re-deserialize (native)?
  - Signal of failure: `let post = ctx.accounts.vault.balance` after a token-program CPI, no `.reload()` between them.
  - Safe pattern (Anchor): `ctx.accounts.vault.reload()?;` immediately after the CPI, before any field reads.
  - Safe pattern (native): re-borrow `vault_account.try_borrow_data()?` and re-deserialize after `invoke`.
  - Severity: **High**

- [ ] Do any post-CPI authorization or sanity checks (balance floor, debt ceiling, access control) read from the same account that the CPI may have mutated, without a reload?
  - A passing check against stale data is a silent failure.
  - Severity: **High**

- [ ] Is the same `AccountInfo` passed to both the caller's `Accounts` struct and the CPI's `account_infos` slice (aliasing case)? If so, is it reloaded before any post-CPI field reads?
  - The callee can mutate the aliased account in place; the caller's deserialized copy is still stale.
  - Severity: **High**

---

## Section 4 — PDA invoke_signed

**Class:** Non-canonical bump or attacker-influenced seeds in `invoke_signed` (see `pda-cpi-signing.md`)

**Detection signal:**

```bash
rg -n 'invoke_signed\s*\(' --type rust
rg -n 'create_program_address\s*\(' --type rust
rg -n 'bump\s*[:=]' --type rust
# Anchor canonical source — should be present:
rg -n 'ctx\.bumps\.' --type rust
```

**Checks to perform at each `invoke_signed` site:**

- [ ] Does the bump used in `signers_seeds` come from canonical derivation only?
  - Signal of failure: bump from instruction data or an account field that the caller supplied.
  - Signal of failure: `create_program_address` called with a caller-supplied bump (non-canonical evaluation).
  - Safe pattern (Anchor): `ctx.bumps.vault_pda` from a `seeds = [...], bump` constraint in the Accounts struct.
  - Safe pattern (native): `Pubkey::find_program_address` called in the same program, result passed directly to `invoke_signed`.
  - Severity: **Critical**

- [ ] Are all components of `signers_seeds` either program constants or values derived from pinned/verified sources? Trace each seed component:
  - Attacker-influenced sources: instruction data fields, `remaining_accounts` entries, unvalidated account fields.
  - Safe sources: program constants (`b"vault"`), account fields read from program-owned accounts that were initialized under constraints.
  - Severity: **Critical** if any seed component is attacker-controlled.

- [ ] If a stored bump is used (bump written into PDA data at initialization and reused in subsequent instructions), was that bump verified as canonical (via `find_program_address` or Anchor's `seeds + bump` constraint) at the time it was stored?
  - A bump accepted from the caller at initialization and stored verbatim is a Critical finding on every subsequent `invoke_signed`.
  - Severity: **Critical**

- [ ] Is the PDA account passed to `invoke_signed` verified to be the canonical PDA (not just any account the caller chose)?
  - Native: compare `vault_account.key == &expected_pda` (derived from `find_program_address`) before `invoke_signed`.
  - Anchor's `seeds + bump` constraint performs this check automatically.
  - Severity: **High**

---

## Checklist Coverage Summary

When completing a review, confirm which sections were exercised:

| Section | Class | Triggered by |
|---------|-------|--------------|
| 1 | Return-data trust | `get_return_data`, `sol_get_return_data` |
| 2 | Arbitrary CPI / program substitution | `invoke`, `invoke_signed`, `CpiContext`, `UncheckedAccount` as program |
| 3 | Account reload after CPI | any `invoke` / CpiContext where a mutated account is read post-CPI |
| 4 | PDA invoke_signed | `invoke_signed`, `create_program_address`, bump variables |

If no grep hit triggers a section, record it as "not applicable" for the target — do not record it as "passed" without evidence.

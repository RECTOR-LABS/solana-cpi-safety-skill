# Arbitrary CPI

A program performs a cross-program invocation (CPI) to a program id that comes from a caller-supplied account, without verifying that account's key against a trusted constant. An attacker substitutes a malicious program in that slot; the victim vault executes it with its own accounts and signing authority. Because the substituted program runs inside the victim's CPI, it can drain tokens, manipulate state, or emit forged return data — all under the victim's umbrella.

This document covers program substitution and the related fake-SPL variant. The PoC is in `poc/arbitrary-cpi/`. For the return-data angle that sits on top of this class, see `cpi-return-data-spoofing.md`.

---

## 1. What it is

### Program substitution

In a CPI the caller passes a `program_id` — the address of the program to invoke. On Solana, the runtime validates that the program exists and is executable, but it does not know or care whether that program is the one the developer *intended* to invoke. If the vault takes `program_id` from an unvalidated `AccountInfo` supplied by the caller, the attacker replaces it with any program they control that exposes a matching instruction discriminator.

The vault in the PoC (`vault_vulnerable`) constructs its `Instruction` like this:

```rust
let ix = Instruction {
    program_id: ctx.accounts.token_program.key(),  // from caller, never verified
    accounts: vec![],
    data: TRANSFER_DISCRIMINATOR.to_vec(),
};
invoke(&ix, &[ctx.accounts.token_program.to_account_info()])?;
```

`token_program` is declared `UncheckedAccount<'info>` and its key is never compared against any constant. The attacker passes `fake_token` instead. The runtime dutifully invokes it; `fake_token`'s `transfer` runs, sets return data `[1u8]`, and the transaction succeeds. The vault is now executing attacker-controlled code in the context of its own instruction.

### Fake-SPL variant

A related class: instead of replacing the *program*, the attacker supplies an account whose *data layout* matches a token account (`TokenAccount` in Anchor / `Account<'_, TokenAccount>` in deserialization terms) but whose on-chain `owner` field is *not* `spl_token::ID`. Naive deserialization succeeds — the fields decode fine — but the account is not a real SPL Token account and the program that controls it is not the token program. An attacker can craft state that passes purely structural checks, then drain or manipulate it in a subsequent instruction where the real owner has control.

The guard for fake-SPL is the same principle: check who *owns* the account, not just what its bytes look like. Anchor's `Account<'info, TokenAccount>` enforces `owner == spl_token::ID`; `Account<'info, Mint>` enforces `owner == spl_token::ID` on mints. If you use `UncheckedAccount` and deserialize manually, you must compare `token_account.owner == spl_token::ID` explicitly.

---

## 2. Why it is exploitable

When a CPI executes, the substituted program runs with:

- **The victim's account list.** All `AccountInfo`s the vault passed to `invoke` arrive in the attacker's program exactly as the vault constructed them, including any accounts that hold real funds or grant authority.
- **The victim's signing authority.** If the vault uses `invoke_signed` with a PDA seed, the substituted program receives those PDA-derived signer permissions. The vault's own authority can be used against it.
- **No structural difference from a legitimate call.** The runtime does not distinguish "the developer intended SPL Token" from "the attacker passed their own program." It only checks the program is executable.

For the fake-SPL variant: Rust's `#[account]` deserialization in Anchor reads a discriminator and field bytes. It does not inherently check that the on-chain program owning the account is the token program. Checking shape but not ownership is trusting the content of an account whose origin has not been authenticated.

---

## 3. Detection heuristics

Grep signals for the program-substitution class:

```bash
# CPI calls where the target program_id may come from a caller-supplied account
rg -n 'invoke\s*\(|invoke_signed\s*\(' --type rust

# UncheckedAccount or AccountInfo used as a program argument
rg -n 'UncheckedAccount|AccountInfo' --type rust

# CpiContext built from an account that is not typed as Program<'info, T>
rg -n 'CpiContext::new' --type rust

# Absence of require_keys_eq! / assert_keys_eq! near CPI calls
# (no direct grep — look for CPI calls NOT followed by a key check)
```

Flag a finding when:

- `invoke` or `invoke_signed` is called and the `program_id` field of the `Instruction` struct traces back to a caller-supplied `AccountInfo` or `UncheckedAccount`, rather than a hardcoded constant.
- `CpiContext::new(ctx.accounts.some_program.to_account_info(), ...)` where `some_program` is `UncheckedAccount` or `AccountInfo` (not a typed `Program<'info, T>`). Anchor's typed `Program<'info, Token>` pins the program id at deserialization time and is the idiomatic fix; an untyped account is a red flag.
- `invoke` to a caller-supplied program followed by `get_return_data()` without a producer check — this combines arbitrary CPI with return-data spoofing (see `cpi-return-data-spoofing.md`).

Grep signals for the fake-SPL variant:

```bash
# Manual deserialization of SPL token account data without owner check
rg -n 'TokenAccount::try_deserialize|unpack|from_account_info' --type rust

# UncheckedAccount used where a token account is expected
rg -n 'UncheckedAccount' --type rust
```

Flag a finding when token account data is deserialized from an `UncheckedAccount` without an explicit `account.owner == spl_token::ID` (or equivalent) guard immediately preceding or following the deserialization call.

---

## 4. Safe pattern — Anchor

Two approaches, in ascending idiomaticity:

### (a) Explicit id pin with `require_keys_eq!`

This is what `vault_fixed` does in the PoC. Pin the program id before constructing or executing the CPI. The `TRUSTED_TOKEN` constant stands in for `spl_token::ID`; in a production vault you pin to the real canonical id.

**Vulnerable** (`poc/arbitrary-cpi/programs/vault-vulnerable/src/lib.rs`):

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: intentionally unvalidated in the vulnerable variant
    pub token_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let ix = Instruction {
        program_id: ctx.accounts.token_program.key(), // no check
        accounts: vec![],
        data: TRANSFER_DISCRIMINATOR.to_vec(),
    };
    invoke(&ix, &[ctx.accounts.token_program.to_account_info()])?;
    Ok(())
}
```

**Fixed** (`poc/arbitrary-cpi/programs/vault-fixed/src/lib.rs`):

```rust
/// The only program this vault will CPI as its token program.
pub const TRUSTED_TOKEN: Pubkey = pubkey!("8P8ZC7vFPBYfMbXShhJC8qV6BicFdM7usCuTDQtnZUR4");

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: validated against TRUSTED_TOKEN inside withdraw
    pub token_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[error_code]
pub enum Err {
    #[msg("token_program must be the trusted SPL Token program")]
    WrongTokenProgram,
}

pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    // LOAD-BEARING FIX: refuse to CPI anything but the trusted token program.
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        TRUSTED_TOKEN,
        Err::WrongTokenProgram
    );

    let ix = Instruction {
        program_id: ctx.accounts.token_program.key(),
        accounts: vec![],
        data: TRANSFER_DISCRIMINATOR.to_vec(),
    };
    invoke(&ix, &[ctx.accounts.token_program.to_account_info()])?;
    Ok(())
}
```

The single `require_keys_eq!` call is the load-bearing line. It fires before any CPI is opened, so an attacker-supplied `fake_token` never executes.

### (b) Idiomatic typed accounts (preferred for production)

Anchor's account type system closes both program-substitution and fake-SPL automatically, without a manual key check:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer, transfer};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    // Program<'info, Token> checks that token_program.key() == spl_token::ID
    // at deserialization time. Any other program id fails account validation
    // before your instruction body runs.
    pub token_program: Program<'info, Token>,

    // Account<'info, TokenAccount> checks owner == spl_token::ID — closes
    // the fake-SPL variant. The runtime-deserialized struct is only reached
    // if the owning program is the real token program.
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    // No explicit id check needed — Program<'info, Token> already pinned it.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: /* ... */,
            authority: ctx.accounts.payer.to_account_info(),
        },
    );
    transfer(cpi_ctx, amount)?;
    Ok(())
}
```

`Program<'info, Token>` enforces the program id at the framework level; `Account<'info, TokenAccount>` enforces the account owner. These are the canonical defenses; use them whenever the program type is known at compile time.

---

## 5. Safe pattern — native

Without Anchor, perform the same two checks manually before invoking:

```rust
use solana_program::{
    account_info::AccountInfo,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

// `spl_token` is the separate `spl-token` crate (add it to Cargo.toml) — it is
// NOT re-exported by solana_program. It provides `spl_token::ID` and the
// `spl_token::instruction` builders used below.
// Pinned to the canonical SPL Token program id.
const EXPECTED_TOKEN_PROGRAM: Pubkey = spl_token::ID;

#[repr(u32)]
enum VaultError {
    WrongTokenProgram = 6000,
    WrongTokenAccountOwner = 6001,
}

impl From<VaultError> for ProgramError {
    fn from(e: VaultError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn withdraw(
    token_program: &AccountInfo,
    token_account: &AccountInfo,
) -> Result<(), ProgramError> {
    // Program substitution guard: pin the callee.
    if *token_program.key != EXPECTED_TOKEN_PROGRAM {
        return Err(VaultError::WrongTokenProgram.into());
    }

    // Fake-SPL guard: confirm the account is owned by the real token program.
    if *token_account.owner != EXPECTED_TOKEN_PROGRAM {
        return Err(VaultError::WrongTokenAccountOwner.into());
    }

    // Both checks passed — safe to CPI.
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            token_account.key,
            /* destination, authority, signers, amount */
        )?,
        &[token_program.clone(), token_account.clone()],
    )
}
```

The pattern is a direct `==` comparison against a constant before the `invoke` call. Return a specific, actionable error code on mismatch so on-chain logs point directly at the rejection.

---

## 6. Proof — runnable PoC

The PoC is a self-contained LiteSVM test suite. It compiles four programs (`real_token`, `fake_token`, `vault_vulnerable`, `vault_fixed`) and drives them through three adversarial tests.

**Reproduce:**

```bash
cd poc/arbitrary-cpi && npm test
```

The three tests (`tests/arbitrary-cpi.test.ts`):

- **EXPLOIT — `vault_vulnerable accepts fake_token program substitution`.** Sends `withdraw` to `vault_vulnerable` with `fake_token` in the `token_program` slot. The transaction succeeds. The return data byte `0` equals `1`, proving that the attacker's `fake_token::transfer` executed and set `[1u8]` — not the real token program.

- **DEFENSE — `vault_fixed rejects fake_token program substitution`.** Same hostile setup, but against `vault_fixed`. The transaction fails and the logs contain `WrongTokenProgram`. The `require_keys_eq!` fired before any CPI was opened; `fake_token` never ran.

- **POSITIVE CONTROL — `vault_fixed accepts real_token`.** `vault_fixed` invoked with the honest `real_token`. The transaction succeeds and return data byte `0` equals `0` (the sentinel `real_token::transfer` sets). The id pin has no false positives on the legitimate path.

---

## 7. Relationship to other classes

### vs. CPI return-data spoofing

These are distinct controls at adjacent points in the CPI lifecycle:

- **Arbitrary CPI / program substitution (this document):** the attacker controls *which program executes* — the callee. The attack happens before or during the CPI.
- **Return-data spoofing (`cpi-return-data-spoofing.md`):** the callee has already run; the attacker controls *what bytes the consumer reads from the return-data slot*. The attack happens after the CPI returns.

Pinning the callee (the control described here) is labeled "defense-in-depth" in `cpi-return-data-spoofing.md` because it prevents a hostile program from executing at all, which in turn prevents it from writing attacker-controlled bytes into the return-data slot. But callee-pinning alone does not close the return-data hole: a stale slot value forwarded from a deeper CPI still carries that deeper program's producer id, and a consumer that reads `get_return_data()` without checking `producer` is still vulnerable even if the immediate callee was legitimate. The two controls are complementary: pin the callee to refuse hostile invocations; check the return-data producer to authenticate what you read. Cross-reference: `cpi-return-data-spoofing.md`.

### vs. existing Foundation coverage

The Solana Foundation `solana-dev-skill` `security.md` already covers arbitrary-CPI program substitution as a known class. This document is included here for completeness and because the runnable PoC (`poc/arbitrary-cpi/`) provides a concrete, locally-executable demonstration that the abstract description lacks.

The novel contribution of this skill set is the **CPI return-data spoofing** class documented in `cpi-return-data-spoofing.md` — a distinct and under-documented vulnerability that sits on top of arbitrary CPI. Do not attribute novelty to the program-substitution class covered here; it is a well-known category. The PoC adds execution evidence, not a new finding.

---

## See also

- `cpi-return-data-spoofing.md` — trusting the return-data slot without checking who produced it; the novel class in this skill set.
- `cpi-checklist.md` — consolidated CPI-safety review checklist.
- `poc-harness.md` — how the LiteSVM PoC harness loads programs and sends instructions.

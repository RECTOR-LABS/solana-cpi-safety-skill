# Account Reload After CPI

When a CPI mutates an on-chain account, the caller's already-deserialized in-memory copy does not update automatically. Any field read from that copy after the CPI returns is stale — it reflects the state that existed before the CPI executed. Acting on stale state leads to logic bugs, incorrect accounting, and in the worst case, double-spend or undetectable over-withdrawal.

---

## 1. What it is — the stale-account-after-CPI bug

Anchor (and native Rust programs) deserialize accounts into typed structs at the start of instruction processing. That deserialization reads the account's data buffer at a point in time. When a CPI later mutates the same account's on-chain data buffer, the already-deserialized Rust struct is not updated — it is a snapshot, not a live view.

The problem arises when the caller reads a field from the deserialized struct **after** the CPI has mutated that field on-chain:

```
instruction starts
  → deserialize account_x (reads balance = 1000)
  → CPI to program B, which deducts 200 from account_x (on-chain balance is now 800)
  → caller reads account_x.balance     ← returns 1000, not 800
  → accounting logic acts on 1000      ← stale, incorrect
```

The on-chain data buffer was mutated by the callee, but the caller's Rust struct still holds the pre-CPI snapshot. The discrepancy is silent — no error is raised; the stale value is returned as if it were current.

### The mutable-account aliasing case

A related variant occurs when the same account is passed to both the caller and the callee in the same CPI — the callee slot and the caller's own account list point to the same `AccountInfo`. Solana's runtime allows this; the callee can mutate the shared account's data and lamports in place. The caller's deserialized struct is still stale for exactly the same reason: it was a copy made before the CPI ran. If the caller reads its deserialized fields after the CPI without reloading, it reads pre-mutation values even though the underlying `AccountInfo` data buffer now reflects the post-mutation state.

---

## 2. Why it is exploitable

The stale-read window creates a gap between the state the program reasons about and the state that actually exists on-chain. An attacker or an incorrect design can exploit this in several ways.

**Incorrect accounting after a transfer.** A lending program reads a vault's token balance into a local struct, issues a CPI to the token program to transfer tokens out of the vault, then reads the same struct's balance to compute a new exchange rate or a fee. The balance it reads is the pre-transfer value. Any fee, rate, or cap computed from it is wrong. If the program uses the stale balance as a floor for a subsequent withdrawal guard, an attacker who arranges the transfer can bypass the guard.

**Double-spend via re-entrancy-adjacent paths.** A program CPIs a redemption, then reads the redeemed-amount field from the stale struct to decide how much to mint. Because the struct still shows the pre-redemption balance, the program may over-mint or issue a second redemption against a balance that no longer exists on-chain.

**Check passes against outdated data.** An authorization or sanity check — "is the vault balance still above the minimum?" — passes because it reads the stale, pre-CPI value, while the on-chain balance has already fallen below the minimum due to the CPI's effect.

The common thread: any invariant the caller enforces on a deserialized struct after a CPI is only as strong as the reload step that precedes it.

---

## 3. Detection heuristics

Grep for CPI calls and look for account field reads that follow them without an intervening reload.

```bash
# All invoke sites (native)
rg -n 'invoke\s*\(|invoke_signed\s*\(' --type rust

# All Anchor CPI dispatch sites
rg -n 'CpiContext::new|CpiContext::new_with_signer' --type rust

# Reload calls that DO exist — confirm coverage against each CPI site
rg -n '\.reload\(\)' --type rust
```

Flag a finding when any of the following hold:

- **A field of a deserialized struct (e.g. `ctx.accounts.vault.balance`) is read after an `invoke` or `CpiContext`-dispatched CPI with no intervening `.reload()?` call on that account.** The read can be direct (field access) or indirect (passing the struct to a helper that reads it).
- **An `Account<T>` is used on both sides of a CPI boundary.** The same account is accessed before the CPI to prepare data and after the CPI to make decisions, without a reload between them.
- **The same account appears in both the caller's `Accounts` struct and in the `account_infos` slice passed to `invoke`.** This is the aliasing case; the callee may mutate the account's data in place, and the caller's deserialized copy is not updated.
- **A post-CPI check (balance floor, debt ceiling, authorization predicate) reads account fields from the original deserialized struct.** These checks are invalidated by any CPI that mutates those fields.

The absence of `.reload()` between a CPI dispatch and any subsequent field read on the mutated account is the canonical signature.

---

## 4. Safe pattern — Anchor

Anchor's `AccountLoader` and `Account<T>` types both expose a `.reload()?` method. Call it on every account that the CPI may have mutated, before reading any fields from it.

**Vulnerable — stale read after CPI:**

```rust
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // Deserialized at instruction entry; vault.balance = 1000 at this point.
    let pre_balance = ctx.accounts.vault.balance;

    // CPI to token program — transfers `amount` out of vault.
    // On-chain vault balance is now 1000 - amount.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from:      ctx.accounts.vault_token.to_account_info(),
            to:        ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount)?;

    // BUG: ctx.accounts.vault is still the pre-CPI snapshot.
    // post_balance reflects the state BEFORE the transfer, not after.
    let post_balance = ctx.accounts.vault.balance;  // stale — reads 1000, not 1000 - amount
    require!(post_balance >= MIN_RESERVE, ErrorCode::BelowMinimum);

    Ok(())
}
```

**Fixed — reload before any post-CPI read:**

```rust
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // CPI to token program — transfers `amount` out of vault.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from:      ctx.accounts.vault_token.to_account_info(),
            to:        ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount)?;

    // FIX: re-read the account's data from the on-chain buffer before
    // accessing any fields. This updates the in-memory struct to reflect
    // whatever the CPI wrote, including mutations by the callee.
    ctx.accounts.vault.reload()?;

    // Now post_balance reflects the actual on-chain state post-CPI.
    let post_balance = ctx.accounts.vault.balance;
    require!(post_balance >= MIN_RESERVE, ErrorCode::BelowMinimum);

    Ok(())
}
```

The single `ctx.accounts.vault.reload()?` line is the load-bearing fix. It re-reads the account's data buffer from its `AccountInfo` and re-populates the typed struct. Every field access after the reload observes post-CPI state.

**When multiple accounts are mutated by the CPI**, reload each one before reading it:

```rust
ctx.accounts.vault.reload()?;
ctx.accounts.collateral.reload()?;
```

---

## 5. Safe pattern — native

In native programs (including Pinocchio), a deserialized struct is a Rust copy of the account's data buffer at the time of deserialization — it has no live link to the underlying `AccountInfo`. After a CPI that mutates the account, re-borrow the account's data and re-deserialize to observe the mutation.

**Vulnerable:**

```rust
// Deserialized before the CPI.
let vault_state = VaultState::try_from_slice(&vault_account.data.borrow())?;
let pre_balance = vault_state.balance;  // snapshot

// CPI that mutates vault_account's on-chain data.
invoke(&transfer_ix, &[vault_account.clone(), destination.clone(), token_program.clone()])?;

// BUG: vault_state is still the pre-CPI copy.
// post_balance is the same value as pre_balance.
let post_balance = vault_state.balance;  // stale
```

**Fixed — re-borrow and re-deserialize after the CPI:**

```rust
// CPI that mutates vault_account's on-chain data.
invoke(&transfer_ix, &[vault_account.clone(), destination.clone(), token_program.clone()])?;

// FIX: re-borrow the data buffer from the AccountInfo and re-deserialize.
// try_borrow_data() returns the current on-chain bytes, not the pre-CPI snapshot.
let vault_data = vault_account.try_borrow_data()?;
let vault_state = VaultState::try_from_slice(&vault_data)?;
drop(vault_data);  // release the borrow before any subsequent mutation

// Now vault_state.balance reflects the post-CPI on-chain state.
let post_balance = vault_state.balance;
require!(post_balance >= MIN_RESERVE, ProgramError::Custom(ErrCode::BelowMinimum as u32));
```

**Key points for the native pattern:**

- `try_borrow_data()` returns the `AccountInfo`'s current data buffer. Calling it after the CPI gives you the bytes the callee wrote, not the bytes you read at instruction entry.
- Release the borrow (`drop(vault_data)`) before any code that needs to mutate the account, to avoid a double-borrow panic.
- Do not cache an old `Ref<[u8]>` or `Rc<RefCell<&mut [u8]>>` across a CPI boundary — it holds a reference to the pre-mutation bytes and will not see the callee's writes even if the `AccountInfo` is the same object.
- For the aliasing case (same `AccountInfo` passed to caller and callee slots), the `AccountInfo`'s internal `RefCell` is updated in place by the callee, so the re-borrow approach correctly reflects the mutation. The deserialized struct, however, is still stale and must be discarded.

---

## 6. Relationship and cross-references

This class is about **temporal correctness** — the caller's view of account state diverges from on-chain state across a CPI boundary. It is distinct from but related to the other CPI-safety classes in this skill:

- **`arbitrary-cpi.md`** — concerns *which program* executes during the CPI. A properly identified callee can still mutate shared accounts, making reload necessary. Pinning the callee id (the control in `arbitrary-cpi.md`) does not eliminate the stale-read risk on accounts the legitimate callee modifies.
- **`cpi-return-data-spoofing.md`** — concerns *what bytes the callee returned*. A consumer that reads stale account state after a CPI compounds any return-data risk: if the callee both mutates an account and sets return data, trusting the stale account fields (this class) or trusting the unverified return data (the spoofing class) are two separate failure modes, either of which is sufficient for exploitation.

A runnable PoC ships in `poc/account-reload/`: a `ledger` program owns a `Vault` PDA, and a consumer CPIs `ledger.withdraw` then runs a solvency check. The LiteSVM suite proves all three cases — EXPLOIT (the vulnerable consumer checks the pre-CPI balance snapshot, so a fully drained vault passes the check), DEFENSE (the fixed consumer re-reads after the CPI — the `reload()` lesson — and rejects it with `Insolvent`), and POSITIVE CONTROL (a partial withdrawal that stays solvent is accepted). Run it with `cd poc/account-reload && npm test`.

---

## See also

- `arbitrary-cpi.md` — pinning the program invoked during CPI; complementary to the reload discipline.
- `cpi-return-data-spoofing.md` — authenticating the producer of CPI return data; a related post-CPI trust failure.
- `cpi-checklist.md` — consolidated CPI-safety review checklist.
- `poc-harness.md` — the LiteSVM harness used by `poc/account-reload/` and the other PoC suites.

# CPI Return-Data Spoofing

A consumer program CPIs an oracle (or any callee), reads the CPI's return data, and acts on the bytes without verifying *which program produced them*. Because Solana's return-data slot is a single shared resource and `get_return_data()` hands you the producer's id for free, skipping that check lets an attacker substitute a malicious program whose forged bytes the consumer adopts as authentic. This is the crown-jewel finding of this skill; the runnable PoC in `poc/return-data-spoofing/` proves the exploit, the fix, and a positive control end to end.

---

## 1. What it is — return-data syscall semantics

Solana gives an instruction one scratch buffer for passing bytes back up a CPI edge. Two syscalls touch it:

- `sol_set_return_data` — exposed in Rust as `set_return_data(&[u8])`. It sets the return data **for the currently-executing program**. The runtime records both the bytes *and* the id of the program that set them.
- `sol_get_return_data` — exposed as `get_return_data() -> Option<(Pubkey, Vec<u8>)>`. It returns the most recently set bytes **together with the `Pubkey` of the program that set them**. `None` means nothing has been set yet in this instruction.

Three properties make this slot a security primitive, not just a convenience:

1. **It is a single per-transaction-instruction resource.** There is exactly one slot for the whole instruction (one top-level instruction and the entire CPI tree beneath it). It reflects the **most recent** setter, not a per-callee mailbox. Every `set_return_data` call overwrites whatever was there.
2. **The producer `Pubkey` is set by the runtime, not the caller.** When program X calls `set_return_data`, the runtime stamps X's id onto the slot. A caller cannot forge that id by passing a different account, relabeling an account, or rearranging `account_infos`. The id always equals the program that actually executed the syscall.
3. **The bytes are fully attacker-controllable if an attacker controls the producing program.** `set_return_data` accepts arbitrary bytes; there is no schema, no signature, no length contract. Trust must come from *who* set the data, never from the shape of the data.

> **The load-bearing invariant:** the producer `Pubkey` from `get_return_data()` is the runtime's authenticated answer to "who set this?" The entire defense reduces to verifying `producer == the program you intended to read from`. Everything else in this document is a corollary of that one sentence.

---

## 2. Why it's exploitable — trusting `data` without checking `program_id`

The vulnerability is the gap between the two halves of the returned tuple. `get_return_data()` returns `(producer, data)`. A correct consumer treats `data` as untrusted until `producer` is checked. A vulnerable consumer reads `data` and throws `producer` away.

There are two distinct ways an attacker turns that gap into a price (or any value) of their choosing.

**Variant A — program substitution (what the PoC proves, the common live form).**
The consumer builds a CPI whose `program_id` comes from a *caller-supplied account* (e.g. an `oracle_program` passed in the instruction's account list), invokes it, reads `get_return_data()`, and trusts the bytes. The attacker simply passes their own program in that account slot. Their program implements the same instruction interface (same discriminator) as the honest oracle but calls `set_return_data(&spoofed)`. The runtime faithfully stamps the *attacker's* id as the producer — and the consumer never looks. In the PoC, the honest oracle quotes `50_000`; the attacker's `quote` returns `1`; the vulnerable consumer adopts `1` and re-emits it as truth. In a lending or AMM context, a price of `1` (or `u64::MAX`) is a drained pool.

**Variant B — stale-slot read (a subtler, related risk).**
The return-data slot is one shared buffer per top-level instruction. The runtime clears it to empty (stamped with the callee's id) at the *start* of every CPI, but does **not** clear it when a CPI *returns*. So a consumer can read bytes its immediate callee never set: if the consumer calls program B, and B internally CPIs a deeper program D that calls `set_return_data`, then B returns without setting its own, the slot still holds `(D, D's bytes)` and the consumer attributes them to B. (If the immediate callee sets nothing and made no deeper setting CPI, the entry-clear leaves the slot empty and `get_return_data()` returns `None` — handle that; never treat it as a value.) The producer check still authenticates the source: an attacker deeper in the tree reports a producer that is not `EXPECTED_ORACLE` and is rejected. The residual issue is *freshness*, not authenticity — if your trusted oracle can itself be invoked deeper, the producer can equal `EXPECTED_ORACLE` while the bytes belong to a different logical call; when reachable, also bind the data to this call (clear the slot immediately before the trusted CPI, require non-empty after). The PoC demonstrates Variant A directly; Variant B is the reason the producer check is mandatory even when you pin the callee.

**Tie to the real finding.** This class is not theoretical. A live instance of exactly this bug was reported and fixed as **Anchor CPI return-data spoofing, CVSS 7.5, fixed upstream, placing 1st of 116 across a 14-protocol audit.** The lesson generalizes: any program that consumes CPI return data without authenticating the producer is exposed, regardless of how reputable the program it *intended* to call.

Why it is so easy to ship: `get_return_data()` returns the producer in the same tuple as the data, so ignoring it is a one-character omission (`let (_producer, bytes) = ...`). The code compiles, the happy path passes every test against the honest oracle, and the hole is invisible until an attacker supplies a hostile producer. Tests that only exercise the legitimate oracle will never catch it — which is precisely why the PoC includes an adversarial test, not just a positive control.

---

## 3. Detection heuristics

Grep the codebase for return-data reads and confirm each one is immediately followed by a producer comparison.

```bash
# Every return-data read site. Each hit must have an adjacent producer check.
rg -n 'get_return_data|sol_get_return_data' --type rust

# Reads whose producer is bound to a throwaway — strong smell.
rg -n 'let\s*\(\s*_+\s*,' --type rust | rg 'get_return_data'

# Confirm a producer comparison exists somewhere near each read.
rg -n 'require_keys_eq!|assert_keys_eq!|==\s*EXPECTED|producer\s*==' --type rust
```

Flag a finding when any of these hold:

- **`get_return_data()` / `sol_get_return_data` is used without an adjacent producer comparison** — no `require_keys_eq!` on the returned `Pubkey`, no `==` against an expected program id. The producer being bound to `_` (or destructured and never read) is the canonical signature.
- **Return data is read after `invoke` / `invoke_signed` to a caller-supplied program account** — i.e. the invoked `program_id` traces back to an `UncheckedAccount`, an `AccountInfo` from `ctx.remaining_accounts`, or any account whose key is not pinned to a constant. This is Variant A's fingerprint: untrusted callee feeding an unchecked return-data read.
- **The expected producer is derived from the same untrusted input as the callee** (e.g. "check `producer == oracle_program.key()`" where `oracle_program` is itself attacker-supplied). That check is circular and provides no protection — the attacker's program passes its own id check trivially. The comparison must be against a *pinned constant or governance-controlled* key, never against the account the attacker chose.
- **A return-data read with no `None` / `Option` handling** — `get_return_data().unwrap()` next to a missing producer check usually means the author treated the slot as trusted scratch space.

A clean read site looks like: destructure both fields, compare the producer to a constant, *then* parse the bytes. Anything that parses the bytes before (or instead of) comparing the producer is a finding.

---

## 4. The safe pattern (Anchor)

The fix is to read the producer the runtime gave you and require it to equal a **pinned** expected program id before parsing a single byte. This diff is lifted verbatim from the PoC — `consumer-vulnerable` versus `consumer-fixed`.

**Vulnerable** (`poc/return-data-spoofing/programs/consumer-vulnerable/src/lib.rs`):

```rust
invoke(&ix, &[ctx.accounts.oracle_program.to_account_info()])?;

// BUG: the producer field from get_return_data() is ignored entirely.
// Any program that set return data during this CPI will be trusted.
let (_producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;
let price = u64::from_le_bytes(
    bytes.get(..8).ok_or(error!(Err::BadData))?
        .try_into().map_err(|_| error!(Err::BadData))?,
);
```

**Fixed** (`poc/return-data-spoofing/programs/consumer-fixed/src/lib.rs`):

```rust
// The only oracle program whose return data this consumer will accept.
pub const EXPECTED_ORACLE: Pubkey = pubkey!("CyhyMsDRy72WbGMsfrYqzoPWX1UT7RQQ5PBqE65sN4Q7");

invoke(&ix, &[ctx.accounts.oracle_program.to_account_info()])?;

let (producer, bytes) = get_return_data().ok_or(error!(Err::NoReturnData))?;

// LOAD-BEARING FIX: confirm the runtime-reported producer is the trusted
// oracle. This is the check that actually closes return-data spoofing — the
// producer id is stamped by the runtime and cannot be forged by the caller,
// so a substituted or stale value fails here.
require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer);
// DEFENSE-IN-DEPTH: also confirm the account the caller passed is the trusted
// oracle. A distinct error (UntrustedCallee) keeps this separable from the
// producer check above, so the DEFENSE test can prove the producer check is
// what rejects a spoofed value. This is the arbitrary-CPI control (see
// arbitrary-cpi.md); for true fail-fast, pin the callee before `invoke`.
require_keys_eq!(
    ctx.accounts.oracle_program.key(),
    EXPECTED_ORACLE,
    Err::UntrustedCallee
);

let price = u64::from_le_bytes(
    bytes.get(..8).ok_or(error!(Err::BadData))?
        .try_into().map_err(|_| error!(Err::BadData))?,
);
```

**The producer check is the load-bearing line.** `require_keys_eq!(producer, EXPECTED_ORACLE, ...)` is what makes the bytes trustworthy, because the producer id is the runtime's unforgeable answer to "who set this data?" If you keep exactly one defensive line from this section, keep that one. It defeats substitution (Variant A) outright — a hostile callee reports a producer that is not `EXPECTED_ORACLE`. It also rejects a stale value surfaced from a deeper CPI (Variant B) whenever that value's producer is not `EXPECTED_ORACLE`. The one case it does not cover alone is a *freshness* gap — a stale value whose producer genuinely is `EXPECTED_ORACLE` (the trusted oracle invoked deeper in the tree); bind the data to this call if that is reachable. For the substitution class this skill targets, the producer check is the sufficient, load-bearing defense.

**On the second `require_keys_eq!` (pin the callee) — complementary, not a substitute.** Requiring `oracle_program.key() == EXPECTED_ORACLE` ensures you never even open a CPI to an attacker-chosen program; it fails fast and shrinks the attack surface. But pinning the callee alone does **not** close the return-data hole — that is the *arbitrary-CPI* control (see `arbitrary-cpi.md`), a different invariant. A program can be the right callee yet the slot still hold a value some *other* program set (Variant B), and not every consumer pins its callee. The producer check is the one that authenticates the *source of the bytes you read*. Use both: pin the callee to refuse hostile invocations, and check the producer to authenticate the data. Together they are belt and suspenders; the producer check is the belt.

Two further notes:

- **Pin against a constant, never against the supplied account.** `EXPECTED_ORACLE` is a `const Pubkey` (or, in production, a key held in a governance/config account). Comparing `producer` to `oracle_program.key()` when `oracle_program` is caller-supplied is circular and worthless — the attacker's program passes its own id.
- **Handle `None`.** `get_return_data()` returning `None` means nothing was set this instruction. `.ok_or(error!(Err::NoReturnData))?` turns that into a clean failure instead of a panic or a silent default.

---

## 5. The safe pattern (native / Pinocchio)

Without Anchor's macros the semantics are identical: `get_return_data()` (the safe wrapper over the `sol_get_return_data` syscall) returns `Option<(Pubkey, Vec<u8>)>`; you compare the `Pubkey` to your expected program with `==` and bail with a custom `ProgramError` on mismatch. **Pinocchio reads return data through the same `sol_get_return_data` syscall surface** — there is no separate mechanism and no separate trust model. The pattern is the same in every framework: read the `(Pubkey, data)` pair, verify the producer, then parse.

```rust
use solana_program::program::get_return_data;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

// Pinned expected producer — a constant or a key read from a config/governance account,
// never an account the caller supplied.
const EXPECTED_ORACLE: Pubkey = solana_program::pubkey!(
    "CyhyMsDRy72WbGMsfrYqzoPWX1UT7RQQ5PBqE65sN4Q7"
);

// Optional but recommended: a dedicated error code so callers can distinguish this failure.
#[repr(u32)]
enum OracleError {
    NoReturnData = 6000,
    UntrustedProducer = 6001,
    BadData = 6002,
}

impl From<OracleError> for ProgramError {
    fn from(e: OracleError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn read_trusted_price() -> Result<u64, ProgramError> {
    // sol_get_return_data via the safe wrapper: (producer, bytes) or None.
    let (producer, bytes) =
        get_return_data().ok_or(OracleError::NoReturnData)?;

    // LOAD-BEARING: the runtime-stamped producer must equal the pinned oracle.
    // The caller cannot forge `producer`; this is what authenticates `bytes`.
    if producer != EXPECTED_ORACLE {
        return Err(OracleError::UntrustedProducer.into());
    }

    // Only now is it safe to parse the attacker-irrelevant bytes.
    let raw: [u8; 8] = bytes
        .get(..8)
        .ok_or(OracleError::BadData)?
        .try_into()
        .map_err(|_| OracleError::BadData)?;
    Ok(u64::from_le_bytes(raw))
}
```

The `if producer != EXPECTED_ORACLE { return Err(...) }` is the exact native counterpart of Anchor's `require_keys_eq!(producer, EXPECTED_ORACLE, Err::UntrustedProducer)`. As with Anchor, **also** pin the program id you pass to the syscall that performs the `invoke` (the arbitrary-CPI control in `arbitrary-cpi.md`) — complementary defense-in-depth, not a replacement for the producer check.

In a pure **Pinocchio** program the accessor is `pinocchio::cpi::get_return_data() -> Option<ReturnData>` (enable the crate's `cpi` feature). Read `ReturnData::program_id()` (a `&pinocchio::Address`) and `ReturnData::as_slice()`, then apply the identical producer comparison before parsing the bytes:

```rust
// Pinocchio: pinocchio = { version = "0.10", features = ["cpi"] }
let return_data = pinocchio::cpi::get_return_data().ok_or(ProgramError::Custom(ERR_NO_RETURN_DATA))?;
// LOAD-BEARING: the runtime stamps the producer; the caller cannot forge it.
if return_data.program_id() != &TRUSTED_ORACLE {
    return Err(ProgramError::Custom(ERR_UNTRUSTED_PRODUCER));
}
let price = u64::from_le_bytes(return_data.as_slice().get(..8).ok_or(/* ... */)?.try_into()?);
```

There is no separate mechanism and no separate trust model — the trust boundary never moves: authenticate the producer, then read the bytes. A runnable Pinocchio version of this exact exploit and fix lives in `poc/pinocchio-return-data/` (see section 6).

---

## 6. Proof — runnable PoC

The PoC is a self-contained LiteSVM test suite. It compiles four real programs (honest `price_oracle`, malicious `attacker_oracle`, `consumer_vulnerable`, `consumer_fixed`) and drives them through three tests that pin down the exploit, the fix, and the absence of a false positive.

**Reproduce:**

```bash
cd poc/return-data-spoofing && npm test
```

The three tests (`tests/return-data-spoofing.test.ts`):

- **EXPLOIT — `vulnerable consumer trusts spoofed return data`.** Sends `consume_price` to `consumer_vulnerable` with `attacker_oracle` in the `oracle_program` slot. The attacker's `quote` calls `set_return_data(&1u64...)`. The transaction **succeeds** and the vulnerable consumer re-emits `1n` as its own return data — it adopted the spoofed price. This is the attack landing: a value of `1` where the honest oracle would have said `50_000`.

- **DEFENSE — `fixed consumer rejects attacker oracle`.** Same hostile setup, but against `consumer_fixed`. The transaction **fails**, and the logs contain `UntrustedProducer`. The `require_keys_eq!(producer, EXPECTED_ORACLE, ...)` fires because the runtime stamped the *attacker's* id as the producer, not `EXPECTED_ORACLE`. The spoof is rejected before any price is trusted.

- **POSITIVE CONTROL — `fixed consumer accepts legitimate oracle`.** `consumer_fixed` invoked with the honest `price_oracle`. The transaction **succeeds** and emits `50_000n`. This proves the fix is not a blunt "reject everything" — it accepts the genuine producer and adopts the real price, so the producer check has no false positives on the legitimate path.

Read together, the three tests are the whole argument: the bug is real (EXPLOIT lands), the producer check stops it (DEFENSE rejects with `UntrustedProducer`), and the check does not break legitimate use (POSITIVE CONTROL still quotes `50_000`). The honest oracle's `50_000` and the attacker's `1` are the two needles; the producer id is the only thread that tells them apart.

### Pinocchio proof

`poc/pinocchio-return-data/` is the same exploit and fix written against raw Pinocchio (`pinocchio::cpi::{invoke, get_return_data, set_return_data}`, `AccountView`, `Address`) and built with `cargo-build-sbf` rather than Anchor. A single `consumer` program exposes both paths via a one-byte instruction discriminator — byte `0` is the unchecked (vulnerable) path, byte `1` adds the producer check — so the only difference under test is the `if return_data.program_id() != &TRUSTED_ORACLE` guard.

```bash
cd poc/pinocchio-return-data && npm test
```

Its three tests mirror the Anchor proof: EXPLOIT (byte `0` + `attacker_oracle`) adopts the spoofed `1`; DEFENSE (byte `1` + `attacker_oracle`) fails with `UntrustedProducer`; POSITIVE CONTROL (byte `1` + the trusted `oracle`) adopts `50_000`. The defense is framework-independent: the runtime-stamped producer id is the load-bearing authentication in native, Anchor, and Pinocchio alike.

---

## See also

- `arbitrary-cpi.md` — pinning the program you invoke (the callee), the complementary control referenced throughout this document.
- `cpi-checklist.md` — the consolidated CPI-safety review checklist.
- `poc-harness.md` — how the LiteSVM PoC harness loads programs and sends instructions.

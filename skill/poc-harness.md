# PoC Harness

This document explains how to build and run the runnable proof-of-concept scenarios under `poc/`, how the shared test harness helpers work, and how to extend the setup with a new scenario.

---

## 1. Prerequisites

| Tool | Required | Version used |
|------|----------|--------------|
| Anchor | 1.0.2 | 1.0.2 (pinned in `Anchor.toml`) |
| Solana / Agave CLI | 3.x | 3.0.13 |
| Rust toolchain | 1.85+ | 1.94 |
| Node | >= 20 | 24 |

Install Anchor via `avm`:

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 1.0.2
avm use 1.0.2
```

Each scenario workspace pins the Anchor version in its `Anchor.toml`:

```toml
anchor_version = "1.0.2"
```

---

## 2. Kit-only warning — do not follow web3.js LiteSVM examples

**The `litesvm` npm package is `@solana/kit`-only since v1.0.** The tests in this repo use `litesvm` 1.1.0 with `@solana/kit` 6.10.0.

Do NOT follow the Anchor documentation's TypeScript examples or Blueshift's LiteSVM TypeScript examples. Those examples show the old `@solana/web3.js` API — they will not compile against `litesvm` >= 1.0. The `@solana/web3.js` `Transaction`, `TransactionInstruction`, and `Keypair` types do not exist in this harness.

Instructions in the test files are plain `@solana/kit` `Instruction` literals (an object with `programAddress`, `accounts`, and `data` fields). Build them by hand or with any `@solana/kit`-compatible helper — never import from `@solana/web3.js`.

---

## 3. Build steps

Run these commands from the scenario directory (e.g. `poc/return-data-spoofing/`):

```bash
cd poc/<scenario>
anchor build            # first pass — produces the program keypairs
anchor keys sync        # syncs declare_id! in src/lib.rs + Anchor.toml to the keypairs
anchor build            # second pass — compiles with the synced program ids
```

The `anchor keys sync` step is required once per fresh workspace. It writes the keypair-derived program addresses into `declare_id!` macros and `Anchor.toml`. The second `anchor build` picks up those synced ids so the compiled `.so` matches the keypair.

After a successful build, compiled programs are at:

```
target/deploy/<program-name>.so
target/deploy/<program-name>-keypair.json
```

**Troubleshooting — `edition2024` error during cargo:** Always build with `anchor build`, not with `cargo build-sbf` directly. The Anchor CLI selects the correct Solana platform-tools toolchain. Running `cargo build-sbf` directly may fail with an `edition2024` error because the platform-tools bundle ships an older cargo that does not support that edition.

---

## 4. Run steps

From the scenario directory:

```bash
npm install   # install litesvm, @solana/kit, tsx, etc.
npm test      # runs: node --import tsx --test --test-concurrency=1 'tests/**/*.test.ts'
```

The test runner is Node's built-in test runner invoked with `tsx` for TypeScript transpilation. No Jest, no Mocha.

---

## 5. CWD-relative `.so` loading

`LiteSVM.addProgramFromFile` resolves the `.so` path relative to the **current working directory** at the time the function is called. Always run `npm test` from the scenario directory (e.g. `poc/return-data-spoofing/`), not from the repo root. If you run tests from a different directory the `.so` paths in the test file will not resolve and the test will fail with a file-not-found error.

---

## 6. Harness API reference

All helpers live in `tests/harness.ts` and are re-exported from there. Import them directly in test files:

```typescript
import { anchorDiscriminator, programAddress, loadProgram, sendIx, SOL,
         LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "./harness.js";
```

### `anchorDiscriminator(ixName: string): Uint8Array`

Returns the first 8 bytes of `sha256("global:" + ixName)`. This is the Anchor instruction discriminator. Use it as the leading 8 bytes of the instruction `data` buffer when building a `@solana/kit` `Instruction` literal that targets an Anchor program.

```typescript
const data = new Uint8Array([...anchorDiscriminator("consume_price")]);
```

### `programAddress(keypairPath: string): Promise<Address>`

Reads a `target/deploy/<name>-keypair.json` (a JSON array of 64 raw bytes), derives a `@solana/kit` `Address` from it, and returns that address. Use this to get a program's on-chain id before loading it.

### `loadProgram(svm: LiteSVM, keypairPath: string, soPath: string): Promise<Address>`

Reads the keypair at `keypairPath`, derives the program address, calls `svm.addProgramFromFile(address, soPath)`, and returns the address. This is the single call that makes a compiled `.so` available in the LiteSVM instance.

```typescript
const svm = new LiteSVM();
const oracleId = await loadProgram(
  svm,
  "target/deploy/price_oracle-keypair.json",
  "target/deploy/price_oracle.so",
);
```

### `sendIx(svm: LiteSVM, payer: TransactionSigner, ix: Instruction): Promise<TransactionMetadata | FailedTransactionMetadata>`

Builds a versioned transaction containing the single instruction `ix`, signs it with `payer`, sets a blockhash from the LiteSVM instance, and submits it. Returns either a `TransactionMetadata` (success) or `FailedTransactionMetadata` (failure). This function **never throws** on transaction failure — the failure is encoded in the return type. Detect failure with `instanceof`:

```typescript
const result = await sendIx(svm, payer, ix);
if (result instanceof FailedTransactionMetadata) {
  console.error(result.err);
}
```

### `SOL`

A `bigint` constant equal to `1_000_000_000n` (one SOL in lamports). Use it when crediting the payer account:

```typescript
svm.airdrop(payer.address, 5n * SOL);
```

---

## 7. Reading return data after `sendIx`

`TransactionMetadata` exposes a `returnData()` method. Two conditions must both hold before calling it:

1. **Assert `result instanceof TransactionMetadata`** — calling `returnData()` on a `FailedTransactionMetadata` is a type error and will throw at runtime.
2. **The instruction must have actually called `set_return_data`** — if the program returned without setting return data, `returnData()` yields empty bytes, not `null`. An empty byte slice is not an error, but treating it as a valid price (or any other value) is a logic bug. Guard against the empty case after checking the producer.

```typescript
assert(result instanceof TransactionMetadata);
const raw = result.returnData();  // Uint8Array — empty if no return data was set
```

---

## 8. Extending with a new scenario

To add a new CPI vulnerability scenario:

1. Create a new Anchor workspace at `poc/<name>/` mirroring the structure of `poc/return-data-spoofing/`:
   - `programs/<program-name>/src/lib.rs` — one Anchor program per subdirectory
   - `tests/<scenario>.test.ts` — the test file
   - `tests/harness.ts` — copy from `poc/return-data-spoofing/tests/harness.ts`
   - `package.json` — same `scripts.test` and same devDependency set (`litesvm`, `@solana/kit`, `tsx`, `typescript`, `@types/node`)
   - `tsconfig.json` — copy from the existing scenario
   - `Anchor.toml` — workspace manifest with `anchor_version = "1.0.2"`

2. Write at minimum three programs:
   - A **vulnerable** consumer (the bug)
   - A **fixed** consumer (the mitigation)
   - An **attacker** or **honest** counterpart (to exercise both paths)

3. Write at minimum three tests (following the pattern in `poc/return-data-spoofing/tests/return-data-spoofing.test.ts`):
   - **EXPLOIT** — the attack succeeds against the vulnerable program
   - **DEFENSE** — the attack is rejected by the fixed program
   - **POSITIVE CONTROL** — the legitimate happy path still works on the fixed program

4. Build and run:
   ```bash
   cd poc/<name>
   anchor build && anchor keys sync && anchor build
   npm install && npm test
   ```

All three tests must pass before considering the scenario complete.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSigner,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import {
  LiteSVM,
  TransactionMetadata,
  FailedTransactionMetadata,
  anchorDiscriminator,
  loadProgram,
  sendIx,
  lamports,
  SOL,
} from "./harness.js";

const D = "target/deploy";
const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;

/** discriminator followed by u64 little-endian args */
function ixData(disc: Uint8Array, ...args: bigint[]): Uint8Array {
  const out = new Uint8Array(disc.length + args.length * 8);
  out.set(disc, 0);
  const view = new DataView(out.buffer);
  args.forEach((a, i) => view.setBigUint64(disc.length + i * 8, a, true));
  return out;
}

function decodeU64LE(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, true);
}

async function setup(initialBalance: bigint) {
  const svm = new LiteSVM();
  const ledger = await loadProgram(svm, `${D}/ledger-keypair.json`, `${D}/ledger.so`);
  const vuln = await loadProgram(
    svm,
    `${D}/consumer_vulnerable-keypair.json`,
    `${D}/consumer_vulnerable.so`,
  );
  const fixed = await loadProgram(
    svm,
    `${D}/consumer_fixed-keypair.json`,
    `${D}/consumer_fixed.so`,
  );
  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(SOL));

  const [vault] = await getProgramDerivedAddress({
    programAddress: ledger,
    seeds: [new TextEncoder().encode("vault")],
  });

  // Create the vault PDA with the starting balance.
  const init = await sendIx(svm, payer, {
    programAddress: ledger,
    accounts: [
      { address: vault, role: 1 /* WRITABLE */ },
      { address: payer.address, role: 3 /* WRITABLE_SIGNER */ },
      { address: SYSTEM_PROGRAM, role: 0 /* READONLY */ },
    ],
    data: ixData(anchorDiscriminator("initialize"), initialBalance),
  });
  assert.ok(
    init instanceof TransactionMetadata,
    `vault init failed: ${init instanceof FailedTransactionMetadata ? init.meta().logs().join("\n") : String(init)}`,
  );
  return { svm, ledger, vuln, fixed, payer, vault };
}

function processIx(
  consumer: Address,
  vault: Address,
  ledger: Address,
  payerAddress: Address,
  amount: bigint,
  min: bigint,
) {
  return {
    programAddress: consumer,
    accounts: [
      { address: vault, role: 1 /* WRITABLE */ },
      { address: ledger, role: 0 /* READONLY */ },
      { address: payerAddress, role: 3 /* WRITABLE_SIGNER */ },
    ],
    data: ixData(anchorDiscriminator("process"), amount, min),
  };
}

test("EXPLOIT: vulnerable solvency check passes on a drained vault (stale read)", async () => {
  const { svm, ledger, vuln, payer, vault } = await setup(1_000n);
  // Withdraw the entire balance, then require >= 100. The live balance is 0, but
  // the vulnerable consumer checks the pre-CPI snapshot (1000) and passes.
  const result = await sendIx(svm, payer, processIx(vuln, vault, ledger, payer.address, 1_000n, 100n));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  const checked = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    checked,
    1_000n,
    `vulnerable checked stale balance ${checked}, expected pre-withdraw snapshot 1000`,
  );
});

test("DEFENSE: fixed consumer rejects the drained vault (reload)", async () => {
  const { svm, ledger, fixed, payer, vault } = await setup(1_000n);
  const result = await sendIx(svm, payer, processIx(fixed, vault, ledger, payer.address, 1_000n, 100n));

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense), got success - the fix did not catch the drain`,
  );
  const logs = result.meta().logs().join("\n");
  assert.match(logs, /Insolvent/, `expected Insolvent in logs, got:\n${logs}`);
});

test("POSITIVE CONTROL: fixed consumer accepts a withdrawal that stays solvent", async () => {
  const { svm, ledger, fixed, payer, vault } = await setup(1_000n);
  // Withdraw 500 of 1000, require >= 100. Live balance 500 >= 100 -> passes.
  const result = await sendIx(svm, payer, processIx(fixed, vault, ledger, payer.address, 500n, 100n));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  const checked = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    checked,
    500n,
    `fixed checked fresh balance ${checked}, expected post-withdraw 500`,
  );
});

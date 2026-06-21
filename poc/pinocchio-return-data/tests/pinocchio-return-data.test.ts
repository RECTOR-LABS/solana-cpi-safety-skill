import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, type Address } from "@solana/kit";
import {
  LiteSVM,
  TransactionMetadata,
  FailedTransactionMetadata,
  loadProgram,
  sendIx,
  lamports,
  SOL,
} from "./harness.js";

const D = "target/deploy";

async function setup() {
  const svm = new LiteSVM();
  const oracle = await loadProgram(svm, `${D}/oracle-keypair.json`, `${D}/oracle.so`);
  const attacker = await loadProgram(
    svm,
    `${D}/attacker_oracle-keypair.json`,
    `${D}/attacker_oracle.so`,
  );
  const consumer = await loadProgram(svm, `${D}/consumer-keypair.json`, `${D}/consumer.so`);
  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(SOL));
  return { svm, oracle, attacker, consumer, payer };
}

// Pinocchio uses single-byte instruction discriminators (no 8-byte Anchor hash):
//   0 = consume_unchecked (vulnerable), 1 = consume_checked (fixed).
// The oracle program is passed as the sole instruction account; the consumer
// CPIs whatever program id it finds there (the caller-controlled attack surface).
function consumeIx(consumer: Address, oracle: Address, checked: boolean) {
  return {
    programAddress: consumer,
    accounts: [{ address: oracle, role: 0 /* AccountRole.READONLY */ }],
    data: Uint8Array.from([checked ? 1 : 0]),
  };
}

function decodeU64LE(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, true);
}

test("EXPLOIT: unchecked consumer trusts spoofed return data", async () => {
  const { svm, attacker, consumer, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(consumer, attacker, false));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const adoptedPrice = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    adoptedPrice,
    1n,
    `unchecked consumer emitted price ${adoptedPrice}, expected spoofed value 1n`,
  );
});

test("DEFENSE: checked consumer rejects attacker oracle (producer mismatch)", async () => {
  const { svm, attacker, consumer, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(consumer, attacker, true));

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense), got TransactionMetadata with return data`,
  );

  const logs = result.meta().logs().join("\n");
  assert.match(
    logs,
    /UntrustedProducer/,
    `expected the producer check to reject the spoof, got:\n${logs}`,
  );
});

test("POSITIVE CONTROL: checked consumer accepts the trusted oracle", async () => {
  const { svm, oracle, consumer, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(consumer, oracle, true));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const adoptedPrice = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    adoptedPrice,
    50_000n,
    `checked consumer emitted price ${adoptedPrice}, expected 50_000n`,
  );
});

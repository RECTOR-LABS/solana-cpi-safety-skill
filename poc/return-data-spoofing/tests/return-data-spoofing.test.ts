import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, type Address } from "@solana/kit";
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

async function setup() {
  const svm = new LiteSVM();
  const attacker = await loadProgram(
    svm,
    `${D}/attacker_oracle-keypair.json`,
    `${D}/attacker_oracle.so`,
  );
  const price = await loadProgram(
    svm,
    `${D}/price_oracle-keypair.json`,
    `${D}/price_oracle.so`,
  );
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
  return { svm, attacker, price, vuln, fixed, payer };
}

function consumeIx(consumer: Address, oracle: Address, payerAddress: Address) {
  return {
    programAddress: consumer,
    accounts: [
      { address: oracle, role: 0 /* AccountRole.READONLY */ },
      { address: payerAddress, role: 3 /* AccountRole.WRITABLE_SIGNER */ },
    ],
    data: anchorDiscriminator("consume_price"),
  };
}

function decodeU64LE(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, true);
}

test("EXPLOIT: vulnerable consumer trusts spoofed return data", async () => {
  const { svm, attacker, vuln, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(vuln, attacker, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const rd = result.returnData();
  const adoptedPrice = decodeU64LE(new Uint8Array(rd.data()));
  assert.strictEqual(
    adoptedPrice,
    1n,
    `vulnerable consumer emitted price ${adoptedPrice}, expected spoofed value 1n`,
  );
});

test("DEFENSE: fixed consumer rejects attacker oracle", async () => {
  const { svm, attacker, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(fixed, attacker, payer.address));

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense), got TransactionMetadata with return data`,
  );

  const logs = result.meta().logs().join("\n");
  assert.match(
    logs,
    /UntrustedProducer/,
    `expected UntrustedProducer in logs, got:\n${logs}`,
  );
  // Isolation: the producer check must be what rejects the spoof, not the
  // defense-in-depth callee pin. The producer check runs first, so a regression
  // that removed it would surface UntrustedCallee here and fail this assertion.
  assert.doesNotMatch(
    logs,
    /UntrustedCallee/,
    `expected the producer check (not the callee pin) to fire; got:\n${logs}`,
  );
});

test("POSITIVE CONTROL: fixed consumer accepts legitimate oracle", async () => {
  const { svm, price, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, consumeIx(fixed, price, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const rd = result.returnData();
  const adoptedPrice = decodeU64LE(new Uint8Array(rd.data()));
  assert.strictEqual(
    adoptedPrice,
    50_000n,
    `fixed consumer emitted price ${adoptedPrice}, expected 50_000n`,
  );
});

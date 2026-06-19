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

// Variant B (deeper-stack leak): the return-data slot is cleared on CPI ENTRY but
// not on RETURN. A consumer calls a benign-looking `relay`; the relay CPIs a
// deeper oracle that sets return data, then returns without setting its own. The
// deeper oracle's (producer, bytes) survive and reach the consumer -- which only
// ever called the relay. The producer check still authenticates the true source.

const D = "target/deploy";

async function setup() {
  const svm = new LiteSVM();
  const relay = await loadProgram(svm, `${D}/relay-keypair.json`, `${D}/relay.so`);
  const attacker = await loadProgram(
    svm,
    `${D}/attacker_oracle-keypair.json`,
    `${D}/attacker_oracle.so`,
  );
  const price = await loadProgram(svm, `${D}/price_oracle-keypair.json`, `${D}/price_oracle.so`);
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
  return { svm, relay, attacker, price, vuln, fixed, payer };
}

function relayIx(consumer: Address, relay: Address, deepOracle: Address, payerAddress: Address) {
  return {
    programAddress: consumer,
    accounts: [
      { address: relay, role: 0 /* READONLY */ },
      { address: deepOracle, role: 0 /* READONLY */ },
      { address: payerAddress, role: 3 /* WRITABLE_SIGNER */ },
    ],
    data: anchorDiscriminator("consume_via_relay"),
  };
}

function decodeU64LE(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, true);
}

test("DEEPER-STACK EXPLOIT: vulnerable consumer adopts a deep-leaked spoof through a benign relay", async () => {
  const { svm, relay, attacker, vuln, payer } = await setup();
  const result = await sendIx(svm, payer, relayIx(vuln, relay, attacker, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  const adopted = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    adopted,
    1n,
    `expected the consumer to adopt the deep attacker's spoofed 1 (leaked past the relay), got ${adopted}`,
  );
});

test("DEEPER-STACK DEFENSE: fixed consumer rejects the deep-leaked spoof (producer check)", async () => {
  const { svm, relay, attacker, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, relayIx(fixed, relay, attacker, payer.address));

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense): the producer check should reject the deep attacker`,
  );
  const logs = result.meta().logs().join("\n");
  assert.match(logs, /UntrustedProducer/, `expected UntrustedProducer in logs, got:\n${logs}`);
});

test("DEEPER-STACK POSITIVE CONTROL: fixed consumer accepts a deep-leaked price from the real oracle", async () => {
  const { svm, relay, price, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, relayIx(fixed, relay, price, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  const adopted = decodeU64LE(new Uint8Array(result.returnData().data()));
  assert.strictEqual(
    adopted,
    50_000n,
    `expected the consumer to adopt the real oracle's 50000 (leaked past the relay), got ${adopted}`,
  );
});

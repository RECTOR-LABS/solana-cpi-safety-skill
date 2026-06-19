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
  const realToken = await loadProgram(
    svm,
    `${D}/real_token-keypair.json`,
    `${D}/real_token.so`,
  );
  const fakeToken = await loadProgram(
    svm,
    `${D}/fake_token-keypair.json`,
    `${D}/fake_token.so`,
  );
  const vuln = await loadProgram(
    svm,
    `${D}/vault_vulnerable-keypair.json`,
    `${D}/vault_vulnerable.so`,
  );
  const fixed = await loadProgram(
    svm,
    `${D}/vault_fixed-keypair.json`,
    `${D}/vault_fixed.so`,
  );
  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(SOL));
  return { svm, realToken, fakeToken, vuln, fixed, payer };
}

function withdrawIx(vault: Address, tokenProgram: Address, payerAddress: Address) {
  return {
    programAddress: vault,
    accounts: [
      { address: tokenProgram, role: 0 /* AccountRole.READONLY */ },
      { address: payerAddress, role: 3 /* AccountRole.WRITABLE_SIGNER */ },
    ],
    data: anchorDiscriminator("withdraw"),
  };
}

test("EXPLOIT: vault_vulnerable accepts fake_token program substitution", async () => {
  const { svm, fakeToken, vuln, payer } = await setup();
  const result = await sendIx(svm, payer, withdrawIx(vuln, fakeToken, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const rd = result.returnData();
  // The fake_token program set return data [1u8] — prove the attacker's program ran
  const marker = new Uint8Array(rd.data())[0];
  assert.strictEqual(
    marker,
    1,
    `expected fake_token to set return data byte 0 = 1 (attacker ran), got ${marker}`,
  );
});

test("DEFENSE: vault_fixed rejects fake_token program substitution", async () => {
  const { svm, fakeToken, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, withdrawIx(fixed, fakeToken, payer.address));

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense), got TransactionMetadata (exploit still lands!)`,
  );

  const logs = result.meta().logs().join("\n");
  assert.match(
    logs,
    /WrongTokenProgram/,
    `expected WrongTokenProgram in logs, got:\n${logs}`,
  );
});

test("POSITIVE CONTROL: vault_fixed accepts real_token", async () => {
  const { svm, realToken, fixed, payer } = await setup();
  const result = await sendIx(svm, payer, withdrawIx(fixed, realToken, payer.address));

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );

  const rd = result.returnData();
  // The real_token program set return data [0u8]
  const marker = new Uint8Array(rd.data())[0];
  assert.strictEqual(
    marker,
    0,
    `expected real_token to set return data byte 0 = 0, got ${marker}`,
  );
});

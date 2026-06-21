import { readFileSync } from "node:fs";
import {
  createKeyPairSignerFromBytes, lamports, pipe,
  createTransactionMessage, setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction, signTransactionMessageWithSigners,
  type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { LiteSVM, TransactionMetadata, FailedTransactionMetadata } from "litesvm";

/** Derive an Address from a `target/deploy/<name>-keypair.json` (64-byte secret key array). */
export async function programAddress(keypairPath: string): Promise<Address> {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")));
  const signer = await createKeyPairSignerFromBytes(bytes);
  return signer.address;
}

/** Load a compiled `.so` under its declared (keypair) id and return that id. */
export async function loadProgram(svm: LiteSVM, keypairPath: string, soPath: string): Promise<Address> {
  const id = await programAddress(keypairPath);
  svm.addProgramFromFile(id, soPath);
  return id;
}

/** Build, sign, and send a single instruction. Returns the result union (never throws on tx failure). */
export async function sendIx(
  svm: LiteSVM, payer: TransactionSigner, ix: Instruction,
): Promise<TransactionMetadata | FailedTransactionMetadata> {
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
    (m) => appendTransactionMessageInstruction(ix, m),
    (m) => signTransactionMessageWithSigners(m),
  );
  return svm.sendTransaction(tx);
}

export const SOL = 1_000_000_000n;
export { lamports, LiteSVM, TransactionMetadata, FailedTransactionMetadata };

# solana-cpi-safety-skill — Contributor Guide

## What this skill is

A Claude Code skill that detects and prevents four Solana CPI vulnerability classes:

1. **CPI return-data spoofing** — trusting `get_return_data()` without verifying the producing program id. Crown jewel: anchored on a real Anchor upstream-fixed finding, CVSS 7.5, 1st of 116 across a 14-protocol audit.
2. **Arbitrary CPI** — invoking a caller-supplied program id.
3. **Stale account after CPI** — reading account state a callee mutated without reloading.
4. **PDA CPI signing** — non-canonical bumps or leaked signer seeds in `invoke_signed`.

Covers Anchor and native/Pinocchio patterns. Includes five runnable PoCs (LiteSVM + TypeScript) across the four classes — the crown-jewel class ships both an Anchor and a Pinocchio proof — plus a `/audit-cpi` command, a `cpi-auditor` agent, and a Rust code rule.

## Toolchain pins

| Tool | Version |
|------|---------|
| Anchor | 1.0.2 |
| Solana / Agave CLI | 3.x |
| Rust | 1.85+ |
| Node.js | >= 20 |
| @solana/kit | 6.10.0 |
| litesvm (npm) | 1.1.0 |

## litesvm kit-only warning

The `litesvm` npm package version 1.1.0 requires `@solana/kit` (not the older `@solana/web3.js`). Do NOT use `@solana/web3.js` in the PoC test harnesses — all transaction construction must use `@solana/kit` 6.10.0 APIs. The Rust `litesvm` crate version is independent; check the per-PoC `Cargo.toml`.

## Running the PoCs

The four Anchor PoCs follow the same flow: build the Anchor programs first, then run the TypeScript tests against the compiled BPF binaries via LiteSVM. The fifth PoC (`pinocchio-return-data`) is a raw Pinocchio program built with `cargo-build-sbf` instead of Anchor — see "Pinocchio PoC toolchain" below.

```bash
# return-data spoofing PoC (includes the Variant B deeper-stack trio)
cd poc/return-data-spoofing
anchor build
npm install
npm test

# arbitrary-CPI PoC
cd poc/arbitrary-cpi
anchor build
npm install
npm test

# account-reload (stale-account-after-CPI) PoC
cd poc/account-reload
anchor build
npm install
npm test

# pda-cpi-signing (invoke_signed) PoC
cd poc/pda-cpi-signing
anchor build
npm install
npm test

# pinocchio-return-data PoC (Pinocchio crown-jewel variant; cargo-build-sbf, NOT anchor)
cd poc/pinocchio-return-data
cargo-build-sbf
npm install
npm test
```

Each scenario follows the EXPLOIT (lands before fix), DEFENSE (rejects after fix), POSITIVE CONTROL (legitimate call succeeds) shape; the return-data PoC adds a second Variant-B trio.

## Pinocchio PoC toolchain

`poc/pinocchio-return-data/` is built with `cargo-build-sbf` (Agave platform-tools), not Anchor. Two pins matter and are captured in the committed lockfile:

- **rustc / platform-tools:** the SBF toolchain ships `rustc 1.84.1` (platform-tools v1.51, `cargo-build-sbf 3.0.13`). pinocchio 0.10.2 (`features = ["cpi"]`) and its sub-crates build on this; do NOT switch the global avm/Solana toolchain to rebuild this PoC.
- **`solana-address = 2.5.0` (pinned in `Cargo.lock`):** pinocchio depends on `solana-address "2.0"`, but versions 2.6.0+ raised their MSRV to `rustc 1.89.0` — newer than the SBF toolchain's 1.84.1 — and fail the build. 2.5.0 is the latest 2.x with MSRV 1.81. If you regenerate the lockfile, re-apply the pin: `cargo update -p solana-address --precise 2.5.0`.

As with the Anchor PoCs, the compiled `.so` and keypairs are committed, so CI and `npm test` need no Rust toolchain at all.

## Publishing the npm package

`@rector-labs/solana-cpi-safety-skill` powers `npx @rector-labs/solana-cpi-safety-skill`. It is a scoped package, so it must be published public, and RECTOR runs the publish (OTP required):

```bash
# one-time: create the rector-labs npm org in the npm web UI
npm login                      # account rz1989
npm publish --access public    # scoped packages default to private; --access public is required
```

Keep `package.json` `version` and `.claude-plugin/plugin.json` `version` in sync. The `files` allowlist ships only the skill bundle (no `poc/`, no `docs/`); run `npm pack --dry-run` to confirm before publishing.

The native plugin channel is the `rector-labs` marketplace, which lives in the dedicated **RECTOR-LABS/claude-plugins** repo (this repo ships only `.claude-plugin/plugin.json`). To list another RECTOR-LABS skill, add an entry to that repo's `marketplace.json`. Install: `/plugin marketplace add RECTOR-LABS/claude-plugins` then `/plugin install solana-cpi-safety@rector-labs`.

## Claim accuracy — strict rules for contributors

The upstream finding that anchors this skill has precisely documented metrics. Never deviate from them.

Allowed:
- "CVSS 7.5"
- "1st of 116"
- "14-protocol audit"
- "Anchor CPI return-data spoofing"
- "fixed upstream"

Forbidden — never write any of the following:
- The number one-hundred-twenty-five (in any form) referring to vulnerability count — it is wrong
- CVSS severity above 7.5 for this finding — CVSS ten is wrong
- Any paraphrase that inflates the claim

CI lint greps all Markdown files for inflated numbers and severities. Do not commit text that would match those patterns.

## Style rules for contributors

- No emojis anywhere (README, skill Markdown, scripts, comments).
- No box-drawing or Unicode line-art glyphs in shell scripts; use plain ASCII only (`=`, `-`, `*`, `[OK]`, `[1/2]`).
- No religious wording of any kind.
- ASCII-only for all installer output (`[OK]`, `[1/2]`, `===`, `*` are fine).
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- No AI attribution in commits or PRs.

## Branch convention

```
feat/<scope>-DD-MM-YYYY
fix/<scope>-DD-MM-YYYY
docs/<scope>-DD-MM-YYYY
```

## Key files

```
skills/solana-cpi-safety/SKILL.md                     # Routing entry point (read first)
skills/solana-cpi-safety/cpi-return-data-spoofing.md  # Primary sub-skill
skills/solana-cpi-safety/arbitrary-cpi.md
skills/solana-cpi-safety/account-reload.md
skills/solana-cpi-safety/pda-cpi-signing.md
skills/solana-cpi-safety/poc-harness.md               # PoC test harness patterns
skills/solana-cpi-safety/cpi-checklist.md             # Pre-audit checklist
skills/solana-cpi-safety/rules/rust.md                # Rust code rule (now inside the skill)
agents/cpi-auditor.md
commands/audit-cpi.md
bin/cli.mjs                                           # npx installer (zero-dep)
package.json                                          # npm package (@rector-labs/...)
.claude-plugin/plugin.json                            # Claude Code plugin manifest
poc/return-data-spoofing/
poc/pinocchio-return-data/      # Pinocchio crown-jewel variant (cargo-build-sbf)
poc/arbitrary-cpi/
poc/account-reload/
poc/pda-cpi-signing/
```

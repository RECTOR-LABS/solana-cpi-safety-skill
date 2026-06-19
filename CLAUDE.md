# solana-cpi-safety-skill — Contributor Guide

## What this skill is

A Claude Code skill that detects and prevents four Solana CPI vulnerability classes:

1. **CPI return-data spoofing** — trusting `get_return_data()` without verifying the producing program id. Crown jewel: anchored on a real Anchor upstream-fixed finding, CVSS 7.5, 1st of 116 across a 14-protocol audit.
2. **Arbitrary CPI** — invoking a caller-supplied program id.
3. **Stale account after CPI** — reading account state a callee mutated without reloading.
4. **PDA CPI signing** — non-canonical bumps or leaked signer seeds in `invoke_signed`.

Covers Anchor and native/Pinocchio patterns. Includes two runnable PoCs (LiteSVM + TypeScript), a `/audit-cpi` command, a `cpi-auditor` agent, and a Rust code rule.

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

Both PoCs follow the same flow: build the Anchor programs first, then run the TypeScript tests against the compiled BPF binaries via LiteSVM.

```bash
# return-data spoofing PoC
cd poc/return-data-spoofing
anchor build
npm install
npm test

# arbitrary-CPI PoC
cd poc/arbitrary-cpi
anchor build
npm install
npm test
```

Each test suite produces three cases: EXPLOIT (lands before fix), DEFENSE (rejects after fix), POSITIVE CONTROL (legitimate call succeeds).

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
- No box-drawing characters in shell scripts (no `─`-range glyphs, no `╔`, `║`, `╚`, etc.).
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
skill/SKILL.md                  # Routing entry point (read first)
skill/cpi-return-data-spoofing.md  # Primary sub-skill
skill/arbitrary-cpi.md
skill/account-reload.md
skill/pda-cpi-signing.md
skill/poc-harness.md            # PoC test harness patterns
skill/cpi-checklist.md          # Pre-audit checklist
agents/cpi-auditor.md
commands/audit-cpi.md
rules/rust.md
poc/return-data-spoofing/
poc/arbitrary-cpi/
```

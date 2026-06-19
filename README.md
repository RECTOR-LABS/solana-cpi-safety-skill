# solana-cpi-safety-skill

Solana CPI safety skill for Claude Code — detects and prevents four cross-program invocation vulnerability classes, with first-class coverage of CPI return-data spoofing.

## What it is

Cross-program invocation is Solana's most common source of severe, exploitable bugs. This skill teaches Claude Code to recognize, explain, and fix the four classes that account for the majority of High and Critical audit findings:

### The four CPI vulnerability classes

| Class | Risk | What goes wrong |
|-------|------|-----------------|
| **CPI return-data spoofing** | Critical | Trusting `get_return_data()` without verifying the producing program. Any program can write to the return-data slot — a rogue caller replaces an oracle price before your program reads it. |
| **Arbitrary CPI** | High | Invoking a caller-supplied program id — enables fake SPL Token programs and attacker-controlled code executing inside the victim vault. |
| **Stale account after CPI** | High | Reading account state a callee mutated without reloading from the ledger. |
| **PDA CPI signing** | Medium-High | `invoke_signed` with non-canonical bumps or leaked signer seeds — enables unauthorized signing. |

### The novel core: CPI return-data spoofing

The crown-jewel coverage is CPI return-data spoofing. It is the least-documented of the four classes and the hardest to catch in review. The attack surface is the `set_return_data` / `get_return_data` syscall pair: any program invoked before yours (or by yours) can overwrite the slot. A DeFi program that calls an oracle CPI and then reads `get_return_data()` without checking `program_id == ORACLE_PROGRAM_ID` is fully exploitable.

This skill is anchored on a real upstream-fixed finding: Anchor CPI return-data spoofing, CVSS 7.5, fixed upstream, placing 1st of 116 across a 14-protocol audit.

Both Anchor and native/Pinocchio patterns are covered.

## What is inside

### Skill bundle

```
skill/
  SKILL.md                      # Routing entry point
  cpi-return-data-spoofing.md   # Crown jewel sub-skill
  arbitrary-cpi.md              # Arbitrary CPI sub-skill
  account-reload.md             # Stale account sub-skill
  pda-cpi-signing.md            # PDA signing sub-skill
  poc-harness.md                # PoC test harness guide
  cpi-checklist.md              # Pre-audit CPI checklist

agents/
  cpi-auditor.md                # Autonomous CPI audit agent

commands/
  audit-cpi.md                  # /audit-cpi command

rules/
  rust.md                       # Rust code rule (Cursor .mdc)

poc/
  return-data-spoofing/         # Runnable LiteSVM + TypeScript PoC (incl. Variant B)
  arbitrary-cpi/                # Runnable LiteSVM + TypeScript PoC
  account-reload/               # Runnable LiteSVM + TypeScript PoC
  pda-cpi-signing/              # Runnable LiteSVM + TypeScript PoC
```

### The /audit-cpi command

Invoke `/audit-cpi` in any Claude Code session to scan a Solana repository for all four CPI vulnerability classes and produce a structured finding report with remediation steps.

### The cpi-auditor agent

A dedicated sub-agent that performs systematic CPI audits. Routes to the appropriate sub-skill for each finding class, writes exploit PoC sketches, and proposes fixes aligned with Anchor or native/Pinocchio idioms.

### The rust.md rule

A Rust code rule in Cursor `.mdc` format (`globs:` frontmatter). In Cursor it auto-loads on Rust file edits and routes CPI-touching changes to the relevant sub-skill and `cpi-checklist.md`. Claude Code has no auto-on-edit rule mechanism, so there it is reference material the skill cites — or drop it into a project `.claude/rules/` (with `paths:` frontmatter) for path-scoped context.

### Four runnable PoCs

Each PoC has Anchor programs (attacker + victim) and a TypeScript LiteSVM test suite with EXPLOIT / DEFENSE / POSITIVE CONTROL cases:

**poc/return-data-spoofing/** (crown jewel; 6 cases)
- EXPLOIT: victim adopts the spoofed price written by the attacker program
- DEFENSE: `UntrustedProducer` error raised when the producer check fails
- POSITIVE CONTROL: accepts return data from the real oracle program
- Variant B (deeper-stack leak): a benign relay surfaces a deeper program's return data — EXPLOIT adopts a deep attacker's spoof, DEFENSE rejects it via the producer check, POSITIVE accepts the real oracle

**poc/arbitrary-cpi/**
- EXPLOIT: attacker substitutes a fake SPL Token program; attacker-controlled code executes inside the vault's CPI
- DEFENSE: explicit program_id check rejects the substitution before any CPI is opened
- POSITIVE CONTROL: the real SPL Token program succeeds

**poc/account-reload/**
- EXPLOIT: a vulnerable consumer checks a pre-CPI balance snapshot, so a vault drained by the CPI passes a solvency check
- DEFENSE: the fixed consumer re-reads after the CPI (the `reload()` lesson) and rejects the drained vault
- POSITIVE CONTROL: a partial withdrawal that stays solvent is accepted

**poc/pda-cpi-signing/**
- EXPLOIT: a vault PDA signs (`invoke_signed`) with seeds `[b"vault", authority]`, but the authority is never required to sign — an attacker drains a victim's vault by passing the victim's pubkey unsigned
- DEFENSE: the fixed program requires the authority to sign, rejecting the unsigned drain
- POSITIVE CONTROL: the real authority withdraws from its own vault

## Quickstart

### Install (standalone)

```bash
git clone https://github.com/RECTOR-LABS/solana-cpi-safety-skill.git
cd solana-cpi-safety-skill
./install.sh
```

For custom install location (project-local or custom path):

```bash
./install-custom.sh
# or: ./install-custom.sh /path/to/target
```

### Run a PoC

The compiled programs and their keypairs are committed, so the PoCs run with Node alone — no Solana/Anchor toolchain required.

```bash
# Return-data spoofing PoC
cd poc/return-data-spoofing
npm install
npm test
```

6 tests run, 6 pass (Variant A + Variant B deeper-stack):
- EXPLOIT: "vulnerable consumer trusts spoofed return data" — tx succeeds, consumer
  adopts attacker-set price 1 (spoofed value confirmed in return data)
- DEFENSE: "fixed consumer rejects attacker oracle" — tx fails with error UntrustedProducer
- POSITIVE CONTROL: "fixed consumer accepts legitimate oracle" — tx succeeds, consumer
  reads real oracle price 50000
- Variant B (deeper-stack leak): EXPLOIT adopts a deep attacker's spoof through a benign
  relay; DEFENSE rejects it via the producer check; POSITIVE accepts the real oracle

```bash
# Arbitrary CPI PoC
cd poc/arbitrary-cpi
npm install
npm test
```

3 tests run, 3 pass:
- EXPLOIT: "vault_vulnerable accepts fake_token program substitution" — tx succeeds,
  return data byte 0 = 1 proving fake_token (attacker program) executed
- DEFENSE: "vault_fixed rejects fake_token program substitution" — tx fails with error
  WrongTokenProgram
- POSITIVE CONTROL: "vault_fixed accepts real_token" — tx succeeds, return data byte 0 = 0

```bash
# account-reload (stale-account-after-CPI) PoC
cd poc/account-reload && npm install && npm test
# pda-cpi-signing (invoke_signed) PoC
cd poc/pda-cpi-signing && npm install && npm test
```

Both run the same EXPLOIT / DEFENSE / POSITIVE CONTROL shape (3 tests each).

#### Rebuild the programs from source (optional)

With Anchor 1.0.2 and the Solana toolchain installed, run `anchor build` inside a `poc/<scenario>/` directory. The committed program keypairs keep the program ids stable across rebuilds.

### Use in Claude Code

After installing, open any Claude Code session in a Solana project and ask:

```
Audit this program for CPI vulnerabilities
/audit-cpi
Are there any return-data spoofing risks in programs/my-program/src/lib.rs?
Review this CPI call for arbitrary-program substitution
```

## Adding to Solana AI Kit

The kit (solanabr/solana-ai-kit) registers external skills as git submodules under `.claude/skills/ext/<name>`. To add this skill:

```bash
git submodule add https://github.com/RECTOR-LABS/solana-cpi-safety-skill.git .claude/skills/ext/solana-cpi-safety
```

The resulting `.gitmodules` block (ready to paste):

```
[submodule ".claude/skills/ext/solana-cpi-safety"]
    path = .claude/skills/ext/solana-cpi-safety
    url = https://github.com/RECTOR-LABS/solana-cpi-safety-skill.git
```

## Requirements (for the PoCs)

To run the PoCs (primary path — programs are precompiled):

| Tool | Version |
|------|---------|
| Node.js | >= 20 |

To rebuild the programs from source (optional):

| Tool | Version |
|------|---------|
| Anchor | 1.0.2 |
| Solana / Agave CLI | 3.x |
| Rust | 1.85+ |
| Node.js | >= 20 |

The skill bundle (skill/, commands/, agents/, rules/) has no runtime requirements — it is plain Markdown.

## Repository structure

```
solana-cpi-safety-skill/
  README.md                   # This file
  CLAUDE.md                   # Contributor guidance
  LICENSE                     # MIT
  install.sh                  # Standard installer
  install-custom.sh           # Custom-path installer

  skill/
    SKILL.md
    cpi-return-data-spoofing.md
    arbitrary-cpi.md
    account-reload.md
    pda-cpi-signing.md
    poc-harness.md
    cpi-checklist.md

  agents/
    cpi-auditor.md

  commands/
    audit-cpi.md

  rules/
    rust.md

  poc/
    return-data-spoofing/
      programs/               # Anchor victim + attacker + relay programs
      tests/                  # LiteSVM TypeScript test suite (Variant A + B)
    arbitrary-cpi/
      programs/               # Anchor victim + attacker programs
      tests/                  # LiteSVM TypeScript test suite
    account-reload/
      programs/               # Anchor ledger + consumer programs
      tests/                  # LiteSVM TypeScript test suite
    pda-cpi-signing/
      programs/               # Anchor vault programs
      tests/                  # LiteSVM TypeScript test suite
```

## License

MIT — see [LICENSE](LICENSE) for details.

---

Maintained by [RECTOR-LABS](https://github.com/RECTOR-LABS).
Built for the Superteam x Solana AI Kit bounty.

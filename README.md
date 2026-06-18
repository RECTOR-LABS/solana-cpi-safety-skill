# solana-cpi-safety-skill

A Claude Code / Codex skill that hardens Solana cross-program invocations (CPI) — with first-class coverage of the **CPI return-data spoofing** exploit class.

> Status: in active development for the Superteam x Solana AI Kit bounty (submission window closes 2026-07-01). This README is finalized at submission.

## The problem

Cross-program invocation is Solana's most common source of severe, exploitable bugs:

- **Return-data spoofing** — trusting `get_return_data()` without verifying which program produced it.
- **Arbitrary CPI** — invoking a caller-supplied program id (fake SPL Token, reversed transfers).
- **Stale-account-after-CPI** — reading account state a callee mutated, without reloading.
- **PDA CPI signing** — `invoke_signed` with non-canonical bumps or leaked signer seeds.

These sit in the dominant severe-bug category for Solana programs: logic, input-validation, and access-control errors account for roughly 85% of High and Critical findings across audited programs.

## What it does

A progressive-disclosure skill that routes by task to focused sub-skills:

| Task | Sub-skill |
|------|-----------|
| Detect and fix return-data spoofing | `skill/cpi-return-data-spoofing.md` |
| Detect arbitrary-CPI / program substitution | `skill/arbitrary-cpi.md` |
| Fix stale-account-after-CPI | `skill/account-reload.md` |
| Harden PDA CPI signing | `skill/pda-cpi-signing.md` |

Plus an `audit-cpi` command and a `cpi-auditor` agent that scan a repository for these patterns, and a runnable LiteSVM proof-of-concept that demonstrates the return-data exploit — a failing test before the fix, passing after.

## Install

Matches the Solana AI Kit skill convention (`install.sh` / `install-custom.sh`).

## Why this skill

Built by a Solana security auditor who found this exact bug class in production: an Anchor CPI return-data spoofing vulnerability, CVSS 7.5, fixed upstream — work that placed 1st of 116 across a 14-protocol audit contest.

## License

MIT.

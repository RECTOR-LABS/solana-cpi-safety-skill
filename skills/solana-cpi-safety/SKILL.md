---
name: solana-cpi-safety
description: Detect and prevent Solana cross-program-invocation vulnerabilities — return-data spoofing, arbitrary CPI, stale-account-after-CPI, and non-canonical PDA signing — in Anchor and native programs.
user-invocable: true
---

# Solana CPI Safety

This skill covers four classes of cross-program invocation vulnerability in Solana programs. The novel core is CPI return-data spoofing: trusting `get_return_data()` without verifying the producing program is an under-documented attack surface that allows a malicious CPI callee to inject arbitrary return data into the caller's control flow. The remaining three classes — arbitrary CPI, stale account reads after CPI, and non-canonical PDA signing — are included for completeness, each with a runnable proof-of-concept harness.

## What This Skill Is For

Use this skill when you are:

- Working with Solana cross-program invocations — `invoke`, `invoke_signed`, or Anchor's `CpiContext::new` / `CpiContext::new_with_signer`
- Reading CPI return data with `get_return_data()` or the `sol_get_return_data` syscall
- Invoking a program whose address comes from a caller-supplied account (arbitrary CPI exposure)
- Auditing or writing Anchor programs, native programs, or Pinocchio programs that cross program boundaries
- Reviewing how your program handles account state after a CPI returns
- Running a structured CPI security audit against a program or PR

## Task Routing Guide

| When you are... | Read |
|----------------|------|
| Trusting CPI return data / using `get_return_data` without verifying the producer | [cpi-return-data-spoofing.md](cpi-return-data-spoofing.md) |
| CPIing a caller-supplied program / program substitution / fake-SPL attack | [arbitrary-cpi.md](arbitrary-cpi.md) |
| Reading an account after a CPI mutated it (stale data / missing reload) | [account-reload.md](account-reload.md) |
| Signing a CPI with `invoke_signed` / PDA bump and seed safety | [pda-cpi-signing.md](pda-cpi-signing.md) |
| Building, running, or extending the runnable PoCs | [poc-harness.md](poc-harness.md) |
| Running a structured CPI audit / reviewing the check items | [cpi-checklist.md](cpi-checklist.md) |

## Commands

| Command | Description |
|---------|-------------|
| `/audit-cpi` | Checklist-driven CPI safety review across all four vulnerability classes (see [audit-cpi.md](../../commands/audit-cpi.md), driven by [cpi-checklist.md](cpi-checklist.md)) |

## Agents

| Agent | Purpose |
|-------|---------|
| `cpi-auditor` | Read-only CPI security auditor that runs the `/audit-cpi` flow against a target program or PR (see [cpi-auditor.md](../../agents/cpi-auditor.md)) |

## Progressive Disclosure

Sub-skills to read when needed:

- [cpi-return-data-spoofing.md](cpi-return-data-spoofing.md) — The novel crown jewel: return-data injection via unverified `get_return_data()` callee, with exploit mechanics, detection patterns, and Anchor/native mitigations.
- [arbitrary-cpi.md](arbitrary-cpi.md) — Program substitution attacks where a caller-supplied account replaces the expected program; includes fake-SPL token program patterns.
- [account-reload.md](account-reload.md) — Stale account data after a CPI mutates on-chain state; when and how to reload accounts in Anchor and native programs.
- [pda-cpi-signing.md](pda-cpi-signing.md) — Safe use of `invoke_signed` with PDA signer seeds, canonical bump enforcement, and seed collision risks.
- [poc-harness.md](poc-harness.md) — LiteSVM-based proof-of-concept test harness shared across all four vulnerability classes; how to build, run, and extend the PoCs.
- [cpi-checklist.md](cpi-checklist.md) — Structured audit checklist covering all four CPI vulnerability classes; used by the `/audit-cpi` command and `cpi-auditor` agent.

## Related skills

This skill is part of the RECTOR-LABS Solana security suite (find -> prove -> respond). The following companion skills are planned and not yet available:

- **solana-poc-forge** — forge standalone runnable proof-of-concept exploits for Solana programs (generalizes the PoC harness in [poc-harness.md](poc-harness.md)).
- **solana-incident-response** — triage, contain, and disclose live Solana security incidents.

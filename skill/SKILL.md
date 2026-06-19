---
name: solana-cpi-safety
description: Detect and prevent Solana cross-program-invocation vulnerabilities — return-data spoofing, arbitrary CPI, stale-account-after-CPI, and non-canonical PDA signing — in Anchor and native programs.
user-invocable: true
---

# Solana CPI Safety

## What this skill is for

Use this skill when you are:

- Working with Solana cross-program invocations — `invoke`, `invoke_signed`, or Anchor's `CpiContext::new` / `CpiContext::new_with_signer`
- Reading CPI return data with `get_return_data()` or the `sol_get_return_data` syscall
- Invoking a program whose address comes from a caller-supplied account (arbitrary CPI exposure)
- Auditing or writing Anchor programs, native programs, or Pinocchio programs that cross program boundaries
- Reviewing how your program handles account state after a CPI returns

## Routing

| When you are... | Read |
|----------------|------|
| trusting CPI return data / using `get_return_data` without verifying the producer | `cpi-return-data-spoofing.md` |
| building, running, or extending the runnable PoCs | `poc-harness.md` |

More routes are added in Phase 4.

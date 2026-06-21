---
description: "Checklist-driven CPI safety review — locates CPI sites with grep, walks skills/solana-cpi-safety/cpi-checklist.md for each site, and emits a structured findings report."
---

This command performs a guidance-driven CPI safety review of a Rust Solana program. It is not a static scanner and does not guarantee completeness — it walks a human-in-the-loop checklist against grep-identified sites and produces a structured report of what was found.

The checklist content lives exclusively in `skills/solana-cpi-safety/cpi-checklist.md`. This command cites that file; it does not restate its items.

---

## Step 1 — Locate CPI sites

Run the following grep commands against the target codebase. Collect every file and line number that matches.

```bash
# Primary CPI dispatch
rg -n 'invoke\b|invoke_signed\b' --type rust

# Anchor CPI context
rg -n 'CpiContext::new|CpiContext::new_with_signer' --type rust

# Return-data read/write
rg -n 'get_return_data|set_return_data|sol_get_return_data|sol_set_return_data' --type rust

# Reload calls (used later to identify Section 3 coverage)
rg -n '\.reload\(\)' --type rust

# Bump sources (used for Section 4)
rg -n 'ctx\.bumps\.|create_program_address|find_program_address' --type rust
```

Record all matches. If a codebase has no hits for a given pattern, record that pattern as "no sites found" and skip its section.

---

## Step 2 — Walk skills/solana-cpi-safety/cpi-checklist.md for each site

Open `skills/solana-cpi-safety/cpi-checklist.md`. For each CPI site identified in Step 1, work through the four sections in that checklist in order:

- **Section 1 (Return-data trust):** apply to every `get_return_data` / `sol_get_return_data` hit.
- **Section 2 (Arbitrary CPI / program substitution):** apply to every `invoke`, `invoke_signed`, and `CpiContext` hit.
- **Section 3 (Account reload):** apply to every `invoke` / `CpiContext` site where a deserialized account may be read after the call.
- **Section 4 (PDA invoke_signed):** apply to every `invoke_signed` site and every `create_program_address` hit.

For each check item in the checklist, record either: (a) the item passes with evidence (`file:line` citation), (b) the item fails and is a finding, or (c) the item is not applicable at this site with a brief reason.

---

## Step 3 — Emit the structured report

Produce a Markdown report in the following exact format.

### Findings table

```
| # | Pattern | Location (file:line) | Severity | Status |
|---|---------|----------------------|----------|--------|
| 1 | Return-data producer not checked | programs/consumer/src/lib.rs:42 | Critical | Finding |
| 2 | ... | ... | ... | ... |
```

- `Pattern` — the specific check item from `skills/solana-cpi-safety/cpi-checklist.md` that failed (use the check item's short label).
- `Location (file:line)` — exact file path relative to crate root and line number from grep output.
- `Severity` — Critical / High / Medium, taken from the checklist item.
- `Status` — Finding / Pass / N/A.

### Per-finding detail blocks

For each row with `Status: Finding`, add a detail block:

```
#### Finding #N — <short title>

**What:** [One sentence: what the code does at this site.]

**Why exploitable:** [One or two sentences: how an attacker turns this into impact. Be specific to the class — cross-reference the relevant sub-skill for full treatment.]

**Fix:**
<minimal code diff sketch showing the load-bearing change>
```

The diff sketch should show the vulnerable line and the corrected replacement. It does not need to be a full patch. See the relevant sub-skill (`skills/solana-cpi-safety/arbitrary-cpi.md`, `skills/solana-cpi-safety/cpi-return-data-spoofing.md`, `skills/solana-cpi-safety/account-reload.md`, `skills/solana-cpi-safety/pda-cpi-signing.md`) for the full safe patterns.

### Checklist coverage summary

Close the report with a coverage table using the format defined at the end of `skills/solana-cpi-safety/cpi-checklist.md`:

```
| Section | Class | Sites examined | Findings |
|---------|-------|----------------|----------|
| 1 | Return-data trust | 2 | 1 |
| 2 | Arbitrary CPI / program substitution | 4 | 0 |
| 3 | Account reload after CPI | 4 | 2 |
| 4 | PDA invoke_signed | 1 | 0 |
```

If a section had no grep hits, record Sites examined as 0 and Findings as N/A (not 0 — absence of hits is not the same as passing the checks).

---

## Important limitations

This is a guidance-driven review, not a guaranteed-complete scanner. It depends on grep coverage of the patterns listed in Step 1. It will miss findings if:

- CPI dispatch is wrapped in a helper function not matched by the patterns above.
- Return-data reads are behind a macro that expands to `get_return_data` at compile time but does not appear literally in source.
- Non-obvious control flow causes a post-CPI read to be separated from the CPI site across function boundaries.

Flag any such cases as "review boundary" notes in the report rather than assuming they are clean.

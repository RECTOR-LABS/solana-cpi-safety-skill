---
globs:
  - "**/*.rs"
exclude:
  - "**/target/**"
---

When editing Rust source that contains any of the following patterns, consult the relevant CPI sub-skill and run the checks in `../cpi-checklist.md` before marking the change complete.

Trigger patterns:

- `invoke` or `invoke_signed` — check Sections 2, 3, and 4 of `../cpi-checklist.md`. If `get_return_data` is read anywhere in scope of this CPI (same function, the callee, or a helper in the same file), also check Section 1.
- `CpiContext` — check Sections 2 and 3.
- `get_return_data` or `sol_get_return_data` — check Section 1.
- `set_return_data` or `sol_set_return_data` — note that you are setting return data; confirm the consumer (if in scope) applies a producer check (Section 1).
- `create_program_address` — check Section 4 (non-canonical bump risk).

For each trigger present in the file being edited, open the corresponding sub-skill for the full safe pattern and detection heuristics:

- Return-data: `../cpi-return-data-spoofing.md`
- Arbitrary CPI / program substitution: `../arbitrary-cpi.md`
- Account reload: `../account-reload.md`
- PDA signing: `../pda-cpi-signing.md`

This rule is CPI-focused. It does not cover general Rust standards.

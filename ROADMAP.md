# ROADMAP — solana-cpi-safety-skill

Status: ACTIVE BUILD (primary submission). Created 2026-06-19.

## Bounty context

- Listing: "Ship useful agent skills we can add to Solana AI Kit" — https://superteam.fun/earn/listing/skills
- Sponsor: Superteam Brasil (contact: Telegram @kauenet)
- Prize: 3,000 USDG across 10 winners (1st-5th: 400 each; 6th-10th: 200 each)
- Submission deadline: 2026-07-01 02:59:59 UTC (~10:00 WIB, 1 July). Winners: 2026-07-08.
- Submission rule: ONE entry per person, no edit/resubmit after posting. One shot.
- Judging axes: Usefulness, Novelty, Quality, Fit.
- Required shape: self-contained `skill/` folder with a routing `SKILL.md` (progressive disclosure) + focused sub-skill `.md` files + optional `agents/` `commands/` `rules/` + `install.sh` / `install-custom.sh` + README + MIT LICENSE. Mirror the reference: https://github.com/solanabr/solana-game-skill

## PSR

### Problem
Cross-program invocation is Solana's number-one systemic footgun. The specific **return-data spoofing** class — trusting `get_return_data()` output without verifying the producing program id — is covered NOWHERE in the kit. Adjacent CPI footguns (arbitrary-CPI program substitution, stale-account-after-CPI, non-canonical PDA signing) are only partially covered. Per the Sec3 2025 dataset (n=163 reviews, 1,669 vulns), logic/validation/access-control is 85.5% of High+Critical findings — the cluster CPI bugs live in.

### Solve
`skill/SKILL.md` routing table dispatches by task to focused sub-skills:
- `cpi-return-data-spoofing.md` — the exploit class; detection heuristics; the safe `get_return_data` pattern with program-id verification; Anchor vs Pinocchio. THE crown jewel (the novel core).
- `arbitrary-cpi.md` — caller-supplied program-id substitution; fake-SPL detection; program-id pinning.
- `account-reload.md` — reload-after-CPI staleness; mutable-account aliasing.
- `pda-cpi-signing.md` — `invoke_signed` bump canonicalization; signer-seed leakage.

Plus:
- `commands/audit-cpi.md` — scan a repo/program for all four patterns.
- `agents/cpi-auditor.md` — agent that performs the scan and reports findings.
- **PoC test** (LiteSVM / Mollusk) demonstrating the return-data exploit: fails pre-fix, passes post-fix. This converts the Quality axis from a claim into a demo. (Tight slice of the poc-forge idea folded in — return-data class only.)

### Results (per axis)
- Usefulness: HIGH — CPI bugs are top-tier severe; every Anchor dev doing cross-program calls benefits.
- Novelty: HIGH — grep over the kit + all 18 ext submodules for `return-data` / `get_return_data` / `set_return_data` returned ZERO hits this session.
- Quality: HIGH — anchored on a real, upstream-fixed bug; current to Anchor/Agave 2026; ships with a runnable PoC.
- Fit: HIGH — clean routing-hub shape; slots beside trailofbits without overlap.
- Builder-fit: MAXIMAL (the submitter's flagship finding is exactly this class).
- Effort: ~8-10 days solo.

## Novelty check (answers the bounty's Q2: "closest competing skill")
Closest existing coverage and how this differs:
- Solana Foundation `solana-dev-skill` `security.md` (562 lines) — covers arbitrary-CPI program-substitution ONLY, not `get_return_data` trust. This skill owns the return-data class it omits.
- Trail of Bits `skills` — chain-agnostic / EVM-leaning; no Solana CPI/return-data semantics.
- The taken `solana-auditor-skill` seed — report-lifecycle / formal-verification, not a CPI exploit-class skill.
- Verification: grep across kit local + ext for return-data primitives = 0 matches (2026-06-19).

## Founder-market-fit (answers the bounty's Q3: "why you")
Found this exact bug class: Anchor CPI return-data spoofing, CVSS 7.5, fixed upstream — placing 1st of 116 across a 14-protocol audit contest. Proof links to assemble at submission: audit-contest result/profile, the finding + upstream fix (if public), GitHub (rz1989s), Superteam Earn profile (rz1989). State credentials accurately only — never the disproven "125-vuln / CVSS-10" claim.

## Build plan (target: submit before 2026-07-01)
1. Day 1 — brainstorm exact scope (in/out boundaries), then writing-plans; scaffold `skill/` to the reference shape.
2. Days 2-4 — `cpi-return-data-spoofing.md` + the LiteSVM/Mollusk PoC (fail->pass).
3. Days 4-6 — `arbitrary-cpi.md`, `account-reload.md`, `pda-cpi-signing.md`.
4. Days 6-7 — `audit-cpi` command + `cpi-auditor` agent.
5. Day 8 — README final (foreground the finding, accurately), installers, polish to reference shape, tests green.
6. Day 9 — verification-before-completion + self code-review + RE-GREP kit novelty.
7. Day 10 — draft questionnaire answers (Q1/Q2/Q3 below), final review; RECTOR submits.

## Submission questionnaire (draft answers to finalize)
- Q1 "Did you contribute towards existing repos or is it a new idea?" -> New standalone skill (own MIT repo).
- Q2 "What is your closest 'competing' skill?" -> see Novelty check above.
- Q3 "Post links/proofs that show why you should be the creator? (Founder market fit)" -> see Founder-market-fit above.

## Pre-submit checklist
- [ ] Re-grep the kit + re-pull `skill-registry.json` for `return-data` the morning of submission (kit is actively maintained; a rival CPI skill could land).
- [ ] Confirm with @kauenet (optional) whether any of the ~22 existing submissions already target CPI (submissions are hidden until winners announced).
- [ ] Matches reference shape exactly (SKILL.md table + sub-skills + agents/commands/rules + 2 installers + README + MIT).
- [ ] PoC test runs green; instructions reproduce it.
- [ ] No emojis, no religious wording; credentials stated accurately.
- [ ] Flip repo public at submission.

## Compliance guardrails
No trading bots; no perps protocols (Pacifica/Extended/GRVT); no Intric/Arbital IP; MIT-licensable; accurate security claims only.

## Sources
- Kit: https://github.com/solanabr/solana-ai-kit | Reference shape: https://github.com/solanabr/solana-game-skill
- Foundation security.md: https://github.com/solana-foundation/solana-dev-skill
- Sec3 2025 study (85.5% severe = logic/validation/access-control; 99.4% audits find vulns): https://solanasec25.sec3.dev/
- Solana CPI vulnerability classes: https://www.asymmetric.re/blog-archived/invocation-security-navigating-vulnerabilities-in-solana-cpis
- Trail of Bits skills: https://github.com/trailofbits/skills

# Design Spec — solana-cpi-safety-skill

Date: 2026-06-19 · Status: APPROVED (brainstorming complete) · Cross-ref: `ROADMAP.md` (PSR, novelty check, founder-market-fit, sources). This spec is the architecture + build plan of record.

> Note: before flipping the repo public at submission, gitignore or remove `docs/superpowers/` so the public bounty repo matches the reference skill shape cleanly.

## 1. Goal & deliverable type

Build a Claude Code **skill** (NOT a plugin) for the Superteam x Solana AI Kit bounty (deadline 2026-07-01; one submission, no edits; axes: Usefulness, Novelty, Quality, Fit).

Verified facts:
- The reference `solana-game-skill` is a SKILL — no `.claude-plugin/plugin.json`; its `install.sh` copies into `~/.claude/skills/<name>/`.
- The KIT `solana-ai-kit` is the PLUGIN/marketplace — it has `.claude-plugin/marketplace.json`. It consumes skills as git submodules under `.claude/skills/ext/` plus a `skill-registry.json` entry.
- So our repo is a standalone MIT skill the kit slots in. We do NOT add a `plugin.json`.

Novel core: CPI **return-data spoofing** — grep-confirmed absent from the kit and all 18 submodules (incl. Foundation `security.md` and Trail of Bits). Anchored on RECTOR's CVSS-7.5 finding (14-protocol audit, 1st of 116; state accurately, never inflated).

## 2. Scope decisions (locked during brainstorm)

- **Mode:** guidance-first + a runnable PoC + a light, checklist-driven `audit-cpi` review. NOT a static-analysis scanner (avoids Trail of Bits overlap and false-positive/quality risk).
- **Framework coverage:** Anchor + Pinocchio/native at FULL parity across all guidance. (~1.5x writing; return-data stays the deep crown jewel, the other three get solid parity.)
- **PoC:** broader harness — TWO exploit classes (return-data spoofing + arbitrary-CPI). LiteSVM + TypeScript. Each scenario ships vulnerable + fixed programs and a failing→passing test. PoC programs in Anchor; the native/Pinocchio variant is explained in prose.

## 3. Architecture (repo layout)

```
solana-cpi-safety-skill/
├── skill/
│   ├── SKILL.md                      # router: frontmatter + task->file table
│   ├── cpi-return-data-spoofing.md   # DEEP — the novel crown jewel
│   ├── arbitrary-cpi.md              # solid — program substitution / fake-SPL
│   ├── account-reload.md             # solid — stale-account-after-CPI
│   ├── pda-cpi-signing.md            # solid — invoke_signed bump/seed safety
│   └── poc-harness.md                # how to run + extend the PoCs
├── poc/
│   ├── return-data-spoofing/         # vulnerable + fixed program + attacker + LiteSVM test
│   └── arbitrary-cpi/                # vulnerable + fixed program + attacker + LiteSVM test
├── commands/audit-cpi.md             # checklist-driven CPI review (not a scanner)
├── agents/cpi-auditor.md             # auditor persona that runs audit-cpi
├── rules/rust.md                     # path-scoped: lazy-loads on .rs CPI edits
├── install.sh / install-custom.sh    # two installers (matches reference)
├── README.md · CLAUDE.md · LICENSE   # (README/LICENSE in place)
└── ROADMAP.md                        # internal index (PSR/novelty/sources)
```

## 4. Components & structural decisions

- `cpi-return-data-spoofing.md` (DEEP): how `get_return_data` / `sol_get_return_data` returns `(program_id, data)`; why trusting `data` without verifying `program_id` is exploitable; detection heuristics; the safe verify-the-producer pattern; Anchor + native parity.
- `arbitrary-cpi.md` · `account-reload.md` · `pda-cpi-signing.md` (solid, both frameworks).
- `poc/`: two scenarios, vulnerable + fixed, LiteSVM/TS test proves exploit on vulnerable, blocked on fixed.
- `audit-cpi` command + `cpi-auditor` agent: share ONE checklist (no duplication); both kept for Fit + completeness.
- `rules/rust.md`: lean path-scoped rule (kit lazy-load feature).

Confirmed structural calls: keep both command + agent; PoCs in Anchor (native in prose); include `rules/rust.md`.

## 5. SKILL.md routing

Frontmatter: `name: solana-cpi-safety`, a one-line `description`, `user-invocable: true`. Then a "What this skill is for" trigger list, then a task->file routing table covering the four sub-skills + the PoC harness + the `audit-cpi` command + `cpi-auditor` agent.

## 6. PoC harness

- Toolchain: Anchor + LiteSVM + a TypeScript test runner (exact runner + versions decided in writing-plans, pinned to the current 2026 stack).
- Each scenario: `vulnerable` + `fixed` program variants; a test that asserts the exploit is blocked — fails on vulnerable (exploit lands), passes on fixed.
- Minimal GitHub Action running the PoC tests (a real green-CI Quality signal).

## 7. Build sequence (risk-first, with an MVP floor)

- Phase 0 (Day 1): scaffold `skill/` to reference shape; stand up the `poc/` LiteSVM+TS toolchain (de-risk the harness early).
- Phase 1 (Days 2-4): `cpi-return-data-spoofing.md` (deep, Anchor + native) + the return-data PoC. **MVP FLOOR — a complete, novel, proven, submittable skill on its own.**
- Phase 2 (Days 4-6): `arbitrary-cpi.md` + its PoC.
- Phase 3 (Days 6-8): `account-reload.md` + `pda-cpi-signing.md` (both frameworks).
- Phase 4 (Days 8-9): `audit-cpi` + `cpi-auditor` + `rules/rust.md` + README/installers + the kit registry-entry snippet.
- Phase 5 (Days 9-10): tests green + CI, self-review, re-grep novelty, draft questionnaire answers, flip public. RECTOR submits before 2026-07-01.

Never drop below the Phase-1 floor; everything after is additive.

## 8. Testing & verification

- Every PoC test compiles and runs green; CI green.
- verification-before-completion + self code-review before any "done" claim.
- Re-grep the kit for `return-data` the morning of submission (active repo; a rival entry could collapse novelty).

## 9. Definition of Done (submission)

- Matches the reference shape (skill/SKILL.md + sub-skills + agents/commands/rules + two installers + README + MIT LICENSE).
- README foregrounds the finding accurately (14-protocol / 1st-of-116 / CVSS-7.5; never the disproven 125-vuln/CVSS-10 claim).
- Ships a ready-to-paste `skill-registry.json` entry + `git submodule add` one-liner (boosts Fit).
- PoC tests + CI green.
- NO emojis, NO religious wording in any file.
- Three questionnaire answers drafted (Q1 new idea / Q2 closest competitor / Q3 founder-market-fit — see ROADMAP).
- `docs/superpowers/` gitignored or removed; repo flipped public; RECTOR submits.

## 10. Compliance guardrails

No trading bots; no perps protocols (Pacifica/Extended/GRVT); no Intric/Arbital IP; MIT-licensable; accurate security claims only.

## 11. Open items for writing-plans

- Exact TS test runner + Anchor/LiteSVM versions (current 2026 stack).
- Whether native/Pinocchio earns its own PoC later (currently prose-only).
- `audit-cpi` output/report format.

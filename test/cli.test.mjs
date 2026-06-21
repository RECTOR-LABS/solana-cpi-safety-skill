import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = join(process.cwd(), "bin", "cli.mjs");

test("--project --yes installs skill, command, and agent into ./.claude", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    execFileSync("node", [CLI, "--project", "--yes"], { cwd: tmp });
    assert.ok(existsSync(join(tmp, ".claude/skills/solana-cpi-safety/SKILL.md")), "SKILL.md");
    assert.ok(existsSync(join(tmp, ".claude/skills/solana-cpi-safety/rules/rust.md")), "rule");
    assert.ok(existsSync(join(tmp, ".claude/commands/audit-cpi.md")), "command");
    assert.ok(existsSync(join(tmp, ".claude/agents/cpi-auditor.md")), "agent");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--help prints usage and installs nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const out = execFileSync("node", [CLI, "--help"], { cwd: tmp, encoding: "utf8" });
    assert.match(out, /Usage: npx @rector-labs\/solana-cpi-safety-skill/);
    assert.ok(!existsSync(join(tmp, ".claude")), "no install on --help");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

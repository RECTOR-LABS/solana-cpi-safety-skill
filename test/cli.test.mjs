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

test("--target <dir> --yes installs the bundle into the given base dir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const target = join(tmp, "custom-base");
    execFileSync("node", [CLI, "--target", target, "--yes"], { cwd: tmp });
    assert.ok(existsSync(join(target, "skills/solana-cpi-safety/SKILL.md")), "SKILL.md");
    assert.ok(existsSync(join(target, "skills/solana-cpi-safety/rules/rust.md")), "rule");
    assert.ok(existsSync(join(target, "commands/audit-cpi.md")), "command");
    assert.ok(existsSync(join(target, "agents/cpi-auditor.md")), "agent");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target without a directory value errors and installs nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    let err;
    try {
      execFileSync("node", [CLI, "--target"], { cwd: tmp, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "should exit non-zero");
    assert.match(err.stderr, /--target requires a directory/);
    assert.ok(!existsSync(join(tmp, ".claude")), "no install on bad args");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target and --project together error (mutually exclusive)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    let err;
    try {
      execFileSync("node", [CLI, "--target", join(tmp, "x"), "--project", "--yes"], {
        cwd: tmp,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "should exit non-zero");
    assert.match(err.stderr, /--target.*--project|cannot be combined|mutually exclusive/);
    assert.ok(!existsSync(join(tmp, "x")), "no install on conflicting args");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--help wins even when --target is present (no value error, installs nothing)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const out = execFileSync("node", [CLI, "--target", "--help"], { cwd: tmp, encoding: "utf8" });
    assert.match(out, /Usage: npx @rector-labs\/solana-cpi-safety-skill/);
    assert.ok(!existsSync(join(tmp, ".claude")), "no install when help wins");
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

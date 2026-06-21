import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = join(process.cwd(), "bin", "cli.mjs");

// Run the CLI expecting a non-zero exit; return the caught error (with .stderr).
function expectExitError(args, cwd) {
  let err;
  try {
    execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    err = e;
  }
  assert.ok(err, `expected non-zero exit for: ${args.join(" ")}`);
  return err;
}

function assertBundleAt(base) {
  assert.ok(existsSync(join(base, "skills/solana-cpi-safety/SKILL.md")), "SKILL.md");
  assert.ok(existsSync(join(base, "skills/solana-cpi-safety/rules/rust.md")), "rule");
  assert.ok(existsSync(join(base, "commands/audit-cpi.md")), "command");
  assert.ok(existsSync(join(base, "agents/cpi-auditor.md")), "agent");
}

test("--project --yes installs skill, command, and agent into ./.claude", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    execFileSync("node", [CLI, "--project", "--yes"], { cwd: tmp });
    assertBundleAt(join(tmp, ".claude"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target <dir> --yes installs the bundle into the given base dir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const target = join(tmp, "custom-base");
    execFileSync("node", [CLI, "--target", target, "--yes"], { cwd: tmp });
    assertBundleAt(target);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("-t <dir> --yes (short alias) installs the bundle into the given base dir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const target = join(tmp, "short-base");
    execFileSync("node", [CLI, "-t", target, "--yes"], { cwd: tmp });
    assertBundleAt(target);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target=<dir> --yes (equals form) installs the bundle into the given base dir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const target = join(tmp, "eq-base");
    execFileSync("node", [CLI, `--target=${target}`, "--yes"], { cwd: tmp });
    assertBundleAt(target);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target into an existing base only replaces its own skill dir, preserving siblings", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const target = join(tmp, "base");
    // Pre-existing, unrelated content under the same base.
    mkdirSync(join(target, "skills", "other-skill"), { recursive: true });
    writeFileSync(join(target, "skills", "other-skill", "SKILL.md"), "keep me");
    writeFileSync(join(target, "unrelated.txt"), "keep me too");
    execFileSync("node", [CLI, "--target", target, "--yes"], { cwd: tmp });
    assert.ok(existsSync(join(target, "skills/solana-cpi-safety/SKILL.md")), "our skill installed");
    assert.ok(existsSync(join(target, "skills/other-skill/SKILL.md")), "sibling skill preserved");
    assert.ok(existsSync(join(target, "unrelated.txt")), "unrelated file preserved");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target without a directory value errors and installs nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const err = expectExitError(["--target"], tmp);
    assert.match(err.stderr, /--target requires a directory/);
    assert.ok(!existsSync(join(tmp, ".claude")), "no install on bad args");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target= (empty equals form) errors and installs nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const err = expectExitError(["--target="], tmp);
    assert.match(err.stderr, /--target requires a directory/);
    assert.ok(!existsSync(join(tmp, ".claude")), "no install on empty value");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target=<flag-like value> errors instead of creating a junk directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const err = expectExitError(["--target=-y"], tmp);
    assert.match(err.stderr, /--target requires a directory/);
    assert.ok(!existsSync(join(tmp, "-y")), "no junk dir created from a flag-like value");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--target and --project together error (mutually exclusive)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cpi-skill-"));
  try {
    const err = expectExitError(["--target", join(tmp, "x"), "--project", "--yes"], tmp);
    assert.match(err.stderr, /--target and --project cannot be combined/);
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

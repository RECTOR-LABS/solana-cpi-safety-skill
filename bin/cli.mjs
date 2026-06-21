#!/usr/bin/env node
// @rector-labs/solana-cpi-safety-skill installer.
// Copies the skill, the /audit-cpi command, and the cpi-auditor agent into a
// Claude Code config dir. Default: ~/.claude (global). --project: ./.claude.
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "solana-cpi-safety";

const HELP = `solana-cpi-safety-skill installer

Usage: npx @rector-labs/solana-cpi-safety-skill [options]

Installs the skill, the /audit-cpi command, and the cpi-auditor agent into
your Claude Code config directory.

Options:
  -p, --project       Install into ./.claude (this project) instead of ~/.claude
  -t, --target <dir>  Install into <dir> as the config base: skill -> <dir>/skills/...,
                      command -> <dir>/commands/, agent -> <dir>/agents/. Use for a
                      custom CLAUDE_CONFIG_DIR or a shared skills directory. Cannot be
                      combined with --project.
  -y, --yes           Skip the confirmation prompt
  -h, --help          Show this help

Default scope: ~/.claude (global - available in all your projects).`;

function parseArgs(argv) {
  // --help always wins: never let another flag's parsing (e.g. --target's missing-value
  // check) pre-empt printing usage.
  if (argv.includes("--help") || argv.includes("-h")) {
    return { project: false, yes: false, help: true, target: null };
  }
  const opts = { project: false, yes: false, help: false, target: null };
  const unknown = [];
  const TARGET_USAGE = "--target requires a directory: npx @rector-labs/solana-cpi-safety-skill --target <dir>";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" || a === "-p") opts.project = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--target" || a === "-t") {
      const val = argv[++i];
      if (val === undefined || val.startsWith("-")) { console.error(TARGET_USAGE); process.exit(1); }
      opts.target = val;
    } else if (a.startsWith("--target=")) {
      const val = a.slice("--target=".length);
      if (!val) { console.error(TARGET_USAGE); process.exit(1); }
      opts.target = val;
    } else unknown.push(a);
  }
  // Reject the first unrecognized option (--help already short-circuited above).
  if (unknown.length) { console.error(`Unknown option: ${unknown[0]}`); process.exit(1); }
  // --target and --project both choose the install base; refuse the ambiguous combination.
  if (opts.target !== null && opts.project) {
    console.error("--target and --project cannot be combined; choose one install base.");
    process.exit(1);
  }
  return opts;
}

function copyDir(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function copyMarkdown(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".md")) cpSync(join(srcDir, f), join(destDir, f));
  }
}

// Fail before touching the user's config dir if the packaged source is incomplete,
// so a corrupt package never wipes an existing install via copyDir's rmSync.
function validateSource() {
  const required = [
    join(PKG_ROOT, "skills", SKILL_NAME, "SKILL.md"),
    join(PKG_ROOT, "commands"),
    join(PKG_ROOT, "agents"),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      console.error(`Installation aborted: packaged source '${p}' is missing. The package may be corrupt -- reinstall it.`);
      process.exit(1);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  validateSource();

  const base = opts.target
    ? resolve(opts.target)
    : opts.project
      ? resolve(process.cwd(), ".claude")
      : join(homedir(), ".claude");
  const skillDest = join(base, "skills", SKILL_NAME);

  console.log("===================================================================");
  console.log("  @rector-labs/solana-cpi-safety-skill");
  console.log("===================================================================");
  console.log(`  skill   -> ${skillDest}/`);
  console.log(`  command -> ${join(base, "commands")}/audit-cpi.md`);
  console.log(`  agent   -> ${join(base, "agents")}/cpi-auditor.md`);
  console.log("");

  if (!opts.yes) {
    if (!stdin.isTTY) {
      // No interactive terminal (piped/CI/non-TTY npx): proceed instead of hanging
      // on a prompt that can never be answered. Pass --yes to silence this notice.
      console.log("No interactive terminal detected; proceeding (pass --yes to skip this notice).");
    } else {
      const rl = createInterface({ input: stdin, output: stdout });
      const ans = (await rl.question("Proceed with installation? [Y/n] ")).trim().toLowerCase();
      rl.close();
      if (ans === "n" || ans === "no") { console.log("Installation cancelled."); return; }
    }
  }

  copyDir(join(PKG_ROOT, "skills", SKILL_NAME), skillDest);
  console.log(`[1/3] [OK] skill   -> ${skillDest}/`);
  copyMarkdown(join(PKG_ROOT, "commands"), join(base, "commands"));
  console.log(`[2/3] [OK] command -> ${join(base, "commands")}/`);
  copyMarkdown(join(PKG_ROOT, "agents"), join(base, "agents"));
  console.log(`[3/3] [OK] agent   -> ${join(base, "agents")}/`);

  console.log("");
  console.log("Installation complete. Restart Claude Code, then try:");
  console.log("  /audit-cpi");
  console.log("  Audit this program for CPI return-data spoofing");
}

main().catch((e) => { console.error(e); process.exit(1); });

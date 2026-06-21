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
  -p, --project   Install into ./.claude (this project) instead of ~/.claude
  -y, --yes       Skip the confirmation prompt
  -h, --help      Show this help

Default scope: ~/.claude (global - available in all your projects).`;

function parseArgs(argv) {
  const opts = { project: false, yes: false, help: false };
  for (const a of argv) {
    if (a === "--project" || a === "-p") opts.project = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else { console.error(`Unknown option: ${a}`); process.exit(1); }
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  const base = opts.project ? resolve(process.cwd(), ".claude") : join(homedir(), ".claude");
  const skillDest = join(base, "skills", SKILL_NAME);

  console.log("===================================================================");
  console.log("  @rector-labs/solana-cpi-safety-skill");
  console.log("===================================================================");
  console.log(`  skill   -> ${skillDest}/`);
  console.log(`  command -> ${join(base, "commands")}/audit-cpi.md`);
  console.log(`  agent   -> ${join(base, "agents")}/cpi-auditor.md`);
  console.log("");

  if (!opts.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question("Proceed with installation? [Y/n] ")).trim().toLowerCase();
    rl.close();
    if (ans === "n" || ans === "no") { console.log("Installation cancelled."); return; }
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

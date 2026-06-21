import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("plugin.json is valid and names the plugin", () => {
  const p = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
  assert.equal(p.name, "solana-cpi-safety");
  assert.ok(p.description && p.version);
});

test("plugin.json author is an object with a name (per Claude Code schema)", () => {
  const p = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
  assert.equal(typeof p.author, "object");
  assert.ok(p.author.name);
});

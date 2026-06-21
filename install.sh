#!/bin/bash

# solana-cpi-safety-skill - Standard Installer
# Installs with recommended defaults. For custom options, use ./install-custom.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Standard defaults. Claude Code discovers each artifact from a distinct location:
#   skills   -> ~/.claude/skills/<name>/SKILL.md   (one level deep; not nested)
#   commands -> ~/.claude/commands/<name>.md       (-> /name)
#   agents   -> ~/.claude/agents/<name>.md
CLAUDE_DIR="$HOME/.claude"
SKILL_PATH="$CLAUDE_DIR/skills/solana-cpi-safety"
COMMANDS_DIR="$CLAUDE_DIR/commands"
AGENTS_DIR="$CLAUDE_DIR/agents"

print_banner() {
    echo ""
    echo "==================================================================="
    echo "  solana-cpi-safety-skill"
    echo "  Solana CPI safety skill for Claude Code"
    echo "  RECTOR-LABS"
    echo "==================================================================="
    echo ""
}

print_help() {
    echo "solana-cpi-safety-skill - Standard Installer"
    echo ""
    echo "Usage: ./install.sh [OPTIONS]"
    echo ""
    echo "Installs with recommended defaults:"
    echo "  skill    -> ~/.claude/skills/solana-cpi-safety/ (SKILL.md at its root)"
    echo "  command  -> ~/.claude/commands/audit-cpi.md     (/audit-cpi)"
    echo "  agent    -> ~/.claude/agents/cpi-auditor.md"
    echo "  rule     -> ~/.claude/skills/solana-cpi-safety/rules/ (reference copy)"
    echo "  Does NOT touch ~/.claude/CLAUDE.md"
    echo ""
    echo "Options:"
    echo "  -y, --yes      Skip confirmation prompt"
    echo "  -h, --help     Show this help"
    echo ""
    echo "For custom install location, use: ./install-custom.sh"
    echo ""
}

# Parse arguments
SKIP_CONFIRM=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -h|--help)
            print_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

print_banner

echo "Standard Installation"
echo ""
echo "This will install:"
echo "  * skill    ->  $SKILL_PATH/"
echo "  * command  ->  $COMMANDS_DIR/audit-cpi.md  (/audit-cpi)"
echo "  * agent    ->  $AGENTS_DIR/cpi-auditor.md"
echo ""
echo "Note: Your ~/.claude/CLAUDE.md will NOT be modified."
echo ""

if [ "$SKIP_CONFIRM" = false ]; then
    read -p "Proceed with installation? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Installation cancelled."
        echo "For custom options, run: ./install-custom.sh"
        exit 0
    fi
fi

echo ""

# Validate source
for dir in skills/solana-cpi-safety commands agents; do
    if [ ! -d "$SCRIPT_DIR/$dir" ]; then
        echo "[ERROR] Source directory '$dir' not found in $SCRIPT_DIR"
        exit 1
    fi
done

# [1/3] Install the skill (flattened: skills/solana-cpi-safety/ CONTENTS go directly under the skill
# dir, so SKILL.md lands at $SKILL_PATH/SKILL.md where Claude Code discovers it).
echo "[1/3] Installing skill..."
if [ -d "$SKILL_PATH" ] && [ "$(ls -A "$SKILL_PATH" 2>/dev/null)" ]; then
    echo "  * Removing existing skill at $SKILL_PATH"
    rm -rf "$SKILL_PATH"
fi
mkdir -p "$SKILL_PATH"
cp -r "$SCRIPT_DIR/skills/solana-cpi-safety/." "$SKILL_PATH/"
# The Rust rule ships inside the skill dir (skills/solana-cpi-safety/rules/), so the
# cp above already installed it as reference material -- no separate rules step.
echo "  [OK] skill -> $SKILL_PATH/ (SKILL.md at root)"

# [2/3] Install the /audit-cpi command where Claude Code discovers commands.
echo "[2/3] Installing command..."
mkdir -p "$COMMANDS_DIR"
cp "$SCRIPT_DIR/commands/"*.md "$COMMANDS_DIR/"
echo "  [OK] command -> $COMMANDS_DIR/ (/audit-cpi)"

# [3/3] Install the cpi-auditor agent where Claude Code discovers subagents.
echo "[3/3] Installing agent..."
mkdir -p "$AGENTS_DIR"
cp "$SCRIPT_DIR/agents/"*.md "$AGENTS_DIR/"
echo "  [OK] agent -> $AGENTS_DIR/"

# Done
echo ""
echo "==================================================================="
echo "  Installation complete"
echo "==================================================================="
echo ""
echo "Installed:"
echo "  skill    $SKILL_PATH/"
echo "  command  $COMMANDS_DIR/audit-cpi.md  (/audit-cpi)"
echo "  agent    $AGENTS_DIR/cpi-auditor.md"
echo ""
echo "Restart Claude Code, then try:"
echo "  * /audit-cpi"
echo "  * Audit this program for CPI return-data spoofing"
echo "  * Check for arbitrary CPI vulnerabilities"
echo ""
echo "To run the PoCs:"
echo "  cd poc/return-data-spoofing && npm install && npm test"
echo "  cd poc/arbitrary-cpi        && npm install && npm test"
echo ""

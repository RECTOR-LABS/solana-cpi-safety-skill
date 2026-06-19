#!/bin/bash

# solana-cpi-safety-skill - Standard Installer
# Installs with recommended defaults. For custom options, use ./install-custom.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Standard defaults
SKILLS_DIR="$HOME/.claude/skills"
INSTALL_PATH="$SKILLS_DIR/solana-cpi-safety"

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
    echo "  Location: ~/.claude/skills/solana-cpi-safety/"
    echo "  Copies: skill/, commands/, agents/, rules/"
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
echo "  * skill bundle  ->  $INSTALL_PATH"
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
for dir in skill commands agents rules; do
    if [ ! -d "$SCRIPT_DIR/$dir" ]; then
        echo "[ERROR] Source directory '$dir' not found in $SCRIPT_DIR"
        exit 1
    fi
done

# Create target
mkdir -p "$INSTALL_PATH"

# [1/2] Remove existing installation
echo "[1/2] Preparing install path..."
if [ -d "$INSTALL_PATH" ] && [ "$(ls -A "$INSTALL_PATH" 2>/dev/null)" ]; then
    echo "  * Removing existing installation at $INSTALL_PATH"
    rm -rf "$INSTALL_PATH"
    mkdir -p "$INSTALL_PATH"
fi
echo "  [OK] $INSTALL_PATH ready"

# [2/2] Copy skill bundle
echo "[2/2] Installing skill bundle..."
for dir in skill commands agents rules; do
    cp -r "$SCRIPT_DIR/$dir" "$INSTALL_PATH/"
    echo "  [OK] $dir/ -> $INSTALL_PATH/$dir/"
done

# Done
echo ""
echo "==================================================================="
echo "  Installation complete"
echo "==================================================================="
echo ""
echo "Installed to: $INSTALL_PATH"
echo ""
echo "Try asking Claude Code:"
echo "  * /audit-cpi"
echo "  * Audit this program for CPI return-data spoofing"
echo "  * Check for arbitrary CPI vulnerabilities"
echo ""
echo "To run the PoCs:"
echo "  cd poc/return-data-spoofing && npm install && npm test"
echo "  cd poc/arbitrary-cpi        && npm install && npm test"
echo ""

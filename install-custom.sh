#!/bin/bash

# solana-cpi-safety-skill - Custom Installer
# Accepts a target directory as first argument, or prompts interactively.
# Usage: ./install-custom.sh [TARGET_DIR]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="solana-cpi-safety"

# Default paths
PERSONAL_SKILLS_DIR="$HOME/.claude/skills"
PROJECT_SKILLS_DIR="./.claude/skills"

# Installation target (resolved during prompts or from arg)
INSTALL_PATH=""

print_banner() {
    echo ""
    echo "==================================================================="
    echo "  solana-cpi-safety-skill - Custom Installer"
    echo "  Solana CPI safety skill for Claude Code"
    echo "  RECTOR-LABS"
    echo "==================================================================="
    echo ""
}

print_help() {
    echo "solana-cpi-safety-skill - Custom Installer"
    echo ""
    echo "Usage: ./install-custom.sh [TARGET_DIR]"
    echo ""
    echo "  TARGET_DIR   Install skill bundle to this directory."
    echo "               If omitted, an interactive location prompt appears."
    echo ""
    echo "Options:"
    echo "  -h, --help   Show this help"
    echo ""
    echo "Examples:"
    echo "  ./install-custom.sh"
    echo "  ./install-custom.sh ~/.claude/skills/solana-cpi-safety"
    echo "  ./install-custom.sh ./.claude/skills/solana-cpi-safety"
    echo ""
}

prompt_install_location() {
    echo "Select Installation Location"
    echo "-------------------------------------------------------------------"
    echo ""
    echo "  [1] Personal skills  (~/.claude/skills/)    available to all projects"
    echo "  [2] Current project  (./.claude/skills/)    this project only"
    echo "  [3] Custom path      (enter manually)"
    echo "  [4] Cancel"
    echo ""

    read -p "Select option [1-4]: " choice

    case $choice in
        1)
            INSTALL_PATH="$PERSONAL_SKILLS_DIR/$SKILL_NAME"
            ;;
        2)
            INSTALL_PATH="$PROJECT_SKILLS_DIR/$SKILL_NAME"
            ;;
        3)
            echo ""
            read -p "Enter target path: " custom_path
            if [ -z "$custom_path" ]; then
                echo "[ERROR] No path entered. Installation cancelled."
                exit 1
            fi
            INSTALL_PATH="$custom_path"
            ;;
        4)
            echo "Installation cancelled."
            exit 0
            ;;
        *)
            echo "[ERROR] Invalid option. Installation cancelled."
            exit 1
            ;;
    esac
}

validate_source() {
    for dir in skill commands agents rules; do
        if [ ! -d "$SCRIPT_DIR/$dir" ]; then
            echo "[ERROR] Source directory '$dir' not found in $SCRIPT_DIR"
            exit 1
        fi
    done
}

install_skill_bundle() {
    echo ""
    echo "--- Installing Skill Bundle ---"
    echo ""

    # Confirm overwrite if path exists and is non-empty
    if [ -d "$INSTALL_PATH" ] && [ "$(ls -A "$INSTALL_PATH" 2>/dev/null)" ]; then
        echo "Warning: '$INSTALL_PATH' already exists and is not empty."
        read -p "Overwrite? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Skipping skill bundle installation."
            return 0
        fi
        rm -rf "$INSTALL_PATH"
    fi

    mkdir -p "$INSTALL_PATH"

    for dir in skill commands agents rules; do
        cp -r "$SCRIPT_DIR/$dir" "$INSTALL_PATH/"
        echo "  [OK] $dir/ -> $INSTALL_PATH/$dir/"
    done

    echo ""
    echo "  Installed files:"
    find "$INSTALL_PATH" -type f -name "*.md" | sort | while read -r f; do
        echo "    * $(basename "$f")"
    done
}

print_success() {
    echo ""
    echo "==================================================================="
    echo "  Installation complete"
    echo "==================================================================="
    echo ""
    echo "Skill bundle: $INSTALL_PATH"
    echo ""
    echo "Try asking Claude Code:"
    echo "  * /audit-cpi"
    echo "  * Audit this program for CPI return-data spoofing"
    echo "  * Check for arbitrary CPI vulnerabilities"
    echo "  * Are there stale-account-after-CPI bugs in my program?"
    echo ""
    echo "To run the PoCs:"
    echo "  cd poc/return-data-spoofing && npm install && npm test"
    echo "  cd poc/arbitrary-cpi        && npm install && npm test"
    echo ""
    echo "To add to Solana AI Kit:"
    echo "  git submodule add https://github.com/RECTOR-LABS/solana-cpi-safety-skill.git \\"
    echo "    .claude/skills/ext/solana-cpi-safety"
    echo ""
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            print_help
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            # First positional arg is the target path
            INSTALL_PATH="$1"
            shift
            ;;
    esac
done

# Main execution
print_banner
validate_source

# Resolve install path if not provided
if [ -z "$INSTALL_PATH" ]; then
    prompt_install_location
fi

echo ""
echo "Install target: $INSTALL_PATH"
echo ""
read -p "Proceed? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Installation cancelled."
    exit 0
fi

install_skill_bundle
print_success

#!/bin/bash
# HumHum Hook Installer
# Installs HumHum hook scripts into Claude Code's settings.
#
# Usage: ./install.sh [--port PORT]
#
# This script:
#   1. Copies hook scripts to ~/.humhum/hooks/
#   2. Makes them executable
#   3. Merges hook configuration into ~/.claude/settings.json
#   4. Preserves existing hooks from other tools

set -euo pipefail

HUMHUM_HOME="$HOME/.humhum"
HOOK_DIR="$HUMHUM_HOME/hooks"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-31275}"

echo "🎙️  HumHum Hook Installer"
echo "========================="
echo ""

# Create directories
mkdir -p "$HOOK_DIR"
mkdir -p "$HOME/.claude"

# Copy hook script
cp "$SCRIPT_DIR/humhum-hook.sh" "$HOOK_DIR/humhum-hook.sh"
chmod +x "$HOOK_DIR/humhum-hook.sh"

echo "✓ Hook script installed to $HOOK_DIR/humhum-hook.sh"

# Build the hook configuration
HOOK_CMD="$HOOK_DIR/humhum-hook.sh"

# Read existing settings or create empty object
if [ -f "$CLAUDE_SETTINGS" ]; then
  SETTINGS=$(cat "$CLAUDE_SETTINGS")
else
  SETTINGS="{}"
fi

# Use Python to safely merge hooks into settings (avoids jq dependency)
NEW_SETTINGS=$(python3 -c "
import json, sys

settings = json.loads('''$SETTINGS''')
if not isinstance(settings, dict):
    settings = {}

hooks = settings.get('hooks', {})

# HumHum hook entries
hook_cmd = '$HOOK_CMD'
humhum_hooks = {
    'PermissionRequest': [{
        'hooks': [{
            'type': 'command',
            'command': hook_cmd,
            'timeout': 120000
        }]
    }],
    'Stop': [{
        'hooks': [{
            'type': 'command',
            'command': hook_cmd
        }]
    }],
    'TaskCompleted': [{
        'hooks': [{
            'type': 'command',
            'command': hook_cmd
        }]
    }],
    'Notification': [{
        'hooks': [{
            'type': 'command',
            'command': hook_cmd
        }]
    }]
}

# Merge (HumHum entries override existing ones for these events)
for key, value in humhum_hooks.items():
    hooks[key] = value

settings['hooks'] = hooks
print(json.dumps(settings, indent=2))
" 2>/dev/null) || {
  echo "⚠ Warning: Python3 not found, using basic merge"
  # Fallback: just write the hooks directly
  NEW_SETTINGS=$(echo "$SETTINGS" | python3 -c "
import json, sys
settings = json.load(sys.stdin) if sys.stdin.read().strip() else {}
settings['hooks'] = settings.get('hooks', {})
settings['hooks']['PermissionRequest'] = [{'hooks': [{'type': 'command', 'command': '$HOOK_CMD', 'timeout': 120000}]}]
settings['hooks']['Stop'] = [{'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]
settings['hooks']['TaskCompleted'] = [{'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]
settings['hooks']['Notification'] = [{'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]
print(json.dumps(settings, indent=2))
")
}

# Write settings
echo "$NEW_SETTINGS" > "$CLAUDE_SETTINGS"

echo "✓ Hooks configured in $CLAUDE_SETTINGS"
echo ""
echo "Installed hooks:"
echo "  • PermissionRequest → voice confirmation"
echo "  • Stop              → task completion broadcast"
echo "  • TaskCompleted     → task summary broadcast"
echo "  • Notification      → notification broadcast"
echo ""
echo "⚡ Restart Claude Code for changes to take effect."
echo "   Verify with /hooks inside Claude Code."
echo ""
echo "✅ Installation complete!"

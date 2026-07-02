#!/bin/bash
# HumHum Hook Uninstaller
# Removes HumHum hooks from Claude Code's settings.
# Preserves other hooks from different tools.

set -euo pipefail

CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "🎙️  HumHum Hook Uninstaller"
echo "==========================="
echo ""

if [ ! -f "$CLAUDE_SETTINGS" ]; then
  echo "No Claude Code settings found at $CLAUDE_SETTINGS"
  exit 0
fi

# Use Python to safely remove HumHum hooks
python3 -c "
import json

with open('$CLAUDE_SETTINGS', 'r') as f:
    settings = json.load(f)

hooks = settings.get('hooks', {})

# Remove HumHum events
for event in ['PermissionRequest', 'Stop', 'TaskCompleted', 'Notification']:
    if event in hooks:
        del hooks[event]
        print(f'  Removed hook: {event}')

settings['hooks'] = hooks

with open('$CLAUDE_SETTINGS', 'w') as f:
    json.dump(settings, f, indent=2)

print()
print('✅ HumHum hooks removed successfully!')
print('   Restart Claude Code for changes to take effect.')
" 2>/dev/null || {
  echo "⚠ Python3 required for safe settings modification"
  echo "  You can manually remove HumHum hooks from $CLAUDE_SETTINGS"
}

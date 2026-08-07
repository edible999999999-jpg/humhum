import type { VoiceCommand } from "@/types";
import { VOICE_COMMANDS } from "./commands";

/**
 * Voice command handler — routes recognized text to the appropriate action.
 */
export interface CommandHandler {
  onConfirm: () => void;
  onReject: () => void;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  onRepeat: () => void;
}

/**
 * Read-only / low-consequence tools that voice alone may approve. This is an
 * allow-list on purpose: anything not listed here — including tools we don't
 * recognize — is treated as high-risk and needs a button or keyboard press,
 * because a misrecognized "yes" must never run a shell command or write a file.
 */
const VOICE_APPROVABLE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
]);

/**
 * A tool requires manual (button/keyboard) confirmation unless it is on the
 * explicit low-risk allow-list. Unknown or missing tool names default to
 * requiring manual confirmation.
 */
export function requiresManualConfirmation(toolName: string | null | undefined): boolean {
  if (!toolName) return true;
  return !VOICE_APPROVABLE_TOOLS.has(toolName);
}

/**
 * Negation markers. If any appears, the utterance can never resolve to
 * "confirm": "不允许" / "don't allow" must deny, not approve. Rejection is
 * still matched normally below, so a negated phrase lands on reject or unknown.
 */
const NEGATION_MARKERS = ["不", "别", "勿", "no", "not", "don't", "do not", "never"];

function hasNegation(normalized: string): boolean {
  return NEGATION_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Precise trigger match. For CJK triggers we keep containment (Chinese has no
 * word delimiters), but for ASCII triggers we require a word boundary so that
 * "yes" does not fire inside "yesterday" and "no" does not fire inside "now".
 */
function matchesTrigger(normalized: string, trigger: string): boolean {
  const lower = trigger.toLowerCase();
  if (/^[\x00-\x7f]+$/.test(lower)) {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized);
  }
  return normalized.includes(lower);
}

/**
 * Match spoken text to a command.
 *
 * Order matters: rejection is evaluated before confirmation, and any negated
 * utterance is barred from confirming. This prevents a substring like "允许"
 * inside "不允许" from being read as approval.
 */
export function matchCommand(text: string): VoiceCommand {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return "unknown";

  const ordered = [...VOICE_COMMANDS].sort((a, b) => rank(a.command) - rank(b.command));
  for (const def of ordered) {
    if (def.command === "confirm" && hasNegation(normalized)) continue;
    for (const trigger of def.triggers) {
      if (matchesTrigger(normalized, trigger)) {
        return def.command;
      }
    }
  }

  return "unknown";
}

/** Reject is checked first; confirm last, so negations resolve safely. */
function rank(command: VoiceCommand): number {
  if (command === "reject") return 0;
  if (command === "confirm") return 100;
  return 50;
}

/** Execute a matched command */
export function executeCommand(
  command: VoiceCommand,
  handler: CommandHandler
): boolean {
  switch (command) {
    case "confirm":
      handler.onConfirm();
      return true;
    case "reject":
      handler.onReject();
      return true;
    case "skip":
      handler.onSkip();
      return true;
    case "pause":
      handler.onPause();
      return true;
    case "resume":
      handler.onResume();
      return true;
    case "repeat":
      handler.onRepeat();
      return true;
    case "unknown":
      console.log(`[VoiceCommand] Unrecognized command`);
      return false;
  }
}

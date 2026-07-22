// ============================================================
// Expression Triggers — hook event → ExpressionId mapping.
// Kept as pure functions so it stays testable and easy to reason about.
// ============================================================
import type { HookEvent, HookEventType } from "@/types";
import type { ExpressionId } from "./registry";

/**
 * Static hook_event_name → ExpressionId map.
 *
 * Only CARD-LESS events belong here. Events that already render an overlay card
 * (TaskCompleted/Stop → CompletionPanel, Notification → NotificationToast,
 * PermissionRequest / AskUserQuestion → Confirm/QuestionToast) now embed the
 * character face directly in the card header, so firing a standalone peek for
 * them would double-bubble. PostToolUseFailure has no card, so it still peeks.
 */
const HOOK_EVENT_TO_EXPR: Partial<Record<HookEventType, ExpressionId>> = {
  // Hexa — agent failure (no card backs this event, so a standalone peek is right)
  PostToolUseFailure: "hexa.concern",
};

/**
 * Resolve the ExpressionId that should peek for a given hook event.
 * Returns null when the event should not produce a fired peek.
 *
 * NOTE: the confirm peek (`hexa.confirm`) is intentionally NOT fired here.
 * It is a *derived* expression driven directly by the presence of a pending
 * permission / question in PetView, so it can never get stuck — it lives and
 * dies with the confirmation UI itself.
 */
export function expressionForEvent(event: HookEvent): ExpressionId | null {
  return HOOK_EVENT_TO_EXPR[event.hook_event_name] ?? null;
}

/**
 * Hype-only skill event map (custom string events emitted from the skills
 * pipeline, not part of HookEventType). Kept separate so main hook table
 * stays type-safe.
 */
const SKILL_EVENT_TO_EXPR: Record<string, ExpressionId> = {
  "hype:new-skill-found": "hype.discover",
  "hype:index-conflict": "hype.surprised",
  "hype:index-done": "hype.grin",
  "hype:suggest-memory": "hype.hopeful",
  "hype:thinking": "hype.thinking",
};

export function expressionForSkillEvent(name: string): ExpressionId | null {
  return SKILL_EVENT_TO_EXPR[name] ?? null;
}

// ----- Ambient expressions (processing variety) -----

/**
 * A pool of friendly Hype expressions that fire randomly when the agent is
 * actively processing. This gives the pet personality variety so the user
 * doesn't just see the same completion face all day.
 */
const AMBIENT_POOL: ExpressionId[] = [
  "hype.thinking",
  "hype.curious",
  "hype.excited",
  "hype.hopeful",
  "hype.grin",
];

let _ambientIdx = 0;

/**
 * Returns the next ambient expression in round-robin order.
 * Sequential cycling (not pure random) avoids repeating the same face
 * twice in a row when the pool is small.
 */
export function nextAmbientExpression(): ExpressionId {
  const id = AMBIENT_POOL[_ambientIdx % AMBIENT_POOL.length]!;
  _ambientIdx++;
  return id;
}

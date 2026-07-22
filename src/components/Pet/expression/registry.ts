// ============================================================
// Expression Registry — single source of truth for bubble peeks.
// Adding a new expression = one row here + one PNG in public/mascots/expr/.
// ============================================================
import type { BubbleCharacter } from "../Bubble";

export type ExpressionId =
  // Hexa — agent lifecycle
  | "hexa.done"
  | "hexa.confirm"
  | "hexa.concern"
  // Hush — user-cared messages
  | "hush.peek-heart"
  | "hush.peek-wave"
  | "hush.peek-alert"
  | "hush.peek-note"
  // Hype — skills / knowledge base
  | "hype.excited"
  | "hype.curious"
  | "hype.discover"
  | "hype.hopeful"
  | "hype.thinking"
  | "hype.proud"
  | "hype.surprised"
  | "hype.wink"
  | "hype.grin";

/** Duration tiers in milliseconds. `-1` means "hold until externally cleared". */
export const DURATION = {
  quick: 3000,
  normal: 4000,
  alert: 5000,
  sticky: 8000,
  persist: -1,
} as const;
export type DurationKey = keyof typeof DURATION;

/** Priority tiers — higher wins on preemption. */
export const PRIORITY = {
  base: 0,
  normal: 10,
  important: 20,
  system: 30,
} as const;
export type PriorityKey = keyof typeof PRIORITY;

export interface ExpressionDef {
  id: ExpressionId;
  character: BubbleCharacter;
  /** Filename inside public/mascots/expr/<character>/, must exist on disk. */
  image: string;
  /** Optional caption; omit for image-only peek. */
  text?: string;
  duration: DurationKey;
  priority: PriorityKey;
}

export const EXPRESSIONS: Record<ExpressionId, ExpressionDef> = {
  // ---------- Hexa — agent supervisor ----------
  "hexa.done": {
    id: "hexa.done",
    character: "hexa",
    image: "done.png",
    duration: "sticky",
    priority: "important",
  },
  "hexa.confirm": {
    id: "hexa.confirm",
    character: "hexa",
    image: "confirm.png",
    duration: "persist",
    priority: "system",
  },
  "hexa.concern": {
    id: "hexa.concern",
    character: "hexa",
    image: "concern.png",
    duration: "alert",
    priority: "important",
  },

  // ---------- Hush — user messages ----------
  "hush.peek-heart": {
    id: "hush.peek-heart",
    character: "hush",
    image: "peek-heart.png",
    duration: "normal",
    priority: "normal",
  },
  "hush.peek-wave": {
    id: "hush.peek-wave",
    character: "hush",
    image: "peek-wave.png",
    duration: "normal",
    priority: "normal",
  },
  "hush.peek-alert": {
    id: "hush.peek-alert",
    character: "hush",
    image: "peek-alert.png",
    duration: "alert",
    priority: "important",
  },
  "hush.peek-note": {
    id: "hush.peek-note",
    character: "hush",
    image: "peek-note.png",
    duration: "normal",
    priority: "normal",
  },

  // ---------- Hype — skills / knowledge base ----------
  "hype.excited": {
    id: "hype.excited",
    character: "hype",
    image: "excited.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.curious": {
    id: "hype.curious",
    character: "hype",
    image: "curious.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.discover": {
    id: "hype.discover",
    character: "hype",
    image: "discover.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.hopeful": {
    id: "hype.hopeful",
    character: "hype",
    image: "hopeful.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.thinking": {
    id: "hype.thinking",
    character: "hype",
    image: "thinking.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.proud": {
    id: "hype.proud",
    character: "hype",
    image: "proud.png",
    duration: "normal",
    priority: "normal",
  },
  "hype.surprised": {
    id: "hype.surprised",
    character: "hype",
    image: "surprised.png",
    duration: "alert",
    priority: "important",
  },
  "hype.wink": {
    id: "hype.wink",
    character: "hype",
    image: "wink.png",
    duration: "quick",
    priority: "normal",
  },
  "hype.grin": {
    id: "hype.grin",
    character: "hype",
    image: "grin.png",
    duration: "normal",
    priority: "normal",
  },
};

/** Global cooldowns to prevent flicker. */
export const COOLDOWN = {
  /** No expression fires within this many ms of the previous one. */
  global: 1000,
  /** Same expression id cannot re-fire within this many ms. */
  sameExpression: 8000,
} as const;

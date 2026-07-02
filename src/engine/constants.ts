import type { HumColors, FpsTarget, EngineConfig, AgentCreatureColors } from "./types";

export const COLORS: Record<string, HumColors> = {
  idle:       { b1: "#818cf8", b2: "#6366f1", hi: "#a5b4fc", t: "#8b5cf6", g: "#6366f1", e: "#eef2ff", bl: "#c7d2fe" },
  processing: { b1: "#60a5fa", b2: "#3b82f6", hi: "#93c5fd", t: "#2563eb", g: "#3b82f6", e: "#dbeafe", bl: "#bfdbfe" },
  speaking:   { b1: "#a78bfa", b2: "#7c3aed", hi: "#c4b5fd", t: "#6d28d9", g: "#8b5cf6", e: "#ede9fe", bl: "#ddd6fe" },
  inspect:    { b1: "#818cf8", b2: "#6366f1", hi: "#a5b4fc", t: "#8b5cf6", g: "#6366f1", e: "#eef2ff", bl: "#c7d2fe" },
  listening:  { b1: "#34d399", b2: "#059669", hi: "#6ee7b7", t: "#047857", g: "#10b981", e: "#d1fae5", bl: "#a7f3d0" },
  waiting:    { b1: "#fbbf24", b2: "#d97706", hi: "#fde68a", t: "#b45309", g: "#f59e0b", e: "#fef9c3", bl: "#fde68a" },
  completed:  { b1: "#34d399", b2: "#059669", hi: "#6ee7b7", t: "#047857", g: "#10b981", e: "#d1fae5", bl: "#a7f3d0" },
  error:      { b1: "#f9a8d4", b2: "#ec4899", hi: "#fbcfe8", t: "#db2777", g: "#f472b6", e: "#fce7f3", bl: "#fbcfe8" },
};

export const AGENT_COLORS: Record<string, AgentCreatureColors> = {
  "claude-code": { light: "#fbbf24", med: "#f97316", dark: "#ea580c" },
  codex:         { light: "#86efac", med: "#22c55e", dark: "#16a34a" },
  "qwen-code":   { light: "#93c5fd", med: "#3b82f6", dark: "#1d4ed8" },
  "gemini-cli":  { light: "#22d3ee", med: "#06b6d4", dark: "#0891b2" },
  "kimi-k1":     { light: "#d8b4fe", med: "#a855f7", dark: "#7c3aed" },
  qoderwork:     { light: "#86efac", med: "#4ade80", dark: "#16a34a" },
};

export const AGENT_BRAND_COLOR: Record<string, string> = {
  "claude-code": "#f97316",
  codex:         "#22c55e",
  "qwen-code":   "#3b82f6",
  "gemini-cli":  "#06b6d4",
  "kimi-k1":     "#a855f7",
  qoderwork:     "#4ade80",
};

export const BABY_THRESHOLD = 4;

export const FPS: FpsTarget = {
  idle: 20,
  active: 30,
  drag: 60,
};

export const DEFAULT_CONFIG: EngineConfig = {
  size: 140,
  devicePixelRatio: window.devicePixelRatio ?? 1,
  powerPreference: "low-power",
};

export const HUM_SIZE = 140;

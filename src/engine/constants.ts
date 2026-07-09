import type { HumColors, FpsTarget, EngineConfig, AgentCreatureColors } from "./types";

export const COLORS: Record<string, HumColors> = {
  idle:       { b1: "#e9fbff", b2: "#a8e7f1", hi: "#fff7fd", t: "#88ddeb", g: "#b8a7ff", e: "#2f3338", bl: "#ff9cab" },
  processing: { b1: "#dff5ff", b2: "#88d5f1", hi: "#f7fbff", t: "#6ccbe8", g: "#7eaef4", e: "#30363d", bl: "#ffadb8" },
  speaking:   { b1: "#f5ecff", b2: "#b9b1ff", hi: "#ffffff", t: "#8ddfe8", g: "#ff8f9a", e: "#2f3338", bl: "#ff9aa7" },
  inspect:    { b1: "#818cf8", b2: "#6366f1", hi: "#a5b4fc", t: "#8b5cf6", g: "#6366f1", e: "#eef2ff", bl: "#c7d2fe" },
  listening:  { b1: "#e2fff8", b2: "#8ee7d7", hi: "#ffffff", t: "#72d7c8", g: "#4ecdb5", e: "#2f3338", bl: "#ffadb8" },
  waiting:    { b1: "#fff2ca", b2: "#ffd879", hi: "#fff8db", t: "#9edcea", g: "#ffb24d", e: "#383126", bl: "#ffb3a6" },
  completed:  { b1: "#ecfff3", b2: "#9be7c5", hi: "#ffffff", t: "#82dec2", g: "#62d79d", e: "#28352e", bl: "#ffa9b6" },
  error:      { b1: "#ffe8ee", b2: "#ff9db0", hi: "#fff6f8", t: "#ffadbd", g: "#ff6d87", e: "#3f3034", bl: "#ff9aa7" },
};

export const AGENT_COLORS: Record<string, AgentCreatureColors> = {
  "claude-code": { light: "#fbbf24", med: "#f97316", dark: "#ea580c" },
  codex:         { light: "#ffffff", med: "#f8fafc", dark: "#0f172a" },
  "qwen-code":   { light: "#93c5fd", med: "#3b82f6", dark: "#1d4ed8" },
  "gemini-cli":  { light: "#22d3ee", med: "#06b6d4", dark: "#0891b2" },
  "kimi-k1":     { light: "#d8b4fe", med: "#a855f7", dark: "#7c3aed" },
  qoder:         { light: "#a5b4fc", med: "#6366f1", dark: "#4338ca" },
  qoderwork:     { light: "#86efac", med: "#4ade80", dark: "#16a34a" },
};

export const AGENT_BRAND_COLOR: Record<string, string> = {
  "claude-code": "#f97316",
  codex:         "#f8fafc",
  "qwen-code":   "#3b82f6",
  "gemini-cli":  "#06b6d4",
  "kimi-k1":     "#a855f7",
  qoder:         "#6366f1",
  qoderwork:     "#4ade80",
};

export const AGENT_ICON_SRC: Record<string, string> = {
  "claude-code": "/agents/claude-code.png",
  codex:         "/agents/codex.svg",
  "qwen-code":   "/agents/qwen-code.png",
  "gemini-cli":  "/agents/gemini-cli.png",
  "kimi-k1":     "/agents/kimi-k1.png",
  qoder:         "/agents/qoder.png",
  qoderwork:     "/agents/qoderwork.png",
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

export interface MascotTheme {
  id: string;
  label: string;
  accent: string;
  icon?: string;
  monogram: string;
}

export const MASCOT_THEMES: MascotTheme[] = [
  { id: "humi", label: "Humi", accent: "#8ddfe8", monogram: "H" },
  { id: "claude-code", label: "Claude Code", accent: "#f97316", icon: "/agents/claude-code.png", monogram: "C" },
  { id: "codex", label: "Codex", accent: "#22c55e", icon: "/agents/codex.svg", monogram: "X" },
  { id: "qwen-code", label: "Qwen Code", accent: "#3b82f6", icon: "/agents/qwen-code.png", monogram: "Q" },
  { id: "gemini-cli", label: "Gemini CLI", accent: "#06b6d4", icon: "/agents/gemini-cli.png", monogram: "G" },
  { id: "kimi-k1", label: "Kimi", accent: "#a855f7", icon: "/agents/kimi-k1.png", monogram: "K" },
  { id: "qoderwork", label: "QoderWork", accent: "#4ade80", icon: "/agents/qoderwork.png", monogram: "Q" },
  { id: "qoder", label: "Qoder", accent: "#84cc16", monogram: "Q" },
  { id: "codebuddy", label: "CodeBuddy", accent: "#fb7185", monogram: "B" },
  { id: "workbuddy", label: "WorkBuddy", accent: "#f472b6", monogram: "W" },
  { id: "cursor", label: "Cursor", accent: "#64748b", monogram: "⌁" },
  { id: "github-copilot", label: "Copilot", accent: "#6366f1", monogram: "GH" },
  { id: "opencode", label: "OpenCode", accent: "#14b8a6", monogram: "O" },
  { id: "hermes", label: "Hermes Agent", accent: "#0f9f8f", monogram: "H" },
  { id: "openclaw", label: "OpenClaw", accent: "#e85d4a", icon: "/agents/openclaw.png", monogram: "OC" },
  { id: "pi", label: "Pi Agent", accent: "#38bdf8", monogram: "π" },
  { id: "wukong", label: "Wukong", accent: "#eab308", icon: "/agents/wukong.png", monogram: "W" },
];

const THEMES_BY_ID = new Map(MASCOT_THEMES.map((theme) => [theme.id, theme]));

export function resolveMascotTheme(
  client: string | null | undefined,
  overrides?: Record<string, string>,
): MascotTheme {
  const defaultTheme = (client && THEMES_BY_ID.get(client)) || THEMES_BY_ID.get("humi")!;
  const override = client ? overrides?.[client] : undefined;
  return (override && THEMES_BY_ID.get(override)) || defaultTheme;
}

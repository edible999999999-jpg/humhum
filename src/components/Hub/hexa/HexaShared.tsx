import { type ReactNode } from "react";
import { type HexaSupervisorSession } from "../../../hooks/useHexaData";
import { t } from "@/lib/i18n";

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b",
  codex: "#22c55e",
  qoderwork: "#fb7185",
  qoder: "#fb7185",
  codebuddy: "#f97316",
  workbuddy: "#14b8a6",
  "qwen-code": "#8b5cf6",
  "gemini-cli": "#38bdf8",
  "kimi-k1": "#f97316",
  hermes: "#0f9f8f",
  openclaw: "#e85d4a",
  wukong: "#eab308",
};

export const STATUS_COLORS: Record<HexaSupervisorSession["progress_status"], string> = {
  working: "#22c55e",
  waiting: "#facc15",
  looping: "#fb923c",
  stalled: "#f87171",
  idle: "#38bdf8",
  completed: "#64748b",
};

export function getClientColor(client: string): string {
  return CLIENT_COLORS[client] || "#94eff4";
}

export function formatTimeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

export function scoreColor(score: number): string {
  if (score >= 78) return "#22c55e";
  if (score >= 58) return "#38bdf8";
  if (score >= 38) return "#f59e0b";
  return "#f87171";
}

function MetricSummaryItem({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  tone: "progress" | "attention" | "complete" | "alert";
  detail: string;
}) {
  return (
    <div className="hexa-metric-summary-item" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

export function HexaMetricSummary({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    tone: "progress" | "attention" | "complete" | "alert";
    detail: string;
  }>;
}) {
  return (
    <div className="hexa-metric-summary" aria-label={t("hexa.metricSummaryLabel")}>
      {items.map((item) => (
        <MetricSummaryItem key={item.label} {...item} />
      ))}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 9px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.16)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ color: "#7b8ba0", fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          color: "#475569",
          fontSize: 12,
          fontWeight: 800,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ReadoutBlock({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div
      style={{
        padding: "9px 10px",
        borderRadius: 8,
        background: `${tone}0d`,
        border: `1px solid ${tone}24`,
      }}
    >
      <div style={{ color: tone, fontSize: 10, fontWeight: 850, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#475569", fontSize: 12, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

export function ChipGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "#7b8ba0", fontSize: 10, fontWeight: 750, marginBottom: 5 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {values.map((value, index) => (
          <span
            key={`${title}-${value}-${index}`}
            style={{
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "3px 7px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.045)",
              color: "#7b8ba0",
              fontSize: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div
      style={{
        padding: 32,
        borderRadius: 8,
        background: "rgba(255,255,255,0.018)",
        border: "1px dashed rgba(255,255,255,0.08)",
        textAlign: "center",
      }}
    >
      <div style={{ color: "#475569", fontSize: 13, fontWeight: 800 }}>
        {t("hexa.emptyNoSessions")}
      </div>
      <div style={{ color: "#7b8ba0", fontSize: 11, marginTop: 6 }}>
        {t("hexa.emptyNoSessionsHint")}
      </div>
    </div>
  );
}

export function SessionSection({
  title,
  count,
  detail,
  children,
}: {
  title: string;
  count: number;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="hexa-scanned-group">
      <div className="hexa-scanned-group-heading">
        <strong>
          {title} <span>({count})</span>
        </strong>
        <small>{detail}</small>
      </div>
      {children}
    </div>
  );
}

export function AgentSessionGroup({
  agent,
  count,
  collapsed,
  onToggle,
  children,
}: {
  agent: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`hexa-scanned-agent ${collapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        className="hexa-scanned-agent-toggle"
      >
        <strong>{collapsed ? "▸" : "▾"} {agent}</strong>
        <small>{count} scanned sessions</small>
      </button>
      {!collapsed && children}
    </div>
  );
}

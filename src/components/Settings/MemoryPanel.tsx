import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/lib/i18n/react";
import type { AgentStats } from "@/types";

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "qwen-code": "Qwen Code",
  "gemini-cli": "Gemini CLI",
  "kimi-k1": "Kimi K1",
  qoderwork: "QoderWork",
  hermes: "Hermes Agent",
  wukong: "Wukong",
};

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "rgba(251, 146, 60, 0.8)",
  codex: "rgba(52, 211, 153, 0.8)",
  "qwen-code": "rgba(96, 165, 250, 0.8)",
  "gemini-cli": "rgba(94, 224, 232, 0.8)",
  "kimi-k1": "rgba(168, 139, 250, 0.8)",
  qoderwork: "rgba(251, 113, 133, 0.8)",
  hermes: "rgba(15, 159, 143, 0.8)",
  wukong: "rgba(234, 179, 8, 0.8)",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export function MemoryPanel() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await invoke<AgentStats[]>("get_agent_stats");
        setAgents(data);
      } catch (e) {
        console.error("Failed to load agent stats:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-white/30 text-xs">{t("stats.loading")}</span>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <svg className="opacity-30" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <p className="text-white/40 text-xs text-center leading-relaxed">
          {t("memory.noData")}<br />
          <span className="text-white/25">{t("memory.noDataHint")}</span>
        </p>
      </div>
    );
  }

  const maxCost = Math.max(...agents.map((a) => a.total_cost_usd), 0.001);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="mb-1">
        <h2 className="text-[13px] font-semibold text-white/75">{t("memory.title")}</h2>
        <p className="text-[10px] text-white/25 mt-0.5">{t("memory.subtitle")}</p>
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-2 gap-2">
        {agents.map((agent) => (
          <AgentCard key={agent.client_type} agent={agent} />
        ))}
      </div>

      {/* Cost Ranking */}
      <section className="kawaii-card">
        <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">
          {t("memory.costRanking")}
        </h3>
        <div className="space-y-2">
          {agents.map((agent) => {
            const pct = (agent.total_cost_usd / maxCost) * 100;
            const color = CLIENT_COLORS[agent.client_type] ?? "rgba(148, 239, 244, 0.6)";
            return (
              <div key={agent.client_type} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: color }}
                    />
                    <span className="text-[11px] text-white/60">
                      {CLIENT_LABELS[agent.client_type] ?? agent.client_type}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-white/70">
                    {formatCost(agent.total_cost_usd)}
                  </span>
                </div>
                <div className="kawaii-progress-bar">
                  <div
                    className="kawaii-progress-segment"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: color,
                      borderRadius: "3px",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Efficiency Table */}
      <section className="kawaii-card">
        <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">
          {t("memory.efficiency")}
        </h3>
        <div className="space-y-2">
          {agents.map((agent) => {
            const cacheTotal = agent.total_cache_creation_tokens + agent.total_cache_read_tokens;
            const cacheRate =
              agent.total_tokens > 0
                ? ((agent.total_cache_read_tokens / agent.total_tokens) * 100).toFixed(0)
                : "0";
            const color = CLIENT_COLORS[agent.client_type] ?? "rgba(148, 239, 244, 0.6)";
            return (
              <div key={agent.client_type} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                  <span className="text-white/55">
                    {CLIENT_LABELS[agent.client_type] ?? agent.client_type}
                  </span>
                </div>
                <div className="flex gap-3 text-white/40">
                  <span title={t("memory.avgCost")}>
                    {formatCost(agent.avg_cost_per_session)}/s
                  </span>
                  <span title={t("memory.cacheHitRate")}>
                    {cacheRate}% cache
                  </span>
                  <span title={t("memory.inputOutput")}>
                    {formatTokens(agent.total_input_tokens)}/{formatTokens(agent.total_output_tokens)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentStats }) {
  const { t } = useTranslation();
  const color = CLIENT_COLORS[agent.client_type] ?? "rgba(148, 239, 244, 0.6)";
  const label = CLIENT_LABELS[agent.client_type] ?? agent.client_type;

  const sparkData = agent.daily_data.map((d) => d.tokens);

  return (
    <div
      className="kawaii-stat-card"
      style={{ "--glow-color": color.replace(/[\d.]+\)$/, "0.04)") } as React.CSSProperties}
    >
      {/* Agent name */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-semibold text-white/70">{label}</span>
      </div>

      {/* Primary stat: cost */}
      <div className="kawaii-stat-value">{formatCost(agent.total_cost_usd)}</div>

      {/* Secondary stats */}
      <div className="text-[9px] text-white/25 mt-0.5 leading-tight space-y-0.5">
        <div>
          {agent.total_sessions} {t("memory.sessions")} · {formatTokens(agent.total_tokens)} {t("memory.tokens")}
        </div>
        <div>
          {t("memory.avgCost")}: {formatCost(agent.avg_cost_per_session)}
        </div>
      </div>

      {/* Sparkline */}
      {sparkData.length >= 2 && (
        <Sparkline data={sparkData} color={color} fillColor={color.replace(/[\d.]+\)$/, "0.08)")} />
      )}

      {/* Top tools */}
      {agent.top_tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {agent.top_tools.slice(0, 3).map(([name]) => (
            <span key={name} className="kawaii-badge text-[8px]">{name}</span>
          ))}
        </div>
      )}

      {/* Models */}
      {agent.models_used.length > 0 && (
        <div className="text-[8px] text-white/20 mt-1 truncate">
          {agent.models_used.map((m) => m.split("/").pop() ?? m).join(", ")}
        </div>
      )}
    </div>
  );
}

function Sparkline({
  data,
  width = 100,
  height = 24,
  color = "rgba(148, 239, 244, 0.6)",
  fillColor = "rgba(148, 239, 244, 0.08)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-1.5"
    >
      <path d={fillPath} fill={fillColor} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

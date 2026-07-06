import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/lib/i18n/react";

interface DailyBucket {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  session_count: number;
  estimated_cost_usd: number;
  clients: Record<string, number>;
}

interface AggregatedStats {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  active_agents: number;
  total_tool_calls: number;
  unique_tool_names: string[];
  total_sessions: number;
  sessions_by_client: Record<string, number>;
  cost_today_usd: number;
  cost_7d_usd: number;
  cost_30d_usd: number;
  daily_buckets: DailyBucket[];
}

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "qwen-code": "Qwen Code",
  "gemini-cli": "Gemini CLI",
  "kimi-k1": "Kimi K1",
  qoderwork: "QoderWork",
};

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-500/80",
  codex: "bg-emerald-500/80",
  "qwen-code": "bg-blue-500/80",
  "gemini-cli": "bg-cyan-400/80",
  "kimi-k1": "bg-purple-500/80",
  qoderwork: "bg-rose-400/80",
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

export function StatsPanel() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await invoke<AggregatedStats>("get_stats");
        setStats(data);
      } catch (e) {
        console.error("Failed to load stats:", e);
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

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-white/30 text-xs">{t("stats.loadFailed")}</span>
      </div>
    );
  }

  const hasData = stats.total_tokens > 0 || stats.total_sessions > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <svg className="opacity-30" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <p className="text-white/40 text-xs text-center leading-relaxed">
          {t("stats.noData")}<br />
          <span className="text-white/25">
            {t("stats.noDataHint")}
          </span>
        </p>
      </div>
    );
  }

  const tokenSpark = stats.daily_buckets.map((b) => b.total_tokens);
  const sessionSpark = stats.daily_buckets.map((b) => b.session_count);
  const toolSpark = stats.daily_buckets.map((b) => b.tool_calls);

  const inputPct = stats.total_tokens > 0 ? (stats.total_input_tokens / stats.total_tokens) * 100 : 0;
  const outputPct = stats.total_tokens > 0 ? (stats.total_output_tokens / stats.total_tokens) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Section title */}
      <div className="mb-1">
        <h2 className="text-[13px] font-semibold text-white/75">{t("stats.title")}</h2>
        <p className="text-[10px] text-white/25 mt-0.5">
          {t("stats.subtitle")}
        </p>
      </div>

      {/* 2x2 Stat Cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label={t("stats.tokenUsage")}
          value={formatTokens(stats.total_tokens)}
          subtitle={t("stats.tokenBreakdown", { input: formatTokens(stats.total_input_tokens), output: formatTokens(stats.total_output_tokens) })}
          sparkData={tokenSpark}
          color="rgba(148, 239, 244, 0.6)"
          fillColor="rgba(148, 239, 244, 0.06)"
          glowColor="rgba(148, 239, 244, 0.04)"
        />
        <StatCard
          label={t("stats.activeAgents")}
          value={String(stats.active_agents)}
          subtitle={t("stats.agentSubtitle")}
          sparkData={sessionSpark}
          color="rgba(94, 224, 232, 0.5)"
          fillColor="rgba(94, 224, 232, 0.06)"
          glowColor="rgba(94, 224, 232, 0.04)"
        />
        <StatCard
          label={t("stats.toolCalls")}
          value={formatTokens(stats.total_tool_calls)}
          subtitle={t("stats.toolSubtitle")}
          sparkData={toolSpark}
          color="rgba(255, 214, 158, 0.5)"
          fillColor="rgba(255, 214, 158, 0.06)"
          glowColor="rgba(255, 214, 158, 0.04)"
        />
        <StatCard
          label={t("stats.sessions")}
          value={String(stats.total_sessions)}
          subtitle={t("stats.sessionSubtitle")}
          sparkData={sessionSpark}
          color="rgba(52, 211, 153, 0.5)"
          fillColor="rgba(52, 211, 153, 0.06)"
          glowColor="rgba(52, 211, 153, 0.04)"
        />
      </div>

      {/* Cost Estimation */}
      <section className="kawaii-card">
        <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">{t("stats.costTitle")}</h3>
        <div className="grid grid-cols-3 gap-3">
          <CostItem label={t("stats.today")} cost={stats.cost_today_usd} />
          <CostItem label={t("stats.days7")} cost={stats.cost_7d_usd} />
          <CostItem label={t("stats.days30")} cost={stats.cost_30d_usd} />
        </div>
      </section>

      {/* Token Breakdown */}
      <section className="kawaii-card">
        <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">{t("stats.tokenDist")}</h3>
        <div className="kawaii-progress-bar mb-2">
          <div
            className="kawaii-progress-segment"
            style={{
              width: `${inputPct}%`,
              background: "rgba(148, 239, 244, 0.5)",
              borderRadius: "3px 0 0 3px",
            }}
          />
          <div
            className="kawaii-progress-segment"
            style={{
              width: `${outputPct}%`,
              background: "rgba(255, 214, 158, 0.45)",
              borderRadius: "0 3px 3px 0",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-white/35">
          <span>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: "rgba(148, 239, 244, 0.6)" }} />
            {t("stats.input")} {inputPct.toFixed(0)}%
          </span>
          <span>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: "rgba(255, 214, 158, 0.6)" }} />
            {t("stats.output")} {outputPct.toFixed(0)}%
          </span>
        </div>
        {stats.total_cache_creation_tokens + stats.total_cache_read_tokens > 0 && (
          <div className="mt-2 text-[10px] text-white/20">
            {t("stats.cacheWrite")} {formatTokens(stats.total_cache_creation_tokens)} · {t("stats.cacheRead")} {formatTokens(stats.total_cache_read_tokens)}
          </div>
        )}
      </section>

      {/* Sessions by Client */}
      {Object.keys(stats.sessions_by_client).length > 0 && (
        <section className="kawaii-card">
          <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">{t("stats.agentDist")}</h3>
          <div className="space-y-2">
            {Object.entries(stats.sessions_by_client)
              .sort(([, a], [, b]) => b - a)
              .map(([client, count]) => (
                <div key={client} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${CLIENT_COLORS[client] ?? "bg-slate-500"}`}
                    />
                    <span className="text-[12px] text-white/60">
                      {CLIENT_LABELS[client] ?? client}
                    </span>
                  </div>
                  <span className="kawaii-badge">{count}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Tool Names */}
      {stats.unique_tool_names.length > 0 && (
        <section className="kawaii-card">
          <h3 className="text-[11px] font-semibold text-white/50 mb-3 uppercase tracking-wider">{t("stats.toolsUsed")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {stats.unique_tool_names.map((name) => (
              <span key={name} className="kawaii-badge text-[10px]">
                {name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  sparkData,
  color,
  fillColor,
  glowColor,
}: {
  label: string;
  value: string;
  subtitle: string;
  sparkData: number[];
  color: string;
  fillColor: string;
  glowColor: string;
}) {
  return (
    <div className="kawaii-stat-card" style={{ "--glow-color": glowColor } as React.CSSProperties}>
      <span className="kawaii-stat-label">{label}</span>
      <div className="kawaii-stat-value mt-1">{value}</div>
      <div className="text-[9px] text-white/20 mt-0.5 leading-tight">{subtitle}</div>
      {sparkData.length >= 2 && (
        <Sparkline data={sparkData} color={color} fillColor={fillColor} />
      )}
    </div>
  );
}

function CostItem({ label, cost }: { label: string; cost: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-white/30 mb-1">{label}</div>
      <div className="text-lg font-bold text-white/80 font-mono">
        {formatCost(cost)}
      </div>
    </div>
  );
}

function Sparkline({
  data,
  width = 100,
  height = 24,
  color = "rgba(168, 139, 250, 0.6)",
  fillColor = "rgba(168, 139, 250, 0.1)",
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

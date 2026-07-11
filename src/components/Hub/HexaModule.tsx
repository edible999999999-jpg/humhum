import { useState } from "react";
import { useHexaData, type HexaSupervisorSession } from "../../hooks/useHexaData";

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b",
  codex: "#22c55e",
  qoderwork: "#fb7185",
  "qwen-code": "#8b5cf6",
  "gemini-cli": "#38bdf8",
  "kimi-k1": "#f97316",
  wukong: "#eab308",
};

const STATUS_COLORS: Record<HexaSupervisorSession["progress_status"], string> = {
  working: "#22c55e",
  waiting: "#facc15",
  looping: "#fb923c",
  stalled: "#f87171",
  idle: "#38bdf8",
  completed: "rgba(255,255,255,0.42)",
};

function getClientColor(client: string): string {
  return CLIENT_COLORS[client] || "#94eff4";
}

function formatTimeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function scoreColor(score: number): string {
  if (score >= 78) return "#22c55e";
  if (score >= 58) return "#38bdf8";
  if (score >= 38) return "#f59e0b";
  return "#f87171";
}

function averageScore(items: HexaSupervisorSession[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, item) => sum + item.recent_need_score, 0) / items.length);
}

function MetricCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  tone: string;
  detail: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${tone}30`,
      }}
    >
      <div style={{ color: tone, fontSize: 22, lineHeight: 1, fontWeight: 850 }}>{value}</div>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: 750, marginTop: 6 }}>
        {label}
      </div>
      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginTop: 3, lineHeight: 1.35 }}>
        {detail}
      </div>
    </div>
  );
}

function StatusBadge({ item }: { item: HexaSupervisorSession }) {
  const color = STATUS_COLORS[item.progress_status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: `${color}16`,
        border: `1px solid ${color}38`,
        color,
        fontSize: 10,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: item.progress_status === "working" ? `0 0 8px ${color}` : "none",
        }}
      />
      {item.progress_label}
    </span>
  );
}

function NeedFitBar({ item }: { item: HexaSupervisorSession }) {
  const color = scoreColor(item.recent_need_score);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
        <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, fontWeight: 750 }}>
          最近需求满足推断
        </span>
        <span style={{ color, fontSize: 11, fontWeight: 850 }}>
          {item.recent_need_score}% · {item.recent_need_label}
        </span>
      </div>
      <div
        style={{
          height: 7,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${item.recent_need_score}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 12px ${color}55`,
          }}
        />
      </div>
      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, marginTop: 5 }}>
        {item.recent_need_basis}
      </div>
    </div>
  );
}

function SessionCard({
  item,
  reviewOpen,
  onToggleReview,
}: {
  item: HexaSupervisorSession;
  reviewOpen: boolean;
  onToggleReview: () => void;
}) {
  const color = getClientColor(item.session.client_type);
  const eventNames = item.session.event_names.slice(-6);
  const stats = item.stats;
  const isCompleted = item.session.status === "completed";
  const showReadout = !isCompleted || reviewOpen;

  return (
    <article
      style={{
        borderRadius: 8,
        background: "rgba(255,255,255,0.026)",
        border: "1px solid rgba(255,255,255,0.065)",
        borderLeft: `3px solid ${color}`,
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
            <span style={{ color, fontSize: 11, fontWeight: 850 }}>{item.agent_label}</span>
            <StatusBadge item={item} />
            {item.pending_confirmations > 0 && (
              <span
                style={{
                  color: "#facc15",
                  background: "rgba(250,204,21,0.1)",
                  border: "1px solid rgba(250,204,21,0.24)",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 850,
                }}
              >
                等待确认
              </span>
            )}
          </div>
          <h3
            style={{
              margin: 0,
              color: "rgba(255,255,255,0.9)",
              fontSize: 15,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {item.display_name}
          </h3>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.52)", fontSize: 12, lineHeight: 1.45 }}>
            {item.project_intent}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 18, fontWeight: 850 }}>
            {item.session.event_count}
          </div>
          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>events</div>
        </div>
      </div>

      <NeedFitBar item={item} />

      {isCompleted && (
        <button
          type="button"
          onClick={onToggleReview}
          style={{
            width: "fit-content",
            border: `1px solid ${color}42`,
            background: `${color}12`,
            color,
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 850,
            cursor: "pointer",
          }}
        >
          {reviewOpen ? "收起复盘" : "打开复盘"}
        </button>
      )}

      {showReadout && (
        <>
          <ReadoutBlock title="用户最近想要" text={item.recent_user_intent} tone="#38bdf8" />
          <ReadoutBlock title="Agent 正在做" text={item.current_work} tone={color} />
          <ReadoutBlock title="感官反馈" text={item.performance_read} tone={scoreColor(item.recent_need_score)} />
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <MiniStat label="last seen" value={formatTimeAgo(item.last_seen_ms)} />
        <MiniStat label="evidence" value={item.evidence.length} />
        <MiniStat label="tokens" value={stats ? formatTokens(stats.total_tokens) : "-"} />
        <MiniStat label="loop" value={item.loop_status} />
      </div>

      {showReadout && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <ChipGroup title="判断依据" values={item.evidence.length ? item.evidence.slice(0, 4) : ["暂无依据"]} />
          <ChipGroup title="事件轨迹" values={eventNames.length ? eventNames : ["等待事件"]} />
        </div>
      )}

      {showReadout && <ReviewAction item={item} />}

      {item.alerts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {item.alerts.map((alert) => (
            <span
              key={`${item.session.session_id}-${alert.type}-${alert.message}`}
              style={{
                color: "#f59e0b",
                background: "rgba(245,158,11,0.09)",
                border: "1px solid rgba(245,158,11,0.22)",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 750,
              }}
            >
              {alert.message}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function ReviewAction({ item }: { item: HexaSupervisorSession }) {
  const isCompleted = item.session.status === "completed";
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 8,
        background: isCompleted ? "rgba(34,197,94,0.055)" : "rgba(255,255,255,0.025)",
        border: isCompleted ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.56)",
        fontSize: 11,
        lineHeight: 1.5,
        display: "grid",
        gap: 7,
      }}
    >
      <div style={{ color: isCompleted ? "#22c55e" : "rgba(255,255,255,0.36)", fontWeight: 850 }}>
        {isCompleted ? "复盘结论" : "建议提醒"}
      </div>
      <div>{item.suggested_nudge}</div>
      {isCompleted && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          <MiniStat label="fit score" value={`${item.recent_need_score}%`} />
          <MiniStat label="evidence" value={item.evidence.length} />
          <MiniStat label="events" value={item.session.event_count} />
        </div>
      )}
    </div>
  );
}

function ReadoutBlock({ title, text, tone }: { title: string; text: string; tone: string }) {
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
      <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
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
      <div style={{ color: "rgba(255,255,255,0.26)", fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          color: "rgba(255,255,255,0.7)",
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

function ChipGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 750, marginBottom: 5 }}>
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
              color: "rgba(255,255,255,0.45)",
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

function EmptyState() {
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
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, fontWeight: 800 }}>
        暂无会话
      </div>
      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, marginTop: 6 }}>
        agent hook 产生事件后，这里会显示当前工作状态和最近需求推进度。
      </div>
    </div>
  );
}

export function HexaModule() {
  const { activeSupervisorSessions, completedSupervisorSessions, supervisorSessions, alerts } = useHexaData();
  const [openReviews, setOpenReviews] = useState<Set<string>>(new Set());

  const active = activeSupervisorSessions;
  const recentCompleted = completedSupervisorSessions.slice(0, 6);
  const visibleSessions = [...active, ...recentCompleted];
  const pendingCount = active.reduce((sum, item) => sum + item.pending_confirmations, 0);
  const workingCount = active.filter((item) => item.progress_status === "working").length;
  const attentionCount = active.filter((item) =>
    ["waiting", "looping", "stalled"].includes(item.progress_status),
  ).length;
  const score = averageScore(visibleSessions);
  const toggleReview = (sessionId: string) => {
    setOpenReviews((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return (
    <div className="hub-module">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 className="hub-module-title" style={{ marginBottom: 4 }}>Hexa Agent 看板</h2>
          <p className="hub-module-desc">
            每个活跃会话一张感官反馈卡：项目是什么、用户最近想要什么、agent 干得如何。
          </p>
        </div>
        <div
          style={{
            color: scoreColor(score),
            background: `${scoreColor(score)}14`,
            border: `1px solid ${scoreColor(score)}34`,
            borderRadius: 8,
            padding: "9px 11px",
            textAlign: "right",
            minWidth: 96,
          }}
        >
          <div style={{ fontSize: 22, lineHeight: 1, fontWeight: 900 }}>{score || "-"}</div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 4 }}>avg need fit</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="活跃会话" value={active.length} tone="#22c55e" detail={`${workingCount} 个正在推进`} />
        <MetricCard label="需要关注" value={attentionCount} tone="#f59e0b" detail={`${pendingCount} 个等待确认`} />
        <MetricCard label="最近完成" value={recentCompleted.length} tone="#38bdf8" detail="保留最近 6 个复盘样本" />
        <MetricCard label="告警信号" value={alerts.length} tone="#f87171" detail="停滞、循环、低进展" />
      </div>

      <section style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.42)",
              fontSize: 11,
              fontWeight: 850,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Sessions ({supervisorSessions.length})
          </div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
            score 优先基于 transcript 最近用户消息 + hook 事件推断
          </div>
        </div>

        {visibleSessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {visibleSessions.map((item) => (
              <SessionCard
                key={item.session.session_id}
                item={item}
                reviewOpen={openReviews.has(item.session.session_id)}
                onToggleReview={() => toggleReview(item.session.session_id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

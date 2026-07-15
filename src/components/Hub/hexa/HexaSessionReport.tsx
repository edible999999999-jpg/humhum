import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Crosshair,
  FileCheck2,
  Flag,
  ShieldQuestion,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { buildHexaSessionReport } from "../../../hooks/hexaSessionReport";
import type {
  FocusResult,
  HexaAlignment,
  HexaAuditMutationRequest,
  HexaSupervisorSession,
  HexaWatchedSession,
} from "../../../hooks/useHexaData";
import { HexaUserReview } from "./HexaUserReview";
import { HexaWorkflowEditor } from "./HexaWorkflowEditor";

const ALIGNMENT: Record<HexaAlignment, { label: string; color: string }> = {
  on_track: { label: "方向一致", color: "#22c55e" },
  watch: { label: "证据待补", color: "#f59e0b" },
  off_track: { label: "出现偏离", color: "#f87171" },
};

const STATUS: Record<HexaWatchedSession["status"], { label: string; color: string }> = {
  starting: { label: "正在接入", color: "#38bdf8" },
  working: { label: "正在推进", color: "#22c55e" },
  waiting: { label: "等待反馈", color: "#f59e0b" },
  idle: { label: "阶段空闲", color: "#94a3b8" },
  completed: { label: "本轮完成", color: "#38bdf8" },
  blocked: { label: "当前阻塞", color: "#f87171" },
};

function timeAgo(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "刚刚";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="hexa-report-metric">
      <strong style={{ color: tone ?? "#263241" }}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function HexaSessionReportView({
  session,
  supervisor,
  operations,
  onFocus,
  onDelete,
  onMutate,
}: {
  session: HexaWatchedSession;
  supervisor: HexaSupervisorSession | null;
  operations?: ReactNode;
  onFocus: (sessionId: string) => Promise<FocusResult>;
  onDelete: (sessionId: string) => Promise<void>;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
}) {
  const [focusState, setFocusState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [deleting, setDeleting] = useState(false);
  const pendingConfirmations = supervisor?.pending_confirmations ?? 0;
  const report = buildHexaSessionReport(session, pendingConfirmations);
  const alignment = ALIGNMENT[report.alignment];
  const status = STATUS[session.status];
  const evidence = [
    ...report.outputs,
    ...report.milestones.flatMap((milestone) => milestone.evidence),
    ...(report.hexaVerdict?.evidence ?? []),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);

  const focus = async () => {
    setFocusState("busy");
    try {
      await onFocus(session.session_id);
      setFocusState("done");
    } catch {
      setFocusState("error");
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete(session.session_id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="hexa-report" aria-label={`${session.name} 会话监督报告`}>
      <header className="hexa-report-header">
        <div className="hexa-report-heading">
          <div className="hexa-report-badges">
            <span style={{ color: status.color, borderColor: `${status.color}55`, background: `${status.color}12` }}>
              <CircleDot size={12} /> {status.label}
            </span>
            <span style={{ color: alignment.color, borderColor: `${alignment.color}55`, background: `${alignment.color}12` }}>
              <ShieldQuestion size={12} /> {alignment.label}
            </span>
            <span>{session.provider}</span>
          </div>
          <div className="hexa-report-eyebrow">这轮正在解决</div>
          <h3>{report.problem}</h3>
          <p>{session.current_step ?? "Agent 尚未报告当前步骤"}</p>
        </div>
        <div className="hexa-report-actions">
          <button type="button" className="kawaii-toggle-btn" onClick={() => void focus()} disabled={focusState === "busy"} title="返回这个 Agent 会话">
            <Crosshair size={15} />
          </button>
          <button type="button" className="kawaii-toggle-btn" onClick={() => void remove()} disabled={deleting} title="停止 Hexa 主动监控">
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="hexa-report-next">
        <span>下一步</span>
        <strong>{report.nextAction}</strong>
        <small>最近更新 {timeAgo(session.updated_at)}</small>
      </div>

      <div className="hexa-report-metrics">
        <Metric label="工作项" value={report.metrics.total} />
        <Metric label="已完成" value={report.metrics.completed} tone="#16a34a" />
        <Metric label="失败" value={report.metrics.failed} tone={report.metrics.failed ? "#ef4444" : undefined} />
        <Metric label="人工介入" value={report.metrics.interventions} tone="#7c3aed" />
        <Metric label="等待确认" value={report.metrics.pendingConfirmations} tone={report.metrics.pendingConfirmations ? "#d97706" : undefined} />
      </div>

      <section className="hexa-report-section">
        <div className="hexa-report-section-title">
          <span><Flag size={15} /> 审核进度</span>
          <strong>{report.progress ? `${report.progress.percent}%` : "尚未定义检查点"}</strong>
        </div>
        {report.progress ? (
          <div className="hexa-report-progress" aria-label={`审核进度 ${report.progress.percent}%`}>
            <span style={{ width: `${report.progress.percent}%` }} />
          </div>
        ) : (
          <p className="hexa-report-empty">当前只有任务目标，还没有可验证的工作项。Hexa 不会用事件数量伪造进度。</p>
        )}
        {report.successCriteria.length > 0 && (
          <ul className="hexa-report-criteria">
            {report.successCriteria.slice(0, 4).map((criterion) => <li key={criterion}>{criterion}</li>)}
          </ul>
        )}
      </section>

      <div className="hexa-report-columns">
        <section className="hexa-report-section">
          <div className="hexa-report-section-title"><span><FileCheck2 size={15} /> 重要产出</span></div>
          {report.outputs.length ? (
            <ul className="hexa-report-list output">
              {report.outputs.slice(0, 3).map((output) => <li key={output.id}>{output.label}</li>)}
            </ul>
          ) : <p className="hexa-report-empty">尚未报告可核验的重要产出</p>}
        </section>
        <section className="hexa-report-section">
          <div className="hexa-report-section-title"><span><AlertTriangle size={15} /> 风险与偏离</span></div>
          {report.risks.length ? (
            <ul className="hexa-report-list risk">
              {report.risks.slice(0, 3).map((risk) => <li key={risk.id}>{risk.summary}</li>)}
            </ul>
          ) : <p className="hexa-report-empty">目前没有证据支持的偏离结论</p>}
        </section>
      </div>

      <section className="hexa-report-section">
        <div className="hexa-report-section-title"><span><CheckCircle2 size={15} /> 会话轨迹</span><small>仅显示最近 5 个关键节点</small></div>
        {report.milestones.length ? (
          <ol className="hexa-report-timeline">
            {report.milestones.map((milestone) => (
              <li key={milestone.id} data-alignment={milestone.alignment}>
                <span>{milestone.summary}</span>
                <time>{timeAgo(milestone.created_at)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="hexa-report-empty">等待 Agent 上报第一个关键节点</p>}
      </section>

      <HexaWorkflowEditor session={session} onMutate={onMutate} />

      <section className="hexa-report-verdicts">
        <div>
          <span>Hexa 审核</span>
          <strong>{report.hexaVerdict?.label ?? "待审核"}</strong>
          <p>{report.hexaVerdict?.summary ?? "完成足够检查点后，Hexa 才会给出结论。"}</p>
        </div>
        <div>
          <span><UserRoundCheck size={14} /> 用户复盘</span>
          <strong>{report.userVerdict?.label ?? "未评价"}</strong>
          <p>{report.userVerdict?.summary ?? "本轮结束后可记录满意、一般或不满意。"}</p>
        </div>
      </section>

      <HexaUserReview session={session} onMutate={onMutate} />

      {operations}

      <details className="hexa-report-evidence">
        <summary>查看原始证据引用 ({evidence.length})</summary>
        {evidence.length ? (
          <ul>
            {evidence.map((item) => (
              <li key={item.id}><span>{item.label}</span>{item.location && <code>{item.location}</code>}</li>
            ))}
          </ul>
        ) : <p>Agent 还没有附上文件、提交、测试或事件引用。</p>}
      </details>

      {focusState === "error" && <div className="hexa-report-error">无法定位原会话，请确认对应终端仍在运行。</div>}
    </article>
  );
}

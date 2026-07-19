import { useRef, useState } from "react";
import {
  Check,
  CircleDot,
  ExternalLink,
  GitBranch,
  History,
  Trash2,
} from "lucide-react";
import type {
  HexaAgentSurface,
  HexaGoalAttempt,
  HexaGoalSummary as HexaGoalSummaryData,
  HexaGoalSummaryAttempt,
} from "../../../hooks/hexaGoalMonitoring";

const SURFACE_LABELS: Record<HexaAgentSurface, string> = {
  codex_desktop: "Codex Desktop",
  codex_cli: "Codex CLI",
  qoder_ide: "Qoder IDE",
  qoder_cli: "Qoder CLI",
  qoder_worker: "Qoder Worker",
  terminal: "终端 Agent",
  remote_worker: "远程 Worker",
  unknown: "端类型待确认",
};

const SESSION_STATUS_LABELS = {
  starting: "正在接入",
  working: "正在推进",
  waiting: "等待反馈",
  idle: "阶段空闲",
  completed: "本轮完成",
  blocked: "当前阻塞",
} as const;

const GOAL_STATUS_LABELS = {
  active: "进行中",
  waiting: "等待验证",
  completed: "已采用",
} as const;

const EVIDENCE_TRUST_RANK: Record<string, number> = {
  test: 3,
  build: 3,
  system_fact: 3,
  artifact: 2,
  reference: 2,
  agent_report: 1,
};

export function hexaSurfaceLabel(surface: HexaAgentSurface): string {
  return SURFACE_LABELS[surface];
}

export function strongestGoalEvidence(evidence: HexaGoalAttempt["evidence"]) {
  return [...evidence].sort((left, right) => {
    const trustDifference = (EVIDENCE_TRUST_RANK[right.kind.trim().toLowerCase()] ?? 1)
      - (EVIDENCE_TRUST_RANK[left.kind.trim().toLowerCase()] ?? 1);
    if (trustDifference !== 0) return trustDifference;

    const rightObservedAt = Date.parse(right.observed_at);
    const leftObservedAt = Date.parse(left.observed_at);
    return (Number.isNaN(rightObservedAt) ? 0 : rightObservedAt)
      - (Number.isNaN(leftObservedAt) ? 0 : leftObservedAt);
  })[0] ?? null;
}

function agentFamilyLabel(family: string): string {
  const normalized = family.trim().toLowerCase();
  if (normalized === "codex") return "Codex";
  if (normalized === "qoder" || normalized === "qoderwork") return "Qoder";
  if (normalized === "claude" || normalized === "claude-code") return "Claude Code";
  return family || "Agent";
}

function resultLabel({ attempt, session }: HexaGoalSummaryAttempt): string {
  if (attempt.result_status === "accepted") return "已采用";
  if (attempt.result_status === "verified") return "验证通过";
  if (attempt.result_status === "failed") return "测试失败";
  if (attempt.result_status === "superseded") return "已被替代";
  if (attempt.completed_at || session?.status === "completed") {
    return "已完成，尚未验证";
  }
  return "结果待上报";
}

function worktreeLabel(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export function HexaGoalSummary({
  summary,
  onViewSession,
  onAccept,
  onDelete,
}: {
  summary: HexaGoalSummaryData;
  onViewSession: (sessionId: string) => void;
  onAccept: (goalId: string, sessionId: string) => Promise<unknown> | unknown;
  onDelete: (goalId: string) => Promise<unknown> | unknown;
}) {
  const { goal, attempts, counts } = summary;
  const availableAttempts = attempts.filter(({ session }) => Boolean(session));
  const [pendingAction, setPendingAction] = useState<
    { kind: "accept"; sessionId: string } | { kind: "delete" } | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionPending = useRef(false);

  const runAction = async (
    action: { kind: "accept"; sessionId: string } | { kind: "delete" },
    errorMessage: string,
    mutation: () => Promise<unknown> | unknown,
  ) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setPendingAction(action);
    setActionError(null);
    try {
      await mutation();
    } catch {
      setActionError(errorMessage);
    } finally {
      actionPending.current = false;
      setPendingAction(null);
    }
  };

  return (
    <article className="hexa-goal-summary" aria-label="开发目标摘要">
      <header className="hexa-goal-summary-header">
        <div>
          <div className="hexa-goal-eyebrow">
            <CircleDot size={12} aria-hidden="true" />
            开发目标 · {GOAL_STATUS_LABELS[goal.status]}
          </div>
          <h3>{goal.title}</h3>
          {goal.success_criteria.length > 0 && (
            <ul className="hexa-goal-criteria" aria-label="成功标准">
              {goal.success_criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="hexa-goal-icon-button"
          aria-label="删除开发目标"
          title={pendingAction?.kind === "delete" ? "正在删除" : "删除开发目标"}
          disabled={pendingAction !== null}
          onClick={async () => {
            await runAction(
              { kind: "delete" },
              "删除失败，请重试。",
              () => onDelete(goal.id),
            );
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </header>

      {actionError && <div className="hexa-goal-action-error" role="alert">{actionError}</div>}

      <div className="hexa-goal-metrics" aria-label="开发目标状态摘要">
        <div><strong>{counts.total}</strong><span>全部尝试</span></div>
        <div><strong>{counts.working}</strong><span>推进中</span></div>
        <div><strong>{counts.verified}</strong><span>已验证</span></div>
        <div><strong>{counts.failed}</strong><span>失败</span></div>
        <div><strong>{counts.blocked}</strong><span>阻塞</span></div>
        <div><strong>{counts.unverified}</strong><span>待验证</span></div>
      </div>

      {availableAttempts.length >= 2 && (
        <section className="hexa-goal-comparison" aria-label="比较结果">
          <strong>比较结果</strong>
          <span>
            {availableAttempts.length} 个可用尝试可逐一核验；只有证据通过或由你采用的结果才会成为最终结论。
          </span>
        </section>
      )}

      <section className="hexa-goal-attempts" aria-label="开发目标尝试">
        {attempts.map(({ attempt, session }) => {
          const surface = hexaSurfaceLabel(attempt.surface);
          const accepted = goal.accepted_attempt_id === attempt.session_id
            || attempt.result_status === "accepted";
          const evidence = strongestGoalEvidence(attempt.evidence);
          const accepting = pendingAction?.kind === "accept"
            && pendingAction.sessionId === attempt.session_id;

          return (
            <article
              className="hexa-goal-attempt"
              data-result={attempt.result_status}
              key={attempt.session_id}
            >
              <div className="hexa-goal-attempt-heading">
                <div className="hexa-goal-attempt-identity">
                  <strong>{surface}</strong>
                  <span>{agentFamilyLabel(attempt.agent_family)}</span>
                </div>
                <div className="hexa-goal-attempt-status">
                  <span>{session ? SESSION_STATUS_LABELS[session.status] : "历史记录"}</span>
                  <strong>{session ? resultLabel({ attempt, session }) : "历史会话不可用"}</strong>
                </div>
              </div>

              {(attempt.branch || attempt.worktree) && (
                <div className="hexa-goal-attempt-context">
                  <GitBranch size={13} aria-hidden="true" />
                  {attempt.branch && <span>{attempt.branch}</span>}
                  {attempt.worktree && <small>{worktreeLabel(attempt.worktree)}</small>}
                </div>
              )}

              <div className="hexa-goal-attempt-evidence">
                {evidence ? (
                  <>
                    <Check size={13} aria-hidden="true" />
                    <span>{evidence.label}</span>
                  </>
                ) : (
                  <>
                    <History size={13} aria-hidden="true" />
                    <span>{session ? "尚未附上可核验证据" : "仅保留目标索引中的历史记录"}</span>
                  </>
                )}
              </div>

              {session && (
                <div className="hexa-goal-attempt-actions">
                  <button
                    type="button"
                    className="kawaii-toggle-btn"
                    onClick={() => onViewSession(attempt.session_id)}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    查看会话
                  </button>
                  <button
                    type="button"
                    className={`kawaii-toggle-btn ${accepted ? "connected" : ""}`}
                    disabled={accepted || pendingAction !== null}
                    onClick={async () => {
                      await runAction(
                        { kind: "accept", sessionId: attempt.session_id },
                        "采用失败，请重试。",
                        () => onAccept(goal.id, attempt.session_id),
                      );
                    }}
                  >
                    <Check size={13} aria-hidden="true" />
                    {accepted ? "已采用" : accepting ? "正在采用" : "采用此结果"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </article>
  );
}

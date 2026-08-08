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
import { t } from "@/lib/i18n";

const SURFACE_LABELS: Record<HexaAgentSurface, string> = {
  codex_desktop: "Codex Desktop",
  codex_cli: "Codex CLI",
  qoder_ide: "Qoder IDE",
  qoder_cli: "Qoder CLI",
  qoder_worker: "Qoder Worker",
  terminal: t("hexa.clientTerminal"),
  remote_worker: t("hexa.clientRemoteWorker"),
  unknown: t("hexa.clientUnknown"),
};

const SESSION_STATUS_LABELS = {
  starting: t("hexa.attemptStarting"),
  working: t("hexa.attemptWorking"),
  waiting: t("hexa.attemptWaiting"),
  idle: t("hexa.attemptIdle"),
  completed: t("hexa.attemptCompleted"),
  blocked: t("hexa.attemptBlocked"),
} as const;

const GOAL_STATUS_LABELS = {
  active: t("hexa.goalStatusActive"),
  waiting: t("hexa.goalStatusWaiting"),
  completed: t("hexa.goalStatusCompleted"),
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
  if (attempt.result_status === "accepted") return t("hexa.resultAccepted");
  if (attempt.result_status === "verified") return t("hexa.resultVerified");
  if (attempt.result_status === "failed") return t("hexa.resultFailed");
  if (attempt.result_status === "superseded") return t("hexa.resultSuperseded");
  if (attempt.completed_at || session?.status === "completed") {
    return t("hexa.resultDoneUnverified");
  }
  return t("hexa.resultPending");
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
    <article className="hexa-goal-summary" aria-label={t("hexa.goalSummaryLabel")}>
      <header className="hexa-goal-summary-header">
        <div>
          <div className="hexa-goal-eyebrow">
            <CircleDot size={12} aria-hidden="true" />
            {t("hexa.goalEyebrow", { status: GOAL_STATUS_LABELS[goal.status] })}
          </div>
          <h3>{goal.title}</h3>
          {goal.success_criteria.length > 0 && (
            <ul className="hexa-goal-criteria" aria-label={t("hexa.successCriteria")}>
              {goal.success_criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="hexa-goal-icon-button"
          aria-label={t("hexa.deleteGoal")}
          title={pendingAction?.kind === "delete" ? t("hexa.deletingGoal") : t("hexa.deleteGoal")}
          disabled={pendingAction !== null}
          onClick={async () => {
            await runAction(
              { kind: "delete" },
              t("hexa.deleteGoalFailed"),
              () => onDelete(goal.id),
            );
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </header>

      {actionError && <div className="hexa-goal-action-error" role="alert">{actionError}</div>}

      <div className="hexa-goal-metrics" aria-label={t("hexa.goalMetricsLabel")}>
        <div><strong>{counts.total}</strong><span>{t("hexa.metricTotal")}</span></div>
        <div><strong>{counts.working}</strong><span>{t("hexa.metricWorking")}</span></div>
        <div><strong>{counts.verified}</strong><span>{t("hexa.metricVerified")}</span></div>
        <div><strong>{counts.failed}</strong><span>{t("hexa.metricFailed")}</span></div>
        <div><strong>{counts.blocked}</strong><span>{t("hexa.metricBlocked")}</span></div>
        <div><strong>{counts.unverified}</strong><span>{t("hexa.metricUnverified")}</span></div>
      </div>

      {availableAttempts.length >= 2 && (
        <section className="hexa-goal-comparison" aria-label={t("hexa.comparisonLabel")}>
          <strong>{t("hexa.comparisonLabel")}</strong>
          <span>
            {t("hexa.comparisonNote", { count: availableAttempts.length })}
          </span>
        </section>
      )}

      <section className="hexa-goal-attempts" aria-label={t("hexa.goalAttemptsLabel")}>
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
                  <span>{session ? SESSION_STATUS_LABELS[session.status] : t("hexa.sessionHistory")}</span>
                  <strong>{session ? resultLabel({ attempt, session }) : t("hexa.sessionUnavailable")}</strong>
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
                    <span>{session ? t("hexa.noVerifiableEvidence") : t("hexa.onlyIndexHistory")}</span>
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
                    {t("hexa.viewSession")}
                  </button>
                  <button
                    type="button"
                    className={`kawaii-toggle-btn ${accepted ? "connected" : ""}`}
                    disabled={accepted || pendingAction !== null}
                    onClick={async () => {
                      await runAction(
                        { kind: "accept", sessionId: attempt.session_id },
                        t("hexa.acceptResultFailed"),
                        () => onAccept(goal.id, attempt.session_id),
                      );
                    }}
                  >
                    <Check size={13} aria-hidden="true" />
                    {accepted ? t("hexa.resultAccepted") : accepting ? t("hexa.accepting") : t("hexa.acceptResult")}
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

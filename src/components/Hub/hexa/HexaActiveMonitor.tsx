import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";
import {
  buildActiveMonitoringProjects,
  buildGoalSummary,
  type HexaDevelopmentGoal,
  type HexaMonitoringGoalEntry,
} from "../../../hooks/hexaGoalMonitoring";
import type {
  FocusResult,
  HexaAuditMutationRequest,
  HexaSupervisorSession,
  HexaWatchedSession,
} from "../../../hooks/useHexaData";
import {
  watchedSessionAge,
  watchedSessionConnectionLabel,
  watchedSessionIsExpired,
} from "../../../hooks/hexaPlanningCapability";
import { HexaGoalSummary, hexaSurfaceLabel } from "./HexaGoalSummary";
import { HexaSessionReportView } from "./HexaSessionReport";
import { t } from "@/lib/i18n";

type ActiveSelection =
  | { kind: "session"; id: string }
  | { kind: "goal"; id: string };

function sessionProblem(session: HexaWatchedSession): string {
  const revisions = session.audit.goal_revisions;
  return revisions[revisions.length - 1]?.goal ?? session.goal ?? session.name;
}

export function HexaActiveMonitor({
  sessions,
  developmentGoals = [],
  supervisorBySessionId,
  dataState,
  goalDataState = "ready",
  entryPanel,
  onRetry,
  onRetryGoals,
  onFocus,
  onDelete,
  onMutate,
  onAcceptGoalAttempt = async () => undefined,
  onDeleteGoal = async () => undefined,
  renderOperations,
  focusGoalId = null,
}: {
  sessions: HexaWatchedSession[];
  developmentGoals?: HexaDevelopmentGoal[];
  supervisorBySessionId: Map<string, HexaSupervisorSession>;
  dataState: "loading" | "ready" | "error";
  goalDataState?: "loading" | "ready" | "error";
  entryPanel: ReactNode;
  onRetry: () => Promise<void>;
  onRetryGoals: () => Promise<void>;
  onFocus: (sessionId: string) => Promise<FocusResult>;
  onDelete: (sessionId: string) => Promise<void>;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
  onAcceptGoalAttempt?: (goalId: string, sessionId: string) => Promise<unknown>;
  onDeleteGoal?: (goalId: string) => Promise<unknown>;
  renderOperations?: (session: HexaWatchedSession) => ReactNode;
  focusGoalId?: string | null;
}) {
  const projects = useMemo(
    () => buildActiveMonitoringProjects(sessions, developmentGoals),
    [developmentGoals, sessions],
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.session_id, session])),
    [sessions],
  );
  const goalsById = useMemo(() => {
    const entries = projects.flatMap((project) => project.entries)
      .filter((entry): entry is HexaMonitoringGoalEntry => entry.kind === "goal");
    return new Map(entries.map((entry) => [entry.goal.id, entry]));
  }, [projects]);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryTouched, setEntryTouched] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  const previousFocusGoalId = useRef<string | null>(null);

  const fallbackSelection = useMemo<ActiveSelection | null>(() => {
    for (const project of projects) {
      const entry = project.entries[0];
      if (!entry) continue;
      if (entry.kind === "session") return { kind: "session", id: entry.sessionId };
      const onlyAttempt = entry.attempts.length === 1 ? entry.attempts[0] : null;
      if (onlyAttempt) {
        return { kind: "session", id: onlyAttempt.session.session_id };
      }
      return { kind: "goal", id: entry.goal.id };
    }
    return null;
  }, [projects]);
  const selectionIsAvailable = selection?.kind === "goal"
    ? goalsById.has(selection.id)
    : selection?.kind === "session"
      ? sessionsById.has(selection.id)
      : false;
  const selectedTarget = selectionIsAvailable ? selection : fallbackSelection;
  const selectedSession = selectedTarget?.kind === "session"
    ? sessionsById.get(selectedTarget.id) ?? null
    : null;
  const selectedGoal = selectedTarget?.kind === "goal"
    ? goalsById.get(selectedTarget.id) ?? null
    : null;
  const selectedGoalSummary = useMemo(
    () => selectedGoal ? buildGoalSummary(selectedGoal.goal, sessions) : null,
    [selectedGoal, sessions],
  );
  const selectedOperations = selectedSession ? renderOperations?.(selectedSession) : null;

  useEffect(() => {
    if (!entryTouched && dataState !== "loading") {
      setEntryOpen(sessions.length === 0 && developmentGoals.length === 0);
    }
  }, [dataState, developmentGoals.length, entryTouched, sessions.length]);

  useEffect(() => {
    if (!focusGoalId) {
      previousFocusGoalId.current = null;
      return;
    }
    if (focusGoalId === previousFocusGoalId.current) return;
    const goalEntry = goalsById.get(focusGoalId);
    if (!goalEntry) return;
    const project = projects.find((candidate) =>
      candidate.entries.some((entry) => entry.kind === "goal" && entry.goal.id === focusGoalId)
    );
    setSelection({ kind: "goal", id: focusGoalId });
    setCollapsedGoals((current) => {
      if (!current.has(focusGoalId)) return current;
      const next = new Set(current);
      next.delete(focusGoalId);
      return next;
    });
    if (project) {
      setCollapsedGroups((current) => {
        if (!current.has(project.key)) return current;
        const next = new Set(current);
        next.delete(project.key);
        return next;
      });
    }
    previousFocusGoalId.current = focusGoalId;
  }, [focusGoalId, goalsById, projects]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectGoal = (goalId: string) => {
    setSelection({ kind: "goal", id: goalId });
  };

  const toggleGoalDisclosure = (goalId: string) => {
    setCollapsedGoals((current) => {
      const next = new Set(current);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  };

  const selectSession = (sessionId: string) => {
    setSelection({ kind: "session", id: sessionId });
  };

  return (
    <section className="hexa-active-monitor" aria-label={t("hexa.monitorWorkbench")}>
      <div className="hexa-active-toolbar">
        <div>
          <strong>{t("hexa.monitorSessions")}</strong>
          <span>{t("hexa.monitorSubtitle")}</span>
        </div>
        <button
          type="button"
          className={`kawaii-toggle-btn ${entryOpen ? "connected" : ""}`}
          onClick={() => {
            setEntryTouched(true);
            setEntryOpen((value) => !value);
          }}
        >
          <Plus size={15} /> {entryOpen ? t("hexa.collapseBind") : t("hexa.bindNewSession")}
        </button>
      </div>

      {entryOpen && <div className="hexa-active-entry">{entryPanel}</div>}

      {dataState === "error" && (
        <div className="hexa-active-state" role="alert">
          <span>{t("hexa.monitorLoadFailed")}</span>
          <button type="button" className="kawaii-toggle-btn" onClick={() => void onRetry()}><RefreshCw size={14} /> {t("hexa.retry")}</button>
        </div>
      )}
      {dataState === "loading" && sessions.length === 0 && <div className="hexa-active-state">{t("hexa.monitorLoading")}</div>}
      {goalDataState === "error" && (
        <div className="hexa-goal-data-state" role="status">
          <span>{t("hexa.goalRefreshFailed")}</span>
          <button type="button" className="kawaii-toggle-btn" onClick={() => void onRetryGoals()}>
            <RefreshCw size={14} /> {t("hexa.retryGoal")}
          </button>
        </div>
      )}

      {projects.length === 0 && dataState !== "loading" ? (
        <div className="hexa-active-empty">
          <Activity size={23} />
          <strong>{t("hexa.noMonitoredSessions")}</strong>
          <span>{t("hexa.noMonitoredHint")}</span>
        </div>
      ) : (
        <div className="hexa-active-workbench">
          <nav className="hexa-session-nav" aria-label={t("hexa.monitorNav")}>
            {projects.map((project) => {
              const collapsed = collapsedGroups.has(project.key);
              const attemptCount = project.entries.reduce(
                (total, entry) => total + (entry.kind === "goal" ? entry.goal.attempts.length : 1),
                0,
              );
              return (
                <div className="hexa-session-group" key={project.key}>
                  <button type="button" className="hexa-session-group-title" onClick={() => toggleGroup(project.key)}>
                    <span>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{project.label}</span>
                    <small>{attemptCount}</small>
                  </button>
                  {!collapsed && project.entries.map((entry) => {
                    if (entry.kind === "goal") {
                      const goalCollapsed = collapsedGoals.has(entry.goal.id);
                      const goalSelected = selectedTarget?.kind === "goal"
                        && selectedTarget.id === entry.goal.id;
                      return (
                        <div className="hexa-goal-nav-group" key={entry.goal.id}>
                          <div className={`hexa-goal-nav-item ${goalSelected ? "selected" : ""}`}>
                            <button
                              type="button"
                              className="hexa-goal-disclosure"
                              aria-label={`${goalCollapsed ? t("hexa.expand") : t("hexa.collapse")}${t("hexa.goalNav", { title: entry.goal.title })}`}
                              aria-expanded={!goalCollapsed}
                              onClick={() => toggleGoalDisclosure(entry.goal.id)}
                            >
                              {goalCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                            </button>
                            <button
                              type="button"
                              className="hexa-goal-nav-select"
                              aria-current={goalSelected ? "true" : undefined}
                              onClick={() => selectGoal(entry.goal.id)}
                            >
                              <span className="hexa-goal-nav-copy">
                                <strong>{entry.goal.title}</strong>
                                <span>{t("hexa.agentAttempts", { count: entry.goal.attempts.length })}</span>
                              </span>
                              <small>{entry.goal.status === "completed" ? t("hexa.adoptedShort") : t("hexa.developmentGoal")}</small>
                            </button>
                          </div>
                          {!goalCollapsed && (
                            <div className="hexa-goal-attempt-nav">
                              {entry.attempts.map(({ attempt, session }) => {
                                const isSelected = selectedTarget?.kind === "session"
                                  && selectedTarget.id === session.session_id;
                                const expired = watchedSessionIsExpired(session.status, session.updated_at);
                                const connectionLabel = watchedSessionConnectionLabel(session.status, session.updated_at);
                                return (
                                  <button
                                    key={session.session_id}
                                    type="button"
                                    className={`hexa-goal-attempt-nav-item ${isSelected ? "selected" : ""}`}
                                    aria-current={isSelected ? "true" : undefined}
                                    onClick={() => selectSession(session.session_id)}
                                  >
                                    <span
                                      className={`hexa-session-status ${expired ? "expired" : session.status}`}
                                      title={expired ? t("hexa.expiredTooltip") : undefined}
                                    />
                                    <span className="hexa-goal-attempt-nav-copy">
                                      <strong>{hexaSurfaceLabel(attempt.surface)}</strong>
                                      <span>{session.name}</span>
                                    </span>
                                    <small>
                                      {connectionLabel
                                        ? `${connectionLabel} · ${watchedSessionAge(session.updated_at)}`
                                        : watchedSessionAge(session.updated_at)}
                                    </small>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    const session = entry.session;
                    const isSelected = selectedTarget?.kind === "session"
                      && selectedTarget.id === session.session_id;
                    const expired = watchedSessionIsExpired(session.status, session.updated_at);
                    const connectionLabel = watchedSessionConnectionLabel(session.status, session.updated_at);
                    return (
                      <button
                        key={session.session_id}
                        type="button"
                        className={`hexa-session-nav-item ${isSelected ? "selected" : ""}`}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => selectSession(session.session_id)}
                      >
                        <span
                          className={`hexa-session-status ${expired ? "expired" : session.status}`}
                          title={expired ? t("hexa.expiredTooltip") : undefined}
                        />
                        <span className="hexa-session-nav-copy">
                          <strong>{session.name}</strong>
                          <span>{sessionProblem(session)}</span>
                        </span>
                        <small className="hexa-session-nav-meta">
                          {connectionLabel ? `${connectionLabel} · ${watchedSessionAge(session.updated_at)}` : watchedSessionAge(session.updated_at)}
                        </small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="hexa-session-report-pane" aria-label={t("hexa.selectedReport")}>
            {selectedSession && (
              <>
                <div className="hexa-session-report-scroll">
                  <HexaSessionReportView
                    session={selectedSession}
                    supervisor={supervisorBySessionId.get(selectedSession.session_id) ?? null}
                    onFocus={onFocus}
                    onDelete={onDelete}
                    onMutate={onMutate}
                  />
                </div>
                {selectedOperations && (
                  <div className="hexa-session-report-dock">
                    {selectedOperations}
                  </div>
                )}
              </>
            )}
            {selectedGoalSummary && (
              <div className="hexa-session-report-scroll">
                <HexaGoalSummary
                  summary={selectedGoalSummary}
                  onViewSession={selectSession}
                  onAccept={onAcceptGoalAttempt}
                  onDelete={onDeleteGoal}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

import { useRef, useState, type ReactNode } from "react";
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
import { planningCapabilityCopy, watchedSessionIsExpired } from "../../../hooks/hexaPlanningCapability";
import { t } from "@/lib/i18n";

const ALIGNMENT: Record<HexaAlignment, { label: string; color: string }> = {
  on_track: { label: t("hexa.alignOnTrack"), color: "#22c55e" },
  watch: { label: t("hexa.alignWatch"), color: "#f59e0b" },
  off_track: { label: t("hexa.alignOffTrack"), color: "#f87171" },
};

const STATUS: Record<HexaWatchedSession["status"], { label: string; color: string }> = {
  starting: { label: t("hexa.attemptStarting"), color: "#38bdf8" },
  working: { label: t("hexa.attemptWorking"), color: "#22c55e" },
  waiting: { label: t("hexa.attemptWaiting"), color: "#f59e0b" },
  idle: { label: t("hexa.attemptIdle"), color: "#94a3b8" },
  completed: { label: t("hexa.attemptCompleted"), color: "#38bdf8" },
  blocked: { label: t("hexa.attemptBlocked"), color: "#f87171" },
};

function timeAgo(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return t("hexa.timeJust");
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return t("hexa.timeSeconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("hexa.timeMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("hexa.timeHours", { count: hours });
  return t("hexa.timeDays", { count: Math.floor(hours / 24) });
}

function Metric({ label, value, tone, onClick }: { label: string; value: number; tone?: string; onClick?: () => void }) {
  const content = (
    <>
      <strong style={{ color: tone ?? "#263241" }}>{value}</strong>
      <span>{label}</span>
    </>
  );
  return onClick
    ? <button type="button" className="hexa-report-metric clickable" onClick={onClick} title={t("hexa.viewLabel", { label })}>{content}</button>
    : <div className="hexa-report-metric">{content}</div>;
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
  const workflowRef = useRef<HTMLDivElement>(null);
  const pendingConfirmations = supervisor?.pending_confirmations ?? 0;
  const report = buildHexaSessionReport(session, pendingConfirmations);
  const alignment = ALIGNMENT[report.alignment];
  const status = watchedSessionIsExpired(session.status, session.updated_at)
    ? { label: t("hexa.disconnected"), color: "#94a3b8" }
    : STATUS[session.status];
  const planning = planningCapabilityCopy(session.planning_capability);
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
    <article className="hexa-report" aria-label={t("hexa.reportLabel", { name: session.name })}>
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
          <div className="hexa-report-eyebrow">{t("hexa.solvingThisRound")}</div>
          <h3>{report.problem}</h3>
          <p>{session.current_step ?? t("hexa.noCurrentStep")}</p>
        </div>
        <div className="hexa-report-actions">
          <button type="button" className="kawaii-toggle-btn" onClick={() => void focus()} disabled={focusState === "busy"} title={t("hexa.returnToSession")}>
            <Crosshair size={15} />
          </button>
          <button type="button" className="kawaii-toggle-btn" onClick={() => void remove()} disabled={deleting} title={t("hexa.stopMonitor")}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="hexa-report-next">
        <span>{t("hexa.nextStep")}</span>
        <strong>{report.nextAction}</strong>
        <small>{t("hexa.updatedAt", { time: timeAgo(session.updated_at) })}</small>
      </div>

      <section className="hexa-report-section" data-tone={planning.tone}>
        <div className="hexa-report-section-title"><span><ShieldQuestion size={15} /> {planning.label}</span></div>
        <p className="hexa-report-empty">{planning.detail}</p>
      </section>

      <div className="hexa-report-metrics">
        <Metric label={t("hexa.workItems")} value={report.metrics.total} onClick={() => workflowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        <Metric label={t("hexa.completed")} value={report.metrics.completed} tone="#16a34a" />
        <Metric label={t("hexa.failed")} value={report.metrics.failed} tone={report.metrics.failed ? "#ef4444" : undefined} />
        <Metric label={t("hexa.interventions")} value={report.metrics.interventions} tone="#7c3aed" />
        <Metric label={t("hexa.pendingConfirmations")} value={report.metrics.pendingConfirmations} tone={report.metrics.pendingConfirmations ? "#d97706" : undefined} />
      </div>

      <section className="hexa-report-section">
        <div className="hexa-report-section-title">
          <span><Flag size={15} /> {t("hexa.reviewProgress")}</span>
          <strong>{report.progress ? `${report.progress.percent}%` : t("hexa.noCheckpoints")}</strong>
        </div>
        {report.progress ? (
          <div className="hexa-report-progress" aria-label={t("hexa.reviewProgressPct", { percent: report.progress.percent })}>
            <span style={{ width: `${report.progress.percent}%` }} />
          </div>
        ) : (
          <p className="hexa-report-empty">{t("hexa.onlyGoalNoItems")}</p>
        )}
        {report.successCriteria.length > 0 && (
          <ul className="hexa-report-criteria">
            {report.successCriteria.slice(0, 4).map((criterion) => <li key={criterion}>{criterion}</li>)}
          </ul>
        )}
      </section>

      <div className="hexa-report-columns">
        <section className="hexa-report-section">
          <div className="hexa-report-section-title"><span><FileCheck2 size={15} /> {t("hexa.strongOutputs")}</span></div>
          {report.outputs.length ? (
            <ul className="hexa-report-list output">
              {report.outputs.slice(0, 3).map((output) => <li key={output.id}>{output.label}</li>)}
            </ul>
          ) : <p className="hexa-report-empty">{t("hexa.noStrongOutputs")}</p>}
        </section>
        <section className="hexa-report-section">
          <div className="hexa-report-section-title"><span><AlertTriangle size={15} /> {t("hexa.risksDeviations")}</span></div>
          {report.risks.length ? (
            <ul className="hexa-report-list risk">
              {report.risks.slice(0, 3).map((risk) => <li key={risk.id}>{risk.summary}</li>)}
            </ul>
          ) : <p className="hexa-report-empty">{t("hexa.noDeviations")}</p>}
        </section>
      </div>

      <section className="hexa-report-section">
        <div className="hexa-report-section-title"><span><CheckCircle2 size={15} /> {t("hexa.sessionTrail")}</span><small>{t("hexa.trailHint")}</small></div>
        {report.milestones.length ? (
          <ol className="hexa-report-timeline">
            {report.milestones.map((milestone) => (
              <li key={milestone.id} data-alignment={milestone.alignment}>
                <span>{milestone.summary}</span>
                <time>{timeAgo(milestone.created_at)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="hexa-report-empty">{t("hexa.awaitFirstNode")}</p>}
      </section>

      <div ref={workflowRef}>
        <HexaWorkflowEditor session={session} onMutate={onMutate} />
      </div>

      <section className="hexa-report-verdicts">
        <div>
          <span>{t("hexa.hexaVerdict")}</span>
          <strong>{report.hexaVerdict?.label ?? t("hexa.pendingVerdict")}</strong>
          <p>{report.hexaVerdict?.summary ?? t("hexa.verdictEmpty")}</p>
        </div>
        <div>
          <span><UserRoundCheck size={14} /> {t("hexa.userReviewLabel")}</span>
          <strong>{report.userVerdict?.label ?? t("hexa.notRated")}</strong>
          <p>{report.userVerdict?.summary ?? t("hexa.userReviewEmpty")}</p>
        </div>
      </section>

      <HexaUserReview session={session} onMutate={onMutate} />

      {operations}

      <details className="hexa-report-evidence">
        <summary>{t("hexa.rawEvidence", { count: evidence.length })}</summary>
        {evidence.length ? (
          <ul>
            {evidence.map((item) => (
              <li key={item.id}><span>{item.label}</span>{item.location && <code>{item.location}</code>}</li>
            ))}
          </ul>
        ) : <p>{t("hexa.noRawEvidence")}</p>}
      </details>

      {focusState === "error" && <div className="hexa-report-error">{t("hexa.cannotFocus")}</div>}
    </article>
  );
}

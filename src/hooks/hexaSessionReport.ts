import type {
  HexaAlignment,
  HexaEvidenceRef,
  HexaMilestone,
  HexaReview,
  HexaReviewRating,
  HexaWatchedSession,
  HexaWorkItem,
  HexaWorkItemStatus,
} from "./useHexaData";

export interface HexaSessionGroup {
  key: string;
  label: string;
  workspace: string | null;
  sessions: HexaWatchedSession[];
  updatedAt: string;
}

export interface HexaVerdictView {
  rating: HexaReviewRating;
  label: string;
  summary: string;
  evidence: HexaEvidenceRef[];
  createdAt: string;
}

export interface HexaSessionReport {
  sessionId: string;
  problem: string;
  successCriteria: string[];
  progress: { completed: number; total: number; percent: number } | null;
  currentItem: HexaWorkItem | null;
  nextAction: string;
  alignment: HexaAlignment;
  metrics: {
    total: number;
    completed: number;
    failed: number;
    interventions: number;
    pendingConfirmations: number;
  };
  outputs: HexaEvidenceRef[];
  risks: HexaMilestone[];
  milestones: HexaMilestone[];
  hexaVerdict: HexaVerdictView | null;
  userVerdict: HexaVerdictView | null;
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function workspaceLabel(workspace: string | null): string {
  if (!workspace) return "未报告工作区";
  const parts = workspace.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

function sortSessions(left: HexaWatchedSession, right: HexaWatchedSession): number {
  const leftCompleted = left.status === "completed" ? 1 : 0;
  const rightCompleted = right.status === "completed" ? 1 : 0;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return timestamp(right.updated_at) - timestamp(left.updated_at);
}

export function groupWatchedSessions(sessions: HexaWatchedSession[]): HexaSessionGroup[] {
  const grouped = new Map<string, HexaWatchedSession[]>();
  for (const session of sessions) {
    const key = session.workspace ?? "__unknown_workspace__";
    grouped.set(key, [...(grouped.get(key) ?? []), session]);
  }

  return Array.from(grouped, ([key, groupSessions]) => {
    const sessions = [...groupSessions].sort(sortSessions);
    return {
      key,
      label: workspaceLabel(sessions[0]?.workspace ?? null),
      workspace: sessions[0]?.workspace ?? null,
      sessions,
      updatedAt: sessions.reduce(
        (latest, session) => timestamp(session.updated_at) > timestamp(latest)
          ? session.updated_at
          : latest,
        sessions[0]?.updated_at ?? "",
      ),
    };
  }).sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}

export function selectVisibleMilestones(milestones: HexaMilestone[], limit = 5): HexaMilestone[] {
  return [...milestones]
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))
    .slice(0, limit);
}

export function orderWorkflow(items: HexaWorkItem[]): HexaWorkItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: HexaWorkItem[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (item: HexaWorkItem) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) return;
    visiting.add(item.id);
    for (const dependency of item.depends_on) {
      const dependencyItem = byId.get(dependency);
      if (dependencyItem) visit(dependencyItem);
    }
    visiting.delete(item.id);
    visited.add(item.id);
    ordered.push(item);
  };

  items.forEach(visit);
  return ordered;
}

export function createWorkItemId(title: string, existingIds: string[]): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "work-item";
  if (!existingIds.includes(base)) return base;
  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function workItemRemovalBlocker(items: HexaWorkItem[], workItemId: string): string | null {
  const dependant = items.find((item) => item.depends_on.includes(workItemId));
  return dependant ? `“${dependant.title}”仍依赖这个检查点` : null;
}

export function reviewLabel(rating: HexaReviewRating): string {
  switch (rating) {
    case "satisfied":
      return "满意";
    case "average":
      return "一般";
    case "unsatisfied":
      return "不满意";
  }
}

export type HexaWorkItemDisplayStatus = HexaWorkItemStatus | "unclosed";

export function workItemDisplayStatus(
  itemStatus: HexaWorkItemStatus,
  sessionStatus: HexaWatchedSession["status"],
): HexaWorkItemDisplayStatus {
  if (
    itemStatus === "in_progress"
    && (sessionStatus === "idle" || sessionStatus === "completed")
  ) {
    return "unclosed";
  }
  return itemStatus;
}

function verdictView(review: HexaReview | null): HexaVerdictView | null {
  if (!review) return null;
  return {
    rating: review.rating,
    label: reviewLabel(review.rating),
    summary: review.summary,
    evidence: review.evidence,
    createdAt: review.created_at,
  };
}

function latestGoal(session: HexaWatchedSession): { goal: string; criteria: string[] } {
  const latest = [...session.audit.goal_revisions]
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))[0];
  return {
    goal: latest?.goal ?? session.goal ?? session.name,
    criteria: latest?.success_criteria.length
      ? latest.success_criteria
      : session.audit.success_criteria,
  };
}

function reportAlignment(session: HexaWatchedSession): HexaAlignment {
  const latestSupported = [...session.audit.milestones]
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))
    .find((milestone) => milestone.evidence.length > 0);
  if (latestSupported) return latestSupported.alignment;
  return "watch";
}

function nextAction(session: HexaWatchedSession, ordered: HexaWorkItem[]): string {
  if (session.need_user) {
    return session.blocked_reason ?? session.current_step ?? "需要用户确认后继续";
  }
  const current = ordered.find((item) => item.status === "in_progress");
  if (current) {
    if (session.status === "idle" || session.status === "completed") {
      return `Agent 本轮已结束，未确认“${current.title}”是否完成`;
    }
    return current.title;
  }
  const completed = new Set(
    ordered.filter((item) => item.status === "completed").map((item) => item.id),
  );
  const ready = ordered.find((item) =>
    item.status === "pending" && item.depends_on.every((dependency) => completed.has(dependency))
  );
  if (ready) return ready.title;
  if (session.status === "completed") return "等待最终评价";
  return session.current_step ?? "等待 Agent 报告下一步";
}

export function buildHexaSessionReport(
  session: HexaWatchedSession,
  pendingConfirmations = 0,
): HexaSessionReport {
  const ordered = orderWorkflow(session.audit.work_items);
  const tracked = ordered.filter((item) =>
    item.source !== "hexa_inferred" && item.source !== "legacy_migration"
  );
  const completed = tracked.filter((item) => item.status === "completed").length;
  const failed = tracked.filter((item) => item.status === "failed").length;
  const goal = latestGoal(session);
  const milestones = selectVisibleMilestones(session.audit.milestones);

  return {
    sessionId: session.session_id,
    problem: goal.goal,
    successCriteria: goal.criteria,
    progress: tracked.length > 0
      ? {
          completed,
          total: tracked.length,
          percent: Math.round((completed / tracked.length) * 100),
        }
      : null,
    currentItem: ordered.find((item) => item.status === "in_progress") ?? null,
    nextAction: nextAction(session, ordered),
    alignment: reportAlignment(session),
    metrics: {
      total: tracked.length,
      completed,
      failed,
      interventions: session.audit.interventions.length,
      pendingConfirmations,
    },
    outputs: [...session.audit.important_outputs]
      .sort((left, right) => timestamp(right.observed_at) - timestamp(left.observed_at)),
    risks: [...session.audit.milestones]
      .filter((milestone) => milestone.alignment !== "on_track")
      .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at)),
    milestones,
    hexaVerdict: verdictView(session.audit.hexa_review),
    userVerdict: verdictView(session.audit.user_review),
  };
}

export function resolveSelectedSession(
  groups: HexaSessionGroup[],
  selectedSessionId: string | null,
): HexaWatchedSession | null {
  const sessions = groups.flatMap((group) => group.sessions);
  return sessions.find((session) => session.session_id === selectedSessionId)
    ?? sessions.find((session) => session.status !== "completed")
    ?? sessions[0]
    ?? null;
}

export function tabCounts(
  watchedSessions: HexaWatchedSession[],
  scannedSessions: unknown[],
): { active: number; scanned: number } {
  return {
    active: watchedSessions.length,
    scanned: scannedSessions.length,
  };
}

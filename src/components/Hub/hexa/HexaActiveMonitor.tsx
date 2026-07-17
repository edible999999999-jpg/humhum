import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { groupWatchedSessions, resolveSelectedSession } from "../../../hooks/hexaSessionReport";
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
import { HexaSessionReportView } from "./HexaSessionReport";

export function HexaActiveMonitor({
  sessions,
  supervisorBySessionId,
  dataState,
  entryPanel,
  onRetry,
  onFocus,
  onDelete,
  onMutate,
  renderOperations,
}: {
  sessions: HexaWatchedSession[];
  supervisorBySessionId: Map<string, HexaSupervisorSession>;
  dataState: "loading" | "ready" | "error";
  entryPanel: ReactNode;
  onRetry: () => Promise<void>;
  onFocus: (sessionId: string) => Promise<FocusResult>;
  onDelete: (sessionId: string) => Promise<void>;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
  renderOperations?: (session: HexaWatchedSession) => ReactNode;
}) {
  const groups = useMemo(() => groupWatchedSessions(sessions), [sessions]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryTouched, setEntryTouched] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const selected = resolveSelectedSession(groups, selectedSessionId);

  useEffect(() => {
    if (selected?.session_id !== selectedSessionId) {
      setSelectedSessionId(selected?.session_id ?? null);
    }
  }, [selected?.session_id, selectedSessionId]);

  useEffect(() => {
    if (!entryTouched && dataState !== "loading") {
      setEntryOpen(sessions.length === 0);
    }
  }, [dataState, entryTouched, sessions.length]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="hexa-active-monitor">
      <div className="hexa-active-toolbar">
        <div>
          <strong>主动监控会话</strong>
          <span>只收录明确绑定到 Hexa 的会话，结论基于 Agent 上报与证据。</span>
        </div>
        <button
          type="button"
          className={`kawaii-toggle-btn ${entryOpen ? "connected" : ""}`}
          onClick={() => {
            setEntryTouched(true);
            setEntryOpen((value) => !value);
          }}
        >
          <Plus size={15} /> {entryOpen ? "收起绑定入口" : "绑定新会话"}
        </button>
      </div>

      {entryOpen && <div className="hexa-active-entry">{entryPanel}</div>}

      {dataState === "error" && (
        <div className="hexa-active-state" role="alert">
          <span>主动监控数据暂时读取失败。</span>
          <button type="button" className="kawaii-toggle-btn" onClick={() => void onRetry()}><RefreshCw size={14} /> 重试</button>
        </div>
      )}
      {dataState === "loading" && sessions.length === 0 && <div className="hexa-active-state">正在读取主动监控会话...</div>}

      {sessions.length === 0 && dataState !== "loading" ? (
        <div className="hexa-active-empty">
          <Activity size={23} />
          <strong>还没有主动监控的会话</strong>
          <span>在目标 Agent 会话里运行上方命令，Hexa 会立即为这一轮建立独立报告。</span>
        </div>
      ) : (
        <div className="hexa-active-workbench">
          <nav className="hexa-session-nav" aria-label="主动监控会话">
            {groups.map((group) => {
              const collapsed = collapsedGroups.has(group.key);
              return (
                <div className="hexa-session-group" key={group.key}>
                  <button type="button" className="hexa-session-group-title" onClick={() => toggleGroup(group.key)}>
                    <span>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{group.label}</span>
                    <small>{group.sessions.length}</small>
                  </button>
                  {!collapsed && group.sessions.map((session) => {
                    const selected = session.session_id === selectedSessionId;
                    const expired = watchedSessionIsExpired(session.status, session.updated_at);
                    const connectionLabel = watchedSessionConnectionLabel(session.status, session.updated_at);
                    const revisions = session.audit.goal_revisions;
                    const problem = revisions[revisions.length - 1]?.goal ?? session.goal ?? session.name;
                    return (
                      <button
                        key={session.session_id}
                        type="button"
                        className={`hexa-session-nav-item ${selected ? "selected" : ""}`}
                        onClick={() => setSelectedSessionId(session.session_id)}
                      >
                        <span
                          className={`hexa-session-status ${expired ? "expired" : session.status}`}
                          title={expired ? "超过 30 分钟没有收到 Agent 更新，已停止实时刷新" : undefined}
                        />
                        <span className="hexa-session-nav-copy">
                          <strong>{session.name}</strong>
                          <span>{problem}</span>
                        </span>
                        <small>{connectionLabel ? `${connectionLabel} · ${watchedSessionAge(session.updated_at)}` : watchedSessionAge(session.updated_at)}</small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="hexa-session-report-pane">
            {selected && (
              <HexaSessionReportView
                session={selected}
                supervisor={supervisorBySessionId.get(selected.session_id) ?? null}
                operations={renderOperations?.(selected)}
                onFocus={onFocus}
                onDelete={onDelete}
                onMutate={onMutate}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

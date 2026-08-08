import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, GitBranch, Plus, Trash2, X } from "lucide-react";
import {
  createWorkItemId,
  orderWorkflow,
  workItemDisplayStatus,
  workItemRemovalBlocker,
} from "../../../hooks/hexaSessionReport";
import type {
  HexaAuditMutationRequest,
  HexaWatchedSession,
  HexaWorkItem,
  HexaWorkItemInput,
  HexaWorkItemStatus,
} from "../../../hooks/useHexaData";
import { workItemSourceLabel } from "../../../hooks/hexaPlanningCapability";
import type { HexaWorkItemDisplayStatus } from "../../../hooks/hexaSessionReport";
import { t } from "@/lib/i18n";

const STATUS: Record<HexaWorkItemDisplayStatus, { label: string; color: string }> = {
  pending: { label: t("hexa.wfPending"), color: "#94a3b8" },
  in_progress: { label: t("hexa.wfInProgress"), color: "#38bdf8" },
  completed: { label: t("hexa.wfCompleted"), color: "#22c55e" },
  failed: { label: t("hexa.wfFailed"), color: "#f87171" },
  unclosed: { label: t("hexa.wfUnclosed"), color: "#f59e0b" },
};

function inputFrom(item: HexaWorkItem): HexaWorkItemInput {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    acceptance_criteria: item.acceptance_criteria,
    status: item.status,
    depends_on: item.depends_on,
    evidence: item.evidence.map(({ kind, label, location }) => ({ kind, label, location })),
  };
}

export function HexaWorkflowEditor({
  session,
  onMutate,
}: {
  session: HexaWatchedSession;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
}) {
  const items = useMemo(() => orderWorkflow(session.audit.work_items), [session.audit.work_items]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HexaWorkItemInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (item: HexaWorkItem) => {
    setEditingId(item.id);
    setDraft(inputFrom(item));
    setError(null);
  };

  const add = () => {
    setEditingId("__new__");
    setDraft({
      id: createWorkItemId("检查点", items.map((item) => item.id)),
      title: "",
      description: null,
      acceptance_criteria: null,
      status: "pending",
      depends_on: items.length ? [items[items.length - 1]!.id] : [],
      evidence: [],
    });
    setError(null);
  };

  const save = async () => {
    if (!draft?.title.trim()) {
      setError(t("hexa.wfCheckpointRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workItem = editingId === "__new__"
        ? { ...draft, id: createWorkItemId(draft.title, items.map((item) => item.id)) }
        : draft;
      await onMutate({ session_id: session.session_id, action: "upsert_work_item", work_item: workItem });
      setEditingId(null);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: HexaWorkItem) => {
    const blocker = workItemRemovalBlocker(items, item.id);
    if (blocker) {
      setError(blocker);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onMutate({ session_id: session.session_id, action: "remove_work_item", work_item_id: item.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hexa-report-section hexa-workflow">
      <div className="hexa-report-section-title">
        <span><GitBranch size={15} /> {t("hexa.wfCheckpoints")}</span>
        <button type="button" className="kawaii-toggle-btn" onClick={add} disabled={busy || editingId === "__new__"}>
          <Plus size={14} /> {t("hexa.wfAdd")}
        </button>
      </div>

      {items.length ? (
        <ol className="hexa-workflow-list">
          {items.map((item, index) => {
            const status = STATUS[workItemDisplayStatus(item.status, session.status)];
            const expanded = editingId === item.id;
            return (
              <li key={item.id}>
                <div className="hexa-workflow-node">
                  <span className="hexa-workflow-index" style={{ borderColor: status.color, color: status.color }}>{index + 1}</span>
                  <button type="button" className="hexa-workflow-main" onClick={() => expanded ? setEditingId(null) : edit(item)}>
                    <strong>{item.title} <small style={{ opacity: 0.55 }}>· {workItemSourceLabel(item.source)}</small></strong>
                    <span>{item.acceptance_criteria ?? t("hexa.wfNoAcceptance")}</span>
                  </button>
                  <span className="hexa-workflow-status" style={{ color: status.color }}>{status.label}</span>
                  <button type="button" className="hexa-icon-button" onClick={() => expanded ? setEditingId(null) : edit(item)} title={t("hexa.wfEditCheckpoint")}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
                {expanded && draft && (
                  <WorkflowForm
                    draft={draft}
                    items={items}
                    busy={busy}
                    onChange={setDraft}
                    onSave={() => void save()}
                    onCancel={() => { setEditingId(null); setDraft(null); setError(null); }}
                    onRemove={() => void remove(item)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hexa-report-empty">{t("hexa.wfEmpty")}</p>
      )}

      {editingId === "__new__" && draft && (
        <WorkflowForm
          draft={draft}
          items={items}
          busy={busy}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={() => { setEditingId(null); setDraft(null); setError(null); }}
        />
      )}
      {error && <div className="hexa-report-error" role="alert">{error}</div>}
    </section>
  );
}

function WorkflowForm({
  draft,
  items,
  busy,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: {
  draft: HexaWorkItemInput;
  items: HexaWorkItem[];
  busy: boolean;
  onChange: (draft: HexaWorkItemInput) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const toggleDependency = (id: string) => {
    onChange({
      ...draft,
      depends_on: draft.depends_on.includes(id)
        ? draft.depends_on.filter((dependency) => dependency !== id)
        : [...draft.depends_on, id],
    });
  };

  return (
    <div className="hexa-workflow-form">
      <label>
        <span>{t("hexa.wfCheckpoint")}</span>
        <input className="kawaii-input" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder={t("hexa.wfTitlePlaceholder")} />
      </label>
      <label>
        <span>{t("hexa.wfAcceptance")}</span>
        <input className="kawaii-input" value={draft.acceptance_criteria ?? ""} onChange={(event) => onChange({ ...draft, acceptance_criteria: event.target.value || null })} placeholder={t("hexa.wfAcceptancePlaceholder")} />
      </label>
      <label>
        <span>{t("hexa.wfStatus")}</span>
        <select className="kawaii-input" value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as HexaWorkItemStatus })}>
          {Object.entries(STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
        </select>
      </label>
      {items.some((item) => item.id !== draft.id) && (
        <fieldset>
          <legend>{t("hexa.wfPrereq")}</legend>
          <div className="hexa-dependency-options">
            {items.filter((item) => item.id !== draft.id).map((item) => (
              <label key={item.id}>
                <input type="checkbox" checked={draft.depends_on.includes(item.id)} onChange={() => toggleDependency(item.id)} />
                <span>{item.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="hexa-workflow-form-actions">
        {onRemove && <button type="button" className="kawaii-toggle-btn" onClick={onRemove} disabled={busy} title={t("hexa.wfDeleteCheckpoint")}><Trash2 size={14} /></button>}
        <span />
        <button type="button" className="kawaii-toggle-btn" onClick={onCancel} disabled={busy}><X size={14} /> {t("hexa.wfCancel")}</button>
        <button type="button" className="kawaii-toggle-btn connected" onClick={onSave} disabled={busy}><Check size={14} /> {t("hexa.wfSave")}</button>
      </div>
    </div>
  );
}

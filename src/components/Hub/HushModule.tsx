import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../../lib/i18n/react";

const PLATFORM_ICONS: Record<string, string> = {
  wechat: "💬",
  dingtalk: "🔷",
  feishu: "🪶",
  telegram: "✈️",
  x: "𝕏",
  facetime: "📱",
};

const TIER_LABEL_KEYS: Record<string, string> = {
  family: "hub.hush.tier.family",
  friends: "hub.hush.tier.friends",
  work: "hub.hush.tier.work",
};

const TIER_ORDER: string[] = ["family", "friends", "work"];

interface HushConnectorStatus {
  id: string;
  name: string;
  installed: boolean;
  bridge_ready: boolean;
  app_path?: string | null;
  status: string;
  next_step: string;
  bridge_mode: string;
}

interface HushInboxMessage {
  id: string;
  platform: string;
  sender: string;
  chat?: string | null;
  text: string;
  tier: string;
  importance: number;
  suggested_reply?: string | null;
  received_at: string;
}

interface HushInboxSummary {
  total: number;
  unread_priority: number;
  by_tier: Record<string, number>;
  by_platform: Record<string, number>;
  messages: HushInboxMessage[];
}

interface DerivedContact {
  id: string;
  name: string;
  tier: string;
  platforms: string[];
  lastMessage: string;
  lastMessageTime: string;
  importance: number;
  messages: HushInboxMessage[];
}

interface LocalSourceCandidate {
  path: string;
  exists: boolean;
  kind: string;
  readable: boolean;
  file_count: number;
  sample_files: string[];
}

interface DingTalkLocalSourceReport {
  app_detected: boolean;
  app_path?: string | null;
  source_count: number;
  readable_count: number;
  candidates: LocalSourceCandidate[];
  summary: string;
  next_step: string;
}

interface DingTalkImportReport {
  source_path: string;
  scanned_files: number;
  imported_messages: number;
  skipped_binary_sources: number;
  skipped_files: number;
  errors: string[];
  summary: string;
}

export function HushModule() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedTiers, setCollapsedTiers] = useState<Set<string>>(new Set());
  const [connectors, setConnectors] = useState<HushConnectorStatus[]>([]);
  const [inbox, setInbox] = useState<HushInboxSummary | null>(null);
  const [dingTalkReport, setDingTalkReport] = useState<DingTalkLocalSourceReport | null>(null);
  const [dingTalkImportReport, setDingTalkImportReport] = useState<DingTalkImportReport | null>(null);
  const [dingTalkImportPath, setDingTalkImportPath] = useState("");
  const [dingTalkLoading, setDingTalkLoading] = useState(false);
  const [dingTalkImporting, setDingTalkImporting] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [openingConnector, setOpeningConnector] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      const data = await invoke<HushConnectorStatus[]>("get_hush_connectors");
      setConnectors(data);
      setConnectorError(null);
    } catch (error) {
      setConnectorError(String(error));
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const fetchInbox = useCallback(async () => {
    try {
      const data = await invoke<HushInboxSummary>("get_hush_inbox");
      setInbox(data);
    } catch (error) {
      setConnectorError(String(error));
    }
  }, []);

  useEffect(() => {
    fetchInbox();
    const interval = setInterval(fetchInbox, 4000);
    return () => clearInterval(interval);
  }, [fetchInbox]);

  const openConnector = useCallback(async (connectorId: string) => {
    setOpeningConnector(connectorId);
    setConnectorError(null);
    try {
      await invoke("open_hush_connector", { connectorId });
      await fetchConnectors();
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setOpeningConnector(null);
    }
  }, [fetchConnectors]);

  const clearInbox = useCallback(async () => {
    await invoke("clear_hush_inbox");
    await fetchInbox();
  }, [fetchInbox]);

  const diagnoseDingTalk = useCallback(async () => {
    setDingTalkLoading(true);
    setConnectorError(null);
    try {
      const report = await invoke<DingTalkLocalSourceReport>("diagnose_dingtalk_local_sources");
      setDingTalkReport(report);
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDingTalkLoading(false);
    }
  }, []);

  const importDingTalk = useCallback(async () => {
    setDingTalkImporting(true);
    setConnectorError(null);
    try {
      const report = await invoke<DingTalkImportReport>("import_dingtalk_local_source", {
        path: dingTalkImportPath,
      });
      setDingTalkImportReport(report);
      await fetchInbox();
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDingTalkImporting(false);
    }
  }, [dingTalkImportPath, fetchInbox]);

  const contacts = useMemo<DerivedContact[]>(() => {
    const messages = inbox?.messages ?? [];
    const map = new Map<string, DerivedContact>();
    for (const message of messages) {
      const key = `${message.platform}:${message.sender}`;
      const existing = map.get(key);
      if (existing) {
        existing.messages.push(message);
        if (message.received_at > existing.lastMessageTime) {
          existing.lastMessage = message.text;
          existing.lastMessageTime = message.received_at;
        }
        existing.importance = Math.max(existing.importance, message.importance);
        if (!existing.platforms.includes(message.platform)) {
          existing.platforms.push(message.platform);
        }
      } else {
        map.set(key, {
          id: key,
          name: message.sender,
          tier: TIER_ORDER.includes(message.tier) ? message.tier : "work",
          platforms: [message.platform],
          lastMessage: message.text,
          lastMessageTime: message.received_at,
          importance: message.importance,
          messages: [message],
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.importance - a.importance || b.lastMessageTime.localeCompare(a.lastMessageTime),
    );
  }, [inbox]);

  const selectedContact = selectedId
    ? contacts.find((c) => c.id === selectedId) ?? null
    : null;

  const toggleTier = (tier: string) => {
    setCollapsedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  return (
    <div className="hub-module">
      <div className="hub-module-heading">
        <span className="hub-module-kicker">{t("hub.role.hush")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <h2 className="hub-module-title" style={{ margin: 0 }}>{t("hub.hush.title")}</h2>
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 9999,
              background: "rgba(148,239,244,0.08)",
              border: "1px solid rgba(148,239,244,0.18)",
              color: "#94eff4",
              fontWeight: 700,
            }}
          >
            Local-first bridge
          </span>
        </div>
        <p className="hub-module-desc">
          {t("hub.hush.desc")}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {connectors.map((connector) => (
          <HushConnectorCard
            key={connector.id}
            connector={connector}
            busy={openingConnector === connector.id}
            onOpen={() => openConnector(connector.id)}
          />
        ))}
      </div>
      {connectorError && (
        <div style={{ marginBottom: 12, fontSize: 11, color: "#fb7185", lineHeight: 1.5 }}>
          {connectorError}
        </div>
      )}
      <HushTruthPanel connectors={connectors} inbox={inbox} />

      <DingTalkSourcePanel
        report={dingTalkReport}
        importReport={dingTalkImportReport}
        importPath={dingTalkImportPath}
        loading={dingTalkLoading}
        importing={dingTalkImporting}
        onDiagnose={diagnoseDingTalk}
        onImportPathChange={setDingTalkImportPath}
        onImport={importDingTalk}
      />

      <LiveInboxPanel inbox={inbox} onRefresh={fetchInbox} onClear={clearInbox} />

      {contacts.length === 0 ? (
        <div
          style={{
            padding: 36,
            textAlign: "center",
            borderRadius: 16,
            background: "rgba(255,255,255,0.62)",
            border: "1px dashed rgba(116,143,165,0.18)",
          }}
        >
          <div className="hub-empty-title">{t("hub.hush.emptyTitle")}</div>
          <div className="hub-empty-desc" style={{ maxWidth: 380, margin: "6px auto 0" }}>
            {t("hub.hush.emptyDesc")}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 400 }}>
          {/* Contact list (real, aggregated from inbox) */}
          <div
            style={{
              borderRadius: 14,
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(116,143,165,0.14)",
              overflowY: "auto",
              maxHeight: 500,
            }}
            className="scrollbar-thin"
          >
            {TIER_ORDER.map((tier) => {
              const tierContacts = contacts.filter((c) => c.tier === tier);
              if (tierContacts.length === 0) return null;
              const collapsed = collapsedTiers.has(tier);

              return (
                <div key={tier}>
                  <div
                    onClick={() => toggleTier(tier)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(116,143,165,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      position: "sticky",
                      top: 0,
                      background: "rgba(247,251,255,0.92)",
                      backdropFilter: "blur(8px)",
                      zIndex: 1,
                    }}
                  >
                    <span>{t(TIER_LABEL_KEYS[tier] ?? "hub.hush.tier.work")}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>
                      {tierContacts.length} {collapsed ? "▸" : "▾"}
                    </span>
                  </div>

                  {!collapsed &&
                    tierContacts.map((contact) => (
                      <ContactRow
                        key={contact.id}
                        contact={contact}
                        selected={selectedId === contact.id}
                        onClick={() => setSelectedId(contact.id)}
                      />
                    ))}
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          <div
            style={{
              borderRadius: 14,
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(116,143,165,0.14)",
              padding: 16,
              overflowY: "auto",
              maxHeight: 500,
            }}
            className="scrollbar-thin"
          >
            {selectedContact ? (
              <div className="animate-bounce-in">
                {/* Contact header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#263241" }}>
                      {selectedContact.name}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                      {selectedContact.platforms.map((p) => (
                        <span key={p} style={{ fontSize: 12 }} title={p}>
                          {PLATFORM_ICONS[p] || p}
                        </span>
                      ))}
                      <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>
                        {selectedContact.tier} · P{selectedContact.importance}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase" }}>
                    {t("hub.hush.messages")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selectedContact.messages.map((msg) => (
                      <div
                        key={msg.id}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.7)",
                          border: "1px solid rgba(116,143,165,0.12)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>
                            {msg.sender}
                          </span>
                          <span style={{ fontSize: 9, color: "#94a3b8" }}>
                            {PLATFORM_ICONS[msg.platform] || msg.platform}
                            {msg.chat ? ` · ${msg.chat}` : ""}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Suggested replies (from backend, latest message) */}
                {(() => {
                  const withReply = [...selectedContact.messages]
                    .reverse()
                    .find((m) => m.suggested_reply);
                  if (!withReply?.suggested_reply) return null;
                  return (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase" }}>
                        {t("hub.hush.suggestedReplies")}
                      </div>
                      <button
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 10,
                          background: "rgba(148,239,244,0.12)",
                          border: "1px solid rgba(116,143,165,0.16)",
                          color: "#0f6d78",
                          fontSize: 12,
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {withReply.suggested_reply}
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: "center" }}>
                <div className="hub-empty-title">{t("hub.hush.selectContactTitle")}</div>
                <div className="hub-empty-desc">{t("hub.hush.selectContactDesc")}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HushTruthPanel({
  connectors,
  inbox,
}: {
  connectors: HushConnectorStatus[];
  inbox: HushInboxSummary | null;
}) {
  const dingTalk = connectors.find((connector) => connector.id === "dingtalk");
  const state = dingTalk?.bridge_ready
    ? "Connected"
    : dingTalk?.installed
      ? "App found, messages not indexed"
      : "Not connected";
  const detail = dingTalk?.bridge_ready
    ? "Hush can summarize approved local messages."
    : dingTalk?.installed
      ? "Opening DingTalk is not enough. Scan local sources, then choose a read-only export/log path for HUMHUM to index."
      : "Install or log into Ali Ding first, then let Hush search for local storage candidates.";

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 18,
        background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(232,248,247,0.82))",
        border: "1px solid rgba(116,143,165,0.14)",
        boxShadow: "0 12px 34px rgba(90,115,150,0.1)",
        color: "#334155",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#6d6ade", fontWeight: 900, marginBottom: 4 }}>
            Hush connection truth
          </div>
          <div style={{ fontSize: 18, color: "#263241", fontWeight: 900, lineHeight: 1.2 }}>
            {state}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.55 }}>
            {detail}
          </div>
        </div>
        <div
          style={{
            minWidth: 124,
            padding: 10,
            borderRadius: 15,
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(116,143,165,0.12)",
          }}
        >
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 850, textTransform: "uppercase" }}>
            approved inbox
          </div>
          <div style={{ marginTop: 4, fontSize: 22, color: "#334155", fontWeight: 900 }}>
            {inbox?.total ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}

function DingTalkSourcePanel({
  report,
  importReport,
  importPath,
  loading,
  importing,
  onDiagnose,
  onImportPathChange,
  onImport,
}: {
  report: DingTalkLocalSourceReport | null;
  importReport: DingTalkImportReport | null;
  importPath: string;
  loading: boolean;
  importing: boolean;
  onDiagnose: () => void;
  onImportPathChange: (path: string) => void;
  onImport: () => void;
}) {
  const visibleCandidates = report?.candidates.filter((candidate) => candidate.exists || candidate.file_count > 0).slice(0, 5) ?? [];
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 16,
        background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(148,239,244,0.035))",
        border: "1px solid rgba(148,239,244,0.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 850, color: "rgba(255,255,255,0.86)" }}>
            Ali Ding local bridge
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.45 }}>
            Find local DingTalk storage first. Hush can only summarize after you choose what it may index.
          </div>
        </div>
        <button className="kawaii-tab" onClick={onDiagnose} disabled={loading} style={{ fontSize: 10, padding: "5px 9px" }}>
          {loading ? "Scanning..." : "Scan Ali Ding"}
        </button>
      </div>

      {report ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
            <MiniInboxStat label="app" value={report.app_detected ? 1 : 0} />
            <MiniInboxStat label="sources" value={report.source_count} />
            <MiniInboxStat label="readable" value={report.readable_count} />
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", lineHeight: 1.55, marginBottom: 8 }}>
            {report.summary}
          </div>
          {visibleCandidates.length > 0 ? (
            <div style={{ display: "grid", gap: 7, maxHeight: 190, overflowY: "auto" }} className="scrollbar-thin">
              {visibleCandidates.map((candidate) => (
                <div
                  key={candidate.path}
                  onClick={() => onImportPathChange(candidate.path)}
                  style={{
                    padding: 9,
                    borderRadius: 11,
                    background: "rgba(0,0,0,0.16)",
                    border: `1px solid ${candidate.readable ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)"}`,
                    cursor: candidate.readable ? "pointer" : "default",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: candidate.readable ? "#6ee7b7" : "#fbbf24", fontWeight: 850 }}>
                      {candidate.readable ? "readable" : candidate.kind}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.36)" }}>
                      {candidate.file_count} possible files
                    </span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,255,255,0.34)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {candidate.path}
                  </div>
                  {candidate.sample_files[0] && (
                    <div style={{ marginTop: 3, fontSize: 9, color: "rgba(148,239,244,0.42)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      sample: {candidate.sample_files[0]}
                    </div>
                  )}
                  {candidate.readable && (
                    <div style={{ marginTop: 5, fontSize: 9, color: "rgba(255,255,255,0.34)" }}>
                      Click to use this source for a read-only import.
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 10, borderRadius: 11, background: "rgba(255,255,255,0.018)", color: "rgba(255,255,255,0.34)", fontSize: 11 }}>
              No local DingTalk source has been found yet.
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            {report.next_step}
          </div>
        </>
      ) : (
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.018)", color: "rgba(255,255,255,0.36)", fontSize: 11, lineHeight: 1.5 }}>
          DingTalk is not connected by opening the app. Click scan to find Ali Ding local storage candidates on this Mac.
        </div>
      )}

      <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", fontWeight: 850, marginBottom: 6 }}>
          Read-only DingTalk import
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.45, marginBottom: 8 }}>
          Paste a DingTalk export/log/text path, or click a scanned candidate above. Hush reads text-like exports only and skips database/cache files.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={importPath}
            onChange={(event) => onImportPathChange(event.target.value)}
            placeholder="~/Library/.../DingTalk export.jsonl"
            style={{
              flex: 1,
              minWidth: 0,
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 999,
              background: "rgba(0,0,0,0.18)",
              color: "rgba(255,255,255,0.78)",
              fontSize: 10,
              padding: "7px 10px",
              outline: "none",
            }}
          />
          <button
            className="kawaii-tab"
            onClick={onImport}
            disabled={importing || !importPath.trim()}
            style={{ fontSize: 10, padding: "6px 10px", opacity: importing || !importPath.trim() ? 0.45 : 1 }}
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
        {importReport && (
          <div style={{ marginTop: 8, padding: 9, borderRadius: 10, background: "rgba(148,239,244,0.035)", border: "1px solid rgba(148,239,244,0.1)" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.68)", lineHeight: 1.5 }}>
              {importReport.summary}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
              <MiniInboxStat label="files" value={importReport.scanned_files} />
              <MiniInboxStat label="imported" value={importReport.imported_messages} />
              <MiniInboxStat label="db skipped" value={importReport.skipped_binary_sources} />
              <MiniInboxStat label="errors" value={importReport.errors.length} />
            </div>
            {importReport.errors[0] && (
              <div style={{ marginTop: 7, fontSize: 9, color: "rgba(251,113,133,0.82)", lineHeight: 1.45 }}>
                {importReport.errors.slice(0, 2).join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LiveInboxPanel({
  inbox,
  onRefresh,
  onClear,
}: {
  inbox: HushInboxSummary | null;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const messages = inbox?.messages ?? [];
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 16,
        background: "linear-gradient(135deg, rgba(148,239,244,0.06), rgba(255,255,255,0.018))",
        border: "1px solid rgba(148,239,244,0.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 850, color: "rgba(255,255,255,0.86)" }}>
            Live message inbox
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: "rgba(255,255,255,0.38)" }}>
            POST real messages to <span style={{ color: "#94eff4" }}>http://127.0.0.1:31275/hush/inbox</span>
          </div>
        </div>
        <button className="kawaii-tab" onClick={onRefresh} style={{ fontSize: 10, padding: "5px 9px" }}>
          Refresh
        </button>
        <button className="kawaii-tab" onClick={onClear} style={{ fontSize: 10, padding: "5px 9px" }}>
          Clear
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
        <MiniInboxStat label="messages" value={inbox?.total ?? 0} />
        <MiniInboxStat label="priority" value={inbox?.unread_priority ?? 0} />
        <MiniInboxStat label="family" value={inbox?.by_tier.family ?? 0} />
        <MiniInboxStat label="work" value={inbox?.by_tier.work ?? 0} />
      </div>

      {messages.length === 0 ? (
        <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.018)", color: "rgba(255,255,255,0.34)", fontSize: 11, lineHeight: 1.55 }}>
          No live messages yet. Try:
          <div style={{ marginTop: 6, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
            curl -X POST http://127.0.0.1:31275/hush/inbox -H 'content-type: application/json' -d '&#123;"platform":"dingtalk","sender":"PM","chat":"Project A","text":"需求文档已更新，今天需要确认"&#125;'
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }} className="scrollbar-thin">
          {messages.slice(0, 8).map((message) => (
            <div
              key={message.id}
              style={{
                padding: 10,
                borderRadius: 12,
                background: message.importance >= 4 ? "rgba(251,191,36,0.07)" : "rgba(255,255,255,0.022)",
                border: `1px solid ${message.importance >= 4 ? "rgba(251,191,36,0.16)" : "rgba(255,255,255,0.05)"}`,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#94eff4", fontWeight: 850 }}>{message.platform}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.78)", fontWeight: 780 }}>{message.sender}</span>
                {message.chat && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.34)" }}>{message.chat}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.32)" }}>
                  {message.tier} · P{message.importance}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", lineHeight: 1.5 }}>{message.text}</div>
              {message.suggested_reply && (
                <div style={{ marginTop: 6, fontSize: 11, color: "rgba(148,239,244,0.72)", lineHeight: 1.45 }}>
                  Suggested: {message.suggested_reply}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniInboxStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 8, borderRadius: 10, background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 16, fontWeight: 850, color: "rgba(255,255,255,0.86)" }}>{value}</div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function HushConnectorCard({
  connector,
  busy,
  onOpen,
}: {
  connector: HushConnectorStatus;
  busy: boolean;
  onOpen: () => void;
}) {
  const icon = connector.id === "dingtalk" ? "🔷" : "💬";
  const statusColor = connector.bridge_ready ? "#34d399" : connector.installed ? "#fbbf24" : "#fb7185";
  const statusLabel = connector.bridge_ready ? "Message bridge ready" : connector.installed ? "App launch ready" : "Not installed";

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        background: connector.installed ? "rgba(148,239,244,0.035)" : "rgba(255,255,255,0.018)",
        border: `1px solid ${connector.installed ? "rgba(148,239,244,0.12)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.8)" }}>
            {connector.name}
          </div>
          <div style={{ fontSize: 10, color: statusColor, marginTop: 2, fontWeight: 800 }}>
            {statusLabel}
          </div>
        </div>
        <button
          onClick={onOpen}
          disabled={busy || !connector.installed}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 999,
            background: connector.installed ? "rgba(148,239,244,0.1)" : "rgba(255,255,255,0.03)",
            color: connector.installed ? "#94eff4" : "rgba(255,255,255,0.25)",
            fontSize: 10,
            fontWeight: 800,
            padding: "6px 10px",
            cursor: connector.installed ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Opening..." : "Open"}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.45 }}>
        {connector.status}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: "rgba(148,239,244,0.58)", fontWeight: 800 }}>
        Mode: {connector.bridge_mode}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.24)", lineHeight: 1.4 }}>
        {connector.next_step}
      </div>
      {connector.app_path && (
        <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.22)", fontFamily: "monospace" }}>
          {connector.app_path}
        </div>
      )}
    </div>
  );
}

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: DerivedContact;
  selected: boolean;
  onClick: () => void;
}) {
  const isPriority = contact.importance >= 4;
  const timeLabel = formatTime(contact.lastMessageTime);

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: selected ? "rgba(148,239,244,0.14)" : "transparent",
        borderLeft: selected ? "2px solid rgba(52,178,190,0.6)" : "2px solid transparent",
        transition: "all 0.15s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
            {contact.name}
          </span>
          {isPriority && (
            <span style={{
              width: 5, height: 5, borderRadius: "50%", background: "#f59e0b",
              boxShadow: "0 0 4px rgba(245,158,11,0.6)",
            }} />
          )}
        </div>
        <div style={{
          fontSize: 10, color: "#94a3b8",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {contact.lastMessage}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>
          {timeLabel}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {contact.platforms.map((p) => (
            <span key={p} style={{ fontSize: 8 }}>{PLATFORM_ICONS[p] || p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

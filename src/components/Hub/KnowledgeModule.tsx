import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Search } from "lucide-react";
import type { AgentAsset, AgentRule, AppConfig, KnowledgeData, ObsidianNote, Preference } from "@/types";
import {
  filterAgentAssets,
  getAgentAssetSummary,
  type AgentAssetScope,
} from "./knowledgePresentation";

const CATEGORIES = ["coding_style", "tools", "workflow", "communication", "other"];

const CATEGORY_COLORS: Record<string, string> = {
  coding_style: "#94eff4",
  tools: "#a78bfa",
  workflow: "#34d399",
  communication: "#fbbf24",
  other: "#fb923c",
};

const NOTE_TYPE_COLORS: Record<string, string> = {
  preference: "#fbbf24",
  memory: "#fb7185",
  rule: "#a78bfa",
  skill: "#60a5fa",
  daily: "#34d399",
  project_context: "#94eff4",
  note: "#cbd5e1",
};

const ASSET_TYPE_COLORS: Record<string, string> = {
  skill: "#60a5fa",
  agent: "#a78bfa",
  soul: "#fb7185",
  memory: "#fbbf24",
  rule: "#34d399",
  config: "#94eff4",
  note: "#cbd5e1",
};

const DEFAULT_ASSET_ROOTS = [
  "~/.codex/skills",
  "~/.codex/plugins/cache",
  "~/.codex/vendor_imports/skills",
  "~/.claude",
  "~/.agents/skills",
  "~/.qoder",
  "~/.qoderwork",
  "~/.gemini",
  "~/.qwen",
  "~/.kimi",
  "~/.pi",
].join("\n");

function parseAssetRoots(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export type KnowledgeTab = "assets" | "preferences" | "rules" | "obsidian";

export type KnowledgeOperationStatus = {
  kind: "busy" | "success" | "error";
  message: string;
};

type KnowledgeRefreshActions = Record<
  KnowledgeTab,
  () => void | Promise<void>
>;

type KnowledgeOperationMessages<T> = {
  busy: string;
  success: string | ((result: T) => string);
  error: string;
};

export async function dispatchKnowledgeRefresh(
  activeTab: KnowledgeTab,
  actions: KnowledgeRefreshActions,
): Promise<void> {
  await actions[activeTab]();
}

export async function runKnowledgeOperation<T>(
  action: () => Promise<T>,
  onStatusChange: (status: KnowledgeOperationStatus) => void,
  messages: KnowledgeOperationMessages<T>,
): Promise<boolean> {
  onStatusChange({ kind: "busy", message: messages.busy });
  try {
    const result = await action();
    onStatusChange({
      kind: "success",
      message:
        typeof messages.success === "function"
          ? messages.success(result)
          : messages.success,
    });
    return true;
  } catch (error) {
    onStatusChange({
      kind: "error",
      message: `${messages.error}：${String(error)}`,
    });
    return false;
  }
}

export function KnowledgeLoadGate({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div
        className="hub-loading"
        role="status"
        aria-live="polite"
        aria-label="正在读取 Hype 知识库"
      />
    );
  }

  return (
    <div className="hype-load-error" role="alert" aria-live="assertive">
      <strong>Hype 暂时无法读取知识库</strong>
      <span>{error || "读取知识库失败"}</span>
      <button type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

export function KnowledgeSearchToolbar({
  query,
  onQueryChange,
  onRefresh,
  refreshBusy,
  refreshDisabled,
  refreshLabel,
  status,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  refreshBusy: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
  status: KnowledgeOperationStatus | null;
}) {
  return (
    <>
      <div className="hype-search-toolbar">
        <label className="hype-search-field">
          <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">搜索 Hype 知识库</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索技能、规则、偏好与记忆"
          />
        </label>
        <button
          type="button"
          className="hype-refresh-button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <RefreshCw
            size={18}
            strokeWidth={1.8}
            className={refreshBusy ? "is-spinning" : undefined}
            aria-hidden="true"
          />
        </button>
      </div>
      {status && (
        <div
          className={`hype-toolbar-status ${status.kind === "error" ? "is-error" : ""}`}
          role={status.kind === "error" ? "alert" : "status"}
          aria-live={status.kind === "error" ? "assertive" : "polite"}
        >
          {status.message}
        </div>
      )}
    </>
  );
}

interface CodexBridgeHealth {
  status: "starting" | "connected" | "codex_missing" | "unsupported" | "disconnected" | "error";
  version: string | null;
  last_connected_at: string | null;
  message: string;
}

interface QoderAcpStatus {
  installed: boolean;
  version?: string | null;
  acp_supported: boolean;
  hint: string;
  error?: string | null;
}

interface ReviewEngineState {
  codex: CodexBridgeHealth | null;
  hooks: Record<string, boolean>;
  qoder: QoderAcpStatus | null;
  config: AppConfig | null;
}

function inferReviewWorkspace(assets: AgentAsset[]): string {
  const firstPath = assets.find((asset) => asset.file_path.startsWith("/"))?.file_path;
  if (!firstPath) return ".";
  const homeMatch = firstPath.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (homeMatch?.[1]) return homeMatch[1];
  const lastSlash = firstPath.lastIndexOf("/");
  return lastSlash > 0 ? firstPath.slice(0, lastSlash) : ".";
}

function buildContextAuditPrompt(assets: AgentAsset[], noteCount: number, ruleCount: number): string {
  const typeCounts = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.asset_type] = (acc[asset.asset_type] || 0) + 1;
    return acc;
  }, {});
  const agentCounts = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.agent_id] = (acc[asset.agent_id] || 0) + 1;
    return acc;
  }, {});
  const samples = assets.slice(0, 24).map((asset) => ({
    type: asset.asset_type,
    agent: asset.agent_id,
    name: asset.name,
    path: asset.relative_path,
    tags: asset.tags.slice(0, 6),
  }));

  return [
    "你是 HUMHUM 的 Hype 上下文体检 reviewer。",
    "目标用户是不懂编程的新手，所以不要输出技术术语堆砌，也不要假装本地启发式判断足够可靠。",
    "请基于下面的扫描摘要，给 Humi 一份可执行的上下文整理建议：哪些值得保留、哪些需要用户确认、哪些可能是噪声、哪些只适合特定 agent。",
    "不要删除或改写任何文件。只输出建议和需要进一步读取的文件路径。",
    "",
    `扫描到 agent assets: ${assets.length}`,
    `扫描到 rules: ${ruleCount}`,
    `扫描到 Obsidian notes: ${noteCount}`,
    `类型分布: ${JSON.stringify(typeCounts)}`,
    `Agent 分布: ${JSON.stringify(agentCounts)}`,
    `样本清单: ${JSON.stringify(samples, null, 2)}`,
    "",
    "请按这个结构回答：",
    "1. 一句话结论",
    "2. 建议保留的上下文类型",
    "3. 需要用户确认的内容",
    "4. 可能造成噪声或误导的内容",
    "5. 下一步建议 Humi 怎么问用户",
  ].join("\n");
}

type AgentAssetRootDiagnostic = {
  raw_path: string;
  path: string;
  exists: boolean;
  is_dir: boolean;
  candidate_count: number;
  skill_count: number;
  sample_paths: string[];
  error?: string | null;
};

export function KnowledgeModule() {
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeLoadError, setKnowledgeLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("assets");
  const [operationStatus, setOperationStatus] = useState<
    (KnowledgeOperationStatus & { tab: KnowledgeTab }) | null
  >(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanningAssets, setScanningAssets] = useState(false);
  const [scanningVault, setScanningVault] = useState(false);
  const [assetRoots, setAssetRoots] = useState(DEFAULT_ASSET_ROOTS);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetScanSummary, setAssetScanSummary] = useState<string | null>(null);
  const [assetDiagnostics, setAssetDiagnostics] = useState<AgentAssetRootDiagnostic[]>([]);
  const [vaultPath, setVaultPath] = useState("");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [assetScope, setAssetScope] = useState<AgentAssetScope>("mine");
  const [reviewEngine, setReviewEngine] = useState<ReviewEngineState>({
    codex: null,
    hooks: {},
    qoder: null,
    config: null,
  });
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [showAdvancedReview, setShowAdvancedReview] = useState(false);
  const [piUrl, setPiUrl] = useState("");
  const [piModel, setPiModel] = useState("");
  const [piToken, setPiToken] = useState("");

  // New preference form
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("coding_style");
  const [showForm, setShowForm] = useState(false);

  const fetchData = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const result = await invoke<KnowledgeData>("get_knowledge");
      setData(result);
      setVaultPath(result.obsidian_vault?.path || "");
      setKnowledgeLoadError(null);
      return result;
    } catch (error) {
      setKnowledgeLoadError(`读取知识库失败：${String(error)}`);
      throw error;
    } finally {
      setKnowledgeLoading(false);
    }
  }, []);

  const fetchReviewEngine = useCallback(async () => {
    const [codex, hooks, qoder, config] = await Promise.all([
      invoke<CodexBridgeHealth>("get_codex_bridge_health").catch(() => null),
      invoke<Record<string, boolean>>("check_hooks_status").catch(() => ({})),
      invoke<QoderAcpStatus>("check_qoder_acp_support").catch(() => null),
      invoke<AppConfig>("get_config").catch(() => null),
    ]);
    setReviewEngine({ codex, hooks, qoder, config });
    if (config) {
      setPiUrl(config.pi.url);
      setPiModel(config.pi.model_name);
      setPiToken(config.pi.token ?? "");
    }
  }, []);

  useEffect(() => {
    void fetchData().catch(() => undefined);
    void fetchReviewEngine();
  }, [fetchData, fetchReviewEngine]);

  const handleSave = async () => {
    if (!newContent.trim()) return;
    const id = `pref-${Date.now()}`;
    await invoke("save_preference", {
      id,
      category: newCategory,
      content: newContent.trim(),
      source: "manual",
      priority: 3,
    });
    setNewContent("");
    setShowForm(false);
    await fetchData();
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_preference", { id });
    await fetchData();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await runKnowledgeOperation(
        async () => {
          const found = await invoke<AgentRule[]>("scan_agent_rules");
          if (found.length > 0) {
            await fetchData();
          }
          return found.length;
        },
        (status) => setOperationStatus({ ...status, tab: "rules" }),
        {
          busy: "正在扫描 Agent 规则...",
          success: (count) => `规则已刷新，共发现 ${count} 条。`,
          error: "扫描 Agent 规则失败",
        },
      );
    } finally {
      setScanning(false);
    }
  };

  const handleRefreshPreferences = async () => {
    await runKnowledgeOperation(
      async () => fetchData(),
      (status) => setOperationStatus({ ...status, tab: "preferences" }),
      {
        busy: "正在刷新偏好...",
        success: "偏好已刷新。",
        error: "刷新偏好失败",
      },
    );
  };

  const handleScanAssets = async () => {
    setScanningAssets(true);
    setAssetError(null);
    setAssetScanSummary(null);
    try {
      const roots = parseAssetRoots(assetRoots);
      const found = await invoke<AgentAsset[]>("scan_agent_assets", { roots });
      const skillCount = found.filter((asset) => asset.asset_type === "skill").length;
      const agentCount = found.filter((asset) => asset.asset_type === "agent").length;
      setAssetScanSummary(`Scanned ${found.length} assets · ${skillCount} skills · ${agentCount} agents`);
      await fetchData();
    } catch (error) {
      setAssetError(String(error));
    } finally {
      setScanningAssets(false);
    }
  };

  const handleDiagnoseAssets = async () => {
    setScanningAssets(true);
    setAssetError(null);
    setAssetScanSummary(null);
    try {
      const roots = parseAssetRoots(assetRoots);
      const diagnostics = await invoke<AgentAssetRootDiagnostic[]>("diagnose_agent_asset_roots", { roots });
      const candidates = diagnostics.reduce((sum, item) => sum + item.candidate_count, 0);
      const skills = diagnostics.reduce((sum, item) => sum + item.skill_count, 0);
      setAssetDiagnostics(diagnostics);
      setAssetScanSummary(`Diagnostics: ${candidates} candidate files · ${skills} SKILL.md files`);
    } catch (error) {
      setAssetError(String(error));
    } finally {
      setScanningAssets(false);
    }
  };

  const handleScanVault = async () => {
    setScanningVault(true);
    setVaultError(null);
    try {
      const path = vaultPath.trim() || null;
      await invoke<ObsidianNote[]>("scan_obsidian_vault", { path });
      await fetchData();
    } catch (error) {
      setVaultError(String(error));
    } finally {
      setScanningVault(false);
    }
  };

  const handleSaveCustomReviewer = async () => {
    if (!reviewEngine.config) return;
    const nextConfig: AppConfig = {
      ...reviewEngine.config,
      pi: {
        url: piUrl.trim(),
        model_name: piModel.trim(),
        token: piToken.trim() || undefined,
      },
    };
    await invoke("save_config", { newConfig: nextConfig });
    setReviewMessage("自定义 AI 助手配置已保存。");
    await fetchReviewEngine();
  };

  const handleStartCodexReview = async () => {
    if (reviewEngine.codex?.status !== "connected") {
      setReviewMessage("还没有可借用的 Codex。请先打开或连接 Codex。");
      return;
    }
    setReviewBusy(true);
    setReviewMessage(null);
    try {
      const threadId = await invoke<string>("hexa_start_codex_thread", {
        workspace: inferReviewWorkspace(assets),
      });
      await invoke("hexa_send_codex_message", {
        threadId,
        message: buildContextAuditPrompt(assets, notes.length, data?.agent_rules.length ?? 0),
      });
      setReviewMessage("已把 Hype 上下文体检任务交给 Codex。你可以在 Hexa 里跟进这个整理会话。");
    } catch (error) {
      setReviewMessage(`借用 Codex 失败：${String(error)}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const handleUpdatePriority = async (pref: Preference, newPriority: number) => {
    await invoke("save_preference", {
      id: pref.id,
      category: pref.category,
      content: pref.content,
      source: pref.source,
      priority: newPriority,
    });
    setEditing(null);
    await fetchData();
  };

  if (!data) {
    return (
      <KnowledgeLoadGate
        loading={knowledgeLoading}
        error={knowledgeLoadError}
        onRetry={() => {
          void fetchData().catch(() => undefined);
        }}
      />
    );
  }

  const notes = data.obsidian_notes || [];
  const assets = data.agent_assets || [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredNotes = notes.filter((note) => {
    if (!normalizedQuery) return true;
    return (
      note.title.toLowerCase().includes(normalizedQuery) ||
      note.relative_path.toLowerCase().includes(normalizedQuery) ||
      note.note_type.toLowerCase().includes(normalizedQuery) ||
      note.excerpt.toLowerCase().includes(normalizedQuery) ||
      note.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
    );
  });
  const filteredPreferences = data.preferences.filter((preference) => {
    if (!normalizedQuery) return true;
    return [
      preference.category,
      preference.content,
      preference.source,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const filteredRules = data.agent_rules.filter((rule) => {
    if (!normalizedQuery) return true;
    return [
      rule.agent_id,
      rule.rule_type,
      rule.file_path,
      rule.content,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  const typeCounts = notes.reduce<Record<string, number>>((acc, note) => {
    acc[note.note_type] = (acc[note.note_type] || 0) + 1;
    return acc;
  }, {});
  const hotCount = notes.filter((note) => note.memory_temperature === "hot").length;
  const coldCount = notes.length - hotCount;
  const configuredAssetRoots = parseAssetRoots(assetRoots);
  const scopedAssets = filterAgentAssets(
    assets,
    assetScope,
    "",
    configuredAssetRoots,
  );
  const assetTypeCounts = scopedAssets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.asset_type] = (acc[asset.asset_type] || 0) + 1;
    return acc;
  }, {});
  const filteredAssets = filterAgentAssets(
    assets,
    assetScope,
    searchQuery,
    configuredAssetRoots,
  );
  const operationBusy =
    operationStatus?.tab === activeTab && operationStatus.kind === "busy";
  const refreshBusy =
    (activeTab === "assets" && scanningAssets) ||
    (activeTab === "rules" && scanning) ||
    (activeTab === "obsidian" && scanningVault) ||
    operationBusy;
  const refreshDisabled =
    refreshBusy || (activeTab === "obsidian" && !vaultPath.trim());
  const refreshLabel =
    activeTab === "assets"
      ? "扫描 Agent 资产"
      : activeTab === "rules"
        ? "扫描 Agent 规则"
        : activeTab === "obsidian"
          ? "刷新 Obsidian 索引"
          : "刷新偏好";

  const toolbarStatus: KnowledgeOperationStatus | null =
    activeTab === "assets"
      ? scanningAssets
        ? { kind: "busy", message: "正在扫描 Agent 资产..." }
        : assetError
          ? { kind: "error", message: assetError }
          : assetScanSummary
            ? { kind: "success", message: assetScanSummary }
            : null
      : activeTab === "obsidian"
        ? scanningVault
          ? { kind: "busy", message: "正在刷新 Obsidian 索引..." }
          : vaultError
            ? { kind: "error", message: vaultError }
            : data.obsidian_vault?.last_indexed_at
              ? {
                  kind: "success",
                  message: `上次索引：${new Date(data.obsidian_vault.last_indexed_at).toLocaleString()}`,
                }
              : null
        : operationStatus?.tab === activeTab
          ? operationStatus
          : null;

  const handleActiveRefresh = () => {
    void dispatchKnowledgeRefresh(activeTab, {
      assets: handleScanAssets,
      preferences: handleRefreshPreferences,
      rules: handleScan,
      obsidian: handleScanVault,
    });
  };

  return (
    <div className="hub-module hype-room-module">
      <header className="hype-heading">
        <h2 className="hub-module-title">Hype 知识库</h2>
        <p className="hub-module-desc">我安装和创建的技能、规则与记忆</p>
      </header>

      <KnowledgeSearchToolbar
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onRefresh={handleActiveRefresh}
        refreshBusy={refreshBusy}
        refreshDisabled={refreshDisabled}
        refreshLabel={refreshLabel}
        status={toolbarStatus}
      />

      <div className="hype-primary-controls">
        <div className="hype-tabs" role="tablist" aria-label="Hype 知识视图">
          {(["assets", "preferences", "rules", "obsidian"] as KnowledgeTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "is-active" : undefined}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "assets"
                ? `我的技能 ${scopedAssets.length}`
                : tab === "preferences"
                  ? `我的偏好 ${data.preferences.length}`
                  : tab === "rules"
                    ? `我的规则 ${data.agent_rules.length}`
                    : `记忆 ${notes.length}`}
            </button>
          ))}
        </div>

        {activeTab === "assets" && (
          <div className="hype-scope-control" aria-label="Agent 资产范围">
            <button
              type="button"
              className={assetScope === "mine" ? "is-active" : undefined}
              aria-pressed={assetScope === "mine"}
              onClick={() => setAssetScope("mine")}
            >
              我安装和创建的
            </button>
            <button
              type="button"
              className={assetScope === "all" ? "is-active" : undefined}
              aria-pressed={assetScope === "all"}
              onClick={() => setAssetScope("all")}
            >
              全部扫描结果
            </button>
          </div>
        )}
      </div>

      <ReviewEnginePanel
        assetsCount={assets.length}
        reviewEngine={reviewEngine}
        busy={reviewBusy}
        message={reviewMessage}
        showAdvanced={showAdvancedReview}
        piUrl={piUrl}
        piModel={piModel}
        piToken={piToken}
        onToggleAdvanced={() => setShowAdvancedReview((value) => !value)}
        onPiUrlChange={setPiUrl}
        onPiModelChange={setPiModel}
        onPiTokenChange={setPiToken}
        onStartCodexReview={handleStartCodexReview}
        onSaveCustomReviewer={handleSaveCustomReviewer}
      />

      {/* Agent assets tab */}
      {activeTab === "assets" && (
        <div className="hype-inventory">
          <div className="hype-inventory-summary">
            <span>{filteredAssets.length} 项</span>
            {Object.entries(assetTypeCounts).map(([type, count]) => (
              <span key={type}>{type} {count}</span>
            ))}
          </div>

          <div className="hype-asset-list">
            <div className="hype-asset-list-header" aria-hidden="true">
              <span>名称</span>
              <span>来源 / Agent</span>
              <span>类型</span>
              <span>更新时间</span>
            </div>
            {filteredAssets.length === 0 ? (
              <div className="hype-empty-state">
                {assets.length === 0
                  ? "刷新后，Hype 会把本地 Agent 资产整理到这里。"
                  : "当前范围里没有匹配的资产。"}
              </div>
            ) : (
              filteredAssets.map((asset) => (
                <AgentAssetRow key={asset.id} asset={asset} />
              ))
            )}
          </div>

          <details className="hype-asset-details">
            <summary>高级扫描设置与诊断</summary>
            <div className="hype-asset-details-content">
              <label className="kawaii-label" htmlFor="hype-asset-roots">
                Agent asset roots
              </label>
              <button
                type="button"
                onClick={() => setAssetRoots(DEFAULT_ASSET_ROOTS)}
                className="kawaii-tab"
              >
                Use recommended roots
              </button>
              <textarea
                id="hype-asset-roots"
                value={assetRoots}
                onChange={(event) => setAssetRoots(event.target.value)}
                className="kawaii-input"
              />
              <button
                type="button"
                onClick={handleDiagnoseAssets}
                disabled={scanningAssets}
                className="kawaii-tab"
              >
                {scanningAssets ? "Diagnosing..." : "Diagnose scan roots"}
              </button>
              {assetDiagnostics.length > 0 && (
                <div className="hype-diagnostics">
                  {assetDiagnostics.map((item) => (
                    <div key={item.path} className="hype-diagnostic-row">
                      <strong className={item.exists && item.is_dir ? "" : "is-error"}>
                        {item.raw_path} · {item.exists && item.is_dir ? "ready" : "not found"}
                      </strong>
                      <span>
                        candidates {item.candidate_count} · SKILL.md {item.skill_count}
                      </span>
                      {item.sample_paths.slice(0, 2).map((sample) => (
                        <code key={sample}>{sample}</code>
                      ))}
                      {item.error && <span className="is-error">{item.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {/* Preferences tab */}
      {activeTab === "preferences" && (
        <div>
          {/* Add button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: 8,
                border: "1px dashed rgba(148,239,244,0.2)",
                background: "rgba(148,239,244,0.04)",
                color: "rgba(148,239,244,0.7)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: 12,
                transition: "all 0.2s",
              }}
            >
              + 添加偏好
            </button>
          )}

          {/* Add form */}
          {showForm && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(148,239,244,0.15)",
                marginBottom: 12,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="kawaii-input kawaii-select"
                  style={{ marginBottom: 8 }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="描述你的偏好..."
                className="kawaii-input"
                style={{ minHeight: 60, resize: "vertical", marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleSave}
                  disabled={!newContent.trim()}
                  className="kawaii-save-btn"
                  style={{ flex: 1, padding: 8, fontSize: 12 }}
                >
                  保存
                </button>
                <button
                  onClick={() => { setShowForm(false); setNewContent(""); }}
                  style={{
                    flex: 1,
                    padding: 8,
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.03)",
                    color: "rgba(255,255,255,0.4)",
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Preference list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredPreferences.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                {data.preferences.length === 0 ? "暂无偏好设置，点击上方按钮添加" : "没有匹配的偏好"}
              </div>
            ) : (
              filteredPreferences.map((pref) => {
                const color = CATEGORY_COLORS[pref.category] || "#94eff4";
                return (
                  <div
                    key={pref.id}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span
                        style={{
                          padding: "1px 6px",
                          borderRadius: 8,
                          background: `${color}15`,
                          color,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {pref.category}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                        via {pref.source}
                      </span>
                      <div style={{ flex: 1 }} />

                      {/* Priority */}
                      {editing === pref.id ? (
                        <div style={{ display: "flex", gap: 2 }}>
                          {[1, 2, 3, 4, 5].map((p) => (
                            <button
                              key={p}
                              onClick={() => handleUpdatePriority(pref, p)}
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 4,
                                border: "none",
                                background:
                                  p <= pref.priority
                                    ? `${color}30`
                                    : "rgba(255,255,255,0.04)",
                                color: p <= pref.priority ? color : "rgba(255,255,255,0.2)",
                                fontSize: 9,
                                cursor: "pointer",
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span
                          onClick={() => setEditing(pref.id)}
                          style={{
                            fontSize: 10,
                            color: "rgba(255,255,255,0.25)",
                            cursor: "pointer",
                          }}
                        >
                          P{pref.priority}
                        </span>
                      )}

                      <button
                        onClick={() => handleDelete(pref.id)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: "none",
                          background: "transparent",
                          color: "rgba(255,255,255,0.15)",
                          fontSize: 11,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                      {pref.content}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* API hint */}
          <div
            style={{
              marginTop: 16,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.03)",
              fontSize: 11,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "monospace",
            }}
          >
            Local API: X-HumHum-Token required (see docs/getting-started.md)
          </div>
        </div>
      )}

      {/* Rules tab */}
      {activeTab === "rules" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredRules.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                {data.agent_rules.length === 0
                  ? "点击刷新发现 CLAUDE.md / .cursorrules 等规则文件"
                  : "没有匹配的规则"}
              </div>
            ) : (
              filteredRules.map((rule) => (
                <RuleCard key={rule.id} rule={rule} />
              ))
            )}
          </div>
        </div>
      )}

      {/* Obsidian tab */}
      {activeTab === "obsidian" && (
        <div>
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(148,239,244,0.12)",
              marginBottom: 12,
            }}
          >
            <label className="kawaii-label">Obsidian Vault</label>
            <input
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              placeholder="~/Documents/My Vault"
              className="kawaii-input"
              style={{ marginTop: 8 }}
            />
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: "rgba(255,255,255,0.25)",
                fontFamily: "monospace",
              }}
            >
              {data.obsidian_vault?.last_indexed_at
                ? `last indexed ${new Date(data.obsidian_vault.last_indexed_at).toLocaleString()}`
                : "read-only local markdown index"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            <KnowledgeStat label="hot" value={hotCount} color="#fbbf24" />
            <KnowledgeStat label="cold" value={coldCount} color="#94a3b8" />
            <KnowledgeStat label="tasks" value={notes.reduce((sum, note) => sum + note.tasks.length, 0)} color="#34d399" />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type} className="kawaii-badge">
                {type} {count}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredNotes.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                {notes.length === 0 ? "配置 vault 路径后刷新索引" : "没有匹配的笔记"}
              </div>
            ) : (
              filteredNotes.map((note) => (
                <ObsidianNoteCard key={note.id} note={note} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div style={{ fontSize: 10, color, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, color: "rgba(255,255,255,0.78)", fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function bridgeTone(ok: boolean): string {
  return ok ? "#34d399" : "#94a3b8";
}

function ReviewEnginePanel({
  assetsCount,
  reviewEngine,
  busy,
  message,
  showAdvanced,
  piUrl,
  piModel,
  piToken,
  onToggleAdvanced,
  onPiUrlChange,
  onPiModelChange,
  onPiTokenChange,
  onStartCodexReview,
  onSaveCustomReviewer,
}: {
  assetsCount: number;
  reviewEngine: ReviewEngineState;
  busy: boolean;
  message: string | null;
  showAdvanced: boolean;
  piUrl: string;
  piModel: string;
  piToken: string;
  onToggleAdvanced: () => void;
  onPiUrlChange: (value: string) => void;
  onPiModelChange: (value: string) => void;
  onPiTokenChange: (value: string) => void;
  onStartCodexReview: () => void;
  onSaveCustomReviewer: () => Promise<void>;
}) {
  const codexReady = reviewEngine.codex?.status === "connected";
  const claudeReady = !!reviewEngine.hooks["claude-code"];
  const qoderReady = !!reviewEngine.qoder?.acp_supported;
  const customReady = !!reviewEngine.config?.pi.token;
  const anyReviewer = codexReady || claudeReady || qoderReady || customReady;

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: 14,
        borderRadius: 8,
        background: anyReviewer
          ? "linear-gradient(135deg, rgba(52,211,153,0.09), rgba(148,239,244,0.06))"
          : "linear-gradient(135deg, rgba(251,191,36,0.09), rgba(255,255,255,0.04))",
        border: `1px solid ${anyReviewer ? "rgba(52,211,153,0.22)" : "rgba(251,191,36,0.2)"}`,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "start" }}>
        <div>
          <div style={{ color: "#263241", fontSize: 13, fontWeight: 850 }}>Hype Review Engine</div>
          <div style={{ marginTop: 4, color: "#64748b", fontSize: 11, lineHeight: 1.5 }}>
            已扫描 {assetsCount} 个上下文资产。Humi 不做低可信本地判断；会优先借用你已经登录的 AI 助手来判断哪些真的有用。
          </div>
        </div>
        <button
          type="button"
          className="kawaii-save-btn"
          disabled={!codexReady || busy || assetsCount === 0}
          onClick={onStartCodexReview}
          style={{ minWidth: 132, padding: "8px 12px", fontSize: 12 }}
          title={codexReady ? "借用 Codex 做上下文体检" : "需要先连接 Codex"}
        >
          {busy ? "整理中..." : codexReady ? "借用 Codex 整理" : "等待 AI 助手"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <ReviewerPill label="Codex" ok={codexReady} detail={reviewEngine.codex?.message ?? "未连接"} />
        <ReviewerPill label="Claude" ok={claudeReady} detail={claudeReady ? "hook 可用" : "未检测到 hook"} />
        <ReviewerPill label="Qoder" ok={qoderReady} detail={reviewEngine.qoder?.hint ?? "未检测到 ACP"} />
        <ReviewerPill label="自定义" ok={customReady} detail={customReady ? reviewEngine.config?.pi.model_name ?? "已配置" : "高级连接"} />
      </div>

      {!anyReviewer && (
        <div style={{ color: "#8a6a12", fontSize: 11, lineHeight: 1.5 }}>
          现在只会展示扫描证据，不会判断好坏。请连接 Codex、Claude、Qoder，或在高级选项里连接一个自定义 AI 服务。
        </div>
      )}

      {message && (
        <div style={{ color: message.includes("失败") ? "#fb7185" : "#0f9f8f", fontSize: 11, fontWeight: 750 }}>
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleAdvanced}
        className="kawaii-tab"
        style={{ width: "fit-content", padding: "6px 10px", fontSize: 11 }}
      >
        {showAdvanced ? "收起高级 AI 连接" : "高级：自定义 AI 服务"}
      </button>

      {showAdvanced && (
        <div style={{ display: "grid", gap: 8, paddingTop: 2 }}>
          <input
            value={piUrl}
            onChange={(event) => onPiUrlChange(event.target.value)}
            placeholder="https://api.openai.com/v1 或本地模型地址"
            className="kawaii-input"
          />
          <input
            value={piModel}
            onChange={(event) => onPiModelChange(event.target.value)}
            placeholder="model name"
            className="kawaii-input"
          />
          <input
            value={piToken}
            onChange={(event) => onPiTokenChange(event.target.value)}
            placeholder="token"
            type="password"
            className="kawaii-input"
          />
          <button
            type="button"
            onClick={() => void onSaveCustomReviewer()}
            className="kawaii-save-btn"
            style={{ width: "fit-content", padding: "8px 12px", fontSize: 12 }}
          >
            保存自定义 AI 助手
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewerPill({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  const color = bridgeTone(ok);
  return (
    <div
      style={{
        minWidth: 0,
        padding: 9,
        borderRadius: 8,
        background: ok ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.42)",
        border: `1px solid ${ok ? "rgba(52,211,153,0.18)" : "rgba(116,143,165,0.12)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color, fontSize: 11, fontWeight: 850 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
        {label}
      </div>
      <div style={{ marginTop: 4, color: "#64748b", fontSize: 10, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {detail}
      </div>
    </div>
  );
}

function AgentAssetRow({ asset }: { asset: AgentAsset }) {
  const [expanded, setExpanded] = useState(false);
  const color = ASSET_TYPE_COLORS[asset.asset_type] || "#94eff4";
  const summary = getAgentAssetSummary(asset);

  return (
    <div className={`hype-asset-item ${expanded ? "is-expanded" : ""}`}>
      <button
        type="button"
        className="hype-asset-row"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="hype-asset-name">
          <strong>{asset.name}</strong>
          <small>{summary}</small>
        </span>
        <span className="hype-asset-source">
          <span>{compactHomePath(asset.source)}</span>
          <small>{asset.agent_id}</small>
        </span>
        <span
          className="hype-asset-type"
          style={{ color, backgroundColor: `${color}18` }}
        >
          {asset.asset_type}
        </span>
        <time dateTime={asset.modified_at || undefined}>
          {asset.modified_at ? new Date(asset.modified_at).toLocaleString() : "—"}
        </time>
      </button>

      {expanded && (
        <div className="hype-asset-expanded">
          <code>{asset.file_path}</code>
          {asset.tags.length > 0 && (
            <div className="hype-asset-tags">
              {asset.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
          )}
          <pre className="scrollbar-thin">{asset.content}</pre>
        </div>
      )}
    </div>
  );
}

function compactHomePath(path: string): string {
  return path.replace(/^(?:[A-Za-z]:\\Users\\[^\\]+|\/Users\/[^/]+|\/home\/[^/]+)/, "~");
}

function ObsidianNoteCard({ note }: { note: ObsidianNote }) {
  const [expanded, setExpanded] = useState(false);
  const color = NOTE_TYPE_COLORS[note.note_type] || "#94eff4";
  const openTasks = note.tasks.filter((task) => !task.completed).length;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderLeft: `3px solid ${color}`,
        cursor: "pointer",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ color, fontSize: 11, fontWeight: 700 }}>{note.note_type}</span>
        <span
          style={{
            fontSize: 10,
            color: note.memory_temperature === "hot" ? "#fbbf24" : "rgba(255,255,255,0.25)",
          }}
        >
          {note.memory_temperature}
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>
          {note.source}
        </span>
        <div style={{ flex: 1 }} />
        {note.tasks.length > 0 && (
          <span style={{ fontSize: 10, color: "#34d399" }}>
            {openTasks}/{note.tasks.length} todo
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", fontWeight: 650 }}>
        {note.title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "rgba(255,255,255,0.28)",
          fontFamily: "monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {note.relative_path}
      </div>

      {note.excerpt && (
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.52)", lineHeight: 1.45 }}>
          {note.excerpt}
        </div>
      )}

      {note.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {note.tags.slice(0, expanded ? 16 : 6).map((tag) => (
            <span
              key={tag}
              style={{
                padding: "1px 6px",
                borderRadius: 8,
                background: "rgba(148,239,244,0.08)",
                color: "rgba(148,239,244,0.75)",
                fontSize: 10,
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: "rgba(0,0,0,0.22)",
            border: "1px solid rgba(255,255,255,0.04)",
            fontSize: 11,
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontFamily: "monospace", marginBottom: 6 }}>{note.file_path}</div>
          <div>wiki links: {note.wiki_links.length ? note.wiki_links.join(", ") : "none"}</div>
          <div>frontmatter keys: {Object.keys(note.frontmatter).length || 0}</div>
          {note.tasks.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {note.tasks.slice(0, 8).map((task) => (
                <div key={`${task.line}:${task.text}`}>
                  {task.completed ? "[x]" : "[ ]"} L{task.line} {task.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: AgentRule }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        cursor: "pointer",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#a78bfa" }}>
          {rule.rule_type}
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
          {rule.agent_id}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.35)",
          fontFamily: "monospace",
          marginTop: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: expanded ? "pre-wrap" : "nowrap",
        }}
      >
        {expanded ? rule.content : rule.file_path}
      </div>
      {expanded && (
        <div
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 8,
            background: "rgba(0,0,0,0.25)",
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            maxHeight: 300,
            overflowY: "auto",
            lineHeight: 1.5,
          }}
          className="scrollbar-thin"
        >
          {rule.content}
        </div>
      )}
    </div>
  );
}

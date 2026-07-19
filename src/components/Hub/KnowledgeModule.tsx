import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentAsset, AgentRule, AppConfig, KnowledgeData, ObsidianNote, Preference } from "@/types";

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
  "~/.qoder",
  "~/.qoderwork",
  "~/.gemini",
  "~/.qwen",
  "~/.kimi",
  "~/.pi",
].join("\n");

type Tab = "assets" | "preferences" | "rules" | "obsidian";

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
  const [activeTab, setActiveTab] = useState<Tab>("assets");
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
  const [assetView, setAssetView] = useState<"skills" | "all">("skills");
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
    try {
      const result = await invoke<KnowledgeData>("get_knowledge");
      setData(result);
      setVaultPath(result.obsidian_vault?.path || "");
    } catch {
      // ignore
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
    fetchData();
    fetchReviewEngine();
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
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_preference", { id });
    fetchData();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const found = await invoke<AgentRule[]>("scan_agent_rules");
      if (found.length > 0) {
        fetchData();
      }
    } finally {
      setScanning(false);
    }
  };

  const handleScanAssets = async () => {
    setScanningAssets(true);
    setAssetError(null);
    setAssetScanSummary(null);
    try {
      const roots = assetRoots
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const found = await invoke<AgentAsset[]>("scan_agent_assets", { roots });
      const skillCount = found.filter((asset) => asset.asset_type === "skill").length;
      const agentCount = found.filter((asset) => asset.asset_type === "agent").length;
      setAssetScanSummary(`已整理 ${found.length} 项本地知识 · ${skillCount} 个个人技能 · ${agentCount} 个 Agent 配置`);
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
      const roots = assetRoots
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const diagnostics = await invoke<AgentAssetRootDiagnostic[]>("diagnose_agent_asset_roots", { roots });
      const candidates = diagnostics.reduce((sum, item) => sum + item.candidate_count, 0);
      const skills = diagnostics.reduce((sum, item) => sum + item.skill_count, 0);
      setAssetDiagnostics(diagnostics);
      setAssetScanSummary(`诊断完成：${candidates} 个候选文件 · ${skills} 个技能文件`);
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
      fetchData();
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
    fetchData();
  };

  if (!data) {
    return <div className="hub-loading" />;
  }

  const notes = data.obsidian_notes || [];
  const assets = data.agent_assets || [];
  const filteredNotes = notes.filter((note) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      note.title.toLowerCase().includes(query) ||
      note.relative_path.toLowerCase().includes(query) ||
      note.note_type.toLowerCase().includes(query) ||
      note.excerpt.toLowerCase().includes(query) ||
      note.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  const typeCounts = notes.reduce<Record<string, number>>((acc, note) => {
    acc[note.note_type] = (acc[note.note_type] || 0) + 1;
    return acc;
  }, {});
  const hotCount = notes.filter((note) => note.memory_temperature === "hot").length;
  const coldCount = notes.length - hotCount;
  const assetTypeCounts = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.asset_type] = (acc[asset.asset_type] || 0) + 1;
    return acc;
  }, {});
  const filteredAssets = assets.filter((asset) => {
    if (assetView === "skills" && asset.asset_type !== "skill") return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      asset.name.toLowerCase().includes(query) ||
      asset.asset_type.toLowerCase().includes(query) ||
      asset.agent_id.toLowerCase().includes(query) ||
      asset.relative_path.toLowerCase().includes(query) ||
      asset.content.toLowerCase().includes(query) ||
      (asset.display_name_zh || "").toLowerCase().includes(query) ||
      (asset.summary_zh || "").toLowerCase().includes(query) ||
      asset.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });
  const personalSkills = assets.filter((asset) => asset.asset_type === "skill");
  const createdSkillCount = personalSkills.filter((asset) => asset.ownership === "created").length;
  const installedSkillCount = personalSkills.filter((asset) => asset.ownership === "installed").length;
  const usedSkillCount = personalSkills.filter((asset) => asset.ownership === "used").length;

  return (
    <div className="hub-module">
      <h2 className="hub-module-title">Hype — Personal Agent Knowledge Base</h2>
      <p className="hub-module-desc" style={{ marginBottom: 14 }}>
        Connect your Obsidian vault, agent rules, preferences, skills, and memories into reusable personal context.
      </p>

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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 8,
          background: "linear-gradient(135deg, rgba(148,239,244,0.08), rgba(167,139,250,0.05))",
          border: "1px solid rgba(148,239,244,0.16)",
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", fontWeight: 750 }}>
            我的 Agent 知识
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.45 }}>
            Hype 只负责扫描证据；哪些真的有用，需要借用一个已连接的 AI 助手来判断。
          </div>
        </div>
        <button
          className="kawaii-save-btn"
          onClick={() => setActiveTab("assets")}
          style={{ minWidth: 116, padding: "8px 12px", fontSize: 12 }}
        >
          查看我的技能
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["assets", "preferences", "rules", "obsidian"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`kawaii-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "assets"
              ? `我的技能 (${personalSkills.length})`
              : tab === "preferences"
                ? `偏好 (${data.preferences.length})`
                : tab === "rules"
                  ? `规则 (${data.agent_rules.length})`
                  : `Obsidian (${notes.length})`}
          </button>
        ))}
      </div>

      {/* Agent assets tab */}
      {activeTab === "assets" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              className={`kawaii-tab ${assetView === "skills" ? "active" : ""}`}
              onClick={() => setAssetView("skills")}
            >
              我的技能
            </button>
            <button
              type="button"
              className={`kawaii-tab ${assetView === "all" ? "active" : ""}`}
              onClick={() => setAssetView("all")}
            >
              全部知识
            </button>
          </div>

          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={assetView === "skills" ? "搜索技能名称或中文用途..." : "搜索技能、规则、记忆或配置..."}
            className="kawaii-input"
            aria-label={assetView === "skills" ? "搜索我的技能" : "搜索全部知识"}
          />
          <div style={{ marginTop: 6, marginBottom: 10, fontSize: 10, color: "rgba(255,255,255,0.32)" }}>
            {searchQuery.trim() ? `找到 ${filteredAssets.length} 项结果` : `共 ${filteredAssets.length} 项`}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
            <KnowledgeStat label="我的技能" value={personalSkills.length} color="#60a5fa" />
            <KnowledgeStat label="我创建的" value={createdSkillCount} color="#34d399" />
            <KnowledgeStat label="已安装" value={installedSkillCount} color="#a78bfa" />
            <KnowledgeStat label="会话用过" value={usedSkillCount} color="#f59e0b" />
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 14,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(148,239,244,0.12)",
              marginBottom: 12,
            }}
          >
            <label className="kawaii-label">补充扫描目录</label>
            <button
              onClick={() => setAssetRoots(DEFAULT_ASSET_ROOTS)}
              className="kawaii-tab"
              style={{ marginTop: 8, marginBottom: 8, padding: "6px 10px", fontSize: 11 }}
            >
              恢复推荐目录
            </button>
            <textarea
              value={assetRoots}
              onChange={(e) => setAssetRoots(e.target.value)}
              className="kawaii-input"
              style={{ minHeight: 96, resize: "vertical", marginTop: 8, fontFamily: "monospace", fontSize: 11 }}
            />
            <button
              onClick={handleScanAssets}
              disabled={scanningAssets}
              className="kawaii-save-btn"
              style={{ width: "100%", padding: 9, fontSize: 12, marginTop: 10 }}
            >
              {scanningAssets ? "正在整理..." : "刷新我的技能与本地知识"}
            </button>
            <button
              onClick={handleDiagnoseAssets}
              disabled={scanningAssets}
              className="kawaii-tab"
              style={{ width: "100%", padding: 8, fontSize: 11, marginTop: 8 }}
            >
              检查扫描目录
            </button>
            {assetError && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#fb7185" }}>
                {assetError}
              </div>
            )}
            {assetScanSummary && (
              <div style={{ marginTop: 8, fontSize: 11, color: "rgba(148,239,244,0.78)", fontWeight: 700 }}>
                {assetScanSummary}
              </div>
            )}
            {assetDiagnostics.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {assetDiagnostics.map((item) => (
                  <div
                    key={item.path}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.18)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontSize: 10,
                      color: "rgba(255,255,255,0.58)",
                    }}
                  >
                    <div style={{ color: item.exists && item.is_dir ? "#94eff4" : "#fb7185", fontWeight: 750 }}>
                      {item.raw_path} · {item.exists && item.is_dir ? "可读取" : "未找到"}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      候选文件 {item.candidate_count} · 技能文件 {item.skill_count}
                    </div>
                    {item.sample_paths.length > 0 && (
                      <div style={{ marginTop: 4, fontFamily: "monospace", opacity: 0.7 }}>
                        {item.sample_paths.slice(0, 2).map((sample) => (
                          <div key={sample}>{sample}</div>
                        ))}
                      </div>
                    )}
                    {item.error && <div style={{ marginTop: 4, color: "#fb7185" }}>{item.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {Object.entries(assetTypeCounts).map(([type, count]) => (
              <span key={type} className="kawaii-badge">
                {type} {count}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredAssets.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                {assetView === "skills" ? "点击刷新后，Hype 会整理你创建和明确安装的技能。" : "点击刷新后，Hype 会整理本地 Agent 知识。"}
              </div>
            ) : (
              filteredAssets.map((asset) => <AgentAssetCard key={asset.id} asset={asset} />)
            )}
          </div>
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
                borderRadius: 12,
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
                borderRadius: 14,
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
                    borderRadius: 9999,
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
            {data.preferences.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                暂无偏好设置，点击上方按钮添加
              </div>
            ) : (
              data.preferences.map((pref) => {
                const color = CATEGORY_COLORS[pref.category] || "#94eff4";
                return (
                  <div
                    key={pref.id}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span
                        style={{
                          padding: "1px 6px",
                          borderRadius: 9999,
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
              borderRadius: 10,
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
          <button
            onClick={handleScan}
            disabled={scanning}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: 12,
              border: "1px solid rgba(148,239,244,0.15)",
              background: "rgba(148,239,244,0.06)",
              color: "rgba(148,239,244,0.8)",
              fontSize: 12,
              fontWeight: 600,
              cursor: scanning ? "wait" : "pointer",
              marginBottom: 12,
              transition: "all 0.2s",
            }}
          >
            {scanning ? "扫描中..." : "🔍 扫描 Agent 规则文件"}
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.agent_rules.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                暂无规则，点击扫描发现 CLAUDE.md / .cursorrules 等文件
              </div>
            ) : (
              data.agent_rules.map((rule) => (
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
              borderRadius: 14,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(148,239,244,0.12)",
              marginBottom: 12,
            }}
          >
            <label className="kawaii-label">Obsidian Vault</label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                placeholder="~/Documents/My Vault"
                className="kawaii-input"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                onClick={handleScanVault}
                disabled={scanningVault || !vaultPath.trim()}
                className="kawaii-save-btn"
                style={{ width: 88, padding: 8, fontSize: 12 }}
              >
                {scanningVault ? "刷新中" : "刷新"}
              </button>
            </div>
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
            {vaultError && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#fb7185" }}>
                {vaultError}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            <KnowledgeStat label="hot" value={hotCount} color="#fbbf24" />
            <KnowledgeStat label="cold" value={coldCount} color="#94a3b8" />
            <KnowledgeStat label="tasks" value={notes.reduce((sum, note) => sum + note.tasks.length, 0)} color="#34d399" />
          </div>

          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索标题、tag、类型或摘录..."
            className="kawaii-input"
            style={{ marginBottom: 10 }}
          />

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
        borderRadius: 10,
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

function AgentAssetCard({ asset }: { asset: AgentAsset }) {
  const [expanded, setExpanded] = useState(false);
  const color = ASSET_TYPE_COLORS[asset.asset_type] || "#94eff4";
  const isSkill = asset.asset_type === "skill";
  const title = asset.display_name_zh || asset.name;
  const ownershipLabel = asset.ownership === "used"
    ? "会话用过"
    : asset.ownership === "installed"
      ? "已安装"
      : asset.ownership === "created"
        ? "我创建的"
        : "来源待确认";

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
        <span style={{ color, fontSize: 11, fontWeight: 800 }}>{isSkill ? ownershipLabel : asset.asset_type}</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{asset.agent_id}</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>{compactHomePath(asset.source)}</span>
        <div style={{ flex: 1 }} />
        {asset.modified_at && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>
            {new Date(asset.modified_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", fontWeight: 700 }}>
        {title}
      </div>
      {isSkill && asset.display_name_zh && (
        <div style={{ marginTop: 3, fontSize: 10, color: "rgba(255,255,255,0.34)" }}>
          原名：{asset.name}
        </div>
      )}
      {isSkill && asset.summary_zh && (
        <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.58)", lineHeight: 1.5 }}>
          {asset.summary_zh}
        </div>
      )}
      {!isSkill && (
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
          {asset.relative_path}
        </div>
      )}

      {asset.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {asset.tags.slice(0, expanded ? 14 : 6).map((tag) => (
            <span
              key={tag}
              style={{
                padding: "1px 6px",
                borderRadius: 9999,
                background: `${color}14`,
                color,
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
            background: "rgba(0,0,0,0.24)",
            border: "1px solid rgba(255,255,255,0.04)",
            fontSize: 11,
            color: "rgba(255,255,255,0.52)",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            maxHeight: 320,
            overflowY: "auto",
            lineHeight: 1.5,
          }}
          className="scrollbar-thin"
        >
          <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>{asset.file_path}</div>
          {asset.content}
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
        borderRadius: 14,
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
                borderRadius: 9999,
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
        borderRadius: 14,
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

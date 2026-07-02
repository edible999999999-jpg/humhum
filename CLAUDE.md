# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

HumHum 是一个 Tauri v2 桌面宠物应用，监听多种 AI 编程助手事件（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1 的 hooks 以及 QoderWork 日志），将其转化为语音播报，并支持语音指令和键盘快捷键交互。UI 是一个透明的、始终置顶的圆形小窗口，宠物形象是一只灯塔水母 "Hum"。

## 常用命令

```bash
npm install           # 安装依赖
npm run tauri dev     # 开发模式（同时启动 Vite 前端 + Rust 后端）
npm run tauri build   # 生产构建
npm run build         # 仅前端构建（tsc + vite）
```

Rust 后端在 `src-tauri/` 目录下，支持标准 `cargo` 命令，但日常开发主要用 `npm run tauri dev`。

手动模拟事件（用于测试）：
```bash
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"TaskCompleted","session_id":"test-123","payload":{}}'
```

无 lint / test 配置。TypeScript 类型检查通过 `tsc`（`npm run build` 包含）。

## 架构

### 双进程模型（Tauri v2）

- **Rust 后端**（`src-tauri/src/`）：在端口 31275 运行 hyper HTTP 服务器（非 Axum/Actix），管理配置、会话存储、客户端注册表，通过 Tauri 事件系统向前端发送事件。
- **React 前端**（`src/`）：渲染两个窗口 — `"main"`（280×210，透明桌宠浮层）和 `"settings"`（420×620，设置面板，默认隐藏）。`App.tsx` 通过 `getCurrentWindow().label` 判断窗口，在 PetWindow 挂载时调用 `initBootstrap()` 初始化全局单例。

### 语音管线（核心数据流）

```
事件到达 → VoicePipeline.processEvent()
    → 2 秒批量窗口（BATCH_WINDOW_MS）聚合快速连发事件
    → mergeEvents() 合并多事件为单次请求
    → OpenAISummarizer.summarize() (非流式调用，逐字符 yield)
    → SentenceSplitter.feed(char) (逐句切分，首句限60字加速TTFB)
    → TTS.synthesize(sentence) (Edge/OpenAI/ElevenLabs)
    → Rust play_audio IPC (base64 → /tmp/humhum-audio/*.mp3 → afplay)
    → 宠物状态: idle → processing → speaking → idle
```

**注意**：Summarizer 使用 `stream: false` 一次性获取完整响应，然后逐字符 yield 给 SentenceSplitter。音频播放使用 macOS 原生 `afplay` 命令，通过 Rust IPC（`play_audio`/`stop_audio`）调用，不使用 Web Audio API 播放。

初始化入口：`src/lib/bootstrap.ts` — 读取 Rust 配置，注册所有 provider，创建 VoicePipeline 等**全局单例**，通过 `getAudioQueue()` / `getPipeline()` / `getSummarizer()` / `getSentenceSplitter()` 导出访问。

### 事件来源

1. **Hook Server**（`hook_server.rs`）：POST /event 接收 hook 脚本发来的事件，支持 `?client=xxx` 查询参数识别客户端类型
2. **QoderWork Watcher**（`qoder_log_watcher.rs`）：每 2 秒轮询 `~/.qoderwork/logs/sessions/` JSONL 文件，5 分钟无更新视为过期，处理 4 种事件类型（`permission.requested`、`session.phase.finished`、`tool.shell.started`、`model.response.completed`）
3. 两种来源都产生 `HookEvent` 并更新 `SessionStore`

### Hook Server API

| 路由 | 方法 | 用途 |
|------|------|------|
| `/event` | POST | 接收 hook 事件。PermissionRequest 阻塞等待用户决策（最长120秒） |
| `/health` | GET | 健康检查，返回版本信息 |
| `/pending` | GET | 列出所有等待中的权限请求 |
| `/respond` | POST | 外部响应权限请求（event_id + behavior） |

### PermissionRequest 流程

PermissionRequest 是特殊事件：hook server 保持 HTTP 连接打开（最长 120 秒），通过 `oneshot::channel` 等待用户决策。前端显示 ConfirmToast（主窗口从 450 扩展到 650 逻辑像素高度），支持四种交互方式：
- UI 按钮（Allow / Always Allow / Deny）
- 语音指令（"确认"/"拒绝"）
- 键盘快捷键（Y/Enter 确认，A 始终允许，N/Esc 拒绝，Space 暂停/恢复播报）
- 外部 POST /respond 接口

决策通过 `invoke("respond_to_permission")` → `commands.rs` → PendingMap 中的 oneshot sender → hook_server 返回 HTTP 响应 → 外部 hook 脚本读取 stdout。`behavior` 字段作为字符串透传（allow/deny）。

### AskUserQuestion 流程

AskUserQuestion 事件触发 `QuestionToast` 组件，显示选项列表。用户点击选项后，通过 `invoke("type_in_terminal")` 将选项编号输入到终端（osascript keystroke），不经过 hook server 的 oneshot channel。

### 多客户端支持

`client_registry.rs` 定义了 5 个客户端的 profile（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1），每个包含配置格式（JSON/TOML）、配置路径、支持的 hook 事件。Settings 面板可独立安装/卸载各客户端的 hooks。

添加新客户端：在 `client_registry.rs` 的 `CLIENTS` 数组追加 `ClientProfile`，指定配置格式和路径，`commands.rs` 的 `install_hooks_for_client` / `uninstall_hooks_for_client` 已支持 JSON 和 TOML 两种格式。

### 适配器/Provider 模式

TTS、STT 使用注册表模式（`src/lib/tts/index.ts`、`src/lib/stt/index.ts`）。添加新 provider：实现 `src/types/index.ts` 中的接口，在 `bootstrap.ts` 中注册到 registry 并设为 active。

- **TTS**: Edge（免费，默认，优先使用 localhost:5050 bridge，fallback Web Speech API）、OpenAI、ElevenLabs
- **STT**: Web Speech API（默认，使用 `webkitSpeechRecognition`）、Whisper

### Rust 后端模块

| 文件 | 职责 |
|------|------|
| `lib.rs` | 应用入口：Tauri builder、4 个插件（fs/notification/shell/store）、macOS 窗口透明（Cocoa/ObjC）、SkyLight 全屏浮窗、托盘菜单、管理 3 个 State（AppConfig/SessionStore/StatsStore）、启动 hook_server 和 qoder_log_watcher |
| `config.rs` | `AppConfig` 结构体（嵌套 ApiKeys/TtsConfig/SttConfig/SummarizerConfig/UiConfig），读写 `~/.humhum/config.json` |
| `commands.rs` | 23 个 `#[tauri::command]`（含 `proxy_post`/`proxy_post_binary` CORS 代理、`play_audio`/`stop_audio` 原生音频） |
| `hook_server.rs` | hyper HTTP 服务器，`PendingMap = Arc<tokio::sync::Mutex<HashMap<String, PendingRequest>>>`，在 Stop/TaskCompleted/SessionEnd 事件时记录统计 |
| `session_store.rs` | 内存中 `HashMap<String, Session>`，按 session_id 聚合事件，跟踪 client_type/cwd/project_name/event_count/status/last_tool_name |
| `stats_store.rs` | 持久化 `~/.humhum/stats.json`，解析 Claude Code JSONL transcript 提取 token/cost，硬编码 Opus/Sonnet/Haiku 定价，30 天滚动保留，原子写入 |
| `client_registry.rs` | 静态 `CLIENTS` 数组定义 5 个客户端 profile |
| `event_bus.rs` | `HookEvent` 结构体、`PermissionDecision`、`emit_hook_event()`/`emit_status_change()` 辅助函数 |
| `qoder_log_watcher.rs` | 轮询 QoderWork JSONL 日志 |
| `window_focus.rs` | macOS `focus_terminal_app()` — 尝试 iTerm/Terminal/WezTerm/Alacritty/kitty |

### Rust Mutex 混用

后端使用两种 Mutex：`std::sync::Mutex`（AppConfig/SessionStore/StatsStore，通过 Tauri `State<'_>` 同步访问）和 `tokio::sync::Mutex`（PendingMap，在 async hook_server handler 中使用）。注意不要混用，std Mutex 不能跨 `.await` 持有。

### IPC 命令（Tauri invoke）

`commands.rs` 导出 23 个 `#[tauri::command]`，前端通过 `invoke()` 调用。关键命令：
- `get_config` / `save_config` — 读写 `AppConfig`
- `install_hooks_for_client` / `uninstall_hooks_for_client` — 按客户端安装/卸载 hooks
- `respond_to_permission` — 通过 PendingMap oneshot channel 回复权限请求
- `get_active_sessions` / `get_session` — 查询 SessionStore
- `check_hooks_status` — 扫描各客户端配置文件检测 HumHum hooks 是否已安装
- `focus_terminal` — macOS 专用，osascript 激活终端应用
- `toggle_settings` — 显示/隐藏设置窗口
- `proxy_post` / `proxy_post_binary` — Rust 侧 reqwest CORS 代理
- `play_audio` / `stop_audio` — base64 MP3 → /tmp 文件 → afplay 播放/killall 停止
- `type_in_terminal` — 聚焦终端并通过 osascript keystroke 输入文本（用于 AskUserQuestion 响应）

### 会话管理

`session_store.rs` 跟踪活跃会话。每个 HookEvent 携带 `client_type` 字段，SessionStore 按 session_id 聚合事件。前端 `PetView.tsx` 每 5 秒轮询 `get_active_sessions`，hover 桌宠时弹出 `SessionDashboard`。

### 桌宠状态机

定义在 `src/components/Pet/PetStates.ts`。状态流：`idle → processing → speaking → idle`，PermissionRequest 分支到 `waiting → listening`。`canTransition()` 守卫函数防止非法状态跳转。

桌宠交互：单击无操作，双击跳转终端（`focus_terminal`），右键打开设置（`toggle_settings`），hover 显示 SessionDashboard，拖拽移动窗口（伴随气泡粒子效果）。

### macOS 窗口特殊处理

`lib.rs` 中有两层 macOS 专有逻辑：
1. **NSWindow 透明**：通过 Cocoa/ObjC unsafe 代码设置窗口透明、递归禁用 WKWebView 的 `drawsBackground`
2. **SkyLight 全屏浮窗**：动态加载私有框架 `/System/Library/PrivateFrameworks/SkyLight.framework`，通过 `dlopen`/`dlsym` 创建 stationary space，使窗口浮于全屏应用之上。后台线程每 3 秒 re-assert window level（1500 = CGAssistiveTechHighWindowLevel）防止 macOS 覆盖

### 渲染引擎

`src/engine/` 目录：
- `PixiApp`（WebGL 透明 canvas，backgroundAlpha:0）
- `HumSprite`（OffscreenCanvas 纹理上传到 PixiJS）
- `FallbackRenderer`（Canvas2D 程序化绘制水母各部位）
- `AgentCreatures`（6 种吸收态生物，每个客户端对应一种深海生物）
- FPS: idle=20 / active=30 / drag=60，`powerPreference: "low-power"`

`PetCanvas.tsx` 使用 PixiJS，接受 `state` 和 `activeClients`（当前活跃的客户端 ID 列表），传递给渲染器绘制吸收态生物。

### 音效系统

`src/lib/audio/sound-effects.ts` 使用 Web Audio API 振荡器程序化生成音效（无外部音频文件）：`taskCompleted`（上行和弦）、`attentionRequired`（双音提示）、`processingStarted`（快速两音）、`error`（下行方波）。

### 调试

`main.tsx` 调用 `patchConsole()`（`src/lib/webview-log.ts`），monkey-patch `console.log/error/warn` 转发到 Rust 侧（`invoke("webview_log")`）。在 `npm run tauri dev` 时可在终端看到前端日志。

## 关键约定

- 路径别名：`@` 映射到 `src/`（`vite.config.ts` 和 `tsconfig.json`）
- Tauri 事件前缀：`humhum://`（如 `humhum://hook-event`、`humhum://status-change`）
- 配置存储：`~/.humhum/config.json`（Rust `config.rs` 读写），默认端口 31275
- API key 采用 BYOK 模式，配置中存储，前端通过 `invoke("get_config")` 获取
- 主窗口无边框、透明、始终置顶、skipTaskbar
- Tauri capability 权限限制：文件系统访问仅限 `~/.humhum/`、`~/.claude/`、`$APPDATA`、`$APPCONFIG`。CSP `connect-src` 允许 `http://localhost:*` 和 `https:`
- 全局状态无 React Context / Redux — 前端用模块级单例（bootstrap.ts getter），Rust 侧用 Tauri managed State
- Summarizer 系统提示设定"桌面小助手"人设，输出中文，限 50 字，不读代码/路径/JSON
- SentenceSplitter 支持中英文句子边界检测，首句限 60 字优化首次发声延迟
- 旧的 `PetMascot.tsx`（SVG `dangerouslySetInnerHTML`）保留但不再被 PetView 引用
- 幼体模式：≥4 活跃会话触发 65% 缩放（`BABY_THRESHOLD` 常量）
- 统计数据持久化在 `~/.humhum/stats.json`，由 `stats_store.rs` 管理
- Hook 脚本在 `hooks/humhum-hook.sh`：从 stdin 读 JSON，POST 到 localhost:31275/event，PermissionRequest 时输出响应
- Edge TTS Bridge：`scripts/edge-tts-bridge.py`，提供 OpenAI 兼容的 `/v1/audio/speech` 端点，默认端口 5050

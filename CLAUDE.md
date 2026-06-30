# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

DevPod 是一个 Tauri v2 桌面宠物应用，监听多种 AI 编程助手事件（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1 的 hooks 以及 QoderWork 日志），将其转化为播客风格的语音播报，并支持语音指令和键盘快捷键交互。UI 是一个透明的、始终置顶的圆形小窗口。

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
- **React 前端**（`src/`）：渲染两个窗口 — `"main"`（280×350，透明桌宠浮层）和 `"settings"`（420×620，设置面板，默认隐藏）。`App.tsx` 通过 `getCurrentWindow().label` 判断窗口，在 PetWindow 挂载时调用 `initBootstrap()` 初始化全局单例。

### 语音管线（核心数据流）

```
事件到达 → VoicePipeline.processEvent()
    → OpenAISummarizer.summarize() (流式 SSE，async generator)
    → SentenceSplitter.feed(token) (逐句切分，首句限60字加速TTFB)
    → TTS.synthesize(sentence) (Edge/OpenAI/ElevenLabs)
    → AudioQueue.enqueue(chunk) (顺序播放)
    → 宠物状态: idle → processing → speaking → idle
```

初始化入口：`src/lib/bootstrap.ts` — 读取 Rust 配置，注册所有 provider，创建 VoicePipeline 等**全局单例**，通过 `getAudioQueue()` / `getPipeline()` / `getSummarizer()` / `getSentenceSplitter()` 导出访问。

### 事件来源

1. **Hook Server**（`hook_server.rs`）：POST /event 接收 hook 脚本发来的事件，支持 `?client=xxx` 查询参数识别客户端类型
2. **QoderWork Watcher**（`qoder_log_watcher.rs`）：每 2 秒轮询 `~/.qoderwork/logs/sessions/` JSONL 文件，5 分钟无更新视为过期
3. 两种来源都产生 `HookEvent` 并更新 `SessionStore`

### Hook Server API

| 路由 | 方法 | 用途 |
|------|------|------|
| `/event` | POST | 接收 hook 事件。PermissionRequest 阻塞等待用户决策（最长120秒） |
| `/health` | GET | 健康检查，返回版本信息 |
| `/pending` | GET | 列出所有等待中的权限请求 |
| `/respond` | POST | 外部响应权限请求（event_id + behavior） |

### PermissionRequest 流程

PermissionRequest 是特殊事件：hook server 保持 HTTP 连接打开（最长 120 秒），通过 `oneshot::channel` 等待用户决策。前端显示 ConfirmToast，支持三种交互方式：
- UI 按钮（Allow/Deny）
- 语音指令（"确认"/"拒绝"）
- 键盘快捷键（Y/Enter 确认，N/Esc 拒绝）

决策通过 `invoke("respond_to_permission")` → `commands.rs` → PendingMap 中的 oneshot sender → hook_server 返回 HTTP 响应 → 外部 hook 脚本读取 stdout。

### 多客户端支持

`client_registry.rs` 定义了 5 个客户端的 profile（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1），每个包含配置格式（JSON/TOML）、配置路径、支持的 hook 事件。Settings 面板可独立安装/卸载各客户端的 hooks。

添加新客户端：在 `client_registry.rs` 的 `CLIENTS` 数组追加 `ClientProfile`，指定配置格式和路径，`commands.rs` 的 `install_hooks_for_client` / `uninstall_hooks_for_client` 已支持 JSON 和 TOML 两种格式。

### 适配器/Provider 模式

TTS、STT 使用注册表模式（`src/lib/tts/index.ts`、`src/lib/stt/index.ts`）。添加新 provider：实现 `src/types/index.ts` 中的接口，在 `bootstrap.ts` 中注册到 registry 并设为 active。

- **TTS**: Edge（免费，默认，优先使用 localhost:5050 bridge，fallback Web Speech API）、OpenAI、ElevenLabs
- **STT**: Web Speech API（默认，使用 `webkitSpeechRecognition`）、Whisper

### IPC 命令（Tauri invoke）

`commands.rs` 导出 16 个 `#[tauri::command]`，前端通过 `invoke()` 调用。关键命令：
- `get_config` / `save_config` — 读写 `AppConfig`
- `install_hooks_for_client` / `uninstall_hooks_for_client` — 按客户端安装/卸载 hooks
- `respond_to_permission` — 通过 PendingMap oneshot channel 回复权限请求
- `get_active_sessions` / `get_session` — 查询 SessionStore
- `check_hooks_status` — 扫描各客户端配置文件检测 DevPod hooks 是否已安装
- `focus_terminal` — macOS 专用，osascript 激活终端应用
- `toggle_settings` — 显示/隐藏设置窗口

### 会话管理

`session_store.rs` 跟踪活跃会话。每个 HookEvent 携带 `client_type` 字段，SessionStore 按 session_id 聚合事件。前端 `SessionDashboard.tsx` 每 3 秒轮询 `get_active_sessions` 显示会话状态，hover 桌宠时弹出。

### 桌宠状态机

定义在 `src/components/Pet/PetStates.ts`。状态流：`idle → processing → speaking → idle`，PermissionRequest 分支到 `waiting → listening`。`canTransition()` 守卫函数防止非法状态跳转。

桌宠交互：单击打开设置，双击跳转终端，右键隐藏窗口，hover 显示 SessionDashboard。

### 音效系统

`src/lib/audio/sound-effects.ts` 使用 Web Audio API 振荡器程序化生成音效（无外部音频文件）：`taskCompleted`（上行和弦）、`attentionRequired`（双音提示）、`processingStarted`（快速两音）、`error`（下行方波）。

## 关键约定

- 路径别名：`@` 映射到 `src/`（`vite.config.ts` 和 `tsconfig.json`）
- Tauri 事件前缀：`devpod://`（如 `devpod://hook-event`、`devpod://status-change`）
- 配置存储：`~/.devpod/config.json`（Rust `config.rs` 读写），默认端口 31275
- API key 采用 BYOK 模式，配置中存储，前端通过 `invoke("get_config")` 获取
- 主窗口无边框、透明、始终置顶，`lib.rs` 中 macOS 特有 Cocoa/ObjC 代码设置 NSWindow 透明并递归禁用 WKWebView 的 `drawsBackground`
- Tauri capability 权限限制：文件系统访问仅限 `~/.devpod/`、`~/.claude/`
- 宠物 SVG 渲染在 `PetMascot.tsx`，纯代码生成无外部图片资源
- Summarizer 系统提示设定"播客主持人"人设，输出中文，限 150 字
- SentenceSplitter 支持中英文句子边界检测，首句限 60 字优化首次发声延迟

# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目简介

DevPod 是一个 Tauri v2 桌面宠物应用，监听多种 AI 编程助手事件（Codex、Codex、Qwen Code、Gemini CLI、Kimi K1 的 hooks 以及 QoderWork 日志），将其转化为播客风格的语音播报，并支持语音指令和键盘快捷键交互。UI 是一个透明的、始终置顶的圆形小窗口。

## 常用命令

```bash
npm install           # 安装依赖
npm run tauri dev     # 开发模式（同时启动 Vite 前端 + Rust 后端）
npm run tauri build   # 生产构建
npm run build         # 仅前端构建（tsc + vite）
```

Rust 后端在 `src-tauri/` 目录下，支持标准 `cargo` 命令，但日常开发主要用 `npm run tauri dev`。

## 架构

### 双进程模型（Tauri v2）

- **Rust 后端**（`src-tauri/src/`）：在端口 31275 运行本地 HTTP 服务器，管理配置、会话存储、客户端注册表，通过 Tauri 事件系统向前端发送事件。
- **React 前端**（`src/`）：渲染两个窗口 — `"main"`（透明桌宠浮层）和 `"settings"`（设置面板，含 4 个 tab：General、Voice、Hooks、Sessions）。`App.tsx` 通过 `getCurrentWindow().label` 判断窗口，在 PetWindow 挂载时调用 `initBootstrap()` 初始化全局单例。

### 语音管线（核心数据流）

```
事件到达 → VoicePipeline.processEvent()
    → OpenAISummarizer.summarize() (流式 SSE)
    → SentenceSplitter.feed(token) (逐句切分)
    → TTS.synthesize(sentence) (Edge/OpenAI/ElevenLabs)
    → AudioQueue.enqueue(chunk) (顺序播放)
    → 宠物状态: idle → processing → speaking → idle
```

初始化入口：`src/lib/bootstrap.ts` — 读取 Rust 配置，注册所有 provider，创建 VoicePipeline 单例。

### 事件来源

1. **Hook Server**（`hook_server.rs`）：POST /event 接收 hook 脚本发来的事件，支持 `?client=xxx` 查询参数识别客户端类型
2. **QoderWork Watcher**（`qoder_log_watcher.rs`）：轮询 `~/.qoderwork/logs/sessions/` JSONL 文件
3. 两种来源都产生 `HookEvent` 并更新 `SessionStore`

### PermissionRequest 流程

PermissionRequest 是特殊事件：hook server 保持 HTTP 连接打开（最长 120 秒），通过 `oneshot::channel` 等待用户决策。前端显示 ConfirmToast，支持三种交互方式：
- UI 按钮（Allow/Deny）
- 语音指令（"确认"/"拒绝"）
- 键盘快捷键（Y/Enter 确认，N/Esc 拒绝）

### 多客户端支持

`client_registry.rs` 定义了 5 个客户端的 profile（Codex、Codex、Qwen Code、Gemini CLI、Kimi K1），每个包含配置格式（JSON/TOML）、配置路径、支持的 hook 事件。Settings 面板 Hooks tab 可独立安装/卸载各客户端的 hooks。

### 适配器/Provider 模式

TTS、STT 使用注册表模式（`src/lib/tts/index.ts`、`src/lib/stt/index.ts`）。添加新 provider：实现 `src/types/index.ts` 中的接口，注册到 registry，设为 active。

- **TTS**: Edge（免费，默认，优先使用 localhost:5050 bridge，fallback Web Speech API）、OpenAI、ElevenLabs
- **STT**: Web Speech API（默认，使用 `webkitSpeechRecognition`）、Whisper

### 会话管理

`session_store.rs` 跟踪活跃会话。每个 HookEvent 携带 `client_type` 字段，SessionStore 按 session_id 聚合事件。前端 `SessionList.tsx` 组件轮询 `get_active_sessions` 显示会话状态。

### 桌宠状态机

定义在 `src/components/Pet/PetStates.ts`。状态流：`idle → processing → speaking → idle`，PermissionRequest 分支到 `waiting → listening`。桌宠交互：单击打开设置，双击跳转终端（`focus_terminal` 通过 osascript 激活终端应用）。

## 关键约定

- 路径别名：`@` 映射到 `src/`（`vite.config.ts` 和 `tsconfig.json`）
- Tauri 事件前缀：`devpod://`（如 `devpod://hook-event`、`devpod://status-change`）
- 配置存储：`~/.devpod/config.json`（Rust `config.rs` 读写），默认端口 31275
- API key 采用 BYOK 模式
- 主窗口无边框、透明、始终置顶，`lib.rs` 中 macOS 特有 Cocoa/CoreGraphics 代码实现圆形遮罩
- Tauri capability 权限限制：文件系统访问仅限 `~/.devpod/`、`~/.Codex/`

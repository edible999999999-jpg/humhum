# DevPod

**Developer Podcast Pet** — 开发者的播客桌宠

一个开源的桌面伴侣应用，监听多种 AI 编程助手（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1）的任务事件，将任务完成/确认请求自动总结为播客风格的语音播报，并支持语音指令和键盘快捷键交互。

## 为什么需要 DevPod？

当你用 Claude Code 或 Codex 做开发时，经常需要切回去看它的输出或者点击确认。DevPod 把这些信息变成语音"播客"直接讲给你听，你只需要动动嘴说"确认"或"拒绝"就行了。

**核心场景：**

- **任务完成播报** — AI 助手完成任务后，语音播报摘要，桌宠露出邪恶得意笑容
- **语音确认** — 需要权限确认时，语音描述 + 三按钮（拒绝/始终允许/允许）
- **多客户端支持** — 同时监听多个 AI 编程助手，统一管理
- **会话仪表盘** — 悬停桌宠查看所有活跃会话状态

## 架构

```
AI 编程助手 Hooks (Claude Code / Codex / Qwen Code / ...)
       │
       ▼
  Hook Script ──→ DevPod Server :31275 (Rust/Hyper)
       │
       ▼
  EventBus ──→ LLM Summarizer (流式 SSE) ──→ Sentence Splitter
                                                    │
                                                    ▼
                                               TTS Engine (可插拔)
                                                    │
                                                    ▼
                                               Audio Queue ──→ Desktop Pet UI
                                                                    │
                                                                    ▼
                                                               STT Engine
                                                               (语音指令)
```

**技术栈：** Tauri v2 + React 18 + TypeScript + TailwindCSS + Rust

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- Python 3 + `edge-tts` (免费 TTS)
- 系统依赖 (Tauri): 见 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### 安装

```bash
# 克隆项目
git clone https://github.com/anthropics/devpod.git
cd devpod

# 安装前端依赖
npm install

# 安装 Edge TTS Bridge 依赖
pip3 install edge-tts aiohttp

# 启动 Edge TTS Bridge（后台运行）
python3 scripts/edge-tts-bridge.py &

# 开发模式
npm run tauri dev
```

### 连接 AI 编程助手

DevPod 启动后，右键桌宠打开 Settings，在"连接"区域点击对应助手的"连接"按钮即可自动安装 hooks。

支持的客户端：
- **Claude Code** — 自动配置 `~/.claude/settings.json`
- **Codex** — 自动配置 Codex hooks
- **Qwen Code** — 自动配置 Qwen Code hooks
- **Gemini CLI** — 自动配置 Gemini CLI hooks
- **Kimi K1** — 自动配置 Kimi K1 hooks

### 配置 API

DevPod 采用 BYOK (Bring Your Own Key) 模式。在 Settings 面板的"密钥"区域填入 API Key。

高级选项中可配置：
- **Summarizer API Base** — 支持任意 OpenAI 兼容 API（如内部部署）
- **Summarizer 模型** — 默认 gpt-4o-mini
- **Edge TTS Bridge URL** — 默认 http://localhost:5050

## 交互方式

### 桌宠交互

| 操作 | 动作 |
|------|------|
| 双击 | 聚焦终端窗口 |
| 右键 | 打开设置面板 |
| 悬停 | 显示会话仪表盘 |
| 拖拽 | 移动桌宠位置 |

### 键盘快捷键（确认模式下）

| 按键 | 动作 |
|------|------|
| Y / Enter | 允许 |
| A | 始终允许 |
| N / Esc | 拒绝 |
| Space | 暂停/恢复播报 |

### 语音指令

| 指令 | 触发词 | 动作 |
|------|--------|------|
| 确认 | "确认" / "好的" / "confirm" / "yes" | 批准权限请求 |
| 拒绝 | "拒绝" / "不行" / "reject" / "no" | 拒绝权限请求 |
| 跳过 | "跳过" / "下一个" / "skip" | 跳过当前播报 |
| 暂停 | "暂停" / "pause" | 暂停播放 |
| 继续 | "继续" / "resume" | 恢复播放 |

## 桌宠表情

| 状态 | 表情 | 颜色 |
|------|------|------|
| idle | 微笑眨眼 | 靛蓝 |
| processing | 专注小眼 | 蓝色 |
| speaking | 张嘴说话 | 紫色 |
| waiting | 圆嘴惊讶 | 琥珀 |
| listening | 弯眼微笑 | 翠绿 |
| completed | 龇牙咧嘴邪恶笑 | 翠绿 |
| error | 大眼哭脸 | 红色 |

## 语音方案

### TTS (文字转语音)

| 方案 | 成本 | 说明 |
|------|------|------|
| Edge TTS | 免费 | 微软 Edge 的 TTS，通过本地 Bridge 服务，默认 |
| OpenAI TTS | $15/M chars | tts-1 模型，自然流畅 |
| ElevenLabs | 按量付费 | 最佳品质，支持声音克隆 |

### STT (语音转文字)

| 方案 | 成本 | 说明 |
|------|------|------|
| Web Speech API | 免费 | WebView 原生支持，默认 |
| OpenAI Whisper | $0.006/min | 高精度 |

## Edge TTS Bridge

免费 TTS 方案需要一个本地 Python 服务作为桥接：

```bash
# 安装
pip3 install edge-tts aiohttp

# 启动（默认端口 5050）
python3 scripts/edge-tts-bridge.py

# 自定义端口
python3 scripts/edge-tts-bridge.py 6060
```

提供 OpenAI 兼容的 `/v1/audio/speech` 端点，返回 MP3 音频。

## 开发

```bash
npm install           # 安装依赖
npm run tauri dev     # 开发模式（Vite + Rust）
npm run tauri build   # 生产构建
npm run build         # 仅前端构建
```

手动模拟事件（测试用）：
```bash
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"TaskCompleted","session_id":"test-123","payload":{}}'
```

## 贡献

欢迎共建！

1. Fork 本仓库
2. 创建分支 (`git checkout -b feature/my-feature`)
3. 提交代码 (`git commit -m 'feat: add my feature'`)
4. 推送分支 (`git push origin feature/my-feature`)
5. 创建 Pull Request

### 好的首次贡献

- 添加新的 AI 编程助手适配（实现 `ClientProfile`）
- 添加新的 TTS/STT provider（实现 `TTSProvider`/`STTProvider` 接口）
- 设计新的桌宠表情和动画
- 翻译 UI 文本到其他语言

## License

[MIT](LICENSE)

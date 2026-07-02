# HumHum

**Developer Podcast Pet** — 开发者的播客桌宠

一个开源的桌面伴侣应用，以"会哼唱的水母" **Hum** 为形象，监听多种 AI 编程助手（Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1、QoderWork）的任务事件，将其转化为播客风格的语音播报，并支持语音指令和键盘快捷键交互。

<p align="center"><em>灯塔水母 Turritopsis dohrnii — 地球上唯一能"返老还童"的生物</em></p>

## 为什么需要 HumHum？

当你用 Claude Code 或 Codex 做开发时，经常需要切回去看它的输出或者点击确认。HumHum 把这些信息变成语音"播客"直接讲给你听，你只需要动动嘴说"确认"或"拒绝"就行了。

**核心场景：**

- **任务完成播报** — AI 助手完成任务后，语音播报摘要
- **语音确认** — 需要权限确认时，语音描述 + 三按钮（拒绝/始终允许/允许）
- **多客户端支持** — 同时监听 6 种 AI 编程助手，统一管理
- **会话仪表盘** — 悬停桌宠查看所有活跃会话状态
- **统计面板** — Token 消耗、费用预估、Agent 活跃度、工具调用统计

## Hum 水母设计

Hum 是一只半透明的灯塔水母，拥有 8 种情绪状态、动态触手和丰富的表情动画。

### 吸收态 Agent

每个连接的 AI 编程助手在 Hum 体内表现为一只独特的小型深海生物：

| Agent | 吸收态生物 | 品牌色 |
|-------|----------|--------|
| Claude Code | 火虾 Fire Shrimp | 🟠 橙色 |
| Codex | 云团 Cloud Puff | 🟢 绿色 |
| Qwen Code | 蓝海马 Blue Seahorse | 🔵 蓝色 |
| Gemini CLI | 水晶海星 Crystal Starfish | 🔷 青色 |
| Kimi K1 | 月亮水母 Moon Jelly | 🟣 紫色 |
| QoderWork | 珊瑚虫 Coral Polyp | 🔴 玫红 |

### 幼体模式（灯塔水母的秘密）

灯塔水母在压力下会逆转回幼体形态。当 Hum 管理 **≥4 个活跃会话** 时，工作压力触发"返老还童"——等比缩小至 65%，越忙越小越努力。

### 喷水推进拖拽

拖拽桌宠时，Hum 通过收缩伞盖喷水移动，伴随气泡尾迹粒子效果。

### 状态与表情

| 状态 | 伞盖 | 触手 | 表情 | 配色 |
|------|------|------|------|------|
| idle | 光滑圆顶 + 呼吸脉冲 | 自由飘荡 | 眨眼微笑 | 靛蓝 |
| processing | 微收 + 内部闪烁 | 编织聚拢 | 专注小眼 | 蓝色 |
| speaking | 脉冲收缩 + 声波 | 喇叭形扩音 | 张嘴说话 | 紫色 |
| waiting | 收缩凹陷 | 缩头卷曲 | 惊讶圆嘴 | 琥珀 |
| listening | 歪头侧耳 | 安静飘浮 | 微笑 | 翠绿 |
| completed | 炸毛绽放 | 烟花展开 | 得意弧眼 | 翠绿 |
| error | 歪斜 | 打结纠缠 | 螺旋X眼 | 粉色 |

## 架构

```
AI 编程助手 Hooks (Claude Code / Codex / Qwen Code / ...)
       │
       ▼
  Hook Script ──→ HumHum Server :31275 (Rust/Hyper)
       │                    │
       ▼                    ▼
  EventBus             StatsStore (Token/费用统计)
       │
       ▼
  LLM Summarizer (流式 SSE) ──→ Sentence Splitter
                                      │
                                      ▼
                                 TTS Engine (可插拔)
                                      │
                                      ▼
                                 Audio Queue ──→ Hum 水母 (PixiJS + Canvas2D)
                                                      │
                                                      ▼
                                                 STT Engine (语音指令)
```

**技术栈：** Tauri v2 + React 18 + TypeScript + TailwindCSS + PixiJS v8 + Rust

### 渲染引擎

```
PixiJS v8 透明 WebGL Canvas (backgroundAlpha:0)
  → FallbackRenderer Canvas2D 程序化水母绘制
    → HumSprite OffscreenCanvas 纹理上传
      → 未来: Rive .riv 角色动画
FPS: 20 idle / 30 active / 60 drag · powerPreference: low-power
```

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- Python 3 + `edge-tts` (免费 TTS)
- 系统依赖 (Tauri): 见 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### 安装

```bash
# 克隆项目
git clone <your-repo-url>
cd humhum-ai-companion

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

HumHum 启动后，右键桌宠打开 Settings，在"连接"区域点击对应助手的"连接"按钮即可自动安装 hooks。

支持的客户端：
- **Claude Code** — 自动配置 `~/.claude/settings.json`
- **Codex** — 自动配置 Codex hooks
- **Qwen Code** — 自动配置 Qwen Code hooks
- **Gemini CLI** — 自动配置 Gemini CLI hooks
- **Kimi K1** — 自动配置 Kimi K1 hooks
- **QoderWork** — 自动监听 `~/.qoderwork/logs/sessions/` JSONL 日志

### 配置 API

HumHum 采用 BYOK (Bring Your Own Key) 模式。在 Settings 面板的"密钥"区域填入 API Key。

高级选项中可配置：
- **Summarizer API Base** — 支持任意 OpenAI 兼容 API
- **Summarizer 模型** — 默认 gpt-4o-mini
- **Edge TTS Bridge URL** — 默认 http://localhost:5050

## 统计面板

Settings → 统计 tab 查看：

- **Token 消耗** — 总量 / 输入 / 输出 / 缓存读写
- **费用预估** — 今日 / 7 天 / 30 天 (基于模型定价自动计算)
- **活跃 Agent** — 按客户端类型分布
- **工具调用** — 去重后的工具名称和次数
- **Sparkline 趋势图** — 每日变化可视化

统计数据来自 Claude Code 的 JSONL transcript 文件，支持 Opus / Sonnet / Haiku 模型的精准费用计算。持久化在 `~/.humhum/stats.json`，保留 30 天。

## 交互方式

### 桌宠交互

| 操作 | 动作 |
|------|------|
| 双击 | 聚焦终端窗口 |
| 右键 | 打开设置面板 |
| 悬停 | 显示会话仪表盘 |
| 拖拽 | 喷水推进移动桌宠 |

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
# 通知事件
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"Notification","session_id":"test","payload":{"message":"Hello!"}}'

# 任务完成
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"TaskCompleted","session_id":"test","payload":{}}'
```

### 添加新的 AI 编程助手

在 `src-tauri/src/client_registry.rs` 的 `CLIENTS` 数组追加 `ClientProfile`，指定配置格式（JSON/TOML）和路径。`install_hooks_for_client` / `uninstall_hooks_for_client` 已支持两种格式。

### 添加新的 Agent 吸收态生物

在 `src/engine/AgentCreatures.ts` 中添加新的 `draw*` 函数，并在 `drawCreature()` 的 switch 中注册。在 `src/engine/constants.ts` 中添加对应的颜色定义。

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
- 设计新的吸收态 Agent 生物
- 翻译 UI 文本到其他语言

## License

[MIT](LICENSE)

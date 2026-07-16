# HUMHUM

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/edible999999999-jpg/humhum)](https://github.com/edible999999999-jpg/humhum/releases)

[English](./README.md)

**让所有 Agent 围绕你工作** —— 个人生活的 Agent 中枢

<p align="center">
  <a href="https://github.com/edible999999999-jpg/humhum/releases/latest/download/HumHum_0.3.12_aarch64.dmg"><strong>下载 macOS 版</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases/latest/download/HumHum_0.3.12_x64-setup.exe"><strong>下载 Windows 预览版</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases/latest/download/HUMHUM-Android-0.3.8-Xiaomi.zip"><strong>下载 Android / 小米版</strong></a>
  ·
  <a href="https://yuxilab.cn/intro"><strong>访问官网</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases">最新 Release</a>
</p>

<p align="center"><em>当前提供 macOS Apple Silicon、Windows 10/11 x64 预览版与 Android 8.0+ 安装包；Linux 仍在路线图中。</em></p>

Windows 开发者可参考 [Windows 开发、构建与安装指南](./docs/windows-development.md)。预览版安装包尚未签名，Microsoft SmartScreen 仍可能要求用户手动确认；在完成 Windows 代码签名之前，它不算正式发行版。

---

当 Agent 越来越多，真正缺少的不是又一个 Agent，而是一个属于你自己的中心。

通用 Agent 提升了思考效率，专项 Agent 提升了工作效率，但你的个人生活仍然散落在 App、消息、健康与饮食记录、偏好和记忆里。HUMHUM 想做的，是**个人生活的 Agent 中枢**：通过一套个人知识库连接不同 Agent，把你手机、电脑、云端里的偏好、记录、任务、消息和生活数据，整理成长期可用的个人上下文。

> 不是让你去管理每一个 Agent，而是让所有 Agent 围绕你工作。

HUMHUM 通过多 Agent Hooks 记录并管理会话，提取你的偏好与会话记忆，理解你的工作与生活边界，把个人画像沉淀为可复用的知识库。

## 为什么是灯塔水母

HUMHUM 的角色灵感来自灯塔水母（*Turritopsis dohrnii*）。它被认为拥有"返老还童"的特性，能在生命周期中回到更年轻的状态——我们借这个意象，是想帮你把被 App、消息、任务和 Agent 消耗掉的生活秩序重新理回来。水母也有很多触须，天然适合作为"连接者"：连接手机端、电脑端、云端工具，连接消息、记忆、健康、饮食、工作流，也连接不同的通用 Agent 与专项 Agent。

在 Agent 遍地的时代，你缺的不只是效率，也缺一种被理解、被陪伴、被温柔接住的情绪价值。所以 HUMHUM 不是一个冷冰冰的机器人，也不是急着替你做决定的自动化工具，它更像一只安静、柔软、可靠的小水母：在你被信息淹没时帮你慢慢理清，在多个 Agent 各自工作时帮你守住属于自己的中心。

## 四个角色

HUMHUM 以中枢窗口（HUMHUM Hub）为核心，围绕四个模块组织你的个人 Agent 生活。

### 🪼 Humi —— 入口与陪伴

Humi 是温暖的个人解读者，也是产品的默认入口。它静静地从你本地的 Agent 活动中学习，用大白话回答你，而不是甩给你一份终端报告。它的默认界面是一个对话框，不是一张配置表。

Humi 会读取本地的 Agent 资产（Codex / Claude / Qoder / Pi 以及项目痕迹），把这些信号翻译成：你的用户画像、当前工作方向、常用技能、偏好，以及记忆建议和温和的下一步。Humi 也能语音汇总 Agent 完成了哪些内容，并自动配置 Claude / Codex / Qoder 的 Hooks——你不用分心，就能确认 Loop 工作流的状态。原始扫描细节收在"详情"里，不会成为你第一眼看到的东西。

### 📚 Hype —— 通用 Agent 知识底座

Hype 管理你的个人 Agent 知识库。它不是又一个 Agent，而是个人知识索引助手，把分散在手机端、电脑端和云端 Agent 中的个人配置统一沉淀下来：不只是基础配置，还有你的偏好、常用 Skill、Agent Rules、Soul 设定、Memory 索引，以及不同 Agent 处理任务时形成的冷热记忆。

这套底座帮不同 Agent 更准确地理解你：知道你喜欢怎样的表达方式、常用哪些工作流、哪些信息需要长期记住、哪些只是临时上下文。Hype 是组织者，但界面不会先是一个文件管理器——它先告诉你知识库意味着什么、还缺什么。当前支持扫描 Skill / Agent / Soul / Memory / Rule / Config 资产、维护偏好、识别 CLAUDE.md / .cursorrules / AGENTS.md 规则，并可索引 Obsidian 笔记库。

### 💬 Hush —— 站在个人角度梳理社交信息

Hush 从你的视角整理个人、社交、工作与家庭的消息。它联通钉钉、微信、X、Meta 等不同来源，把消息重新组织成你能理解的关系层级：家人、朋友、工作、兴趣与每日重要信息。

Hush **不替你说话**，只帮你看见真正该回应的人：父母的消息被及时提醒和总结，快乐大家群里的暖心话不被工作消息淹没，X 上最重要的每日 AI 动态也可以整理成一份轻量摘要。当你需要回应时，Hush 给出一个温柔的句式建议，但最终是否回复、如何回复，始终由你决定。本地消息桥接默认只读，且必须经你授权。

> 它不是自动社交工具，而是帮你守住关系温度的个人消息助手。

### 🛰️ Hexa —— 并行 Agent 的会话状态记录器

Hexa 是你的 Agent 监工。它不负责重新编排所有 Agent，而是帮你看清每个 Agent 的工作进度、待确认会话、优秀产出和跑偏之处。当多个 Agent 同时处理工程任务时，Hexa 记录它们做得好的地方，也提醒你哪些地方正在偏离。它让复杂的 Agent 协作不再是黑盒，而是一个你看得懂、管得住、能复盘的过程——并行工作生活的贴心小管家。

## 桌宠形态

HUMHUM 已实现桌宠部分形态（初版在黑客松开始后搭建，便于点子呈现）。Humi 以一只半透明的灯塔水母出现在桌面上，可以语音汇总 Agent 完成了哪些内容，帮你随时确认 Agent 状态，并自动配置 Claude / Codex / Qoder 的 Hooks。桌宠层已较为成熟，是项目最早的一层能力：

- **语音播报** —— 把 Agent 事件变成自然语言播报，不用切窗口就知道发生了什么
- **语音 / 键盘确认** —— 需要权限确认时语音描述，你可用语音、快捷键或按钮回应
- **多客户端监听** —— 同时接入 Claude Code、Codex、Qwen Code、Gemini CLI、Kimi K1、QoderWork
- **狂暴模式** —— 全自动确认，Agent 不再等你
- **会话仪表盘 / 统计面板** —— 悬停查看活跃会话，查看 Token 用量与费用预估

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 22.19+
- [Rust](https://rustup.rs/) 1.89+
- Python 3 + `edge-tts`（可选，免费语音播报）
- 系统依赖（Tauri）：见 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

Windows 还需要安装 Visual Studio 2022 Build Tools，并勾选 C++ 桌面开发工作负载和 Windows SDK。完整配置见 [Windows 指南](./docs/windows-development.md)。

### 安装与运行

可直接从 [GitHub Releases](https://github.com/edible999999999-jpg/humhum/releases) 下载最新 macOS 安装包，或从源码运行：

```bash
# 1. 克隆项目
git clone https://github.com/edible999999999-jpg/humhum.git
cd humhum

# 2. 安装前端依赖
npm ci

# 3. 开发模式启动（自动编译 Rust + 启动 Vite）
npm run tauri dev

# 4.（可选）启动 Edge TTS Bridge，用于免费语音播报
pip3 install edge-tts aiohttp
python3 scripts/edge-tts-bridge.py &
```

### 生产构建

```bash
npm run tauri build
# 产物在 src-tauri/target/release/bundle/
```

Windows 可仅构建 NSIS 安装包：

```powershell
npm run tauri build -- --bundles nsis
# 产物：src-tauri\target\release\bundle\nsis\*.exe
```

### 打开中枢并接入 Agent

启动后，从系统托盘菜单或桌宠右键打开 **Hub（中枢）**，即可进入 Humi / Hype / Hush / Hexa 四个模块。在设置或 Humi 页里连接 AI 编程助手，Hooks 会自动安装：

- **Claude Code** —— 自动写入 / 合并 `~/.claude/settings.json`
- **Codex / Qwen Code / Gemini CLI / Kimi K1** —— 通过统一的客户端注册表自动配置（支持 JSON / TOML）
- **QoderWork** —— 自动监听 `~/.qoderwork/logs/sessions/` 会话日志

## 数据与隐私

HUMHUM 坚持本地优先，用户自己机器上的数据就是它的优势。所有长期数据持久化在 `~/.humhum/` 目录下：

- `config.json` —— 应用配置（Hook 端口、BYOK 密钥、TTS/STT、语言等）
- `local-api-token` —— 本机 HTTP API 的单机认证密钥，请勿分享
- `knowledge.json` —— Hype 的规则、Agent 资产与 Obsidian 索引
- `vault/preferences/*.md` 与 `vault/memory/*.md` —— Hype 偏好和记忆的真实数据源；备份时应包含整个 `vault/` 目录
- `stats.json` —— Token 与费用统计
- `hush-inbox.json` —— Hush 的本地消息收件箱（最多保留 500 条）
- `local-agent-memory.md` —— Humi 的本地 Agent 记忆

隐私体现在行为上：不在未经你明确操作的情况下读取私密聊天或敏感数据；本地消息桥接默认只读；扫描结果保留用于调试，但**解读后的摘要才是默认呈现的产品界面**。

## 技术栈

前端使用 React 18 + TypeScript + Vite，桌宠渲染基于 PixiJS v8（2D）与 Three.js（3D Humi）；桌面外壳是 Tauri v2（Rust）。后端 Rust 侧提供本地 Hook 服务（Hyper，:31275）、知识库存储、会话与统计存储、Hush 收件箱，以及对 Claude / Codex / Qoder / Wukong 会话的监听与解析。语音链路支持 Edge TTS / OpenAI / ElevenLabs 与 Web Speech / Whisper，摘要走任意 OpenAI 兼容 API（BYOK）。

关键代码位置：Tauri 命令注册在 `src-tauri/src/lib.rs`；本地知识逻辑在 `src-tauri/src/knowledge_store.rs`；Humi 本地 Agent 解读在 `src-tauri/src/commands.rs`；Hush 消息存储在 `src-tauri/src/hush_store.rs`；中枢 UI 模块在 `src/components/Hub/`。

## 项目结构

```
src/                    # React 前端
  components/
    Hub/                # 中枢四模块 (Humi / Hype / Hush / Hexa)
    Pet/                # 桌宠水母 (PixiJS + Three.js)
    Overlay/            # 权限确认 / 通知 / 完成面板
    Settings/          # 设置、统计、记忆面板
  engine/               # PixiJS / Canvas2D 渲染引擎
  lib/                  # 语音链路、TTS/STT、摘要、i18n
  hooks/                # React hooks (useHexaData 等)
src-tauri/src/          # Rust 后端
  lib.rs                # 应用启动 + Tauri 命令注册
  commands.rs           # IPC 命令实现 (含 Hooks 自动配置、Humi kernel)
  knowledge_store.rs    # Hype 知识库持久化
  hush_store.rs         # Hush 消息收件箱
  hook_server.rs        # 本地 HTTP 服务 :31275
  client_registry.rs    # AI 助手客户端注册表
docs/                   # 设计与展望文档
scripts/                # Edge TTS bridge 等
```

## 路线图

- [ ] 手机远程审批与状态查看（扫码连接，无需装 App）
- [ ] 跨设备偏好与上下文同步
- [x] macOS 微信与钉钉新通知只读桥接
- [ ] 用户授权的 Hush 历史聊天导入与深度桥接
- [ ] 智能权限策略（学习你的审批习惯）
- [ ] 更多 Agent 接入与开放 Hook 协议标准
- [ ] 已签名的 Windows 正式版与 Linux 完整支持

## 贡献

HUMHUM 是开源项目，欢迎共建。新增功能时不妨先问自己一句："这是否让用户更被理解、更有掌控感？"如果答案只是"它暴露了更多数据"，那就该重新设计。

1. Fork 本仓库
2. 创建分支（`git checkout -b feature/my-feature`）
3. 提交代码（`git commit -m 'feat: add my feature'`）
4. 运行 `npm run tauri dev` 验证
5. 推送分支并创建 Pull Request

## License

[MIT](LICENSE)

---

<p align="center"><em>HUMHUM —— 面向用户的个人 Agent 中枢。在你被信息淹没时，帮你慢慢理清。🪼</em></p>

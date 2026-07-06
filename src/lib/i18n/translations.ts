import type { Language } from "./index";

type TranslationMap = Record<string, Record<Language, string>>;

export const translations: TranslationMap = {
  // ── Bubble ──
  "bubble.processing": { zh: "...", en: "..." },
  "bubble.waiting": { zh: "!", en: "!" },
  "bubble.listening": { zh: "...", en: "..." },

  // ── CompletionPanel ──
  "completion.completed": { zh: "完成", en: "Completed" },
  "completion.stopped": { zh: "结束", en: "Stopped" },
  "completion.notification": { zh: "通知", en: "Notice" },
  "completion.fallback": { zh: "{client} 会话{status}", en: "{client} session {status}" },

  // ── ConfirmToast ──
  "confirm.title": { zh: "请求批准", en: "Approval" },
  "confirm.deny": { zh: "拒绝", en: "Deny" },
  "confirm.always": { zh: "始终", en: "Always" },
  "confirm.allow": { zh: "允许", en: "Allow" },
  "confirm.sending": { zh: "发送中...", en: "Sending..." },
  "confirm.sent": { zh: "已发送", en: "Sent" },

  // ── QuestionToast ──
  "question.title": { zh: "选择", en: "Choose" },
  "question.fallback": { zh: "选择一个选项", en: "Pick an option" },

  // ── PetView ──
  "petview.needsChoice": { zh: "需要选择", en: "Choice needed" },
  "petview.waitingChoice": { zh: "等待你选择选项", en: "Waiting for your choice" },
  "petview.needsApproval": { zh: "{tool} 需要确认", en: "{tool} needs approval" },
  "petview.requestExec": { zh: "{client} 请求执行 {tool}", en: "{client} wants to run {tool}" },
  "petview.command": { zh: "命令", en: "Cmd" },
  "petview.file": { zh: "文件", en: "File" },
  "petview.gotNotification": { zh: "收到通知", en: "Notification" },
  "petview.using": { zh: "正在使用", en: "using" },
  "petview.done": { zh: "已完成", en: "done with" },
  "petview.pending": { zh: "+{n} 个待确认", en: "+{n} pending" },
  "petview.ccWaitingChoice": { zh: "Claude Code 在等你选择选项", en: "Claude Code is waiting for your pick" },

  // ── Settings Panel ──
  "settings.loading": { zh: "加载中...", en: "Loading..." },
  "settings.title": { zh: "HumHum", en: "HumHum" },
  "settings.subtitle": { zh: "你的 AI 编程伴侣", en: "Your AI coding companion" },
  "settings.tabSettings": { zh: "设置", en: "Settings" },
  "settings.tabStats": { zh: "统计", en: "Stats" },
  "settings.voiceTitle": { zh: "音色选择", en: "Voice" },
  "settings.voiceSubtitle": { zh: "让伴侣的声音更适合你", en: "Choose the right voice for Hum" },
  "settings.edgeFree": { zh: "Edge (免费)", en: "Edge (Free)" },
  "settings.voiceLabel": { zh: "音色", en: "Voice" },
  "settings.speed": { zh: "语速", en: "Speed" },
  "settings.connectionsTitle": { zh: "连接", en: "Connections" },
  "settings.connectedCount": { zh: "{n} 个助手已连接", en: "{n} agent(s) connected" },
  "settings.connected": { zh: "已连接", en: "On" },
  "settings.connect": { zh: "连接", en: "Connect" },
  "settings.rageTitle": { zh: "狂暴模式", en: "Rage Mode" },
  "settings.rageSubtitle": { zh: "自动确认所有权限请求", en: "Auto-approve all permission requests" },
  "settings.rageDesc": { zh: "开启后，Hum 自动批准所有权限请求", en: "When on, Hum auto-approves every request" },
  "settings.rageOn": { zh: "已开启", en: "On" },
  "settings.rageOff": { zh: "关闭", en: "Off" },
  "settings.keysTitle": { zh: "密钥", en: "API Keys" },
  "settings.keysSubtitle": { zh: "BYOK，数据不离开本地", en: "BYOK — data stays local" },
  "settings.openaiPlaceholder": { zh: "sk-... (TTS / 摘要 / Whisper)", en: "sk-... (TTS / Summary / Whisper)" },
  "settings.elevenOptional": { zh: "ElevenLabs (可选)", en: "ElevenLabs (optional)" },
  "settings.elevenPlaceholder": { zh: "高级音质引擎", en: "Premium voice engine" },
  "settings.expandAdvanced": { zh: "展开高级选项", en: "Advanced options" },
  "settings.collapseAdvanced": { zh: "收起高级选项", en: "Hide advanced" },
  "settings.language": { zh: "语言", en: "Language" },
  "settings.sttEngine": { zh: "STT 引擎", en: "STT Engine" },
  "settings.webSpeechFree": { zh: "Web Speech (免费)", en: "Web Speech (Free)" },
  "settings.summaryModel": { zh: "摘要模型", en: "Summary Model" },
  "settings.hookPort": { zh: "Hook 端口", en: "Hook Port" },
  "settings.saved": { zh: "已保存 ~", en: "Saved ~" },
  "settings.saveFailed": { zh: "保存失败: {e}", en: "Save failed: {e}" },
  "settings.hookFailed": { zh: "Hook 操作失败: {e}", en: "Hook operation failed: {e}" },
  "settings.saving": { zh: "保存中", en: "Saving" },
  "settings.save": { zh: "保存设置", en: "Save" },

  // ── Stats Panel ──
  "stats.loading": { zh: "加载统计数据...", en: "Loading stats..." },
  "stats.loadFailed": { zh: "无法加载统计数据", en: "Failed to load stats" },
  "stats.noData": { zh: "暂无统计数据", en: "No data yet" },
  "stats.noDataHint": { zh: "使用 AI 编程助手后，统计数据将自动记录", en: "Stats will appear once you start using AI coding agents" },
  "stats.title": { zh: "统计", en: "Stats" },
  "stats.subtitle": { zh: "Agent · Token · 工具调用 · 活跃概览", en: "Agents · Tokens · Tools · Activity" },
  "stats.tokenUsage": { zh: "Token 消耗", en: "Tokens" },
  "stats.tokenBreakdown": { zh: "输入 {input} · 输出 {output}", en: "In {input} · Out {output}" },
  "stats.activeAgents": { zh: "活跃 Agent", en: "Agents" },
  "stats.agentSubtitle": { zh: "本周期客户端类型", en: "Client types this period" },
  "stats.toolCalls": { zh: "工具调用", en: "Tool Calls" },
  "stats.toolSubtitle": { zh: "去重后的调用次数", en: "Deduplicated invocations" },
  "stats.sessions": { zh: "会话数", en: "Sessions" },
  "stats.sessionSubtitle": { zh: "按 agent 去重", en: "Deduplicated by agent" },
  "stats.costTitle": { zh: "费用预估", en: "Cost Estimate" },
  "stats.today": { zh: "今日", en: "Today" },
  "stats.days7": { zh: "7 天", en: "7 Days" },
  "stats.days30": { zh: "30 天", en: "30 Days" },
  "stats.tokenDist": { zh: "Token 分布", en: "Token Mix" },
  "stats.input": { zh: "输入", en: "Input" },
  "stats.output": { zh: "输出", en: "Output" },
  "stats.cacheWrite": { zh: "缓存写入", en: "Cache write" },
  "stats.cacheRead": { zh: "缓存读取", en: "Cache read" },
  "stats.agentDist": { zh: "Agent 分布", en: "Agent Mix" },
  "stats.toolsUsed": { zh: "使用的工具", en: "Tools Used" },

  // ── Summarizer ──
  "summarizer.systemZh": {
    zh: "你是桌面小助手，用一两句话简短播报开发进展。\n\n规则：\n- 用最简短的口语，像同事随口说一句\n- 不超过50字\n- 不读代码、路径、JSON\n- 多个事件合并说，如\"刚跑完两个任务，都顺利\"\n- 确认请求要说\"需要你确认\"\n- 不要客套开场白，直接说重点",
    en: "You are a desktop companion. Summarize dev events in one short sentence.\n\nRules:\n- Speak casually, like a coworker giving a quick update\n- Under 60 characters\n- Never read code, paths, or JSON\n- Merge multiple events, e.g. \"Two tasks done, all good\"\n- For permission requests say \"needs your approval\"\n- No greetings, get to the point",
  },
  "summarizer.eventType": { zh: "事件类型", en: "Event type" },
  "summarizer.session": { zh: "会话", en: "Session" },
  "summarizer.details": { zh: "详细内容", en: "Details" },
  "summarizer.permissionHint": {
    zh: "这是一个权限确认请求。请在播报末尾提醒用户需要做出确认或拒绝的决定。",
    en: "This is a permission request. Remind the user they need to approve or deny it.",
  },
};

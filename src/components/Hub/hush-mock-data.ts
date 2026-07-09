export interface Contact {
  id: string;
  name: string;
  avatar: string;
  tier: "family" | "friends" | "work";
  platforms: string[];
  lastMessage: string;
  lastMessageTime: string;
}

export interface MessageSummary {
  contactId: string;
  summary: string;
  suggestedReplies: string[];
  messages: { from: string; text: string; time: string; platform: string }[];
}

export const CONTACTS: Contact[] = [
  // Family
  { id: "f1", name: "妈妈", avatar: "👩", tier: "family", platforms: ["wechat"], lastMessage: "今天有没有按时吃饭", lastMessageTime: "14:30" },
  { id: "f2", name: "爸爸", avatar: "👨", tier: "family", platforms: ["wechat"], lastMessage: "周末回来吗", lastMessageTime: "昨天" },
  { id: "f3", name: "姐姐", avatar: "👧", tier: "family", platforms: ["wechat", "facetime"], lastMessage: "给你发了个快递单号", lastMessageTime: "12:15" },

  // Friends
  { id: "r1", name: "小明", avatar: "🧑‍💻", tier: "friends", platforms: ["wechat", "x"], lastMessage: "那个 AI 工具你试了吗", lastMessageTime: "11:20" },
  { id: "r2", name: "阿花", avatar: "🌸", tier: "friends", platforms: ["wechat"], lastMessage: "周六一起去看展吗", lastMessageTime: "10:45" },
  { id: "r3", name: "大壮", avatar: "💪", tier: "friends", platforms: ["wechat", "x"], lastMessage: "代码 review 完了 LGTM", lastMessageTime: "09:30" },
  { id: "r4", name: "Luna", avatar: "🌙", tier: "friends", platforms: ["telegram", "x"], lastMessage: "Check this thread on AI agents", lastMessageTime: "08:00" },
  { id: "r5", name: "小鱼", avatar: "🐟", tier: "friends", platforms: ["wechat"], lastMessage: "那家咖啡馆不错", lastMessageTime: "昨天" },

  // Work
  { id: "w1", name: "张总", avatar: "👔", tier: "work", platforms: ["dingtalk"], lastMessage: "周报记得提交", lastMessageTime: "16:00" },
  { id: "w2", name: "产品经理 小李", avatar: "📋", tier: "work", platforms: ["dingtalk", "feishu"], lastMessage: "需求文档已更新", lastMessageTime: "15:30" },
  { id: "w3", name: "设计师 Coco", avatar: "🎨", tier: "work", platforms: ["feishu"], lastMessage: "新 icon 放到 Figma 了", lastMessageTime: "14:00" },
  { id: "w4", name: "后端 老王", avatar: "⚙️", tier: "work", platforms: ["dingtalk"], lastMessage: "API 改了入参格式", lastMessageTime: "13:20" },
  { id: "w5", name: "QA 小陈", avatar: "🔍", tier: "work", platforms: ["dingtalk"], lastMessage: "Bug #1234 已修复验证通过", lastMessageTime: "11:00" },
  { id: "w6", name: "实习生 小赵", avatar: "🌱", tier: "work", platforms: ["dingtalk", "wechat"], lastMessage: "导师请问这个怎么部署", lastMessageTime: "10:30" },
  { id: "w7", name: "HR Lily", avatar: "💼", tier: "work", platforms: ["feishu"], lastMessage: "7月团建投票链接", lastMessageTime: "昨天" },
  { id: "w8", name: "运维 阿杰", avatar: "🛠", tier: "work", platforms: ["dingtalk"], lastMessage: "服务器扩容完成", lastMessageTime: "昨天" },
];

export const MESSAGE_SUMMARIES: Record<string, MessageSummary> = {
  f1: {
    contactId: "f1",
    summary: "妈妈今天发了3条消息，主要关心你的饮食和作息。提到了周末家里做了红烧排骨，问你要不要回家。",
    suggestedReplies: [
      "今天按时吃了～放心吧妈",
      "周末回来！想吃你做的排骨了",
      "最近工作忙，但都有好好吃饭哦",
    ],
    messages: [
      { from: "妈妈", text: "宝贝早上好，记得吃早饭", time: "07:30", platform: "wechat" },
      { from: "妈妈", text: "今天有没有按时吃饭", time: "14:30", platform: "wechat" },
      { from: "妈妈", text: "周末做了红烧排骨要不要回来", time: "14:31", platform: "wechat" },
    ],
  },
  r1: {
    contactId: "r1",
    summary: "小明分享了一个新的 AI Agent 框架，很兴奋地讨论了 30 分钟。他在考虑用 Claude Code hooks 来自动化工作流。",
    suggestedReplies: [
      "试了！确实很强，特别是 hook 系统",
      "我正好在做类似的东西，回头聊聊",
      "推荐你也试试 HumHum 配合用",
    ],
    messages: [
      { from: "小明", text: "老哥看这个 https://...", time: "10:50", platform: "wechat" },
      { from: "小明", text: "直接 hook 进 Claude Code 太爽了", time: "11:05", platform: "wechat" },
      { from: "小明", text: "那个 AI 工具你试了吗", time: "11:20", platform: "wechat" },
    ],
  },
  w2: {
    contactId: "w2",
    summary: "小李更新了 v2.1 需求文档，主要改动是知识库模块的交互流程。标注了几个需要开发确认的技术点。",
    suggestedReplies: [
      "收到，我看下技术可行性今天回复",
      "交互流程没问题，预计 2 天完成",
      "有几个点需要和后端对齐，拉个群？",
    ],
    messages: [
      { from: "小李", text: "v2.1 文档链接在飞书了", time: "15:00", platform: "feishu" },
      { from: "小李", text: "知识库的搜索交互改了，你看下", time: "15:20", platform: "feishu" },
      { from: "小李", text: "需求文档已更新", time: "15:30", platform: "feishu" },
    ],
  },
};

export const PLATFORM_ICONS: Record<string, string> = {
  wechat: "💬",
  dingtalk: "🔷",
  feishu: "🪶",
  telegram: "✈️",
  x: "𝕏",
  facetime: "📱",
};

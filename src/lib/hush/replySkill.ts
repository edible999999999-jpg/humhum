import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../../types";
import { createHumiPiRuntime } from "../pi/runtime";

const MAX_CONTEXT_MESSAGES = 12;
const MAX_SUGGESTION_CHARACTERS = 300;

export interface HushReplySkillMessage {
  sender: string;
  text: string;
  received_at: string;
}

export interface HushReplySkillInput {
  conversationName: string;
  messages: HushReplySkillMessage[];
}

function buildHushReplySkillPrompt(input: HushReplySkillInput): string {
  const context = input.messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(
      (message) =>
        `[${message.received_at}] ${message.sender}：${message.text.trim()}`,
    )
    .join("\n");

  return [
    "执行 Hush「建议回复」Skill。",
    `当前是与「${input.conversationName}」的单聊。`,
    "请根据下面的最近对话，代用户拟一条自然、具体、符合上下文的中文回复。",
    "只输出一条可直接发送的回复，不要写“建议回复”、解释、标题、引号或多个选项。",
    "不要承诺上下文里没有依据的时间、结果或行动；信息不足时用自然方式询问。",
    "",
    "最近对话：",
    context || "（当前没有可用的消息正文）",
  ].join("\n");
}

function normalizeHushReplySuggestion(answer: string): string {
  const normalized = answer
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:建议回复|回复建议)\s*[:：]\s*/i, "")
    .replace(/^["“](.*)["”]$/s, "$1")
    .trim();
  if (!normalized) {
    throw new Error("这次没有生成可显示的建议，请重试。");
  }
  return Array.from(normalized)
    .slice(0, MAX_SUGGESTION_CHARACTERS)
    .join("");
}

export async function runHushReplySkill(
  input: HushReplySkillInput,
): Promise<string> {
  const config = await invoke<AppConfig>("get_config");
  const runtime = createHumiPiRuntime(config);
  const answer = await runtime.ask(buildHushReplySkillPrompt(input));
  return normalizeHushReplySuggestion(answer);
}

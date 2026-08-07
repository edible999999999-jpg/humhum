export interface HushReplySkillMessage {
  sender: string;
  text: string;
  received_at: string;
}

export interface HushReplySkillInput {
  conversationName: string;
  messages: HushReplySkillMessage[];
}

export async function runHushReplySkill(
  input: HushReplySkillInput,
): Promise<string> {
  const ordered = input.messages
    .filter((message) => message.text.trim())
    .sort(
      (left, right) =>
        Date.parse(left.received_at) - Date.parse(right.received_at),
    );
  const latest = ordered[ordered.length - 1];
  if (!latest) {
    throw new Error("这条对话还没有可参考的消息，快捷短语暂不可用。");
  }

  const text = latest.text.trim();
  if (/[?？]\s*$/.test(text) || /(?:吗|么|能否|可不可以)[？?]?\s*$/.test(text)) {
    return "我看到了，稍后确认好再回复你。";
  }
  if (/(?:谢谢|多谢|感谢)[！!。\s]*$/.test(text)) {
    return "不客气。";
  }
  return "收到，我看到了。";
}

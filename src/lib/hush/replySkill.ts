import { t } from "@/lib/i18n";

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
    throw new Error(t("hush.reply.noMessageYet"));
  }

  const text = latest.text.trim();
  if (/[?？]\s*$/.test(text) || /(?:吗|么|能否|可不可以)[？?]?\s*$/.test(text)) {
    return t("hush.reply.willConfirmLater");
  }
  if (/(?:谢谢|多谢|感谢)[！!。\s]*$/.test(text)) {
    return t("hush.reply.youreWelcome");
  }
  return t("hush.reply.gotItSeen");
}

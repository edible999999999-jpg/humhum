import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, MessageCircle, Send, ShieldCheck } from "lucide-react";
import {
  runHushReplySkill,
  type HushReplySkillMessage,
} from "../../lib/hush/replySkill";

interface HushReplyPreview {
  confirmation_id: string;
  platform: string;
  conversation: string;
  body: string;
  expires_at: string;
  delivery_mode: "wechat_ui" | "dingtalk_dws" | string;
  notice: string;
}

interface HushReplyReceipt {
  platform: string;
  conversation: string;
  sent_at: string;
  status: "sent" | string;
}

export function HushReplyComposer({
  conversationName,
  targetMessageId,
  messages,
}: {
  conversationName: string;
  targetMessageId: string | null;
  messages: HushReplySkillMessage[];
}) {
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<HushReplyPreview | null>(null);
  const [status, setStatus] = useState<"idle" | "drafting" | "preparing" | "sending" | "sent">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft("");
    setPreview(null);
    setStatus("idle");
    setError(null);
  }, [conversationName, targetMessageId]);

  if (!targetMessageId) {
    return (
      <div className="hush-reply-unavailable">
        <ShieldCheck size={14} aria-hidden="true" />
        回复只对已确认收件人的真实单聊开放。
      </div>
    );
  }

  const createLocalDraft = async () => {
    setStatus("drafting");
    setError(null);
    try {
      setDraft(
        await runHushReplySkill({
          conversationName,
          messages,
        }),
      );
      setPreview(null);
      setStatus("idle");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const prepareReply = async () => {
    if (!draft.trim() || status !== "idle") return;
    setStatus("preparing");
    setError(null);
    try {
      const next = await invoke<HushReplyPreview>("prepare_hush_reply", {
        messageId: targetMessageId,
        body: draft,
      });
      setDraft(next.body);
      setPreview(next);
      setStatus("idle");
    } catch (caught) {
      setStatus("idle");
      setPreview(null);
      setError(String(caught));
    }
  };

  const confirmReply = async () => {
    if (!preview || status !== "idle") return;
    setStatus("sending");
    setError(null);
    try {
      const receipt = await invoke<HushReplyReceipt>("confirm_hush_reply", {
        confirmationId: preview.confirmation_id,
      });
      if (receipt.status !== "sent") {
        throw new Error("聊天平台没有确认发送结果");
      }
      setStatus("sent");
      setPreview(null);
    } catch (caught) {
      setStatus("idle");
      setPreview(null);
      setError(String(caught));
    }
  };

  const busy = status === "drafting" || status === "preparing" || status === "sending";

  return (
    <section className="hush-reply-composer" aria-label="安全回复">
      <div className="hush-reply-composer-heading">
        <div>
          <strong>回复 {conversationName}</strong>
          <span>草稿留在本机，发送前逐条确认</span>
        </div>
        <button
          type="button"
          className="hush-reply-local-draft"
          disabled={busy}
          onClick={() => void createLocalDraft()}
          title="按最新一条消息套用固定短语，不调用任何模型"
        >
          <MessageCircle size={14} aria-hidden="true" />
          {status === "drafting" ? "填入中" : "快捷短语"}
        </button>
      </div>

      <textarea
        value={draft}
        rows={3}
        maxLength={2000}
        placeholder="输入要回复的内容"
        aria-label={`回复 ${conversationName}`}
        disabled={busy || status === "sent"}
        onChange={(event) => {
          setDraft(event.target.value);
          setPreview(null);
          setStatus("idle");
          setError(null);
        }}
      />

      {preview && (
        <div className="hush-reply-confirmation" role="status">
          <div>
            <strong>发送给：{preview.conversation}</strong>
            <span>{preview.notice}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmReply()}
          >
            <Send size={14} aria-hidden="true" />
            {status === "sending" ? "正在发送" : "确认发送"}
          </button>
        </div>
      )}

      {error && (
        <div className="hush-reply-skill-error" role="alert">
          {error}
        </div>
      )}

      {status === "sent" ? (
        <div className="hush-reply-sent" role="status">
          <Check size={14} aria-hidden="true" />
          已发送
        </div>
      ) : (
        !preview && (
          <button
            type="button"
            className="hush-reply-prepare"
            disabled={busy || !draft.trim()}
            onClick={() => void prepareReply()}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {status === "preparing" ? "正在准备" : "检查收件人与内容"}
          </button>
        )
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, MessageCircle, Send, ShieldCheck } from "lucide-react";
import {
  runHushReplySkill,
  type HushReplySkillMessage,
} from "../../lib/hush/replySkill";
import { useTranslation } from "../../lib/i18n/react";

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
  const { t } = useTranslation();
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
        {t("hush.reply.unavailable")}
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
        throw new Error(t("hush.reply.sendNotConfirmed"));
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
    <section className="hush-reply-composer" aria-label={t("hush.reply.title")}>
      <div className="hush-reply-composer-heading">
        <div>
          <strong>{t("hush.reply.replyTo", { name: conversationName })}</strong>
          <span>{t("hush.reply.subtitle")}</span>
        </div>
        <button
          type="button"
          className="hush-reply-local-draft"
          disabled={busy}
          onClick={() => void createLocalDraft()}
          title={t("hush.reply.quickPhraseTitle")}
        >
          <MessageCircle size={14} aria-hidden="true" />
          {status === "drafting"
            ? t("hush.reply.filling")
            : t("hush.reply.quickPhrase")}
        </button>
      </div>

      <textarea
        value={draft}
        rows={3}
        maxLength={2000}
        placeholder={t("hush.reply.placeholder")}
        aria-label={t("hush.reply.replyTo", { name: conversationName })}
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
            <strong>{t("hush.reply.sendTo", { name: preview.conversation })}</strong>
            <span>{preview.notice}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmReply()}
          >
            <Send size={14} aria-hidden="true" />
            {status === "sending"
              ? t("hush.reply.sending")
              : t("hush.reply.confirmSend")}
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
          {t("hush.reply.sent")}
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
            {status === "preparing"
              ? t("hush.reply.preparing")
              : t("hush.reply.checkRecipient")}
          </button>
        )
      )}
    </section>
  );
}

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "@/lib/i18n";
import type { HookEvent } from "@/types";

interface QuestionToastProps {
  event: HookEvent;
  onDismiss: () => void;
}

interface QuestionOption {
  label: string;
  description?: string;
}

export function QuestionToast({ event, onDismiss }: QuestionToastProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const payload = event.payload as Record<string, unknown>;
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};

  const questions = (toolInput.questions as Array<Record<string, unknown>>) ?? [];
  const firstQ = questions[0] ?? toolInput;
  const questionText = (firstQ.question as string) ?? t("question.fallback");
  const rawOptions = (firstQ.options as QuestionOption[]) ?? [];

  const hookEventName = (payload.hook_event_name as string) || event.hook_event_name || "";
  const isHookBlocking = hookEventName === "PermissionRequest" || hookEventName === "PreToolUse";

  const handleSelect = async (index: number, label: string) => {
    const choice = String(index + 1);
    console.log(`[QuestionToast] Selected #${choice}: ${label}, isHookBlocking=${isHookBlocking}`);

    if (isHookBlocking) {
      setStatus("sending");
      setErrorMsg("");
      const questionKey = questionText || (firstQ.header as string) || "";
      const answer = {
        questions: toolInput.questions,
        answers: { [questionKey]: label },
      };
      try {
        await invoke("respond_to_permission", {
          eventId: event.id,
          behavior: "allow",
          answer,
        });
        onDismiss();
      } catch (e) {
        console.error("[QuestionToast] respond_to_permission failed:", e);
        setStatus("error");
        setErrorMsg(`Response failed: ${String(e)}`);
      }
    } else {
      try {
        await invoke("type_in_terminal", { text: choice });
        onDismiss();
      } catch (e) {
        console.error("[QuestionToast] type_in_terminal failed:", e);
        setStatus("error");
        setErrorMsg(`Response failed: ${String(e)}`);
      }
    }
  };

  const handleDismissWithoutAnswer = async () => {
    if (isHookBlocking) {
      setStatus("sending");
      setErrorMsg("");
      try {
        await invoke("respond_to_permission", { eventId: event.id, behavior: "deny" });
      } catch (e) {
        console.error("[QuestionToast] deny failed:", e);
        setStatus("error");
        setErrorMsg(`Response failed: ${String(e)}`);
        return;
      }
    }
    onDismiss();
  };

  return (
    <div className="confirm-card toast-enter pointer-events-auto" style={{ borderColor: "rgba(116,143,165,0.16)", boxShadow: "0 18px 44px rgba(90,115,150,0.18)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <img
            src="/mascots/expr/hexa/confirm.png"
            alt="Hexa"
            className="module-face"
            style={{ width: 28, height: 28 }}
            draggable={false}
          />
          <span className="font-semibold text-[13px]" style={{ color: "#334155" }}>{t("question.title")}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button
          type="button"
          onClick={handleDismissWithoutAnswer}
          disabled={status === "sending"}
          aria-label="关闭提问"
          className="text-xs transition-colors leading-none"
          style={{ color: "#94a3b8" }}
        >✕</button>
      </div>

      {/* Question */}
      <div className="px-3 pb-2">
        <div className="text-[12px] leading-snug" style={{ color: "#334155" }}>{questionText}</div>
      </div>

      {status !== "idle" && (
        <div
          className={`px-3 pb-2 text-[10px] font-semibold ${status === "error" ? "text-red-400/80" : "text-amber-300/80"}`}
          role={status === "error" ? "alert" : "status"}
        >
          {status === "error" ? errorMsg : t("confirm.sending")}
        </div>
      )}

      {/* Options */}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5" style={{ maxHeight: 240, overflowY: "auto" }}>
        {rawOptions.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleSelect(i, opt.label)}
            disabled={status === "sending"}
            className="w-full text-left px-3.5 py-2 rounded-2xl border transition-all text-[12px] active:scale-[0.97]"
            style={{
              background: "rgba(255,255,255,0.66)",
              borderColor: "rgba(116,143,165,0.14)",
              color: "#334155",
            }}
          >
            <span className="font-semibold">{i + 1}. {opt.label}</span>
            {opt.description && (
              <span className="block text-[10px] mt-0.5 leading-snug" style={{ color: "#64748b" }}>{opt.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

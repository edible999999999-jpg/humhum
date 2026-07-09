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
  const payload = event.payload as Record<string, unknown>;
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};

  const questions = (toolInput.questions as Array<Record<string, unknown>>) ?? [];
  const firstQ = questions[0] ?? toolInput;
  const questionText = (firstQ.question as string) ?? t("question.fallback");
  const rawOptions = (firstQ.options as QuestionOption[]) ?? [];

  const hookEventName = (payload.hook_event_name as string) || event.hook_event_name || "";
  const isHookBlocking = hookEventName === "PermissionRequest" || hookEventName === "PreToolUse";

  const handleSelect = (index: number, label: string) => {
    const choice = String(index + 1);
    console.log(`[QuestionToast] Selected #${choice}: ${label}, isHookBlocking=${isHookBlocking}`);

    if (isHookBlocking) {
      const questionKey = questionText || (firstQ.header as string) || "";
      const answer = {
        questions: toolInput.questions,
        answers: { [questionKey]: label },
      };
      invoke("respond_to_permission", {
        eventId: event.id,
        behavior: "allow",
        answer,
      }).then(() => onDismiss()).catch((e) => {
        console.error("[QuestionToast] respond_to_permission failed:", e);
        onDismiss();
      });
    } else {
      onDismiss();
      invoke("type_in_terminal", { text: choice }).catch((e) =>
        console.error("[QuestionToast] type_in_terminal failed:", e),
      );
    }
  };

  const handleDismissWithoutAnswer = () => {
    if (isHookBlocking) {
      invoke("respond_to_permission", { eventId: event.id, behavior: "allow" }).catch(() => {});
    }
    onDismiss();
  };

  return (
    <div className="confirm-card toast-enter pointer-events-auto" style={{ borderColor: "rgba(116,143,165,0.16)", boxShadow: "0 18px 44px rgba(90,115,150,0.18)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(148, 239, 244, 0.08)", color: "rgba(148, 239, 244, 0.8)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
            </svg>
          </div>
          <span className="font-semibold text-[13px]" style={{ color: "#334155" }}>{t("question.title")}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button onClick={handleDismissWithoutAnswer} className="text-xs transition-colors leading-none" style={{ color: "#94a3b8" }}>✕</button>
      </div>

      {/* Question */}
      <div className="px-3 pb-2">
        <div className="text-[12px] leading-snug" style={{ color: "#334155" }}>{questionText}</div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5" style={{ maxHeight: 240, overflowY: "auto" }}>
        {rawOptions.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i, opt.label)}
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

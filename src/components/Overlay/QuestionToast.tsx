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
    <div className="confirm-card toast-enter pointer-events-auto" style={{ borderColor: "rgba(148, 239, 244, 0.12)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(148, 239, 244, 0.08)", color: "rgba(148, 239, 244, 0.8)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
            </svg>
          </div>
          <span className="text-white/80 font-semibold text-[13px]">{t("question.title")}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button onClick={handleDismissWithoutAnswer} className="text-white/20 hover:text-white/50 text-xs transition-colors leading-none">✕</button>
      </div>

      {/* Question */}
      <div className="px-3 pb-2">
        <div className="text-white/65 text-[12px] leading-snug">{questionText}</div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5" style={{ maxHeight: 240, overflowY: "auto" }}>
        {rawOptions.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i, opt.label)}
            className="w-full text-left px-3.5 py-2 rounded-2xl border transition-all text-[12px] bg-white/[0.02] border-white/[0.04] text-white/60 hover:bg-[rgba(148,239,244,0.06)] hover:border-[rgba(148,239,244,0.12)] hover:text-white/85 active:scale-[0.97]"
          >
            <span className="font-semibold">{i + 1}. {opt.label}</span>
            {opt.description && (
              <span className="block text-[10px] text-white/30 mt-0.5 leading-snug">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

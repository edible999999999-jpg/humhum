import { invoke } from "@tauri-apps/api/core";
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
  const questionText = (firstQ.question as string) ?? "选择一个选项";
  const rawOptions = (firstQ.options as QuestionOption[]) ?? [];

  const handleSelect = (index: number, label: string) => {
    const choice = String(index + 1);
    console.log(`[QuestionToast] Selected #${choice}: ${label}`);
    onDismiss();
    invoke("type_in_terminal", { text: choice }).catch((e) =>
      console.error("[QuestionToast] type_in_terminal failed:", e),
    );
  };

  return (
    <div className="confirm-card toast-enter pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded flex items-center justify-center bg-indigo-400/15 text-indigo-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
            </svg>
          </div>
          <span className="text-white/90 font-semibold text-[13px]">选择</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button onClick={onDismiss} className="text-white/30 hover:text-white/60 text-xs transition-colors leading-none">✕</button>
      </div>

      {/* Question */}
      <div className="px-3 pb-2">
        <div className="text-white/80 text-[12px] leading-snug">{questionText}</div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5" style={{ maxHeight: 240, overflowY: "auto" }}>
        {rawOptions.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i, opt.label)}
            className="w-full text-left px-3 py-2 rounded-lg border transition-all text-[12px] bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-indigo-500/10 hover:border-indigo-400/20 hover:text-white/90 active:scale-[0.97]"
          >
            <span className="font-semibold">{i + 1}. {opt.label}</span>
            {opt.description && (
              <span className="block text-[10px] text-white/40 mt-0.5 leading-snug">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

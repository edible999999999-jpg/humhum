import type { PetState } from "@/types";

interface BubbleProps {
  state: PetState;
  text: string;
}

export function Bubble({ state, text }: BubbleProps) {
  if (!text || state === "idle") return null;

  const isLongText = text.length > 5;

  return (
    <div
      className={`mb-2 px-4 py-2 bg-slate-900 border border-white/10 rounded-2xl rounded-bl-sm text-center shadow-xl transition-all duration-300 ${
        isLongText ? "max-w-[300px]" : "max-w-[200px]"
      }`}
    >
      <p
        className={`text-indigo-200/90 leading-relaxed ${
          isLongText ? "text-[10px]" : "text-xs"
        }`}
      >
        {text}
      </p>
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 border-r border-b border-white/10 rotate-45" />
    </div>
  );
}

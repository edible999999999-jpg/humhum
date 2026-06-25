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
      className={`mb-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-2xl rounded-bl-sm text-center transition-all duration-300 ${
        isLongText ? "max-w-[300px]" : "max-w-[200px]"
      }`}
    >
      <p
        className={`text-white/90 leading-relaxed ${
          isLongText ? "text-[10px]" : "text-xs"
        }`}
      >
        {text}
      </p>
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/10 backdrop-blur-md rotate-45" />
    </div>
  );
}

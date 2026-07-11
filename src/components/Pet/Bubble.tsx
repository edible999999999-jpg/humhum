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
      className={`relative mb-2 inline-flex w-fit items-center justify-center rounded-2xl rounded-bl-sm px-4 py-2 text-center transition-all duration-300 ${
        isLongText ? "max-w-[300px]" : "max-w-[200px]"
      }`}
      style={{
        background: "rgba(255,250,247,0.88)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        border: "1px solid rgba(116,143,165,0.16)",
        boxShadow: "0 14px 34px rgba(90,115,150,0.18)",
      }}
    >
      <p
        className={`leading-relaxed ${
          isLongText ? "text-[10px]" : "text-xs"
        }`}
        style={{ margin: 0, color: "#334155" }}
      >
        {text}
      </p>
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 border-r border-b rotate-45"
        style={{
          background: "rgba(255,250,247,0.94)",
          borderColor: "rgba(116,143,165,0.16)",
        }}
      />
    </div>
  );
}

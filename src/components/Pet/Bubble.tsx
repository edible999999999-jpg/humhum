import type { PetState } from "@/types";

/**
 * Character keys correspond to `public/mascots/expr/<character>/` folders.
 * `humi` is the body itself — it never peeks into the bubble.
 */
export type BubbleCharacter = "hype" | "hush" | "hexa";

interface BubbleProps {
  state: PetState;
  /** Optional short text (comic-style, <=10 chars best) */
  text?: string;
  /**
   * When provided, the bubble renders the character's expression image on the
   * left and (optionally) text on the right. When omitted, the bubble falls
   * back to the legacy text-only comic style.
   */
  character?: BubbleCharacter;
  /** Filename inside `public/mascots/expr/<character>/`, e.g. `excited.png` */
  image?: string;
}

export function Bubble({ state, text, character, image }: BubbleProps) {
  const hasImage = Boolean(character && image);
  const hasText = Boolean(text);

  // Text-only bubbles stay silent during idle (comic-book convention).
  // Image peeks may run in idle too — the Director owns their lifetime.
  if (!hasImage && !hasText) return null;
  if (!hasImage && state === "idle") return null;

  const isLongText = hasText && (text as string).length > 5;

  return (
    <div
      className={`relative mb-2 inline-flex w-fit items-center gap-2 rounded-2xl rounded-bl-sm px-3 py-2 text-center transition-all duration-300 ${
        isLongText ? "max-w-[320px]" : "max-w-[240px]"
      }`}
      style={{
        background: "rgba(255,250,247,0.88)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        border: "1px solid rgba(116,143,165,0.16)",
        boxShadow: "0 14px 34px rgba(90,115,150,0.18)",
      }}
    >
      {hasImage && (
        <img
          src={`/mascots/expr/${character}/${image}`}
          alt={`${character} ${image?.replace(/\.png$/i, "") ?? ""}`}
          className="h-14 w-auto max-w-[64px] shrink-0 select-none object-contain"
          draggable={false}
        />
      )}
      {hasText && (
        <p
          className={`m-0 leading-relaxed ${
            isLongText ? "text-[10px]" : "text-xs"
          }`}
          style={{ color: "#334155" }}
        >
          {text}
        </p>
      )}
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

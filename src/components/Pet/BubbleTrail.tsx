import { useState, useCallback, useEffect, useRef } from "react";

interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  dx: number;
  dy: number;
  delay: number;
}

let nextId = 0;

export function useBubbleTrail() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const cleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const burst = useCallback((originX: number, originY: number) => {
    const count = 5 + Math.floor(Math.random() * 4);
    const newBubbles: Bubble[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 35;
      newBubbles.push({
        id: nextId++,
        x: originX + (Math.random() - 0.5) * 20,
        y: originY + (Math.random() - 0.5) * 10,
        size: 3 + Math.random() * 6,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 15,
        delay: i * 30,
      });
    }
    setBubbles((prev) => [...prev, ...newBubbles]);

    if (cleanupRef.current) clearTimeout(cleanupRef.current);
    cleanupRef.current = setTimeout(() => {
      setBubbles([]);
    }, 1200);
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) clearTimeout(cleanupRef.current);
    };
  }, []);

  return { bubbles, burst };
}

export function BubbleParticles({ bubbles }: { bubbles: Bubble[] }) {
  if (bubbles.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            background: "rgba(139, 92, 246, 0.35)",
            filter: "blur(0.5px)",
            animation: `jet-bubble 0.8s ease-out ${b.delay}ms forwards`,
            ["--dx" as string]: `${b.dx}px`,
            ["--dy" as string]: `${b.dy}px`,
          }}
        />
      ))}
    </div>
  );
}

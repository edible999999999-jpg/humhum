// ============================================================
// useExpression — Director hook.
// Owns the "which expression is currently peeking" state, plus the
// preemption / cooldown / timer logic. Call `fire(id)` to trigger a peek;
// call `clear()` to dismiss a `persist` expression manually.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { BubbleCharacter } from "../Bubble";
import {
  COOLDOWN,
  DURATION,
  EXPRESSIONS,
  PRIORITY,
  type ExpressionId,
} from "./registry";

export interface ExpressionSlot {
  id: ExpressionId;
  character: BubbleCharacter;
  image: string;
  text?: string;
}

export interface UseExpressionResult {
  active: ExpressionSlot | null;
  fire: (id: ExpressionId) => void;
  clear: () => void;
}

export function useExpression(): UseExpressionResult {
  const [active, setActive] = useState<ExpressionSlot | null>(null);

  // Refs keep `fire` referentially stable — event handler effects wire it
  // into deps arrays, so a churning callback would re-subscribe every render.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFiredAtRef = useRef<Partial<Record<ExpressionId, number>>>({});
  const lastGlobalFireRef = useRef<number>(0);
  const activePriorityRef = useRef<number>(-1);

  const clearActive = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activePriorityRef.current = -1;
    setActive(null);
  }, []);

  const fire = useCallback(
    (id: ExpressionId) => {
      const def = EXPRESSIONS[id];
      if (!def) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[useExpression] unknown expression id:", id);
        }
        return;
      }

      const now = Date.now();

      // Global flicker guard.
      if (now - lastGlobalFireRef.current < COOLDOWN.global) return;

      // Same-expression cooldown.
      const lastSame = lastFiredAtRef.current[id] ?? 0;
      if (now - lastSame < COOLDOWN.sameExpression) return;

      // Preemption: lower priority cannot displace higher priority.
      const incomingPriority = PRIORITY[def.priority];
      if (incomingPriority < activePriorityRef.current) return;

      // Install new slot.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastGlobalFireRef.current = now;
      lastFiredAtRef.current[id] = now;
      activePriorityRef.current = incomingPriority;

      setActive({
        id: def.id,
        character: def.character,
        image: def.image,
        text: def.text,
      });

      const ms = DURATION[def.duration];
      if (ms > 0) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          activePriorityRef.current = -1;
          setActive(null);
        }, ms);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { active, fire, clear: clearActive };
}

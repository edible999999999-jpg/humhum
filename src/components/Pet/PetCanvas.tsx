import { useRef, useEffect } from "react";
import { FallbackRenderer } from "@/engine/FallbackRenderer";
import { FPS, AGENT_BRAND_COLOR } from "@/engine/constants";
import type { PetState } from "@/types";
import type { ActiveAgent } from "@/engine/types";

interface PetCanvasProps {
  state: PetState;
  size?: number;
  activeClients?: string[];
}

export function PetCanvas({ state, size = 140, activeClients = [] }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FallbackRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef<PetState>(state);
  const agentsRef = useRef<ActiveAgent[]>([]);

  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderer = new FallbackRenderer(size, dpr);
    rendererRef.current = renderer;

    let lastTime = performance.now();

    function loop(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      renderer.setState(stateRef.current);
      renderer.setAgents(agentsRef.current);

      const offscreen = renderer.render(dt);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.drawImage(offscreen, 0, 0);

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rendererRef.current = null;
    };
  }, [size]);

  useEffect(() => {
    agentsRef.current = activeClients.map((id) => ({
      id,
      color: AGENT_BRAND_COLOR[id] ?? "#94a3b8",
    }));
  }, [activeClients]);

  return (
    <canvas
      ref={canvasRef}
      className="select-none pointer-events-none"
      style={{ width: size, height: size }}
    />
  );
}

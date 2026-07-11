import { lazy, Suspense, useRef, useEffect, useState, useCallback } from "react";
import { FallbackRenderer } from "@/engine/FallbackRenderer";
import { FPS, AGENT_BRAND_COLOR, AGENT_ICON_SRC } from "@/engine/constants";
import type { PetState } from "@/types";
import type { ActiveAgent } from "@/engine/types";
import { resolveMascotTheme } from "@/lib/mascot-theme";

const PetModel3D = lazy(() =>
  import("./PetModel3D").then((module) => ({ default: module.PetModel3D })),
);

const HUMI_SPRITE_SRC = "/mascots/humi-sprite-v1.png";

interface PetCanvasProps {
  state: PetState;
  size?: number;
  activeClients?: string[];
  prefer3d?: boolean;
  primaryClient?: string | null;
  mascotOverrides?: Record<string, string>;
}

export function PetCanvas({
  state,
  size = 140,
  activeClients = [],
  prefer3d = true,
  primaryClient,
  mascotOverrides,
}: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FallbackRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef<PetState>(state);
  const agentsRef = useRef<ActiveAgent[]>([]);
  const themeRef = useRef(resolveMascotTheme(primaryClient, mascotOverrides));
  const agentIconsRef = useRef<Record<string, HTMLImageElement>>({});
  const [modelReady, setModelReady] = useState(false);
  const [modelUnavailable, setModelUnavailable] = useState(false);

  stateRef.current = state;
  const theme = resolveMascotTheme(primaryClient, mascotOverrides);
  themeRef.current = theme;

  const useModel3d = prefer3d && size >= 72 && !modelUnavailable;

  const handleModelReady = useCallback(() => {
    setModelReady(true);
  }, []);

  const handleModelUnavailable = useCallback(() => {
    setModelReady(false);
    setModelUnavailable(true);
  }, []);

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

    const sprite = new Image();
    sprite.decoding = "async";
    sprite.onload = () => {
      renderer.setSpriteImage(sprite);
    };
    sprite.onerror = () => {
      renderer.setSpriteImage(null);
    };
    sprite.src = HUMI_SPRITE_SRC;

    const agentIconImages = Object.entries(AGENT_ICON_SRC).map(([id, src]) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        agentIconsRef.current = { ...agentIconsRef.current, [id]: image };
        renderer.setAgentIcons(agentIconsRef.current);
      };
      image.src = src;
      return image;
    });

    let lastTime = performance.now();

    function loop(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      renderer.setState(stateRef.current);
      renderer.setAgents(agentsRef.current);
      renderer.setTheme(themeRef.current);

      const offscreen = renderer.render(dt);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.drawImage(offscreen, 0, 0);

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      sprite.onload = null;
      sprite.onerror = null;
      agentIconImages.forEach((image) => {
        image.onload = null;
      });
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
    <div
      className="relative select-none pointer-events-none"
      style={{ width: size, height: size }}
      data-pet-renderer={useModel3d && modelReady ? "3d" : "2d"}
      data-mascot-theme={theme.id}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 select-none pointer-events-none transition-opacity duration-300"
        style={{ width: size, height: size, opacity: useModel3d && modelReady ? 0 : 1 }}
      />
      {useModel3d && (
        <Suspense fallback={null}>
          <PetModel3D
            state={state}
            size={size}
            activeClients={activeClients}
            onReady={handleModelReady}
            onUnavailable={handleModelUnavailable}
          />
        </Suspense>
      )}
      {theme.id !== "humi" && (
        <span
          className="absolute right-[8%] bottom-[10%] flex items-center justify-center overflow-hidden rounded-full border bg-white/90 font-bold shadow-sm"
          style={{
            width: Math.max(16, size * 0.19),
            height: Math.max(16, size * 0.19),
            borderColor: theme.accent,
            color: theme.accent,
            fontSize: Math.max(7, size * 0.07),
          }}
          title={theme.label}
        >
          {theme.icon ? (
            <img src={theme.icon} alt="" className="h-[72%] w-[72%] object-contain" />
          ) : (
            theme.monogram
          )}
        </span>
      )}
    </div>
  );
}

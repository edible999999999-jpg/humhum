import { useRef, useEffect } from "react";
import { PixiApp } from "@/engine/PixiApp";
import { HumSprite } from "@/engine/HumSprite";
import { Ticker } from "pixi.js";
import type { PetState } from "@/types";

interface PetCanvasProps {
  state: PetState;
  size?: number;
}

export function PetCanvas({ state, size = 140 }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<{ app: PixiApp; hum: HumSprite } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const dpr = window.devicePixelRatio ?? 1;

    (async () => {
      const app = await PixiApp.create(canvas, { size, devicePixelRatio: dpr });
      if (disposed) {
        app.destroy();
        return;
      }

      const hum = new HumSprite(size, dpr);
      app.app.stage.addChild(hum);

      const ticker = app.app.ticker;
      ticker.maxFPS = 30;
      const onTick = (t: Ticker) => {
        hum.tick(t.deltaMS / 1000);
      };
      ticker.add(onTick);

      engineRef.current = { app, hum };
    })();

    return () => {
      disposed = true;
      const engine = engineRef.current;
      if (engine) {
        engine.hum.destroy();
        engine.app.destroy();
        engineRef.current = null;
      }
    };
  }, [size]);

  useEffect(() => {
    engineRef.current?.hum.setState(state);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      className="select-none pointer-events-none"
      style={{ width: size, height: size }}
    />
  );
}

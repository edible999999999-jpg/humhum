import { Application } from "pixi.js";
import { DEFAULT_CONFIG } from "./constants";
import type { EngineConfig } from "./types";

let instance: PixiApp | null = null;

export class PixiApp {
  app: Application;
  private config: EngineConfig;

  private constructor(config: EngineConfig) {
    this.config = config;
    this.app = new Application();
  }

  static async create(
    canvas: HTMLCanvasElement,
    config: Partial<EngineConfig> = {},
  ): Promise<PixiApp> {
    if (instance) {
      instance.destroy();
    }

    const merged = { ...DEFAULT_CONFIG, ...config };
    const pixi = new PixiApp(merged);

    await pixi.app.init({
      canvas,
      width: merged.size,
      height: merged.size,
      resolution: merged.devicePixelRatio,
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: true,
      powerPreference: merged.powerPreference as "low-power" | "high-performance",
      preference: "webgl",
    });

    instance = pixi;
    return pixi;
  }

  resize(size: number) {
    this.config.size = size;
    this.app.renderer.resize(size, size);
  }

  destroy() {
    if (instance === this) instance = null;
    this.app.destroy(false, { children: true });
  }
}

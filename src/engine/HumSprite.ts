import { Container, Sprite, Texture } from "pixi.js";
import { FallbackRenderer } from "./FallbackRenderer";
import { FPS } from "./constants";
import type { PetState, ActiveAgent } from "./types";

export class HumSprite extends Container {
  private fallback: FallbackRenderer;
  private sprite: Sprite;
  private state: PetState = "idle";
  private elapsed = 0;
  private frameInterval: number;
  private dpr: number;

  constructor(size: number, dpr: number) {
    super();
    this.dpr = dpr;
    this.fallback = new FallbackRenderer(size, dpr);
    this.sprite = new Sprite(Texture.EMPTY);
    this.sprite.anchor.set(0, 0);
    this.sprite.width = size;
    this.sprite.height = size;
    this.addChild(this.sprite);
    this.frameInterval = 1 / FPS.idle;
    this.updateTexture(0);
  }

  setState(state: PetState) {
    if (this.state === state) return;
    this.state = state;
    this.fallback.setState(state);
    this.frameInterval = 1 / this.getFps();
    this.elapsed = this.frameInterval;
  }

  setAgents(agents: ActiveAgent[]) {
    this.fallback.setAgents(agents);
  }

  tick(delta: number) {
    this.elapsed += delta;
    if (this.elapsed >= this.frameInterval) {
      this.updateTexture(this.elapsed);
      this.elapsed = 0;
    }
  }

  private updateTexture(dt: number) {
    const rendered = this.fallback.render(dt);

    if (!("transferToImageBitmap" in rendered)) {
      if (this.sprite.texture === Texture.EMPTY) {
        this.sprite.texture = Texture.from({
          resource: rendered,
          resolution: this.dpr,
        });
      } else {
        this.sprite.texture.source.update();
      }
      return;
    }

    const source = rendered.transferToImageBitmap();
    if (this.sprite.texture !== Texture.EMPTY) {
      this.sprite.texture.destroy(true);
    }
    this.sprite.texture = Texture.from({
      resource: source,
      resolution: this.dpr,
    });
  }

  private getFps(): number {
    const active: PetState[] = ["processing", "speaking", "completed", "error", "waiting"];
    return active.includes(this.state) ? FPS.active : FPS.idle;
  }

  override destroy() {
    if (this.sprite.texture !== Texture.EMPTY) {
      this.sprite.texture.destroy(true);
    }
    super.destroy({ children: true });
  }
}

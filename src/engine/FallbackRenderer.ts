import { COLORS, BABY_THRESHOLD } from "./constants";
import { drawAbsorbedAgents } from "./AgentCreatures";
import type { HumColors, PetState, ActiveAgent } from "./types";

export class FallbackRenderer {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private sz: number;
  private time = 0;
  private state: PetState = "idle";
  private agents: ActiveAgent[] = [];
  private spriteImage: CanvasImageSource | null = null;
  private agentIcons: Record<string, CanvasImageSource> = {};

  constructor(size: number, dpr: number) {
    this.sz = size;
    this.canvas = new OffscreenCanvas(size * dpr, size * dpr);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot get 2D context");
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
  }

  setState(state: PetState) {
    this.state = state;
  }

  setAgents(agents: ActiveAgent[]) {
    this.agents = agents;
  }

  setAgentIcons(icons: Record<string, CanvasImageSource>) {
    this.agentIcons = icons;
  }

  setSpriteImage(image: CanvasImageSource | null) {
    this.spriteImage = image;
  }

  render(dt: number): OffscreenCanvas {
    this.time += dt;
    const ctx = this.ctx;
    const sz = this.sz;
    const C = COLORS[this.state] ?? COLORS.idle!;

    ctx.clearRect(0, 0, sz, sz);

    const cx = sz / 2;
    const R = sz * 0.3;
    const dcy = sz * 0.32;
    const dby = dcy + R * 0.82;

    const isJuvenile = this.agents.length >= BABY_THRESHOLD;
    const juvScale = isJuvenile ? 0.65 : 1;

    const floatPhase = this.getFloatPhase();

    ctx.save();
    ctx.translate(0, floatPhase);

    if (isJuvenile) {
      ctx.translate(cx, sz * 0.42);
      ctx.scale(juvScale, juvScale);
      ctx.translate(-cx, -sz * 0.42);
    }

    if (this.spriteImage) {
      this.drawSpritePet(ctx, cx, dcy, dby, R, C, sz);
    }

    ctx.restore();

    return this.canvas;
  }

  private drawSpritePet(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number,
    dcy: number,
    dby: number,
    R: number,
    C: HumColors,
    sz: number,
  ) {
    if (!this.spriteImage) return;

    this.drawShadow(ctx, cx, dby, R);
    this.drawGlow(ctx, cx, dcy + R * 0.18, R * 1.05, C);

    const activePulse =
      this.state === "speaking"
        ? Math.sin(this.time * 7.5) * 0.018
        : this.state === "processing"
          ? Math.sin(this.time * 4.2) * 0.012
          : Math.sin(this.time * 1.7) * 0.008;
    const squash = this.state === "waiting" ? 0.985 : 1 + activePulse;
    const stretch = this.state === "speaking" ? 1 - activePulse * 0.8 : 1;
    const side = sz * 1.08;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(cx, sz * 0.48);
    ctx.scale(squash, stretch);
    ctx.translate(-cx, -sz * 0.48);
    ctx.drawImage(this.spriteImage, (sz - side) / 2, -sz * 0.085, side, side);
    ctx.restore();

    this.drawSpriteStateOverlay(ctx, cx, dcy, R, C);
    this.drawStatusDot(ctx, cx, dcy, R, C);
    drawAbsorbedAgents(ctx, this.agents, cx, dcy, R, sz, this.time, this.agentIcons);
  }

  private drawSpriteStateOverlay(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number,
    dcy: number,
    R: number,
    C: HumColors,
  ) {
    if (this.state === "idle") return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (this.state === "speaking") {
      const alpha = 0.24 + 0.18 * Math.abs(Math.sin(this.time * 7.2));
      ctx.strokeStyle = this.withAlpha(C.g, alpha);
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const x = cx + R * (0.86 + i * 0.16);
        const y = dcy + R * (0.08 + i * 0.16);
        ctx.beginPath();
        ctx.arc(x, y, 3 + i * 2, -Math.PI * 0.35, Math.PI * 0.35);
        ctx.stroke();
      }
    } else if (this.state === "processing") {
      ctx.strokeStyle = this.withAlpha(C.g, 0.28);
      ctx.lineWidth = 2;
      const r = R * (1.08 + 0.06 * Math.sin(this.time * 3.2));
      ctx.beginPath();
      ctx.arc(cx, dcy + R * 0.2, r, this.time * 0.8, this.time * 0.8 + Math.PI * 1.35);
      ctx.stroke();
    } else if (this.state === "waiting") {
      ctx.fillStyle = this.withAlpha("#ffd69e", 0.18 + 0.1 * Math.abs(Math.sin(this.time * 2.8)));
      ctx.beginPath();
      ctx.ellipse(cx, dcy + R * 0.16, R * 0.92, R * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.state === "completed") {
      ctx.fillStyle = this.withAlpha("#7ee7d8", 0.22);
      ctx.beginPath();
      ctx.arc(cx + R * 0.72, dcy - R * 0.52, 5, 0, Math.PI * 2);
      ctx.arc(cx + R * 0.92, dcy - R * 0.32, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.state === "error") {
      ctx.strokeStyle = this.withAlpha("#ff7a93", 0.42);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.16, dcy - R * 0.62);
      ctx.lineTo(cx + R * 0.16, dcy - R * 0.28);
      ctx.moveTo(cx + R * 0.16, dcy - R * 0.62);
      ctx.lineTo(cx - R * 0.16, dcy - R * 0.28);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawShadow(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dby: number, R: number,
  ) {
    const grad = ctx.createRadialGradient(cx, dby + R * 0.95, 0, cx, dby + R * 0.95, R * 1.2);
    grad.addColorStop(0, "rgba(47, 51, 56, 0.14)");
    grad.addColorStop(0.6, "rgba(47, 51, 56, 0.05)");
    grad.addColorStop(1, "rgba(47, 51, 56, 0)");

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, dby + R * 0.92, R * 0.92, R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private getFloatPhase(): number {
    const sc = this.state;
    if (sc === "waiting" || sc === "error") return 0;
    const dur = sc === "processing" ? 2.5 : sc === "speaking" ? 3 : 4;
    return Math.sin((this.time / dur) * Math.PI * 2) * -5;
  }

  private drawGlow(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number, C: HumColors,
  ) {
    let opacity = 0.08;
    if (this.state === "waiting") {
      opacity = 0.05 + 0.11 * Math.abs(Math.sin(this.time * 2.6));
    } else if (this.state === "speaking") {
      opacity = 0.06 + 0.10 * Math.abs(Math.sin(this.time * 3.14));
    }

    const rx = R + 16;
    const ry = R + 8;
    const gy = dcy + 10;
    const grad = ctx.createRadialGradient(cx, gy, 0, cx, gy, Math.max(rx, ry));
    grad.addColorStop(0, this.withAlpha(C.g, opacity));
    grad.addColorStop(0.6, this.withAlpha(C.g, opacity * 0.4));
    grad.addColorStop(1, this.withAlpha(C.g, 0));

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, gy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawStatusDot(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number, C: HumColors,
  ) {
    const alpha = 0.35 + 0.4 * Math.abs(Math.sin(this.time * 1.57));
    ctx.save();
    ctx.fillStyle = C.g;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx + R * 0.72, dcy - R * 0.7, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private withAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}

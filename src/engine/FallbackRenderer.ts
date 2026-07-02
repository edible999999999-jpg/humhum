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

  render(dt: number): OffscreenCanvas {
    this.time += dt;
    const ctx = this.ctx;
    const sz = this.sz;
    const C = COLORS[this.state] ?? COLORS.idle!;

    ctx.clearRect(0, 0, sz, sz);

    const cx = sz / 2;
    const R = sz * 0.26;
    const dcy = sz * 0.28;
    const dby = dcy + R * 0.85;

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

    this.drawGlow(ctx, cx, dcy, R, C);
    this.drawTentacles(ctx, cx, dby + 2, R, C);
    this.drawDome(ctx, cx, R, dcy, dby, C);
    this.drawShimmer(ctx, cx, R, dcy);
    this.drawInnerGlow(ctx, cx, dcy, R, C);
    this.drawBlush(ctx, cx, dcy, R, C);
    this.drawEyes(ctx, cx, dcy - R * 0.06, R * 0.3, C);
    this.drawMouth(ctx, cx, dcy + R * 0.26, C);
    this.drawStatusDot(ctx, cx, dcy, R, C);

    drawAbsorbedAgents(ctx, this.agents, cx, dcy, R, sz, this.time);

    ctx.restore();

    return this.canvas;
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

  private drawDome(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, R: number, dcy: number, dby: number, C: HumColors,
  ) {
    const grad = ctx.createRadialGradient(cx, dcy - R * 0.3, 0, cx, dcy, R * 1.2);
    grad.addColorStop(0, this.withAlpha(C.b1, 0.6));
    grad.addColorStop(0.75, this.withAlpha(C.b2, 0.28));
    grad.addColorStop(1, this.withAlpha(C.b2, 0.06));

    ctx.beginPath();
    ctx.moveTo(cx - R * 0.92, dby);
    ctx.bezierCurveTo(
      cx - R * 1.02, dby - R * 0.4,
      cx - R * 0.92, dcy - R * 0.95,
      cx, dcy - R * 0.95,
    );
    ctx.bezierCurveTo(
      cx + R * 0.92, dcy - R * 0.95,
      cx + R * 1.02, dby - R * 0.4,
      cx + R * 0.92, dby,
    );

    this.drawFrill(ctx, cx, R, dby);

    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = this.withAlpha(C.b1, 0.2);
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Breathing scale pulse
    const pulseStates = ["idle", "inspect", "listening", "speaking", "processing"];
    if (pulseStates.includes(this.state)) {
      const rate = this.state === "speaking" ? 0.8 : this.state === "processing" ? 2 : 3.5;
      const amp = this.state === "speaking" ? 0.04 : this.state === "processing" ? 0.02 : 0.015;
      const _pulse = 1 + Math.sin(this.time / rate * Math.PI * 2) * amp;
      // Pulse is applied implicitly via dome shape — kept for future Rive mapping
    }
  }

  private drawFrill(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, R: number, dby: number,
  ) {
    const frillN = 7;
    const frillW = R * 1.7;
    for (let i = 0; i < frillN; i++) {
      const fx = cx + frillW / 2 - (frillW / frillN) * i;
      const fx2 = fx - frillW / frillN;
      const fh = dby + 3 + (i % 2 === 0 ? 3 : 5);
      ctx.quadraticCurveTo((fx + fx2) / 2, fh, fx2, dby + 1);
    }
    ctx.closePath();
  }

  private drawTentacles(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, by: number, R: number, C: HumColors,
  ) {
    const bw = R * 0.85;
    const offsets = [-0.7, -0.35, 0, 0.35, 0.7];
    const lengths = [38, 48, 52, 48, 38];

    const grad = ctx.createLinearGradient(0, by, 0, by + 55);
    grad.addColorStop(0, this.withAlpha(C.t, 0.55));
    grad.addColorStop(1, this.withAlpha(C.t, 0.03));

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";

    for (let i = 0; i < offsets.length; i++) {
      const x = cx + bw * offsets[i]!;
      const l = lengths[i]!;
      const sw = i % 2 === 0 ? 7 : -7;
      const dur = 4.2 + i * 0.3;
      const phase = Math.sin(this.time / dur * Math.PI * 2);

      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.bezierCurveTo(
        x + sw * 0.4 * phase, by + l * 0.3,
        x + sw * phase, by + l * 0.55,
        x - sw * 0.3 * phase, by + l,
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawShimmer(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, R: number, dcy: number,
  ) {
    const grad = ctx.createRadialGradient(
      cx - R * 0.22, dcy - R * 0.4, 0,
      cx - R * 0.22, dcy - R * 0.4, R * 0.32,
    );
    grad.addColorStop(0, "rgba(255,255,255,0.2)");
    grad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.22, dcy - R * 0.4, R * 0.32, R * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawInnerGlow(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number, C: HumColors,
  ) {
    let alpha = 1;
    if (this.state === "processing") {
      alpha = 0.3 + 0.4 * Math.abs(Math.sin(this.time * 1.57));
    }

    const grad = ctx.createRadialGradient(cx, dcy + 2, 0, cx, dcy + 2, R * 0.38);
    grad.addColorStop(0, this.withAlpha(C.hi, 0.5 * alpha));
    grad.addColorStop(1, this.withAlpha(C.hi, 0));

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, dcy + 2, R * 0.38, R * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBlush(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number, C: HumColors,
  ) {
    if (!["idle", "completed", "listening", "speaking", "inspect"].includes(this.state)) return;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = C.bl;
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.52, dcy + R * 0.18, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.52, dcy + R * 0.18, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawEyes(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, ey: number, sp: number, C: HumColors,
  ) {
    const lx = cx - sp;
    const rx = cx + sp;

    if (this.state === "completed") {
      // Happy arcs
      ctx.save();
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.9;

      for (const x of [lx, rx]) {
        ctx.beginPath();
        ctx.moveTo(x - 4, ey + 1);
        ctx.quadraticCurveTo(x, ey - 4.5, x + 4, ey + 1);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (this.state === "error") {
      // Dizzy spiral + X
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(lx, ey, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(rx - 3, ey - 3);
      ctx.lineTo(rx + 3, ey + 3);
      ctx.moveTo(rx + 3, ey - 3);
      ctx.lineTo(rx - 3, ey + 3);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Blink animation
    const blinkCycle = 5;
    const blinkPhase = (this.time % blinkCycle) / blinkCycle;
    let scaleY = 1;
    if (blinkPhase > 0.46 && blinkPhase < 0.54) {
      const t = (blinkPhase - 0.46) / 0.08;
      scaleY = t < 0.5 ? 1 - t * 2 * 0.89 : 0.11 + (t - 0.5) * 2 * 0.89;
    }

    const r = this.state === "waiting" ? 4.5 : this.state === "processing" ? 2.8 : 3.5;
    const eyeAlpha = this.state === "waiting" ? 0.85 : this.state === "processing" ? 0.75 : 0.85;

    // Processing: subtle vertical bob
    let eyeYOff = 0;
    if (this.state === "processing") {
      eyeYOff = Math.sin(this.time * 1.26) * -1.5;
    }

    ctx.save();
    ctx.fillStyle = C.e;
    ctx.globalAlpha = eyeAlpha;

    for (const x of [lx, rx]) {
      ctx.beginPath();
      ctx.ellipse(x, ey + eyeYOff, r, r * scaleY, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pupils (not for waiting — larger plain eyes)
    if (this.state !== "waiting") {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.globalAlpha = 1;
      const pr = this.state === "processing" ? 1.3 : 1.5;
      for (const x of [lx + 0.3, rx + 0.3]) {
        ctx.beginPath();
        ctx.ellipse(x, ey + 0.5 + eyeYOff, pr, pr * scaleY, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Waiting: centered pupils
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.globalAlpha = 1;
      for (const x of [lx, rx]) {
        ctx.beginPath();
        ctx.arc(x, ey + 0.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Eye highlights (idle-like states)
    if (!["waiting", "processing", "error", "completed"].includes(this.state)) {
      ctx.fillStyle = "white";
      ctx.globalAlpha = 0.5;
      for (const x of [lx - 1, rx - 1]) {
        ctx.beginPath();
        ctx.arc(x, ey - 1.2, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawMouth(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, my: number, C: HumColors,
  ) {
    ctx.save();

    if (this.state === "speaking") {
      const ry = 1 + 3 * Math.abs(Math.sin(this.time * 7.85));
      ctx.fillStyle = C.e;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(cx, my, 3.5, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.state === "completed") {
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(cx - 6, my);
      ctx.quadraticCurveTo(cx, my + 6, cx + 6, my);
      ctx.stroke();
    } else if (this.state === "error") {
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(cx - 3, my + 1);
      ctx.quadraticCurveTo(cx + 1, my - 1, cx + 4, my + 2);
      ctx.stroke();
    } else if (this.state === "waiting") {
      ctx.fillStyle = C.e;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(cx, my, 2.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.state === "processing") {
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, my);
      ctx.lineTo(cx + 3.5, my);
      ctx.stroke();
    } else {
      // idle, listening, inspect
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(cx - 4.5, my);
      ctx.quadraticCurveTo(cx, my + 4, cx + 4.5, my);
      ctx.stroke();
    }

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

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
    } else {
      this.drawShadow(ctx, cx, dby, R);
      this.drawGlow(ctx, cx, dcy, R, C);
      this.drawTentacles(ctx, cx, dby + 2, R, C);
      this.drawDome(ctx, cx, R, dcy, dby, C);
      this.drawGelTexture(ctx, cx, dcy, R, C);
      this.drawHeadset(ctx, cx, dcy, R);
      this.drawShimmer(ctx, cx, R, dcy);
      this.drawInnerGlow(ctx, cx, dcy, R, C);
      this.drawBlush(ctx, cx, dcy, R, C);
      this.drawEyes(ctx, cx, dcy - R * 0.04, R * 0.28, C);
      this.drawMouth(ctx, cx, dcy + R * 0.28, C);
      this.drawStatusDot(ctx, cx, dcy, R, C);

      drawAbsorbedAgents(ctx, this.agents, cx, dcy, R, sz, this.time, this.agentIcons);
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

  private drawDome(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, R: number, dcy: number, dby: number, C: HumColors,
  ) {
    const grad = ctx.createRadialGradient(cx, dcy - R * 0.3, 0, cx, dcy, R * 1.2);
    grad.addColorStop(0, this.withAlpha("#fffdf5", 0.92));
    grad.addColorStop(0.28, this.withAlpha(C.b1, 0.8));
    grad.addColorStop(0.76, this.withAlpha(C.b2, 0.5));
    grad.addColorStop(1, this.withAlpha(C.b2, 0.18));

    ctx.beginPath();
    ctx.moveTo(cx - R * 0.96, dby);
    ctx.bezierCurveTo(
      cx - R * 1.08, dby - R * 0.42,
      cx - R * 0.98, dcy - R * 1.04,
      cx, dcy - R * 0.95,
    );
    ctx.bezierCurveTo(
      cx + R * 0.98, dcy - R * 1.04,
      cx + R * 1.08, dby - R * 0.42,
      cx + R * 0.96, dby,
    );

    this.drawFrill(ctx, cx, R, dby);

    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = this.withAlpha("#ffffff", 0.72);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.strokeStyle = this.withAlpha(C.b2, 0.2);
    ctx.lineWidth = 0.8;
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
    const frillW = R * 1.86;
    for (let i = 0; i < frillN; i++) {
      const fx = cx + frillW / 2 - (frillW / frillN) * i;
      const fx2 = fx - frillW / frillN;
      const fh = dby + 5 + (i % 2 === 0 ? 5 : 8);
      ctx.quadraticCurveTo((fx + fx2) / 2, fh, fx2, dby + 1);
    }
    ctx.closePath();
  }

  private drawTentacles(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, by: number, R: number, C: HumColors,
  ) {
    const bw = R * 0.82;
    const offsets = [-0.68, -0.36, -0.08, 0.22, 0.5, 0.72];
    const lengths = [28, 37, 44, 42, 35, 27];

    const grad = ctx.createLinearGradient(0, by, 0, by + 55);
    grad.addColorStop(0, this.withAlpha("#ffffff", 0.62));
    grad.addColorStop(0.24, this.withAlpha(C.t, 0.8));
    grad.addColorStop(1, this.withAlpha(C.t, 0.1));

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10.5;
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

      ctx.save();
      ctx.strokeStyle = this.withAlpha("#ffffff", 0.35);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - 1.3, by + 3);
      ctx.bezierCurveTo(
        x + sw * 0.22 * phase, by + l * 0.28,
        x + sw * 0.55 * phase, by + l * 0.52,
        x - sw * 0.18 * phase - 1.2, by + l - 6,
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawHeadset(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number,
  ) {
    const topY = dcy - R * 1.02;
    const cupY = dcy - R * 0.2;
    const leftX = cx - R * 0.86;
    const rightX = cx + R * 0.86;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const bandGrad = ctx.createLinearGradient(cx - R, topY, cx + R, topY);
    bandGrad.addColorStop(0, "rgba(71, 62, 70, 0.78)");
    bandGrad.addColorStop(0.5, "rgba(255, 245, 247, 0.92)");
    bandGrad.addColorStop(1, "rgba(71, 62, 70, 0.78)");

    ctx.strokeStyle = "rgba(68, 59, 65, 0.52)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cupY + R * 0.08, R * 0.98, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    ctx.strokeStyle = bandGrad;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(cx, cupY + R * 0.08, R * 0.98, Math.PI * 1.09, Math.PI * 1.91);
    ctx.stroke();

    for (const side of [-1, 1]) {
      const x = side < 0 ? leftX : rightX;
      const cupGrad = ctx.createRadialGradient(x - side * 2, cupY - 4, 0, x, cupY, R * 0.36);
      cupGrad.addColorStop(0, "rgba(255,255,255,0.95)");
      cupGrad.addColorStop(0.35, side < 0 ? "rgba(196,238,244,0.9)" : "rgba(205,194,255,0.9)");
      cupGrad.addColorStop(1, side < 0 ? "rgba(124,201,219,0.78)" : "rgba(151,139,232,0.76)");

      ctx.fillStyle = "rgba(57, 52, 58, 0.38)";
      ctx.beginPath();
      ctx.ellipse(x + side * 1, cupY + 1, R * 0.22, R * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = cupGrad;
      ctx.beginPath();
      ctx.ellipse(x, cupY, R * 0.2, R * 0.31, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(77, 71, 76, 0.75)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(rightX + R * 0.1, cupY + R * 0.15);
    ctx.quadraticCurveTo(cx + R * 1.02, dcy + R * 0.2, cx + R * 0.72, dcy + R * 0.46);
    ctx.stroke();

    const micGrad = ctx.createRadialGradient(cx + R * 0.72, dcy + R * 0.46, 0, cx + R * 0.72, dcy + R * 0.46, R * 0.15);
    micGrad.addColorStop(0, "rgba(255,230,230,1)");
    micGrad.addColorStop(1, "rgba(255,119,126,0.92)");
    ctx.fillStyle = micGrad;
    ctx.beginPath();
    ctx.arc(cx + R * 0.72, dcy + R * 0.46, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  private drawGelTexture(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, dcy: number, R: number, C: HumColors,
  ) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const specks = [
      [-0.36, -0.54, 1.2, 0.22],
      [-0.12, -0.68, 0.9, 0.18],
      [0.24, -0.5, 1.1, 0.16],
      [0.44, -0.18, 0.8, 0.14],
      [-0.48, -0.1, 0.7, 0.12],
      [0.08, 0.05, 1, 0.13],
    ] as const;

    for (const [ox, oy, r, alpha] of specks) {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(cx + R * ox, dcy + R * oy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const gleam = ctx.createLinearGradient(cx - R * 0.7, dcy - R * 0.74, cx + R * 0.58, dcy + R * 0.45);
    gleam.addColorStop(0, "rgba(255,255,255,0)");
    gleam.addColorStop(0.45, "rgba(255,255,255,0.18)");
    gleam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = gleam;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(cx, dcy - R * 0.08, R * 0.58, R * 0.68, -0.22, Math.PI * 1.12, Math.PI * 1.82);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = this.withAlpha(C.hi, 0.14);
    ctx.beginPath();
    ctx.ellipse(cx, dcy + R * 0.42, R * 0.8, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
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
    grad.addColorStop(0, "rgba(255,255,255,0.62)");
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
    grad.addColorStop(0, this.withAlpha(C.hi, 0.34 * alpha));
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
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = C.bl;
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.47, dcy + R * 0.2, 5.2, 3.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.47, dcy + R * 0.2, 5.2, 3.3, 0, 0, Math.PI * 2);
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
      ctx.save();
      ctx.strokeStyle = C.e;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.9;

      for (const x of [lx, rx]) {
        ctx.beginPath();
        ctx.moveTo(x - 5, ey - 1);
        ctx.quadraticCurveTo(x, ey + 4, x + 5, ey - 1);
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

    const r = this.state === "idle" ? 5.1 : this.state === "waiting" ? 4.5 : this.state === "processing" ? 2.8 : 4.2;
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
      const pr = this.state === "idle" ? 2.1 : this.state === "processing" ? 1.3 : 1.5;
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
      ctx.globalAlpha = this.state === "idle" ? 0.75 : 0.5;
      for (const x of [lx - 1, rx - 1]) {
        ctx.beginPath();
        ctx.arc(x - 0.8, ey - 1.3, this.state === "idle" ? 1.2 : 0.9, 0, Math.PI * 2);
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
    } else if (this.state === "idle") {
      ctx.fillStyle = C.e;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(cx, my, 4.4, 5.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.beginPath();
      ctx.ellipse(cx - 1.2, my - 1.4, 1.5, 1, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // listening, inspect
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

import { AGENT_COLORS } from "./constants";
import type { AgentCreatureColors, ActiveAgent } from "./types";

function getColors(id: string): AgentCreatureColors {
  return AGENT_COLORS[id] ?? { light: "#94a3b8", med: "#64748b", dark: "#475569" };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function drawAbsorbedAgents(
  ctx: OffscreenCanvasRenderingContext2D,
  agents: ActiveAgent[],
  cx: number,
  dcy: number,
  R: number,
  sz: number,
  time: number,
  icons: Record<string, CanvasImageSource> = {},
) {
  if (agents.length === 0) return;

  const n = agents.length;
  const creatureS = sz < 80 ? sz * 0.06 : sz >= 140 ? sz * 0.09 : sz * 0.07;

  agents.forEach((agent, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dist = n === 1 ? 0 : R * (0.28 + n * 0.025);
    const ax = cx + Math.cos(angle) * dist;
    const ay = dcy - R * 0.05 + Math.sin(angle) * dist * 0.5;

    const dx = 1.5 + (i * 0.7 + 0.3);
    const dy = 1.2 + (i * 0.5 + 0.2);
    const driftT = time / (4 + i * 0.5);
    const phase = driftT * Math.PI * 2;
    const offsetX = Math.sin(phase) * dx;
    const offsetY = Math.cos(phase * 0.7) * dy;

    ctx.save();
    ctx.translate(offsetX, offsetY);

    const icon = icons[agent.id];
    if (sz >= 80 && icon) {
      ctx.globalAlpha = 0.58;
      drawLogoBubble(ctx, icon, ax, ay, creatureS * 1.7, agent.color);
    } else if (sz >= 80) {
      ctx.globalAlpha = 0.35;
      drawCreature(ctx, agent.id, ax, ay, creatureS * 2, agent.color);
    } else {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = hexToRgba(agent.color, 0.5);
      ctx.beginPath();
      ctx.arc(ax, ay, creatureS, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });
}

function drawLogoBubble(
  ctx: OffscreenCanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  s: number,
  color: string,
) {
  const r = s * 0.5;
  const iconSize = s * 0.58;

  ctx.save();
  ctx.shadowColor = hexToRgba(color, 0.4);
  ctx.shadowBlur = r * 0.55;
  ctx.fillStyle = hexToRgba(color, 0.2);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const glass = ctx.createRadialGradient(x - r * 0.28, y - r * 0.35, r * 0.1, x, y, r);
  glass.addColorStop(0, "rgba(255,255,255,0.58)");
  glass.addColorStop(0.5, "rgba(255,255,255,0.2)");
  glass.addColorStop(1, "rgba(255,255,255,0.08)");
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = hexToRgba(color, 0.42);
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.08, Math.PI * 0.12, Math.PI * 1.42);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.26, y - r * 0.34, r * 0.17, r * 0.08, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCreature(
  ctx: OffscreenCanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  s: number,
  color: string,
) {
  const c = getColors(id);
  const r = s * 0.5;
  const eR = s * 0.055;
  const hR = s * 0.03;

  switch (id) {
    case "claude-code":
      drawFireShrimp(ctx, x, y, r, eR, hR, c);
      break;
    case "codex":
      drawCloudPuff(ctx, x, y, r, s, eR, hR, c);
      break;
    case "qwen-code":
      drawBlueSeahorse(ctx, x, y, r, s, eR, hR, c);
      break;
    case "gemini-cli":
      drawCrystalStarfish(ctx, x, y, r, s, eR, c);
      break;
    case "kimi-k1":
      drawMoonJelly(ctx, x, y, r, s, eR, hR, c);
      break;
    case "qoderwork":
      drawCoralPolyp(ctx, x, y, r, s, eR, hR, c);
      break;
    default:
      ctx.fillStyle = hexToRgba(color, 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawFireShrimp(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number,
  eR: number, hR: number,
  c: AgentCreatureColors,
) {
  // Body: plump C-curve
  ctx.save();
  ctx.fillStyle = hexToRgba(c.med, 0.65);
  ctx.strokeStyle = hexToRgba(c.dark, 0.2);
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, y - r * 0.55);
  ctx.bezierCurveTo(x - r * 0.1, y - r * 0.55, x - r * 0.55, y - r * 0.3, x - r * 0.45, y + r * 0.05);
  ctx.bezierCurveTo(x - r * 0.35, y + r * 0.4, x - r * 0.05, y + r * 0.6, x + r * 0.3, y + r * 0.45);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Belly highlight
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.25);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.15, y, r * 0.2, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Segment lines
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.dark, 0.3);
  ctx.lineWidth = r * 0.03;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y - r * 0.08);
  ctx.quadraticCurveTo(x - r * 0.15, y - r * 0.15, x + r * 0.05, y - r * 0.2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(c.dark, 0.25);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.38, y + r * 0.15);
  ctx.quadraticCurveTo(x - r * 0.1, y + r * 0.08, x + r * 0.12, y + r * 0.03);
  ctx.stroke();
  ctx.restore();

  // Antennae
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.med, 0.6);
  ctx.lineWidth = r * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, y - r * 0.55);
  ctx.quadraticCurveTo(x + r * 0.35, y - r * 0.8, x + r * 0.55, y - r * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, y - r * 0.55);
  ctx.quadraticCurveTo(x + r * 0.45, y - r * 0.7, x + r * 0.65, y - r * 0.6);
  ctx.stroke();
  ctx.restore();

  // Antenna tips
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.8);
  ctx.beginPath();
  ctx.arc(x + r * 0.55, y - r * 0.85, hR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.65, y - r * 0.6, hR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tail fan
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.35);
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + r * 0.3, y + r * 0.45);
  ctx.lineTo(x + r * 0.55, y + r * 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.3, y + r * 0.45);
  ctx.lineTo(x + r * 0.55, y + r * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.3, y + r * 0.45);
  ctx.lineTo(x + r * 0.5, y + r * 0.6);
  ctx.stroke();
  ctx.restore();

  // Eye
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x + r * 0.05, y - r * 0.4, eR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.dark, 0.7);
  ctx.beginPath();
  ctx.arc(x + r * 0.06, y - r * 0.38, eR * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(x + r * 0.02, y - r * 0.43, eR * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Blush
  ctx.save();
  ctx.fillStyle = "rgba(253,164,175,0.2)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.08, y - r * 0.28, r * 0.06, r * 0.036, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloudPuff(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number, s: number,
  eR: number, hR: number,
  c: AgentCreatureColors,
) {
  // Main body (3 overlapping ellipses)
  ctx.save();
  ctx.fillStyle = hexToRgba(c.med, 0.5);
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.08, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.light, 0.42);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.22, y - r * 0.18, r * 0.32, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.med, 0.38);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.2, y - r * 0.12, r * 0.28, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner fluff
  ctx.save();
  ctx.fillStyle = "rgba(220,252,231,0.15)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.1, y - r * 0.05, r * 0.18, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyes
  const elx = x - r * 0.16, erx = x + r * 0.16, eey = y + r * 0.02;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(elx, eey, eR * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(erx, eey, eR * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba(c.dark, 0.65);
  ctx.beginPath();
  ctx.arc(elx + hR * 0.3, eey + hR * 0.4, eR * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(erx + hR * 0.3, eey + hR * 0.4, eR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Star highlights
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(elx - hR * 0.3, eey - hR * 0.5, hR * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(erx - hR * 0.3, eey - hR * 0.5, hR * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cat mouth ω
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.dark, 0.4);
  ctx.lineWidth = s * 0.018;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.1, y + r * 0.22);
  ctx.quadraticCurveTo(x - r * 0.03, y + r * 0.3, x, y + r * 0.22);
  ctx.quadraticCurveTo(x + r * 0.03, y + r * 0.3, x + r * 0.1, y + r * 0.22);
  ctx.stroke();
  ctx.restore();

  // Droplets
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.3);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.15, y + r * 0.55, s * 0.015, s * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.light, 0.25);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.1, y + r * 0.6, s * 0.012, s * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBlueSeahorse(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number, s: number,
  eR: number, hR: number,
  c: AgentCreatureColors,
) {
  // Body S-curve
  ctx.save();
  ctx.fillStyle = hexToRgba(c.med, 0.6);
  ctx.strokeStyle = hexToRgba(c.dark, 0.15);
  ctx.lineWidth = s * 0.015;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.05, y - r * 0.65);
  ctx.bezierCurveTo(x + r * 0.35, y - r * 0.55, x + r * 0.3, y - r * 0.15, x + r * 0.1, y + r * 0.05);
  ctx.bezierCurveTo(x - r * 0.15, y + r * 0.3, x - r * 0.2, y + r * 0.5, x - r * 0.05, y + r * 0.6);
  ctx.bezierCurveTo(x + r * 0.15, y + r * 0.7, x + r * 0.25, y + r * 0.65, x + r * 0.15, y + r * 0.75);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Lighter belly
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.2);
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + r * 0.15, y - r * 0.2);
  ctx.bezierCurveTo(x + r * 0.25, y, x + r * 0.15, y + r * 0.2, x + r * 0.05, y + r * 0.35);
  ctx.stroke();
  ctx.restore();

  // Belly rings
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.25);
  ctx.lineWidth = s * 0.01;
  for (let i = 0; i < 4; i++) {
    const ry2 = y - r * 0.1 + i * r * 0.15;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.05 + i * r * 0.02, ry2);
    ctx.lineTo(x + r * 0.2 - i * r * 0.02, ry2);
    ctx.stroke();
  }
  ctx.restore();

  // Crown
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.65);
  ctx.lineWidth = s * 0.02;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.1, y - r * 0.6);
  ctx.lineTo(x, y - r * 0.8);
  ctx.lineTo(x + r * 0.1, y - r * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.05, y - r * 0.62);
  ctx.lineTo(x - r * 0.12, y - r * 0.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.05, y - r * 0.62);
  ctx.lineTo(x + r * 0.12, y - r * 0.75);
  ctx.stroke();
  ctx.restore();

  // Dorsal fin
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.2);
  ctx.translate(x - r * 0.15, y + r * 0.1);
  ctx.rotate(-15 * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.08, r * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eye
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y - r * 0.4, eR * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.dark, 0.7);
  ctx.beginPath();
  ctx.arc(x + r * 0.22, y - r * 0.38, eR * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(x + r * 0.18, y - r * 0.43, hR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Lash line
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.dark, 0.3);
  ctx.lineWidth = s * 0.012;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.1, y - r * 0.48);
  ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.52, x + r * 0.3, y - r * 0.47);
  ctx.stroke();
  ctx.restore();
}

function drawCrystalStarfish(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number, s: number,
  eR: number,
  c: AgentCreatureColors,
) {
  // Rounded star body (2 overlapping ellipses in cross)
  ctx.save();
  ctx.fillStyle = hexToRgba(c.med, 0.5);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.25, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.6, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Center glow
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.4);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Arm tip circles
  const tips: [number, number][] = [
    [0, -r * 0.55], [0, r * 0.55], [-r * 0.55, 0], [r * 0.55, 0],
  ];
  ctx.save();
  ctx.fillStyle = hexToRgba(c.dark, 0.25);
  for (const [dx, dy] of tips) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Facet lines
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.2);
  ctx.lineWidth = s * 0.01;
  const lines: [number, number, number, number][] = [
    [0, -r * 0.2, 0, -r * 0.5],
    [0, r * 0.2, 0, r * 0.5],
    [-r * 0.2, 0, -r * 0.5, 0],
    [r * 0.2, 0, r * 0.5, 0],
  ];
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x + x1, y + y1);
    ctx.lineTo(x + x2, y + y2);
    ctx.stroke();
  }
  ctx.restore();

  // Eyes
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y - r * 0.06, eR * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.12, y - r * 0.06, eR * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.dark, 0.6);
  ctx.beginPath();
  ctx.arc(x - r * 0.11, y - r * 0.04, eR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.13, y - r * 0.04, eR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Smile
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.dark, 0.4);
  ctx.lineWidth = s * 0.015;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.08, y + r * 0.1);
  ctx.quadraticCurveTo(x, y + r * 0.18, x + r * 0.08, y + r * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawMoonJelly(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number, s: number,
  eR: number, hR: number,
  c: AgentCreatureColors,
) {
  // Crescent body
  ctx.save();
  ctx.fillStyle = hexToRgba(c.med, 0.5);
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y, r * 0.55, -Math.PI / 2, Math.PI * 1.5);
  ctx.arc(x + r * 0.35, y, r * 0.35, Math.PI * 1.5, -Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Inner lighter
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.25);
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y, r * 0.35, -Math.PI / 3, Math.PI * 1.33);
  ctx.arc(x + r * 0.3, y, r * 0.25, Math.PI * 1.33, -Math.PI / 3, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Swirl texture
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.light, 0.12);
  ctx.lineWidth = s * 0.01;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.15, y - r * 0.15);
  ctx.quadraticCurveTo(x - r * 0.3, y + r * 0.1, x - r * 0.1, y + r * 0.2);
  ctx.stroke();
  ctx.restore();

  // Sleepy eye (big round + half-lid)
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(x - r * 0.05, y, eR * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.dark, 0.7);
  ctx.beginPath();
  ctx.arc(x - r * 0.03, y + eR * 0.15, eR * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Sleepy lid (covers top)
  ctx.fillStyle = hexToRgba(c.med, 0.55);
  ctx.beginPath();
  ctx.arc(x - r * 0.05, y, eR * 1.1, Math.PI, 0);
  ctx.lineTo(x - r * 0.05 + eR * 1.1, y - eR * 0.3);
  ctx.arc(x - r * 0.05, y - eR * 0.3, eR * 1.1, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();

  // Lash
  ctx.strokeStyle = hexToRgba(c.dark, 0.3);
  ctx.lineWidth = s * 0.012;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.05 - eR * 0.9, y - eR * 0.55);
  ctx.quadraticCurveTo(x - r * 0.05, y - eR * 0.85, x - r * 0.05 + eR * 0.9, y - eR * 0.45);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x - r * 0.08, y - eR * 0.3, hR * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tiny peaceful mouth
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.dark, 0.3);
  ctx.lineWidth = s * 0.012;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.1, y + r * 0.18);
  ctx.quadraticCurveTo(x - r * 0.03, y + r * 0.22, x + r * 0.02, y + r * 0.17);
  ctx.stroke();
  ctx.restore();

  // Crescent tip glows
  ctx.save();
  ctx.fillStyle = hexToRgba(c.light, 0.3);
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y - r * 0.48, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y + r * 0.48, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Star companions
  drawStar(ctx, x + r * 0.6, y - r * 0.3, r * 0.08, hexToRgba(c.light, 0.45));
  drawStar(ctx, x + r * 0.5, y + r * 0.55, r * 0.06, hexToRgba(c.light, 0.35));
}

function drawStar(
  ctx: OffscreenCanvasRenderingContext2D,
  sx: number, sy: number, sr: number,
  fill: string,
) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const d = i % 2 === 0 ? sr : sr * 0.4;
    const px = sx + Math.cos(a) * d;
    const py = sy + Math.sin(a) * d;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCoralPolyp(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, r: number, s: number,
  eR: number, hR: number,
  c: AgentCreatureColors,
) {
  // Stem
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.med, 0.65);
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.55);
  ctx.bezierCurveTo(x, y + r * 0.3, x, y + r * 0.05, x, y - r * 0.1);
  ctx.stroke();
  ctx.restore();

  // Stem texture bumps
  ctx.save();
  ctx.fillStyle = hexToRgba(c.dark, 0.15);
  ctx.beginPath();
  ctx.arc(x - r * 0.08, y + r * 0.2, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(c.dark, 0.12);
  ctx.beginPath();
  ctx.arc(x + r * 0.06, y + r * 0.35, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Branches
  const branchData: [number, number, number, number, number, number, number][] = [
    // left branch
    [x, y - r * 0.1, x - r * 0.15, y - r * 0.2, x - r * 0.3, y - r * 0.35, x - r * 0.38],
    // right branch
    [x, y - r * 0.1, x + r * 0.15, y - r * 0.2, x + r * 0.3, y - r * 0.35, x + r * 0.38],
  ];
  ctx.save();
  ctx.strokeStyle = hexToRgba(c.med, 0.6);
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = "round";
  for (const [sx, sy, cx1, cy1, cx2, cy2, ex] of branchData) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, ex, y - r * 0.5);
    ctx.stroke();
  }
  // Center branch (taller)
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.1);
  ctx.bezierCurveTo(x, y - r * 0.3, x, y - r * 0.5, x, y - r * 0.65);
  ctx.stroke();
  ctx.restore();

  // Tip bulbs with petals
  const tips2: [number, number][] = [
    [x - r * 0.38, y - r * 0.5],
    [x + r * 0.38, y - r * 0.5],
    [x, y - r * 0.65],
  ];
  tips2.forEach(([tx, ty], ti) => {
    ctx.save();
    ctx.fillStyle = hexToRgba(c.light, 0.3);
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // 3 petals per tip
    for (let p = 0; p < 3; p++) {
      const pa = -Math.PI / 2 + (p * Math.PI * 2) / 3;
      ctx.fillStyle = hexToRgba(c.light, 0.35);
      ctx.save();
      ctx.translate(tx + Math.cos(pa) * r * 0.1, ty + Math.sin(pa) * r * 0.1);
      ctx.rotate(pa);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.05, r * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Tip face (only on center tip)
    if (ti === 2) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(tx - r * 0.05, ty, eR * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx + r * 0.05, ty, eR * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexToRgba(c.dark, 0.55);
      ctx.beginPath();
      ctx.arc(tx - r * 0.04, ty + eR * 0.1, eR * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx + r * 0.06, ty + eR * 0.1, eR * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

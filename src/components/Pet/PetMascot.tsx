import { useRef, useMemo } from "react";

interface PetMascotProps {
  state: string;
  size?: number;
}

export function PetMascot({ state, size = 140 }: PetMascotProps) {
  const idRef = useRef("h" + Math.random().toString(36).slice(2, 7));
  const svg = useMemo(
    () => generateHum(state, size, idRef.current),
    [state, size]
  );

  return (
    <div
      className="select-none pointer-events-none"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

type Colors = {
  b1: string; b2: string; hi: string; t: string;
  g: string; e: string; bl: string;
};

const COLORS: Record<string, Colors> = {
  idle:       { b1: "#818cf8", b2: "#6366f1", hi: "#a5b4fc", t: "#8b5cf6", g: "#6366f1", e: "#eef2ff", bl: "#c7d2fe" },
  processing: { b1: "#60a5fa", b2: "#3b82f6", hi: "#93c5fd", t: "#2563eb", g: "#3b82f6", e: "#dbeafe", bl: "#bfdbfe" },
  speaking:   { b1: "#a78bfa", b2: "#7c3aed", hi: "#c4b5fd", t: "#6d28d9", g: "#8b5cf6", e: "#ede9fe", bl: "#ddd6fe" },
  inspect:    { b1: "#818cf8", b2: "#6366f1", hi: "#a5b4fc", t: "#8b5cf6", g: "#6366f1", e: "#eef2ff", bl: "#c7d2fe" },
  listening:  { b1: "#34d399", b2: "#059669", hi: "#6ee7b7", t: "#047857", g: "#10b981", e: "#d1fae5", bl: "#a7f3d0" },
  waiting:    { b1: "#fbbf24", b2: "#d97706", hi: "#fde68a", t: "#b45309", g: "#f59e0b", e: "#fef9c3", bl: "#fde68a" },
  completed:  { b1: "#34d399", b2: "#059669", hi: "#6ee7b7", t: "#047857", g: "#10b981", e: "#d1fae5", bl: "#a7f3d0" },
  error:      { b1: "#f9a8d4", b2: "#ec4899", hi: "#fbcfe8", t: "#db2777", g: "#f472b6", e: "#fce7f3", bl: "#fbcfe8" },
};

function smoothDome(cx: number, R: number, dcy: number, dby: number): string {
  return `M ${cx - R * 0.92} ${dby}
    C ${cx - R * 1.02} ${dby - R * 0.4} ${cx - R * 0.92} ${dcy - R * 0.95} ${cx} ${dcy - R * 0.95}
    C ${cx + R * 0.92} ${dcy - R * 0.95} ${cx + R * 1.02} ${dby - R * 0.4} ${cx + R * 0.92} ${dby}`;
}

function generateDome(sc: string, cx: number, R: number, dcy: number, dby: number): string {
  if (sc === "completed") {
    const bumpN = 5, bumpH = R * 0.16;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= bumpN * 2; i++) {
      const a = Math.PI * 0.85 - (Math.PI * 0.7 / (bumpN * 2)) * i;
      const extra = i % 2 === 1 ? bumpH : 0;
      pts.push({ x: cx + (R * 1.08 + extra) * Math.cos(a), y: dcy - (R * 1.08 + extra) * Math.sin(a) });
    }
    let d = `M ${cx - R * 0.92} ${dby}`;
    d += ` C ${cx - R * 1.05} ${dby - R * 0.4} ${cx - R * 1.08} ${dcy - R * 0.5} ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!, p1 = pts[i + 1]!;
      const cpy = Math.min(p0.y, p1.y) - (i % 2 === 0 ? bumpH * 0.6 : -bumpH * 0.15);
      d += ` Q ${(p0.x + p1.x) / 2} ${cpy} ${p1.x} ${p1.y}`;
    }
    d += ` C ${cx + R * 1.08} ${dcy - R * 0.5} ${cx + R * 1.05} ${dby - R * 0.4} ${cx + R * 0.92} ${dby}`;
    return d;
  }
  if (sc === "waiting") {
    const sq = 0.92;
    return `M ${cx - R * sq} ${dby + 2}
      C ${cx - R * sq} ${dby - R * 0.3} ${cx - R * 0.8} ${dcy - R * 0.75} ${cx} ${dcy - R * 0.72}
      C ${cx + R * 0.8} ${dcy - R * 0.75} ${cx + R * sq} ${dby - R * 0.3} ${cx + R * sq} ${dby + 2}`;
  }
  if (sc === "error") {
    return `M ${cx - R * 0.88} ${dby + 1}
      C ${cx - R * 0.9} ${dby - R * 0.3} ${cx - R * 0.75} ${dcy - R * 0.9} ${cx + R * 0.05} ${dcy - R * 0.88}
      C ${cx + R * 0.85} ${dcy - R * 0.82} ${cx + R * 0.95} ${dby - R * 0.25} ${cx + R * 0.92} ${dby + 2}`;
  }
  return smoothDome(cx, R, dcy, dby);
}

function generateFrill(cx: number, R: number, dby: number): string {
  const frillN = 7, frillW = R * 1.7;
  let frill = "";
  for (let i = 0; i < frillN; i++) {
    const fx = cx + frillW / 2 - (frillW / frillN) * i;
    const fx2 = fx - frillW / frillN;
    const fh = dby + 3 + (i % 2 === 0 ? 3 : 5);
    frill += ` Q ${(fx + fx2) / 2} ${fh} ${fx2} ${dby + 1}`;
  }
  return frill + " Z";
}

function generateTentacles(sc: string, cx: number, by: number, R: number, C: Colors, u: string): string {
  const tg = `url(#${u}tg)`, bw = R * 0.85;

  if (sc === "idle") {
    const xs = [-0.7, -0.35, 0, 0.35, 0.7].map(r => cx + bw * r);
    const ls = [38, 48, 52, 48, 38];
    return xs.map((x, i) => {
      const sw = i % 2 === 0 ? 7 : -7;
      const d = 4.2 + i * 0.3, l = ls[i]!;
      return `<path fill="none" stroke="${tg}" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="d" values="M ${x} ${by} C ${x + sw * 0.4} ${by + l * 0.3} ${x + sw} ${by + l * 0.55} ${x - sw * 0.3} ${by + l};M ${x} ${by} C ${x - sw * 0.4} ${by + l * 0.3} ${x - sw} ${by + l * 0.55} ${x + sw * 0.3} ${by + l};M ${x} ${by} C ${x + sw * 0.4} ${by + l * 0.3} ${x + sw} ${by + l * 0.55} ${x - sw * 0.3} ${by + l}" dur="${d}s" repeatCount="indefinite"/>
      </path>`;
    }).join("");
  }

  if (sc === "processing") {
    const xs = [-0.55, -0.28, 0, 0.28, 0.55].map(r => cx + bw * r);
    return xs.map((x, i) => {
      const tx = cx + (i < 2 ? 7 : i > 2 ? -7 : 0), l = 32 + Math.abs(2 - i) * 3 as number;
      return `<path fill="none" stroke="${tg}" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="d" values="M ${x} ${by} C ${x} ${by + l * 0.35} ${tx + 5} ${by + l * 0.6} ${tx + 3} ${by + l};M ${x} ${by} C ${(x + tx) / 2} ${by + l * 0.3} ${tx - 5} ${by + l * 0.55} ${tx - 3} ${by + l - 2};M ${x} ${by} C ${x} ${by + l * 0.35} ${tx + 5} ${by + l * 0.6} ${tx + 3} ${by + l}" dur="2s" repeatCount="indefinite"/>
      </path>`;
    }).join("") +
      [0, 1, 2].map(i => `<circle r="2" fill="${C.hi}" opacity="0">
        <animate attributeName="cx" values="${cx - 8 + i * 8};${cx + 3 - i * 3};${cx - 8 + i * 8}" dur="1.8s" repeatCount="indefinite" begin="${i * 0.5}s"/>
        <animate attributeName="cy" values="${by + 30};${by + 8};${by + 30}" dur="1.8s" repeatCount="indefinite" begin="${i * 0.5}s"/>
        <animate attributeName="opacity" values="0;0.8;0" dur="1.8s" repeatCount="indefinite" begin="${i * 0.5}s"/>
      </circle>`).join("");
  }

  if (sc === "speaking") {
    const xs = [-0.7, -0.35, 0, 0.35, 0.7].map(r => cx + bw * r);
    const exs = [-1.1, -0.55, 0, 0.55, 1.1].map(r => cx + bw * r);
    const ls = [30, 36, 40, 36, 30];
    return xs.map((x, i) => {
      const ex = exs[i]!, l = ls[i]!;
      return `<path fill="none" stroke="${tg}" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="d" values="M ${x} ${by} C ${(x + ex) / 2} ${by + l * 0.35} ${ex} ${by + l * 0.65} ${ex} ${by + l};M ${x} ${by} C ${(x + ex) / 2 + 2} ${by + l * 0.3} ${ex + 3} ${by + l * 0.6} ${ex + 3} ${by + l - 2};M ${x} ${by} C ${(x + ex) / 2} ${by + l * 0.35} ${ex} ${by + l * 0.65} ${ex} ${by + l}" dur="1.5s" repeatCount="indefinite"/>
      </path>`;
    }).join("");
  }

  if (sc === "inspect") {
    const idle = [-0.65, -0.33, 0, 0.33].map(r => cx + bw * r).map((x, i) => {
      const sw = i % 2 === 0 ? 4 : -4;
      return `<path fill="none" stroke="${tg}" stroke-width="2" stroke-linecap="round" opacity="0.4">
        <animate attributeName="d" values="M ${x} ${by} C ${x + sw} ${by + 12} ${x + sw * 1.2} ${by + 22} ${x - sw * 0.2} ${by + 30};M ${x} ${by} C ${x - sw} ${by + 12} ${x - sw * 1.2} ${by + 22} ${x + sw * 0.2} ${by + 30};M ${x} ${by} C ${x + sw} ${by + 12} ${x + sw * 1.2} ${by + 22} ${x - sw * 0.2} ${by + 30}" dur="${4.5 + i * 0.3}s" repeatCount="indefinite"/>
      </path>`;
    }).join("");
    const tx = cx + bw * 0.65, ox = tx + 20, oy = by + 16;
    return idle + `
      <path fill="none" stroke="${C.t}" stroke-width="2.5" stroke-linecap="round" opacity="0.6">
        <animate attributeName="d" values="M ${tx} ${by} C ${tx + 10} ${by + 4} ${ox - 4} ${oy - 10} ${ox - 1} ${oy - 5} S ${ox + 5} ${oy + 3} ${ox} ${oy + 7};M ${tx} ${by} C ${tx + 12} ${by + 3} ${ox - 3} ${oy - 11} ${ox} ${oy - 6} S ${ox + 6} ${oy + 2} ${ox + 1} ${oy + 6};M ${tx} ${by} C ${tx + 10} ${by + 4} ${ox - 4} ${oy - 10} ${ox - 1} ${oy - 5} S ${ox + 5} ${oy + 3} ${ox} ${oy + 7}" dur="3s" repeatCount="indefinite"/>
      </path>
      <circle cx="${ox}" cy="${oy}" r="8" fill="#f97316" opacity="0.6"><animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite"/></circle>
      <circle cx="${ox}" cy="${oy}" r="11" fill="none" stroke="#f97316" stroke-width="0.7" opacity="0.2"><animate attributeName="r" values="11;14;11" dur="2s" repeatCount="indefinite"/></circle>
      <text x="${ox}" y="${oy + 3}" text-anchor="middle" font-size="7" fill="white" font-weight="700" opacity="0.85">C</text>`;
  }

  if (sc === "listening") {
    const idle = [-0.6, -0.28, 0, 0.3].map(r => cx + bw * r).map((x, i) => `
      <path fill="none" stroke="${tg}" stroke-width="2" stroke-linecap="round" opacity="0.4">
        <animate attributeName="d" values="M ${x} ${by} C ${x + 2} ${by + 12} ${x - 1} ${by + 22} ${x + 1} ${by + 30};M ${x} ${by} C ${x - 1} ${by + 12} ${x + 2} ${by + 22} ${x - 1} ${by + 30};M ${x} ${by} C ${x + 2} ${by + 12} ${x - 1} ${by + 22} ${x + 1} ${by + 30}" dur="5s" repeatCount="indefinite"/>
      </path>`).join("");
    const mx = cx + bw * 0.72, my = by + 34;
    return idle + `
      <path fill="none" stroke="${C.t}" stroke-width="2.5" stroke-linecap="round" opacity="0.6">
        <animate attributeName="d" values="M ${mx} ${by} C ${mx + 6} ${by + 10} ${mx + 9} ${by + 20} ${mx + 9} ${my - 4};M ${mx} ${by} C ${mx + 7} ${by + 8} ${mx + 11} ${by + 18} ${mx + 11} ${my - 6};M ${mx} ${by} C ${mx + 6} ${by + 10} ${mx + 9} ${by + 20} ${mx + 9} ${my - 4}" dur="2.5s" repeatCount="indefinite"/>
      </path>
      <circle cx="${mx + 9}" cy="${my - 3}" r="4" fill="${C.g}" opacity="0.5"><animate attributeName="opacity" values="0.3;0.85;0.3" dur="1s" repeatCount="indefinite"/><animate attributeName="r" values="3.5;4.5;3.5" dur="1s" repeatCount="indefinite"/></circle>`;
  }

  if (sc === "waiting") {
    const xs = [-0.45, -0.15, 0.15, 0.45].map(r => cx + bw * r);
    const cur = xs.map((x, i) => {
      const d = i < 2 ? 1 : -1;
      return `<path fill="none" stroke="${tg}" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="d" values="M ${x} ${by} C ${x + d * 6} ${by + 5} ${x + d * 10} ${by + 9} ${x + d * 6} ${by + 13};M ${x} ${by} C ${x + d * 7} ${by + 4} ${x + d * 11} ${by + 8} ${x + d * 7} ${by + 12};M ${x} ${by} C ${x + d * 6} ${by + 5} ${x + d * 10} ${by + 9} ${x + d * 6} ${by + 13}" dur="1.5s" repeatCount="indefinite"/>
      </path>`;
    }).join("");
    const cy2 = by + 32;
    return cur + `
      <path fill="none" stroke="${C.t}" stroke-width="2.2" stroke-linecap="round" opacity="0.5">
        <animate attributeName="d" values="M ${cx} ${by} C ${cx} ${by + 10} ${cx} ${by + 18} ${cx} ${cy2 - 8};M ${cx} ${by} C ${cx + 1} ${by + 9} ${cx + 1} ${by + 17} ${cx + 1} ${cy2 - 9};M ${cx} ${by} C ${cx} ${by + 10} ${cx} ${by + 18} ${cx} ${cy2 - 8}" dur="1.8s" repeatCount="indefinite"/>
      </path>
      <rect x="${cx - 11}" y="${cy2 - 5}" width="22" height="14" rx="3" fill="${C.b2}" opacity="0.3" stroke="${C.g}" stroke-width="0.7" stroke-opacity="0.35"><animate attributeName="opacity" values="0.2;0.4;0.2" dur="1.2s" repeatCount="indefinite"/></rect>
      <line x1="${cx - 6}" y1="${cy2 + 1}" x2="${cx + 6}" y2="${cy2 + 1}" stroke="${C.hi}" stroke-width="0.6" opacity="0.35"/>
      <line x1="${cx - 6}" y1="${cy2 + 4}" x2="${cx + 3}" y2="${cy2 + 4}" stroke="${C.hi}" stroke-width="0.4" opacity="0.2"/>`;
  }

  if (sc === "completed") {
    const angs = [-55, -28, 0, 28, 55];
    const xs0 = [-0.6, -0.3, 0, 0.3, 0.6].map(r => cx + bw * r);
    return angs.map((deg, i) => {
      const rad = deg * Math.PI / 180, l = 42;
      const ex = cx + Math.sin(rad) * l, ey = by + Math.cos(rad) * l, x = xs0[i]!;
      return `<path fill="none" stroke="${tg}" stroke-width="2.2" stroke-linecap="round">
        <animate attributeName="d" values="M ${x} ${by} C ${x} ${by + 8} ${x} ${by + 16} ${x} ${by + 20};M ${x} ${by} C ${(x + ex) / 2} ${by + l * 0.3} ${ex + (i % 2 ? 2 : -2)} ${ey - 6} ${ex} ${ey};M ${x} ${by} C ${(x + ex) / 2} ${by + l * 0.3} ${ex + (i % 2 ? 2 : -2)} ${ey - 6} ${ex} ${ey}" dur="1.2s" fill="freeze"/></path>
      <circle cx="${ex}" cy="${ey}" r="2" fill="${C.hi}" opacity="0">
        <animate attributeName="opacity" values="0;0.9;0" dur="1.6s" begin="0.6s"/>
        <animate attributeName="cy" values="${ey};${ey - 12}" dur="1.6s" begin="0.6s"/>
        <animate attributeName="r" values="2;0.3" dur="1.6s" begin="0.6s"/>
      </circle>`;
    }).join("");
  }

  if (sc === "error") {
    const droopy = [-0.55, 0.55].map(r => cx + bw * r).map((x, i) =>
      `<path d="M ${x} ${by} C ${x} ${by + 6} ${x + (i ? -3 : 3)} ${by + 14} ${x + (i ? -5 : 5)} ${by + 20}" fill="none" stroke="${tg}" stroke-width="2" stroke-linecap="round" opacity="0.3"/>`
    ).join("");
    const t1 = cx - bw * 0.2, t2 = cx + bw * 0.2;
    return droopy + `
      <path fill="none" stroke="${C.t}" stroke-width="2.2" stroke-linecap="round" opacity="0.45">
        <animate attributeName="d" values="M ${t1} ${by} C ${t1} ${by + 8} ${t1} ${by + 16} ${t1} ${by + 22};M ${t1} ${by} C ${t1 + 8} ${by + 6} ${t2 + 5} ${by + 12} ${t1 - 1} ${by + 18} S ${t1 + 5} ${by + 24} ${t1 + 3} ${by + 26};M ${t1} ${by} C ${t1 + 8} ${by + 6} ${t2 + 5} ${by + 12} ${t1 - 1} ${by + 18} S ${t1 + 5} ${by + 24} ${t1 + 3} ${by + 26}" dur="0.7s" fill="freeze"/>
      </path>
      <path fill="none" stroke="${C.t}" stroke-width="2.2" stroke-linecap="round" opacity="0.45">
        <animate attributeName="d" values="M ${t2} ${by} C ${t2} ${by + 8} ${t2} ${by + 16} ${t2} ${by + 22};M ${t2} ${by} C ${t2 - 8} ${by + 6} ${t1 - 5} ${by + 12} ${t2 + 1} ${by + 18} S ${t2 - 3} ${by + 22} ${t2 - 2} ${by + 24};M ${t2} ${by} C ${t2 - 8} ${by + 6} ${t1 - 5} ${by + 12} ${t2 + 1} ${by + 18} S ${t2 - 3} ${by + 22} ${t2 - 2} ${by + 24}" dur="0.7s" fill="freeze"/>
      </path>
      <path fill="none" stroke="${C.t}" stroke-width="2" stroke-linecap="round" opacity="0.45">
        <animate attributeName="d" values="M ${cx + bw * 0.45} ${by} C ${cx + bw * 0.45 + 4} ${by - 3} ${cx + bw * 0.45 + 10} ${by - 12} ${cx + bw * 0.45 + 6} ${by - 18};M ${cx + bw * 0.45} ${by} C ${cx + bw * 0.45 + 5} ${by - 4} ${cx + bw * 0.45 + 11} ${by - 11} ${cx + bw * 0.45 + 7} ${by - 20};M ${cx + bw * 0.45} ${by} C ${cx + bw * 0.45 + 4} ${by - 3} ${cx + bw * 0.45 + 10} ${by - 12} ${cx + bw * 0.45 + 6} ${by - 18}" dur="1s" repeatCount="indefinite"/>
      </path>`;
  }

  return "";
}

function generateEyes(sc: string, cx: number, ey: number, sp: number, R: number, C: Colors): string {
  const lx = cx - sp, rx = cx + sp;

  if (sc === "completed") {
    return `<path d="M ${lx - 4} ${ey + 1} Q ${lx} ${ey - 4.5} ${lx + 4} ${ey + 1}" fill="none" stroke="${C.e}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
    <path d="M ${rx - 4} ${ey + 1} Q ${rx} ${ey - 4.5} ${rx + 4} ${ey + 1}" fill="none" stroke="${C.e}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>`;
  }

  if (sc === "error") {
    return `<g opacity="0.8"><circle cx="${lx}" cy="${ey}" r="4" fill="none" stroke="${C.e}" stroke-width="1.2"/><path d="M ${lx - 1.5} ${ey - 1} A 1.8 1.8 0 1 1 ${lx + 2} ${ey + 0.5}" fill="none" stroke="${C.e}" stroke-width="1"/></g>
    <g opacity="0.8"><line x1="${rx - 3}" y1="${ey - 3}" x2="${rx + 3}" y2="${ey + 3}" stroke="${C.e}" stroke-width="1.6" stroke-linecap="round"/><line x1="${rx + 3}" y1="${ey - 3}" x2="${rx - 3}" y2="${ey + 3}" stroke="${C.e}" stroke-width="1.6" stroke-linecap="round"/></g>`;
  }

  if (sc === "waiting") {
    return `<circle cx="${lx}" cy="${ey}" r="4.5" fill="${C.e}" opacity="0.85"/><circle cx="${rx}" cy="${ey}" r="4.5" fill="${C.e}" opacity="0.85"/>
    <circle cx="${lx}" cy="${ey + 0.5}" r="2.2" fill="rgba(0,0,0,0.3)"/><circle cx="${rx}" cy="${ey + 0.5}" r="2.2" fill="rgba(0,0,0,0.3)"/>`;
  }

  if (sc === "processing") {
    return `<circle cx="${lx}" cy="${ey}" r="2.8" fill="${C.e}" opacity="0.75"><animate attributeName="cy" values="${ey};${ey - 1.5};${ey}" dur="2.5s" repeatCount="indefinite"/></circle>
    <circle cx="${rx}" cy="${ey}" r="2.8" fill="${C.e}" opacity="0.75"><animate attributeName="cy" values="${ey};${ey - 1.5};${ey}" dur="2.5s" repeatCount="indefinite"/></circle>
    <circle cx="${lx}" cy="${ey}" r="1.3" fill="rgba(0,0,0,0.25)"><animate attributeName="cy" values="${ey};${ey - 1.5};${ey}" dur="2.5s" repeatCount="indefinite"/></circle>
    <circle cx="${rx}" cy="${ey}" r="1.3" fill="rgba(0,0,0,0.25)"><animate attributeName="cy" values="${ey};${ey - 1.5};${ey}" dur="2.5s" repeatCount="indefinite"/></circle>`;
  }

  // Default: idle, speaking, inspect, listening — normal eyes with blink
  return `<circle cx="${lx}" cy="${ey}" r="3.5" fill="${C.e}" opacity="0.85"><animate attributeName="ry" values="3.5;3.5;0.4;3.5;3.5" dur="5s" repeatCount="indefinite" keyTimes="0;0.46;0.5;0.54;1"/></circle>
  <circle cx="${rx}" cy="${ey}" r="3.5" fill="${C.e}" opacity="0.85"><animate attributeName="ry" values="3.5;3.5;0.4;3.5;3.5" dur="5s" repeatCount="indefinite" keyTimes="0;0.46;0.5;0.54;1"/></circle>
  <circle cx="${lx + 0.3}" cy="${ey + 0.5}" r="1.5" fill="rgba(0,0,0,0.28)"/>
  <circle cx="${rx + 0.3}" cy="${ey + 0.5}" r="1.5" fill="rgba(0,0,0,0.28)"/>
  <circle cx="${lx - 1}" cy="${ey - 1.2}" r="0.8" fill="white" opacity="0.5"/>
  <circle cx="${rx - 1}" cy="${ey - 1.2}" r="0.8" fill="white" opacity="0.5"/>`;
}

function generateMouth(sc: string, cx: number, my: number, C: Colors): string {
  if (sc === "speaking") return `<ellipse cx="${cx}" cy="${my}" rx="3.5" fill="${C.e}" opacity="0.45"><animate attributeName="ry" values="1;4;1.5;3;1" dur="0.8s" repeatCount="indefinite"/></ellipse>`;
  if (sc === "completed") return `<path d="M ${cx - 6} ${my} Q ${cx} ${my + 6} ${cx + 6} ${my}" fill="none" stroke="${C.e}" stroke-width="1.5" stroke-linecap="round" opacity="0.65"/>`;
  if (sc === "error") return `<path d="M ${cx - 3} ${my + 1} Q ${cx + 1} ${my - 1} ${cx + 4} ${my + 2}" fill="none" stroke="${C.e}" stroke-width="1.2" stroke-linecap="round" opacity="0.45"/>`;
  if (sc === "waiting") return `<ellipse cx="${cx}" cy="${my}" rx="2.5" ry="3.5" fill="${C.e}" opacity="0.3"/>`;
  if (sc === "processing") return `<line x1="${cx - 3.5}" y1="${my}" x2="${cx + 3.5}" y2="${my}" stroke="${C.e}" stroke-width="1.2" stroke-linecap="round" opacity="0.3"/>`;
  return `<path d="M ${cx - 4.5} ${my} Q ${cx} ${my + 4} ${cx + 4.5} ${my}" fill="none" stroke="${C.e}" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/>`;
}

function generateExtras(sc: string, cx: number, dcy: number, R: number, bby: number, C: Colors, u: string): string {
  if (sc === "speaking") {
    const bn = 7, bwi = 2.2, bg = 2.8, tw = bn * bwi + (bn - 1) * bg;
    const sx = cx - tw / 2, barY = bby + 50;
    let b = "";
    for (let i = 0; i < bn; i++) {
      const x = sx + i * (bwi + bg), dl = (i * 0.08).toFixed(2);
      b += `<rect x="${x}" y="${barY}" width="${bwi}" rx="1.1" fill="${C.t}" opacity="0.4"><animate attributeName="height" values="2;10;3;8;2" dur="0.55s" begin="${dl}s" repeatCount="indefinite"/><animate attributeName="y" values="${barY};${barY - 8};${barY - 1};${barY - 6};${barY}" dur="0.55s" begin="${dl}s" repeatCount="indefinite"/></rect>`;
    }
    const w = [0, 0.5, 1].map(d =>
      `<ellipse cx="${cx}" cy="${dcy}" fill="none" stroke="${C.g}" stroke-width="0.5" opacity="0"><animate attributeName="rx" values="${R * 0.8};${R * 1.8}" dur="1.5s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="ry" values="${R * 0.6};${R * 1.3}" dur="1.5s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.25;0" dur="1.5s" begin="${d}s" repeatCount="indefinite"/></ellipse>`
    ).join("");
    return b + w;
  }

  if (sc === "waiting") {
    return `<text x="${cx}" y="${dcy - R - 6}" text-anchor="middle" font-size="15" font-weight="800" fill="${C.g}" opacity="0.75">!<animate attributeName="y" values="${dcy - R - 6};${dcy - R - 10};${dcy - R - 6}" dur="0.8s" repeatCount="indefinite"/></text>`;
  }

  if (sc === "completed") {
    return [
      { x: cx - 24, y: dcy - R - 4, dx: -8, dy: -16 },
      { x: cx + 24, y: dcy - R, dx: 10, dy: -14 },
      { x: cx - 30, y: dcy + R * 0.5, dx: -11, dy: -4 },
      { x: cx + 30, y: dcy + R * 0.4, dx: 12, dy: -7 },
      { x: cx, y: dcy - R - 8, dx: 0, dy: -18 },
    ].map((s, i) =>
      `<circle cx="${s.x}" cy="${s.y}" r="2.2" fill="${C.hi}" opacity="0"><animate attributeName="cx" values="${s.x};${s.x + s.dx}" dur="1.6s" begin="${i * 0.12}s"/><animate attributeName="cy" values="${s.y};${s.y + s.dy}" dur="1.6s" begin="${i * 0.12}s"/><animate attributeName="opacity" values="0;0.85;0" dur="1.6s" begin="${i * 0.12}s"/><animate attributeName="r" values="2.2;0.4" dur="1.6s" begin="${i * 0.12}s"/></circle>`
    ).join("");
  }

  if (sc === "listening") {
    const bn = 5, bwi = 1.5, bg = 2.2, tw = bn * bwi + (bn - 1) * bg;
    const sx = cx - tw / 2, barY = bby + 44;
    return Array.from({ length: bn }, (_, i) => {
      const x = sx + i * (bwi + bg), dl = (i * 0.12).toFixed(2);
      return `<rect x="${x}" y="${barY}" width="${bwi}" rx="0.75" fill="${C.g}" opacity="0.22"><animate attributeName="height" values="1;5;1" dur="1s" begin="${dl}s" repeatCount="indefinite"/><animate attributeName="y" values="${barY};${barY - 4};${barY}" dur="1s" begin="${dl}s" repeatCount="indefinite"/></rect>`;
    }).join("");
  }

  if (sc === "error") {
    return `<text x="${cx + 3}" y="${dcy - R - 4}" text-anchor="middle" font-size="14" fill="${C.g}" opacity="0.65" font-weight="600">?<animate attributeName="y" values="${dcy - R - 4};${dcy - R - 8};${dcy - R - 4}" dur="1.5s" repeatCount="indefinite"/></text>`;
  }

  return "";
}

function generateHum(sc: string, sz: number, u: string): string {
  const cx = sz / 2;
  const R = sz * 0.26;
  const dcy = sz * 0.28;
  const dby = dcy + R * 0.85;
  const C = COLORS[sc] ?? COLORS.idle!;

  let domePath = generateDome(sc, cx, R, dcy, dby);
  const frill = generateFrill(cx, R, dby);
  domePath += frill;

  const fl = !["waiting", "error"].includes(sc);
  const fd = sc === "processing" ? "2.5" : sc === "speaking" ? "3" : "4";

  let svg = `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" style="overflow:visible" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${u}bg" cx="50%" cy="32%" r="62%">
      <stop offset="0%" stop-color="${C.b1}" stop-opacity="0.6"/>
      <stop offset="75%" stop-color="${C.b2}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${C.b2}" stop-opacity="0.06"/>
    </radialGradient>
    <radialGradient id="${u}ig" cx="50%" cy="40%" r="40%">
      <stop offset="0%" stop-color="${C.hi}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${C.hi}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${u}tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.t}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${C.t}" stop-opacity="0.03"/>
    </linearGradient>
    <filter id="${u}gl"><feGaussianBlur stdDeviation="12"/></filter>
    <radialGradient id="${u}sh" cx="32%" cy="22%" r="28%">
      <stop offset="0%" stop-color="white" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g>`;

  // Float animation
  if (fl) svg += `<animateTransform attributeName="transform" type="translate" values="0,0;0,-5;0,0" dur="${fd}s" repeatCount="indefinite"/>`;
  if (sc === "listening") svg += `<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${dcy};-7 ${cx} ${dcy};-7 ${cx} ${dcy}" dur="0.5s" fill="freeze" additive="sum"/>`;
  if (sc === "error") svg += `<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${dcy};5 ${cx} ${dcy};5 ${cx} ${dcy}" dur="0.4s" fill="freeze" additive="sum"/>`;

  // Aura glow
  svg += `<ellipse cx="${cx}" cy="${dcy + 10}" rx="${R + 16}" ry="${R + 8}" fill="${C.g}" opacity="0.08" filter="url(#${u}gl)">`;
  if (sc === "waiting") svg += `<animate attributeName="opacity" values="0.05;0.16;0.05;0.12;0.05" dur="1.2s" repeatCount="indefinite"/>`;
  if (sc === "speaking") svg += `<animate attributeName="opacity" values="0.06;0.16;0.06" dur="1s" repeatCount="indefinite"/>`;
  if (sc === "completed") svg += `<animate attributeName="rx" values="${R + 16};${R + 35};${R + 20}" dur="1.5s" fill="freeze"/>`;
  svg += `</ellipse>`;

  // Tentacles (behind dome)
  svg += generateTentacles(sc, cx, dby + 2, R, C, u);

  // Dome group
  svg += `<g>`;
  if (["idle", "inspect", "listening"].includes(sc)) svg += `<animateTransform attributeName="transform" type="scale" values="1 1;1.015 0.985;1 1" dur="3.5s" repeatCount="indefinite" additive="sum"/>`;
  if (sc === "speaking") svg += `<animateTransform attributeName="transform" type="scale" values="1 1;1.04 0.96;1 1" dur="0.8s" repeatCount="indefinite" additive="sum"/>`;
  if (sc === "processing") svg += `<animateTransform attributeName="transform" type="scale" values="1 1;0.98 1.01;1 1" dur="2s" repeatCount="indefinite" additive="sum"/>`;
  if (sc === "completed") svg += `<animateTransform attributeName="transform" type="scale" values="0.9 0.95;1.1 0.95;1.05 0.98" dur="1s" fill="freeze" additive="sum"/>`;

  // Dome path — completed animates from smooth to wavy
  if (sc === "completed") {
    const smoothD = smoothDome(cx, R, dcy, dby) + frill;
    svg += `<path fill="url(#${u}bg)" stroke="${C.b1}" stroke-width="0.5" stroke-opacity="0.2">
      <animate attributeName="d" values="${smoothD};${domePath};${domePath}" dur="0.8s" fill="freeze"/>
    </path>`;
  } else {
    svg += `<path d="${domePath}" fill="url(#${u}bg)" stroke="${C.b1}" stroke-width="0.5" stroke-opacity="0.2"/>`;
  }

  // Speaking: ripple overlay on dome
  if (sc === "speaking") {
    svg += `<ellipse cx="${cx}" cy="${dcy - R * 0.5}" rx="${R * 0.6}" ry="${R * 0.12}" fill="${C.hi}" opacity="0">
      <animate attributeName="opacity" values="0;0.12;0" dur="0.8s" repeatCount="indefinite"/>
      <animate attributeName="ry" values="${R * 0.08};${R * 0.15};${R * 0.08}" dur="0.8s" repeatCount="indefinite"/>
    </ellipse>`;
  }

  // Shimmer highlight
  svg += `<ellipse cx="${cx - R * 0.22}" cy="${dcy - R * 0.4}" rx="${R * 0.32}" ry="${R * 0.22}" fill="url(#${u}sh)"/>`;

  // Inner organ glow
  svg += `<ellipse cx="${cx}" cy="${dcy + 2}" rx="${R * 0.38}" ry="${R * 0.28}" fill="url(#${u}ig)">`;
  if (sc === "processing") svg += `<animate attributeName="opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite"/>`;
  svg += `</ellipse>`;
  svg += `</g>`;

  // Blush marks
  if (["idle", "completed", "listening", "speaking", "inspect"].includes(sc)) {
    svg += `<ellipse cx="${cx - R * 0.52}" cy="${dcy + R * 0.18}" rx="4" ry="2.5" fill="${C.bl}" opacity="0.18"/>`;
    svg += `<ellipse cx="${cx + R * 0.52}" cy="${dcy + R * 0.18}" rx="4" ry="2.5" fill="${C.bl}" opacity="0.18"/>`;
  }

  // Eyes
  svg += generateEyes(sc, cx, dcy - R * 0.06, R * 0.3, R, C);

  // Mouth
  svg += generateMouth(sc, cx, dcy + R * 0.26, C);

  // Extras (waveform, particles, icons)
  svg += generateExtras(sc, cx, dcy, R, dby, C, u);

  // Client status dot
  svg += `<circle cx="${cx + R * 0.72}" cy="${dcy - R * 0.7}" r="2.2" fill="${C.g}" opacity="0.55"><animate attributeName="opacity" values="0.35;0.75;0.35" dur="2s" repeatCount="indefinite"/></circle>`;

  svg += `</g></svg>`;
  return svg;
}

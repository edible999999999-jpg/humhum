import type { PetState } from "@/types";

export type { PetState };

export interface HumColors {
  b1: string; // body primary
  b2: string; // body secondary
  hi: string; // highlight
  t: string;  // tentacle
  g: string;  // glow accent
  e: string;  // eye/feature color
  bl: string; // blush
}

export interface AgentCreatureColors {
  light: string;
  med: string;
  dark: string;
}

export interface ActiveAgent {
  id: string;
  color: string;
}

export type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

export type RenderContext2D =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

export interface EngineConfig {
  size: number;
  devicePixelRatio: number;
  powerPreference: "low-power" | "high-performance";
}

export interface FpsTarget {
  idle: number;
  active: number;
  drag: number;
}

import type { Agent } from "@earendil-works/pi-agent-core";
import type { AppConfig } from "../../types";

export interface HumiPiProgress {
  label: string;
  tool?: string;
}

export interface HumiPiCallbacks {
  onProgress?: (progress: HumiPiProgress) => void;
}

export interface HumiPiRuntime {
  agent: Agent;
  ask: (prompt: string) => Promise<string>;
}

export type HumiPiConfig = AppConfig["pi"];

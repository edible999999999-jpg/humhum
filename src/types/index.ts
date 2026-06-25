// ============================================================
// DevPod Core Type Definitions
// ============================================================

// --- Hook Events ---

/** All Claude Code hook event types we listen to */
export type HookEventType =
  | "PermissionRequest"
  | "Stop"
  | "TaskCompleted"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd";

/** Raw event received from Claude Code via hook script */
export interface HookEvent {
  id: string;
  hook_event_name: HookEventType;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  client_type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Permission request payload from Claude Code */
export interface PermissionRequestPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  description?: string;
}

// --- Pet States ---

/** Desktop pet's current state */
export type PetState =
  | "idle" // Floating, waiting for events
  | "processing" // Received event, generating summary
  | "speaking" // Playing TTS audio
  | "listening" // Waiting for voice command
  | "waiting" // Waiting for user confirmation
  | "error"; // Something went wrong

// --- TTS ---

export interface TTSOptions {
  voice?: string;
  speed?: number;
  model?: string;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: "male" | "female" | "neutral";
  provider: string;
}

/** TTS provider interface - implement this for each TTS backend */
export interface TTSProvider {
  readonly name: string;
  readonly providerId: string;
  synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  synthesizeStream?(
    text: string,
    options?: TTSOptions
  ): AsyncIterable<ArrayBuffer>;
  getVoices(): Promise<Voice[]>;
  isAvailable(): boolean;
}

// --- STT ---

/** STT provider interface - implement this for each STT backend */
export interface STTProvider {
  readonly name: string;
  readonly providerId: string;
  startListening(options?: STTOptions): Promise<void>;
  stopListening(): Promise<string>;
  onResult(callback: (text: string, isFinal: boolean) => void): void;
  onError(callback: (error: Error) => void): void;
  onEnd(callback: () => void): void;
  isAvailable(): boolean;
}

export interface STTOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

// --- Summarizer ---

/** LLM summarizer interface */
export interface Summarizer {
  readonly name: string;
  summarize(
    event: HookEvent,
    options?: SummarizerOptions
  ): AsyncIterable<string>;
}

export interface SummarizerOptions {
  style?: "podcast" | "brief" | "detailed";
  language?: "zh" | "en";
  maxLength?: number;
}

// --- Audio Queue ---

export interface AudioChunk {
  id: string;
  buffer: ArrayBuffer;
  text: string;
  duration?: number;
}

export type AudioQueueState = "idle" | "playing" | "paused" | "ended";

// --- Voice Commands ---

export type VoiceCommand =
  | "confirm"
  | "reject"
  | "skip"
  | "pause"
  | "resume"
  | "repeat"
  | "unknown";

export interface VoiceCommandDefinition {
  command: VoiceCommand;
  triggers: string[]; // Trigger phrases in multiple languages
  description: string;
}

// --- Configuration ---

export interface AppConfig {
  hook_port: number;
  api_keys: {
    openai?: string;
    elevenlabs?: string;
  };
  tts: {
    provider: "edge" | "openai" | "elevenlabs";
    voice: string;
    speed: number;
    model?: string;
    edge_bridge_url?: string;
  };
  stt: {
    provider: "web-speech" | "whisper";
    language: string;
  };
  summarizer: {
    api_base: string;
    model: string;
    max_tokens: number;
  };
  ui: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    language: "zh" | "en";
  };
}

// --- UI Events ---

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: Date;
  type: "summary" | "confirmation" | "command" | "system";
  isPlaying?: boolean;
}

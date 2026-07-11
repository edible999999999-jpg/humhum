// ============================================================
// HumHum Core Type Definitions
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
  | "completed" // Task done — evil grin
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
  pi: {
    url: string;
    token?: string;
    model_name: string;
  };
  ui: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    language: "zh" | "en";
    auto_confirm?: boolean;
    awake_mode?: boolean;
  };
}

// --- Agent Stats ---

export interface DailyAgentData {
  date: string;
  tokens: number;
  cost_usd: number;
  sessions: number;
}

export interface AgentStats {
  client_type: string;
  total_sessions: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tool_calls: number;
  total_cost_usd: number;
  avg_tokens_per_session: number;
  avg_cost_per_session: number;
  top_tools: [string, number][];
  models_used: string[];
  daily_data: DailyAgentData[];
}

// --- Knowledge Base ---

export interface Preference {
  id: string;
  category: string;
  content: string;
  source: string;
  priority: number;
}

export interface AgentRule {
  id: string;
  agent_id: string;
  rule_type: string;
  file_path: string;
  content: string;
}

export interface MemoryItem {
  id: string;
  agent_id: string;
  content: string;
  temperature: string;
}

export interface ObsidianVaultConfig {
  path?: string | null;
  enabled: boolean;
  last_indexed_at?: string | null;
}

export interface ObsidianTask {
  text: string;
  completed: boolean;
  line: number;
}

export interface ObsidianNote {
  id: string;
  title: string;
  file_path: string;
  relative_path: string;
  source: string;
  note_type: string;
  memory_temperature: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  wiki_links: string[];
  tasks: ObsidianTask[];
  excerpt: string;
  modified_at?: string | null;
}

export interface AgentAsset {
  id: string;
  asset_type: string;
  agent_id: string;
  name: string;
  file_path: string;
  relative_path: string;
  source: string;
  content: string;
  tags: string[];
  modified_at?: string | null;
}

export interface KnowledgeData {
  preferences: Preference[];
  agent_rules: AgentRule[];
  memory_items: MemoryItem[];
  obsidian_vault: ObsidianVaultConfig;
  obsidian_notes: ObsidianNote[];
  agent_assets: AgentAsset[];
}

// --- UI Events ---

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: Date;
  type: "summary" | "confirmation" | "command" | "system";
  isPlaying?: boolean;
}

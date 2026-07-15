import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "@/types";
import { setLanguage } from "./i18n";
import { EdgeTTSProvider } from "./tts/edge-tts";
import { OpenAITTSProvider } from "./tts/openai-tts";
import { ElevenLabsProvider } from "./tts/elevenlabs";
import { registerProvider, setActiveProvider } from "./tts";
import { WebSpeechProvider } from "./stt/web-speech";
import { WhisperProvider } from "./stt/whisper";
import { registerSTTProvider, setActiveSTTProvider } from "./stt";
import { OpenAISummarizer } from "./summarizer";
import { SentenceSplitter } from "./summarizer/sentence-split";
import { AudioQueue } from "./audio/queue";
import { VoicePipeline } from "./pipeline";

let audioQueue: AudioQueue | null = null;
let summarizer: OpenAISummarizer | null = null;
let splitter: SentenceSplitter | null = null;
let pipeline: VoicePipeline | null = null;
let initialized = false;

export function getAudioQueue(): AudioQueue {
  if (!audioQueue) audioQueue = new AudioQueue();
  return audioQueue;
}

export function getSummarizer(): OpenAISummarizer | null {
  return summarizer;
}

export function getSentenceSplitter(): SentenceSplitter {
  if (!splitter) splitter = new SentenceSplitter();
  return splitter;
}

export function getPipeline(): VoicePipeline | null {
  return pipeline;
}

export async function initBootstrap(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const config = (await invoke("get_config")) as AppConfig;
  setLanguage(config.ui.language as "zh" | "en");

  // --- TTS Providers ---
  const edgeTts = new EdgeTTSProvider(config.tts.edge_bridge_url);
  registerProvider(edgeTts);

  if (config.api_keys.openai) {
    const openaiTts = new OpenAITTSProvider(config.api_keys.openai);
    registerProvider(openaiTts);
  }

  if (config.api_keys.elevenlabs) {
    const elevenTts = new ElevenLabsProvider(config.api_keys.elevenlabs);
    registerProvider(elevenTts);
  }

  try {
    setActiveProvider(config.tts.provider);
  } catch {
    setActiveProvider("edge");
  }

  // --- STT Providers ---
  const webSpeech = new WebSpeechProvider();
  registerSTTProvider(webSpeech);

  if (config.api_keys.openai) {
    const whisper = new WhisperProvider(config.api_keys.openai, config.summarizer.api_base);
    registerSTTProvider(whisper);
  }

  let activeStt: string | null = null;
  for (const candidate of [config.stt.provider, "whisper", "web-speech"]) {
    if (activeStt) break;
    try {
      setActiveSTTProvider(candidate);
      activeStt = candidate;
    } catch {
      // Try the next runtime-capable provider.
    }
  }
  if (!activeStt) {
    console.warn("[Bootstrap] No speech recognition provider is available");
  }

  // --- Summarizer ---
  if (config.api_keys.openai) {
    summarizer = new OpenAISummarizer({
      apiKey: config.api_keys.openai,
      baseUrl: config.summarizer.api_base,
      model: config.summarizer.model,
      maxTokens: config.summarizer.max_tokens,
    });
  }

  // --- Audio Queue + Splitter ---
  audioQueue = getAudioQueue();
  splitter = getSentenceSplitter();

  // --- Pipeline ---
  if (summarizer) {
    pipeline = new VoicePipeline(summarizer, splitter, audioQueue);
  }

  console.log("[Bootstrap] Initialized", {
    tts: config.tts.provider,
    stt: activeStt ?? "unavailable",
    hasSummarizer: !!summarizer,
    hasPipeline: !!pipeline,
    apiKey: config.api_keys.openai ? "SET" : "MISSING",
    apiBase: config.summarizer.api_base,
  });
}

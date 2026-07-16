import { invoke } from "@tauri-apps/api/core";
import type { TTSProvider, TTSOptions, Voice } from "@/types";

export class EdgeTTSProvider implements TTSProvider {
  readonly name = "Edge TTS (Free)";
  readonly providerId = "edge";

  private bridgeUrl: string;

  constructor(bridgeUrl?: string) {
    this.bridgeUrl = bridgeUrl || "http://localhost:5050";
  }

  async synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
    const url = `${this.bridgeUrl}/v1/audio/speech`;
    const body = JSON.stringify({
      input: text,
      voice: options?.voice ?? "zh-CN-XiaoxiaoNeural",
      model: "tts-1",
      speed: options?.speed ?? 1.0,
    });

    console.log("[EdgeTTS] Calling bridge via Rust proxy:", url);

    try {
      const base64 = (await invoke("proxy_post_binary", {
        url,
        headers: { "Content-Type": "application/json" },
        body,
      })) as string;

      const binary = atob(base64);
      const buf = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
      }

      console.log("[EdgeTTS] Got", buf.byteLength, "bytes from bridge");
      return buf;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[EdgeTTS] Bridge failed:", msg, "— falling back to system speech");
      return this.synthesizeSystemSpeech(text, options);
    }
  }

  private async synthesizeSystemSpeech(
    text: string,
    options?: TTSOptions
  ): Promise<ArrayBuffer> {
    const base64 = (await invoke("synthesize_system_speech", {
      text,
      voice: options?.voice ?? "zh-CN-XiaoxiaoNeural",
      speed: options?.speed ?? 1.0,
    })) as string;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  async getVoices(): Promise<Voice[]> {
    return [
      { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (中文)", language: "zh", gender: "female", provider: "edge" },
      { id: "zh-CN-YunxiNeural", name: "Yunxi (中文)", language: "zh", gender: "male", provider: "edge" },
      { id: "en-US-AriaNeural", name: "Aria (English)", language: "en", gender: "female", provider: "edge" },
      { id: "en-US-GuyNeural", name: "Guy (English)", language: "en", gender: "male", provider: "edge" },
      { id: "ja-JP-NanamiNeural", name: "Nanami (日本語)", language: "ja", gender: "female", provider: "edge" },
    ];
  }

  isAvailable(): boolean {
    return true;
  }
}

import type { TTSProvider, TTSOptions, Voice } from "@/types";

export class EdgeTTSProvider implements TTSProvider {
  readonly name = "Edge TTS (Free)";
  readonly providerId = "edge";

  private bridgeUrl: string;
  private bridgeAvailable: boolean | null = null;

  constructor(bridgeUrl?: string) {
    this.bridgeUrl = bridgeUrl || "http://localhost:5050";
  }

  async synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
    if (this.bridgeAvailable !== false) {
      try {
        const response = await fetch(`${this.bridgeUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: text,
            voice: options?.voice ?? "zh-CN-XiaoxiaoNeural",
            model: "tts-1",
            speed: options?.speed ?? 1.0,
          }),
        });
        if (response.ok) {
          this.bridgeAvailable = true;
          return await response.arrayBuffer();
        }
      } catch {
        this.bridgeAvailable = false;
        console.warn("[EdgeTTS] Bridge server not available, falling back to Web Speech");
      }
    }

    return this.synthesizeWebSpeech(text, options);
  }

  private synthesizeWebSpeech(
    text: string,
    options?: TTSOptions
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        reject(new Error("Speech synthesis not available"));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voiceId = options?.voice ?? "zh-CN-XiaoxiaoNeural";
      const lang = voiceId.startsWith("zh")
        ? "zh-CN"
        : voiceId.startsWith("ja")
          ? "ja-JP"
          : "en-US";

      const voices = synth.getVoices();
      const matched = voices.find((v) => v.lang === lang);
      if (matched) utterance.voice = matched;
      utterance.lang = lang;
      utterance.rate = options?.speed ?? 1.0;

      utterance.onend = () => resolve(createSilentWav());
      utterance.onerror = (e) =>
        reject(new Error(`Speech synthesis error: ${e.error}`));

      synth.speak(utterance);
    });
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
    return (
      typeof window !== "undefined" &&
      (this.bridgeAvailable === true || "speechSynthesis" in window)
    );
  }
}

function createSilentWav(): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 22050, true);
  view.setUint32(28, 44100, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, 0, true);
  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

import type { STTProvider, STTOptions } from "@/types";
import { invoke } from "@tauri-apps/api/core";

/**
 * OpenAI Whisper API provider — high accuracy, requires API key.
 */
export class WhisperProvider implements STTProvider {
  readonly name = "OpenAI Whisper";
  readonly providerId = "whisper";

  private apiKey: string;
  private baseUrl: string;
  private resultCallback: ((text: string, isFinal: boolean) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private endCallback: (() => void) | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private language = "zh";

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async startListening(options?: STTOptions): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("Microphone recording is not available in this WebView");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permissionError = new Error(`Microphone permission was denied or unavailable: ${message}`);
      this.errorCallback?.(permissionError);
      throw permissionError;
    }

    const mimeType = preferredRecordingMimeType();
    this.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    this.audioChunks = [];
    this.language = normalizeLanguage(options?.language);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onerror = (event) => {
      this.errorCallback?.(new Error(`Microphone recording failed: ${event.error.message}`));
    };

    this.mediaRecorder.start();
    console.log("[Whisper] Recording with", this.mediaRecorder.mimeType || "browser default");
  }

  async stopListening(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Not recording"));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        const recorder = this.mediaRecorder;
        const mimeType = recorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.mediaRecorder = null;
        this.audioChunks = [];

        try {
          if (audioBlob.size === 0) throw new Error("The microphone recording was empty");
          const buffer = await audioBlob.arrayBuffer();
          const text = (await invoke("transcribe_audio", {
            base64Data: arrayBufferToBase64(buffer),
            filename: `recording.${extensionForMime(mimeType)}`,
            apiBase: this.baseUrl,
            apiKey: this.apiKey,
            model: "whisper-1",
            language: this.language,
          })) as string;

          if (this.resultCallback) this.resultCallback(text, true);
          if (this.endCallback) this.endCallback();

          resolve(text);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (this.errorCallback) this.errorCallback(err);
          reject(err);
        }
      };

      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    });
  }

  onResult(callback: (text: string, isFinal: boolean) => void): void {
    this.resultCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onEnd(callback: () => void): void {
    this.endCallback = callback;
  }

  isAvailable(): boolean {
    const runtimeMediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as unknown as {
            mediaDevices?: { getUserMedia?: unknown };
          }).mediaDevices;

    return Boolean(
      this.apiKey &&
      typeof navigator !== "undefined" &&
      typeof runtimeMediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined",
    );
  }
}

function preferredRecordingMimeType(): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function normalizeLanguage(language?: string): string {
  return (language || "zh").split("-")[0] || "zh";
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

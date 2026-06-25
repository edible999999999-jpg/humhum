import type { STTProvider, STTOptions } from "@/types";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export class WebSpeechProvider implements STTProvider {
  readonly name = "Web Speech API";
  readonly providerId = "web-speech";

  private recognition: SpeechRecognitionInstance | null = null;
  private resultCallback: ((text: string, isFinal: boolean) => void) | null =
    null;
  private errorCallback: ((error: Error) => void) | null = null;
  private endCallback: (() => void) | null = null;
  private finalTranscript = "";

  async startListening(options?: STTOptions): Promise<void> {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error("Speech recognition not available");
    }

    this.finalTranscript = "";
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = options?.continuous ?? false;
    this.recognition.interimResults = options?.interimResults ?? true;
    this.recognition.lang = options?.language ?? "zh-CN";

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results.item(i);
        if (!result) continue;
        const transcript = result.item(0)?.transcript ?? "";
        if (result.isFinal) {
          this.finalTranscript += transcript;
          this.resultCallback?.(this.finalTranscript, true);
        } else {
          interim += transcript;
          this.resultCallback?.(this.finalTranscript + interim, false);
        }
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.errorCallback?.(new Error(`Speech recognition: ${event.error}`));
    };

    this.recognition.onend = () => {
      this.endCallback?.();
    };

    this.recognition.start();
  }

  async stopListening(): Promise<string> {
    this.recognition?.stop();
    this.recognition = null;
    return this.finalTranscript;
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
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }
}

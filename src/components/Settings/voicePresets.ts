export const VOICE_PRESETS: Record<string, Array<{ id: string; label: string }>> = {
  edge: [
    { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 (中文女声)" },
    { id: "zh-CN-YunxiNeural", label: "云希 (中文男声)" },
    { id: "zh-CN-XiaoyiNeural", label: "晓伊 (中文女声)" },
    { id: "en-US-AriaNeural", label: "Aria (English F)" },
    { id: "en-US-GuyNeural", label: "Guy (English M)" },
    { id: "ja-JP-NanamiNeural", label: "Nanami (日本語)" },
  ],
  openai: [
    { id: "alloy", label: "Alloy" },
    { id: "ash", label: "Ash" },
    { id: "coral", label: "Coral" },
    { id: "echo", label: "Echo" },
    { id: "fable", label: "Fable" },
    { id: "nova", label: "Nova" },
    { id: "onyx", label: "Onyx" },
    { id: "sage", label: "Sage" },
    { id: "shimmer", label: "Shimmer" },
  ],
  elevenlabs: [
    { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel" },
  ],
};

export const DEFAULT_VOICE: Record<string, string> = {
  edge: "zh-CN-XiaoxiaoNeural",
  openai: "alloy",
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
};

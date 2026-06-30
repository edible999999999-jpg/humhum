import type { HookEvent, Summarizer, SummarizerOptions } from "@/types";

/**
 * LLM Summarizer — turns raw Claude Code event data into podcast-style scripts.
 * Uses an OpenAI-compatible API with streaming.
 */
export class OpenAISummarizer implements Summarizer {
  readonly name = "OpenAI Summarizer";

  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.model = opts.model ?? "gpt-4o-mini";
    this.maxTokens = opts.maxTokens ?? 500;
  }

  async *summarize(
    event: HookEvent,
    options?: SummarizerOptions
  ): AsyncIterable<string> {
    const prompt = buildPodcastPrompt(event, options);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: this.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[Summarizer] API error:", response.status, errorText);
      throw new Error(`Summarizer error: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data) as {
            choices: Array<{ delta: { content?: string } }>;
          };
          const content = parsed.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }
  }
}

const SYSTEM_PROMPT = `你是一位播客主播，正在向听众播报一个开发任务的进展。
请将技术输出转化为自然、口语化的播报。

规则：
- 像跟同事聊天一样说话，不要念文档
- 用短句（TTS 更容易自然朗读）
- 加过渡语："好，来看看这个..."、"有意思的是..."
- 不要读代码、文件路径、JSON — 用口语描述
- 控制在 150 字以内（约 60 秒播报）
- 如果是确认请求，最后清楚说明"需要你确认是否允许"`;

function buildPodcastPrompt(
  event: HookEvent,
  options?: SummarizerOptions
): string {
  const _lang = options?.language ?? "zh";
  const _style = options?.style ?? "podcast";

  let context = `事件类型: ${event.hook_event_name}\n`;
  context += `会话: ${event.session_id}\n`;

  if (event.payload) {
    const payloadStr = JSON.stringify(event.payload, null, 2);
    context += `详细内容:\n${payloadStr.slice(0, 2000)}`;
  }

  if (event.hook_event_name === "PermissionRequest") {
    context += `\n\n这是一个权限确认请求。请在播报末尾提醒用户需要做出确认或拒绝的决定。`;
  }

  return context;
}

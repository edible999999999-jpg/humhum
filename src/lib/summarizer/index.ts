import { invoke } from "@tauri-apps/api/core";
import type { HookEvent, Summarizer, SummarizerOptions } from "@/types";

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
    this.maxTokens = opts.maxTokens ?? 100;
  }

  async *summarize(
    event: HookEvent,
    options?: SummarizerOptions
  ): AsyncIterable<string> {
    const prompt = buildPodcastPrompt(event, options);
    const url = `${this.baseUrl}/chat/completions`;
    console.log("[Summarizer] Calling:", url, "model:", this.model);

    const requestBody = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: this.maxTokens,
      stream: false,
    });

    const responseText = (await invoke("proxy_post", {
      url,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    })) as string;

    const json = JSON.parse(responseText) as {
      choices: Array<{ message: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    console.log("[Summarizer] Got response:", content.slice(0, 80));

    for (const char of content) {
      yield char;
    }
  }
}

const SYSTEM_PROMPT = `你是桌面小助手，用一两句话简短播报开发进展。

规则：
- 用最简短的口语，像同事随口说一句
- 不超过50字
- 不读代码、路径、JSON
- 多个事件合并说，如"刚跑完两个任务，都顺利"
- 确认请求要说"需要你确认"
- 不要客套开场白，直接说重点`;

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

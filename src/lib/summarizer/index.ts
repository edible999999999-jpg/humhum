import { invoke } from "@tauri-apps/api/core";
import { getLanguage, t } from "../i18n";
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
    const systemPrompt = t("summarizer.systemZh");
    const url = `${this.baseUrl}/chat/completions`;
    console.log("[Summarizer] Calling:", url, "model:", this.model, "lang:", getLanguage());

    const requestBody = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
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

function buildPodcastPrompt(
  event: HookEvent,
  options?: SummarizerOptions
): string {
  let context = `${t("summarizer.eventType")}: ${event.hook_event_name}\n`;
  context += `${t("summarizer.session")}: ${event.session_id}\n`;

  if (event.payload) {
    const payloadStr = JSON.stringify(event.payload, null, 2);
    context += `${t("summarizer.details")}:\n${payloadStr.slice(0, 2000)}`;
  }

  if (event.hook_event_name === "PermissionRequest") {
    context += `\n\n${t("summarizer.permissionHint")}`;
  }

  return context;
}

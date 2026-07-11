import {
  Agent,
  type AgentEvent,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  createAssistantMessageEventStream,
  type Model,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { AppConfig } from "../../types";
import { buildHumiTools } from "./tools";
import type { HumiPiCallbacks, HumiPiConfig, HumiPiRuntime } from "./types";
import { invoke } from "@tauri-apps/api/core";

const PROVIDER_ID = "humi-custom";

function buildModel(config: HumiPiConfig): Model<"openai-completions"> {
  return {
    id: config.model_name,
    name: config.model_name,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: config.url.replace(/\/$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

function finalAssistantText(agent: Agent): string {
  const lastAssistant = [...agent.state.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!lastAssistant) return "";
  const content: unknown = lastAssistant.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return lastAssistant.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function progressForEvent(event: AgentEvent, callbacks?: HumiPiCallbacks): void {
  if (event.type === "tool_execution_start") {
    callbacks?.onProgress?.({ label: "正在查找相关信息", tool: event.toolName });
  }
  if (event.type === "agent_start") {
    callbacks?.onProgress?.({ label: "Humi 正在认真听你说" });
  }
}

function proxyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createProxyError(error: unknown, model: Model<"openai-completions">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: proxyErrorMessage(error),
    timestamp: Date.now(),
  };
}

export function createHumiPiRuntime(
  config: AppConfig,
  callbacks?: HumiPiCallbacks,
): HumiPiRuntime {
  const piConfig = config.pi;
  if (!piConfig.url.trim()) throw new Error("请先填写 Pi 的 API URL");
  if (!piConfig.model_name.trim()) throw new Error("请先填写 Pi 的 model_name");
  if (!piConfig.token?.trim()) throw new Error("请先填写 Pi 的 Token");

  const model = buildModel(piConfig);
  const provider = createProvider({
    id: PROVIDER_ID,
    name: "HUMHUM Pi Provider",
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "HUMHUM Pi Token",
        resolve: async () => ({ auth: { apiKey: piConfig.token } }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);

  const streamThroughTauriProxy = (requestedModel: Model<"openai-completions">, context: Parameters<typeof models.streamSimple>[1], options: Parameters<typeof models.streamSimple>[2]) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const requestHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = typeof init?.body === "string" ? init.body : "";
        const responseText = await invoke<string>("proxy_post", {
          url: requestUrl,
          headers: requestHeaders,
          body: requestBody,
        });
        return new Response(responseText, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };

      try {
        const source = models.streamSimple(requestedModel, context, options);
        for await (const event of source) {
          output.push(event as AssistantMessageEvent);
        }
      } catch (error) {
        output.push({
          type: "error",
          reason: "error",
          error: createProxyError(error, requestedModel),
        });
      } finally {
        globalThis.fetch = nativeFetch;
        output.end();
      }
    })();
    return output;
  };

  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: "off",
      systemPrompt: [
        "你是 Humi，HUMHUM 里温柔、准确的个人 Agent。",
        "你通过有限的本地上下文工具理解用户，不要编造没有证据的结论。",
        "先判断是否需要工具；需要时调用工具，再基于工具结果自然回答。",
        "不要向用户展示隐藏思维链、原始路径、Token、工具参数或内部 JSON。",
        "如果证据不足，直接说目前还不能确定，并告诉用户缺什么。",
        "除非用户明确确认，不要保存记忆、修改文件、执行命令或触达私密消息。",
        "用中文回答，像在和用户聊天，不要写成终端报告。",
      ].join("\n"),
      tools: buildHumiTools((label, tool) => callbacks?.onProgress?.({ label, tool })),
    },
    streamFn: (requestedModel, context, options) =>
      streamThroughTauriProxy(requestedModel as Model<"openai-completions">, context, options),
  });

  agent.subscribe((event) => progressForEvent(event, callbacks));

  return {
    agent,
    ask: async (prompt: string) => {
      await agent.prompt(prompt);
      const answer = finalAssistantText(agent);
      if (!answer) {
        throw new Error(agent.state.errorMessage || "Pi 没有返回可显示的回答");
      }
      return answer;
    },
  };
}

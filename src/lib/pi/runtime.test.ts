import { describe, expect, it } from "vitest";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";

describe("Pi ReAct runtime", () => {
  it("executes a context tool before producing the final answer", async () => {
    const provider = fauxProvider({ provider: "test-pi" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("get_context", {})),
      fauxAssistantMessage("我根据刚才读取到的上下文整理好了。"),
    ]);

    let toolCalls = 0;
    const tool: AgentTool = {
      name: "get_context",
      label: "读取上下文",
      description: "Read local context",
      parameters: Type.Object({}),
      execute: async () => {
        toolCalls += 1;
        return { content: [{ type: "text", text: "用户最近在整理 Agent 架构" }], details: {} };
      },
    };

    const agent = new Agent({
      initialState: {
        model: provider.getModel(),
        systemPrompt: "Use tools when context is needed.",
        tools: [tool],
      },
      streamFn: (model, context, options) => provider.provider.streamSimple(model, context, options),
    });

    await agent.prompt("我最近在忙什么？");

    expect(toolCalls).toBe(1);
    expect(agent.state.messages[agent.state.messages.length - 1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "我根据刚才读取到的上下文整理好了。" }],
    });
  });
});

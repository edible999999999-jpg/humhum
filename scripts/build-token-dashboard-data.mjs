// Build design-qa-assets/token-dashboard-data.js from tokscale JSON outputs.
//
// Args: <graph.json> <hourly.json> <outDir>
// Emits token-dashboard-data.js (window.TOKEN_DATA = {...}) and a matching
// .json for inspection. Keeps the shape the dashboard's token-dashboard.js
// expects, plus a `hours` array for the "今日·按小时" view.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [graphPath, hourlyPath, outDir] = process.argv.slice(2);
if (!graphPath || !hourlyPath || !outDir) {
  console.error("usage: build-token-dashboard-data.mjs <graph.json> <hourly.json> <outDir>");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const hourly = JSON.parse(readFileSync(hourlyPath, "utf8"));

const days = graph.contributions.map((c) => {
  const tb = c.tokenBreakdown ?? {};
  return {
    date: c.date,
    tokens: c.totals.tokens,
    cost: c.totals.cost,
    messages: c.totals.messages,
    input: tb.input ?? 0,
    output: tb.output ?? 0,
    cacheRead: tb.cacheRead ?? 0,
    cacheWrite: tb.cacheWrite ?? 0,
    reasoning: tb.reasoning ?? 0,
    clients: (c.clients ?? []).map((cl) => ({
      client: cl.client,
      model: cl.modelId ?? cl.model,
      tokens: typeof cl.tokens === "object"
        ? (cl.tokens.input ?? 0) + (cl.tokens.output ?? 0) + (cl.tokens.cacheRead ?? 0) + (cl.tokens.cacheWrite ?? 0) + (cl.tokens.reasoning ?? 0)
        : cl.tokens,
      cost: cl.cost,
      messages: cl.messages,
    })),
  };
});

const hours = (hourly.entries ?? []).map((e) => ({
  hour: e.hour,
  tokens: (e.input ?? 0) + (e.output ?? 0) + (e.cacheRead ?? 0) + (e.cacheWrite ?? 0) + (e.reasoning ?? 0),
  cost: e.cost ?? 0,
  messages: e.messageCount ?? 0,
  input: e.input ?? 0,
  output: e.output ?? 0,
  cacheRead: e.cacheRead ?? 0,
  cacheWrite: e.cacheWrite ?? 0,
  reasoning: e.reasoning ?? 0,
}));

const data = {
  generatedAt: graph.meta.generatedAt,
  range: graph.meta.dateRange,
  summary: {
    totalTokens: graph.summary.totalTokens,
    totalCost: graph.summary.totalCost,
    totalDays: graph.summary.totalDays,
    activeDays: graph.summary.activeDays,
    averagePerDay: graph.summary.averagePerDay,
    maxCostInSingleDay: graph.summary.maxCostInSingleDay,
    clients: graph.summary.clients,
    models: graph.summary.models,
  },
  today: hours.length ? hours[0].hour.slice(0, 10) : null,
  hours,
  days,
};

const json = JSON.stringify(data);
writeFileSync(join(outDir, "token-dashboard-data.js"), `window.TOKEN_DATA=${json};\n`);
writeFileSync(join(outDir, "token-dashboard-data.json"), json);
console.log(`  days=${days.length} hours=${hours.length} total=${(data.summary.totalTokens / 1e9).toFixed(2)}B $${data.summary.totalCost.toFixed(2)}`);

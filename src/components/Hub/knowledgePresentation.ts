import type { AgentAsset } from "@/types";

const EXCLUDED_AGENT_ASSET_PATHS = [
  "/.system/",
  "/openai-bundled/",
  "/openai-primary-runtime/",
  "/marketplace/",
  "/marketplaces/",
];

const PERSONAL_SKILL_ROOTS = [
  "/.agents/skills/",
  "/.claude/skills/",
  "/.codex/skills/",
  "/.codex/vendor_imports/skills/",
  "/.gemini/skills/",
  "/.kimi/skills/",
  "/.pi/skills/",
  "/.qoder/skills/",
  "/.qoderwork/skills/",
  "/.qwen/skills/",
];

function normalizedAssetPath(asset: AgentAsset): string {
  return asset.file_path.replaceAll("\\", "/").toLowerCase();
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isPersonalAgentAsset(asset: AgentAsset): boolean {
  const path = normalizedAssetPath(asset);
  if (EXCLUDED_AGENT_ASSET_PATHS.some((excluded) => path.includes(excluded))) {
    return false;
  }

  return (
    path.includes("/openai-curated-remote/") ||
    PERSONAL_SKILL_ROOTS.some((root) => path.includes(root))
  );
}

export function getAgentAssetSummary(asset: AgentAsset): string {
  const content = asset.content.replace(/\r\n/g, "\n");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const description = frontmatter?.[1]
    ?.split("\n")
    .find((line) => /^description\s*:/i.test(line))
    ?.replace(/^description\s*:\s*/i, "");

  if (description && oneLine(description)) {
    return oneLine(description).replace(/^['\"]|['\"]$/g, "");
  }

  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const heading = body.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (heading && oneLine(heading)) {
    return oneLine(heading);
  }

  const firstLine = body
    .split("\n")
    .map(oneLine)
    .find(Boolean);
  return firstLine || "No description available.";
}

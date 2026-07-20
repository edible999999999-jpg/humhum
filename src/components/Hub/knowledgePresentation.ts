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

function normalizePath(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function assetPathCandidates(asset: AgentAsset): string[] {
  return [
    asset.file_path,
    asset.source,
    asset.relative_path,
  ].map(normalizePath);
}

function isSkillDescriptor(asset: AgentAsset): boolean {
  return assetPathCandidates(asset).some((path) => {
    const parts = path.split("/");
    return parts[parts.length - 1] === "skill.md";
  });
}

function isWithinConfiguredRoot(candidate: string, configuredRoot: string): boolean {
  const root = normalizePath(configuredRoot);
  if (!root) {
    return false;
  }

  if (root.startsWith("~/")) {
    const expandedSuffix = root.slice(1);
    return (
      candidate === root ||
      candidate.startsWith(`${root}/`) ||
      candidate.endsWith(expandedSuffix) ||
      candidate.includes(`${expandedSuffix}/`)
    );
  }

  return candidate === root || candidate.startsWith(`${root}/`);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type AgentAssetScope = "mine" | "all";

const MIN_MEANINGFUL_ASSET_TIME = Date.UTC(2000, 0, 1);

function meaningfulAssetTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= MIN_MEANINGFUL_ASSET_TIME
    ? timestamp
    : null;
}

export function agentAssetLastUsedTimestamp(asset: AgentAsset): number | null {
  return meaningfulAssetTimestamp(asset.last_used_at);
}

export function agentAssetModifiedTimestamp(asset: AgentAsset): number | null {
  return meaningfulAssetTimestamp(asset.modified_at);
}

export function sortAgentAssetsByRecentUse(assets: AgentAsset[]): AgentAsset[] {
  return [...assets].sort((left, right) => {
    const leftUsed = agentAssetLastUsedTimestamp(left);
    const rightUsed = agentAssetLastUsedTimestamp(right);
    if (leftUsed !== null || rightUsed !== null) {
      if (leftUsed === null) return 1;
      if (rightUsed === null) return -1;
      if (leftUsed !== rightUsed) return rightUsed - leftUsed;
    }

    const leftModified = agentAssetModifiedTimestamp(left);
    const rightModified = agentAssetModifiedTimestamp(right);
    if (leftModified !== null || rightModified !== null) {
      if (leftModified === null) return 1;
      if (rightModified === null) return -1;
      if (leftModified !== rightModified) return rightModified - leftModified;
    }

    return left.name.localeCompare(right.name);
  });
}

export function sortByRecentUpdate<T extends { modified_at?: string | null }>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    const leftModified = meaningfulAssetTimestamp(left.modified_at);
    const rightModified = meaningfulAssetTimestamp(right.modified_at);
    if (leftModified === null && rightModified === null) return 0;
    if (leftModified === null) return 1;
    if (rightModified === null) return -1;
    return rightModified - leftModified;
  });
}

export function isPersonalAgentAsset(
  asset: AgentAsset,
  configuredRoots: string[] = [],
): boolean {
  if (["created", "installed", "used"].includes(asset.ownership || "")) {
    return true;
  }

  const paths = assetPathCandidates(asset);
  if (
    paths.some((path) =>
      EXCLUDED_AGENT_ASSET_PATHS.some((excluded) => path.includes(excluded))
    )
  ) {
    return false;
  }

  return (
    paths.some((path) => path.includes("/openai-curated-remote/")) ||
    paths.some((path) =>
      PERSONAL_SKILL_ROOTS.some((root) => path.includes(root))
    ) ||
    configuredRoots.some((root) =>
      paths.some((path) => isWithinConfiguredRoot(path, root))
    )
  );
}

export function filterAgentAssets(
  assets: AgentAsset[],
  scope: AgentAssetScope,
  query: string,
  configuredRoots: string[] = [],
): AgentAsset[] {
  const normalizedQuery = query.trim().toLowerCase();

  return assets.filter((asset) => {
    if (!isSkillDescriptor(asset)) {
      return false;
    }
    if (scope === "mine" && !isPersonalAgentAsset(asset, configuredRoots)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    return [
      asset.name,
      asset.display_name_zh || "",
      asset.summary_zh || "",
      asset.content,
      asset.source,
      asset.asset_type,
      asset.agent_id,
      asset.file_path,
      asset.relative_path,
      ...asset.tags,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

export function getAgentAssetSummary(asset: AgentAsset): string {
  if (asset.summary_zh?.trim()) {
    return oneLine(asset.summary_zh);
  }

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

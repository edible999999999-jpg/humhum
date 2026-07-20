import type { AgentAsset, LogicalSkill, SkillUsageEvidence } from "@/types";

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

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeLogicalSkillName(name: string): string {
  return normalizeSearchText(name)
    .replace(/[\s_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function parseableTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsedTimestamp(value?: string | null): number | null {
  return meaningfulAssetTimestamp(value);
}

function compareNewest(left?: string | null, right?: string | null): number {
  const leftTime = parsedTimestamp(left);
  const rightTime = parsedTimestamp(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return rightTime - leftTime;
}

function newestValue(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => parsedTimestamp(value) !== null)
    .sort(compareNewest)[0] ?? null;
}

function normalizeContent(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function usageEvidenceKey(evidence: SkillUsageEvidence): string {
  return `${evidence.agent_id}\u0000${evidence.session_id}`;
}

function isNewerEvidence(
  candidate: SkillUsageEvidence,
  current: SkillUsageEvidence,
): boolean {
  const candidateTime = parseableTimestamp(candidate.used_at);
  const currentTime = parseableTimestamp(current.used_at);
  return candidateTime !== null &&
    (currentTime === null || candidateTime > currentTime);
}

function deduplicateUsageEvidence(copies: AgentAsset[]): SkillUsageEvidence[] {
  const sessions = new Map<string, SkillUsageEvidence>();
  for (const copy of copies) {
    for (const evidence of copy.usage_evidence ?? []) {
      const key = usageEvidenceKey(evidence);
      const current = sessions.get(key);
      if (!current || isNewerEvidence(evidence, current)) {
        sessions.set(key, evidence);
      }
    }
  }

  return [...sessions.values()].sort((left, right) => {
    const byUse = compareNewest(left.used_at, right.used_at);
    return byUse || usageEvidenceKey(left).localeCompare(usageEvidenceKey(right));
  });
}

export function groupLogicalSkills(assets: AgentAsset[]): LogicalSkill[] {
  const grouped = new Map<string, AgentAsset[]>();
  for (const asset of assets) {
    const key = normalizeLogicalSkillName(asset.name);
    const copies = grouped.get(key);
    if (copies) {
      copies.push(asset);
    } else {
      grouped.set(key, [asset]);
    }
  }

  const skills = [...grouped.entries()].map(([key, copies]): LogicalSkill => {
    const sessions = deduplicateUsageEvidence(copies);
    const firstCopy = copies[0];
    const localizedCopy = copies.find((copy) => copy.display_name_zh?.trim());
    const summaryCopy = copies.find((copy) => copy.summary_zh?.trim()) ?? firstCopy;
    const contentVariants = new Set(copies.map((copy) => normalizeContent(copy.content)));

    return {
      key,
      name: firstCopy?.name ?? key,
      display_name_zh: localizedCopy?.display_name_zh ?? null,
      summary: summaryCopy ? getAgentAssetSummary(summaryCopy) : "",
      copies,
      sessions,
      latest_used_at: newestValue(sessions.map((session) => session.used_at)),
      latest_modified_at: newestValue(copies.map((copy) => copy.modified_at)),
      session_count: sessions.length,
      agent_count: new Set(copies.map((copy) => copy.agent_id)).size,
      has_multiple_versions: contentVariants.size > 1,
    };
  });

  return skills.sort((left, right) => {
    const leftUsed = parsedTimestamp(left.latest_used_at);
    const rightUsed = parsedTimestamp(right.latest_used_at);
    if (leftUsed !== null || rightUsed !== null) {
      if (leftUsed === null) return 1;
      if (rightUsed === null) return -1;
      if (leftUsed !== rightUsed) return rightUsed - leftUsed;
    }

    const leftModified = parsedTimestamp(left.latest_modified_at);
    const rightModified = parsedTimestamp(right.latest_modified_at);
    if (leftModified !== null || rightModified !== null) {
      if (leftModified === null) return 1;
      if (rightModified === null) return -1;
      if (leftModified !== rightModified) return rightModified - leftModified;
    }

    return left.name.localeCompare(right.name);
  });
}

export function filterLogicalSkills(
  skills: LogicalSkill[],
  query: string,
): LogicalSkill[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...skills];

  return skills.filter((skill) => {
    const values = [
      skill.key,
      skill.name,
      skill.display_name_zh ?? "",
      skill.summary,
      ...skill.copies.flatMap((copy) => [
        copy.name,
        copy.display_name_zh ?? "",
        copy.summary_zh ?? "",
        copy.agent_id,
        copy.asset_type,
        copy.file_path,
        copy.relative_path,
        copy.source,
        copy.content,
        ...copy.tags,
      ]),
      ...skill.sessions.flatMap((session) => [
        session.session_id,
        session.agent_id,
        session.session_path,
        session.workspace ?? "",
      ]),
    ];
    return values.some((value) => normalizeSearchText(value).includes(normalizedQuery));
  });
}

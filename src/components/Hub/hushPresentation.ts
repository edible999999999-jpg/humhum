export type HushFilter = "all" | "attention" | "unread";

export interface HushInboxMessage {
  id: string;
  platform: string;
  sender: string;
  chat?: string | null;
  text: string;
  tier: string;
  importance: number;
  conversation_kind?: HushChatScope | string;
  suggested_reply?: string | null;
  received_at: string;
  source_id?: string | null;
  preview_limited?: boolean;
  raw?: Record<string, unknown>;
}

export interface DerivedContact {
  id: string;
  legacyIds: string[];
  name: string;
  tier: string;
  platforms: string[];
  lastMessage: string;
  lastMessageTime: string;
  importance: number;
  messages: HushInboxMessage[];
}

export interface HushMessageGroup {
  id: string;
  sender: string;
  platform: string;
  chat: string | null;
  messages: HushInboxMessage[];
  startedAt: string;
  endedAt: string;
}

export interface HushConversationState {
  attentionIds: string[];
  readThrough: Record<string, string>;
  legacyMigrations?: Record<string, HushLegacyMigration>;
}

export interface HushLegacyMigration {
  attention: boolean;
  readThrough?: string;
  targetIds: string[];
}

export interface HushConversationIdentity {
  id: string;
  name: string;
  legacyIds: string[];
}

export interface HushPlatformIdentity {
  key: "dingtalk" | "wechat" | "other";
  label: string;
}

export type HushChatScope = "direct" | "group" | "unknown";

type HushConversationKind =
  | "dws-id"
  | "dws-chat"
  | "notification-thread"
  | "sender";

const EMPTY_HUSH_CONVERSATION_STATE: HushConversationState = {
  attentionIds: [],
  readThrough: {},
};

export function getHushChatScope(
  message: Pick<HushInboxMessage, "conversation_kind" | "raw">,
): HushChatScope {
  const explicit =
    normalizeHushClassifier(message.conversation_kind) ??
    normalizeHushClassifier(message.raw?.conversation_kind);
  if (explicit === "direct" || explicit === "single" || explicit === "single_chat") {
    return "direct";
  }
  if (explicit === "group" || explicit === "group_chat") {
    return "group";
  }

  const legacySingleChat = message.raw?.single_chat;
  if (legacySingleChat === true) return "direct";
  if (legacySingleChat === false) return "group";
  return "unknown";
}

export function getHushConversationScope(
  messages: Array<Pick<HushInboxMessage, "conversation_kind" | "raw">>,
): HushChatScope {
  const knownScopes = new Set(
    messages
      .map(getHushChatScope)
      .filter((scope): scope is Exclude<HushChatScope, "unknown"> =>
        scope !== "unknown"
      ),
  );
  return knownScopes.size === 1
    ? (knownScopes.values().next().value ?? "unknown")
    : "unknown";
}

export function getHushConversationScopeLabel(
  messages: Array<Pick<HushInboxMessage, "conversation_kind" | "raw">>,
): string {
  const scope = getHushConversationScope(messages);
  if (scope === "direct") return "单聊 · 可回复";
  if (scope === "group") return "群聊 · 仅观察";
  return "类型待确认 · 仅观察";
}

export function compareHushContacts(
  a: Pick<DerivedContact, "importance" | "lastMessageTime">,
  b: Pick<DerivedContact, "importance" | "lastMessageTime">,
): number {
  const aTime = Date.parse(a.lastMessageTime);
  const bTime = Date.parse(b.lastMessageTime);
  const timeDifference =
    (Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY) -
    (Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY);
  return timeDifference || b.importance - a.importance;
}

export function sortHushContactsByAttention(
  contacts: DerivedContact[],
  state: Pick<HushConversationState, "attentionIds">,
): DerivedContact[] {
  const attentionIds = new Set(state.attentionIds);
  return [...contacts].sort((a, b) => {
    const attentionDifference =
      Number(attentionIds.has(b.id)) - Number(attentionIds.has(a.id));
    return attentionDifference || compareHushContacts(a, b);
  });
}

export function getHushPriorityLabel(
  importance: number,
  attention: boolean,
): string {
  if (attention) return "P0 · 特别关注";
  if (importance >= 5) return "P1";
  if (importance >= 4) return "P2";
  if (importance >= 3) return "P3";
  return "P4";
}

export function formatHushConversationTime(
  value: string,
  now: Date = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const valueStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (dayStart.getTime() - valueStart.getTime()) / 86_400_000,
  );
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function getHushConversationIdentity(
  message: Pick<
    HushInboxMessage,
    "platform" | "sender" | "chat" | "source_id" | "raw"
  >,
): HushConversationIdentity {
  const platformKey =
    normalizeHushClassifier(message.platform) ?? "unknown-platform";
  const senderKey = trimHushIdentityPart(message.sender) ?? "unknown-sender";
  const senderName = message.sender.trim() || "Unknown sender";
  const legacyIds = [getB6HushConversationId(message)];
  const source = normalizeHushClassifier(message.raw?.source);
  const sourceId = normalizeHushClassifier(message.source_id);
  const isDwsMessage =
    sourceId?.startsWith("dws:") === true || source === "dws";
  if (isDwsMessage) {
    const conversationId =
      trimHushIdentityPart(message.raw?.conversation_id) ??
      trimHushIdentityPart(message.raw?.chat_id);
    if (conversationId) {
      const chatName =
        trimHushIdentityPart(message.chat) ??
        trimHushIdentityPart(message.raw?.chat);
      return {
        id: createHushConversationId(
          platformKey,
          "dws-id",
          conversationId,
        ),
        name: chatName || senderName,
        legacyIds,
      };
    }

    const chatKey =
      trimHushIdentityPart(message.raw?.chat) ??
      trimHushIdentityPart(message.chat);
    if (chatKey) {
      return {
        id: createHushConversationId(platformKey, "dws-chat", chatKey),
        name: trimHushIdentityPart(message.chat) ?? chatKey,
        legacyIds,
      };
    }
  }

  const isMacNotification =
    source === "macos_notification_center" ||
    sourceId?.startsWith("com.tencent.xinwechat:") === true ||
    sourceId?.startsWith("com.alibaba.dingtalkmac:") === true;
  const notificationThreadKey =
    trimHushIdentityPart(message.raw?.threadIdentifier) ??
    (isMacNotification
      ? (trimHushIdentityPart(message.raw?.chat) ??
        trimHushIdentityPart(message.chat))
      : null);
  if (notificationThreadKey) {
    return {
      id: createHushConversationId(
        platformKey,
        "notification-thread",
        notificationThreadKey,
      ),
      name: senderName,
      legacyIds,
    };
  }

  return {
    id: createHushConversationId(platformKey, "sender", senderKey),
    name: senderName,
    legacyIds,
  };
}

export function groupHushMessages(
  messages: HushInboxMessage[],
): HushMessageGroup[] {
  const chronological = orderHushMessages(messages);

  return chronological.reduce<HushMessageGroup[]>((groups, message) => {
    const previous = groups[groups.length - 1];
    if (
      previous?.sender === message.sender &&
      previous.platform === message.platform
    ) {
      previous.messages.push(message);
      previous.endedAt = message.received_at;
      return groups;
    }

    groups.push({
      id: `${message.platform}:${message.sender}:${message.id}`,
      sender: message.sender,
      platform: message.platform,
      chat: message.chat ?? null,
      messages: [message],
      startedAt: message.received_at,
      endedAt: message.received_at,
    });
    return groups;
  }, []);
}

export function getLatestHushMessage(
  messages: HushInboxMessage[],
): HushInboxMessage | null {
  const chronological = orderHushMessages(messages);
  return chronological[chronological.length - 1] ?? null;
}

export function isHushContactUnread(
  contact: DerivedContact,
  state: HushConversationState,
): boolean {
  return getHushUnreadCount(contact, state) > 0;
}

export function getHushUnreadCount(
  contact: DerivedContact,
  state: HushConversationState,
): number {
  const readThrough = state.readThrough[contact.id];
  if (!readThrough) return contact.messages.length;

  const chronological = orderHushMessages(contact.messages);
  const readTime = parseHushTimestamp(readThrough);
  if (readTime !== null) {
    return chronological.filter((message) => {
      const messageTime = parseHushTimestamp(message.received_at);
      return messageTime === null || messageTime > readTime;
    }).length;
  }

  let lastReadIndex = -1;
  chronological.forEach((message, index) => {
    if (message.received_at === readThrough) {
      lastReadIndex = index;
    }
  });
  return lastReadIndex >= 0
    ? chronological.length - lastReadIndex - 1
    : chronological.length;
}

export function filterHushContacts(
  contacts: DerivedContact[],
  filter: HushFilter,
  state: HushConversationState,
): DerivedContact[] {
  if (filter === "attention") {
    const attentionIds = new Set(state.attentionIds);
    return contacts.filter((contact) => attentionIds.has(contact.id));
  }
  if (filter === "unread") {
    return contacts.filter((contact) => isHushContactUnread(contact, state));
  }
  return contacts;
}

export function filterHushContactsByName(
  contacts: DerivedContact[],
  query: string,
): DerivedContact[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return contacts;

  return contacts.filter((contact) =>
    contact.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function formatHushMessageText(raw: string): string {
  const readableRaw = extractHushStructuredText(raw) ?? raw;
  const entityNames: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  const decodeEntity = (_match: string, entity: string): string => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const digits = entity.slice(isHex ? 2 : 1);
      const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
      if (
        Number.isFinite(codePoint) &&
        codePoint > 0 &&
        codePoint <= 0x10ffff
      ) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return "";
        }
      }
      return "";
    }
    return entityNames[entity.toLowerCase()] ?? `&${entity};`;
  };

  return readableRaw
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(https?:\/\/[^>\s]+)>/gi, "$1")
    .replace(/<mailto:([^>\s]+)>/gi, "$1")
    .replace(/<@[^>\s]+>/g, "@")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\?xml\b[^>]*\?>/gi, "")
    .replace(/<\/?[A-Za-z][A-Za-z0-9:_-]*(?:\s[^<>]*?)?\s*\/?>/g, "")
    .replace(
      /!\[([^\]]*)\]\((?:\\.|[^)])*\)/g,
      (_match, alt: string) => (alt.trim() ? `图片：${alt.trim()}` : "图片"),
    )
    .replace(
      /\[([^\]]*)\]\((?:\\.|[^)])*\)/g,
      (_match, label: string) => label.trim(),
    )
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/`+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, decodeEntity)
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHushStructuredText(raw: string): string | null {
  const trimmed = raw.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return null;
  }

  try {
    return readHushStructuredText(JSON.parse(trimmed), 0);
  } catch {
    return null;
  }
}

function readHushStructuredText(value: unknown, depth: number): string | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => readHushStructuredText(entry, depth + 1))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (!isRecord(value)) return null;

  for (const key of [
    "textContent",
    "markdownContent",
    "imageContent",
    "text",
    "content",
    "markdown",
    "message",
  ]) {
    const candidate = readHushStructuredText(value[key], depth + 1);
    if (candidate) return candidate;
  }
  return null;
}

export function resolveHushSelectedContact(
  contacts: DerivedContact[],
  selectedId: string | null,
): DerivedContact | null {
  return selectedId
    ? (contacts.find((contact) => contact.id === selectedId) ?? null)
    : null;
}

export function getHushPlatformIdentity(
  platform: string,
): HushPlatformIdentity {
  const normalized = platform.toLowerCase();
  if (normalized.includes("dingtalk") || normalized === "钉钉") {
    return { key: "dingtalk", label: "钉钉" };
  }
  if (normalized.includes("wechat") || normalized === "微信") {
    return { key: "wechat", label: "WeChat" };
  }
  return { key: "other", label: platform };
}

export function parseHushConversationState(
  raw: string | null,
): HushConversationState {
  if (!raw) return { ...EMPTY_HUSH_CONVERSATION_STATE, readThrough: {} };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) {
      return { ...EMPTY_HUSH_CONVERSATION_STATE, readThrough: {} };
    }
    if (!Array.isArray(parsed.attentionIds) || !isRecord(parsed.readThrough)) {
      return { ...EMPTY_HUSH_CONVERSATION_STATE, readThrough: {} };
    }

    const attentionIds = parsed.attentionIds.filter(
      (id): id is string => typeof id === "string",
    );
    const readThrough = Object.fromEntries(
      Object.entries(parsed.readThrough).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const legacyMigrations = parseHushLegacyMigrations(
      parsed.legacyMigrations,
    );
    return {
      attentionIds: Array.from(new Set(attentionIds)),
      readThrough,
      ...(legacyMigrations ? { legacyMigrations } : {}),
    };
  } catch {
    return { ...EMPTY_HUSH_CONVERSATION_STATE, readThrough: {} };
  }
}

export function serializeHushConversationState(
  state: HushConversationState,
): string {
  return JSON.stringify({
    version: 1,
    attentionIds: Array.from(new Set(state.attentionIds)),
    readThrough: state.readThrough,
    ...(state.legacyMigrations
      ? { legacyMigrations: state.legacyMigrations }
      : {}),
  });
}

export function migrateHushConversationState(
  state: HushConversationState,
  contacts: Array<Pick<DerivedContact, "id" | "legacyIds">>,
): HushConversationState {
  const canonicalIds = new Set(contacts.map(({ id }) => id));
  const legacyTargets = new Map<string, string[]>();
  for (const contact of contacts) {
    for (const legacyId of new Set(contact.legacyIds)) {
      if (!legacyId || legacyId === contact.id) continue;
      const targets = legacyTargets.get(legacyId) ?? [];
      if (!targets.includes(contact.id)) targets.push(contact.id);
      legacyTargets.set(legacyId, targets);
    }
  }

  const attentionIds = new Set(state.attentionIds);
  const readThrough = { ...state.readThrough };
  const legacyMigrations = Object.fromEntries(
    Object.entries(state.legacyMigrations ?? {}).map(([legacyId, migration]) => [
      legacyId,
      { ...migration, targetIds: [...migration.targetIds] },
    ]),
  );
  let changed = attentionIds.size !== state.attentionIds.length;

  for (const [legacyId, targets] of legacyTargets) {
    if (canonicalIds.has(legacyId)) continue;
    let migration = legacyMigrations[legacyId];
    if (
      !migration &&
      !attentionIds.has(legacyId) &&
      readThrough[legacyId] === undefined
    ) {
      continue;
    }
    if (!migration) {
      migration = {
        attention: attentionIds.has(legacyId),
        ...(readThrough[legacyId] !== undefined
          ? { readThrough: readThrough[legacyId] }
          : {}),
        targetIds: [],
      };
      legacyMigrations[legacyId] = migration;
      changed = true;
    }

    if (attentionIds.delete(legacyId)) changed = true;
    if (readThrough[legacyId] !== undefined) {
      delete readThrough[legacyId];
      changed = true;
    }

    for (const targetId of targets) {
      if (migration.targetIds.includes(targetId)) continue;
      if (migration.attention) attentionIds.add(targetId);
      if (migration.readThrough !== undefined) {
        readThrough[targetId] = laterHushReadThrough(
          readThrough[targetId],
          migration.readThrough,
        );
      }
      migration.targetIds.push(targetId);
      changed = true;
    }
  }

  return changed
    ? {
        attentionIds: Array.from(attentionIds),
        readThrough,
        ...(Object.keys(legacyMigrations).length > 0
          ? { legacyMigrations }
          : {}),
      }
    : state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHushLegacyMigrations(
  value: unknown,
): Record<string, HushLegacyMigration> | undefined {
  if (!isRecord(value)) return undefined;
  const migrations: Record<string, HushLegacyMigration> = {};
  for (const [legacyId, candidate] of Object.entries(value)) {
    if (
      !isRecord(candidate) ||
      typeof candidate.attention !== "boolean" ||
      !Array.isArray(candidate.targetIds)
    ) {
      continue;
    }
    migrations[legacyId] = {
      attention: candidate.attention,
      ...(typeof candidate.readThrough === "string"
        ? { readThrough: candidate.readThrough }
        : {}),
      targetIds: Array.from(
        new Set(
          candidate.targetIds.filter(
            (targetId): targetId is string => typeof targetId === "string",
          ),
        ),
      ),
    };
  }
  return migrations;
}

function trimHushIdentityPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeHushClassifier(value: unknown): string | null {
  const normalized = trimHushIdentityPart(value)?.toLowerCase();
  return normalized || null;
}

function createHushConversationId(
  platform: string,
  kind: HushConversationKind,
  value: string,
): string {
  return `hush:v2:${kind}:${encodeURIComponent(platform)}:${encodeURIComponent(value)}`;
}

function getB6HushConversationId(
  message: Pick<
    HushInboxMessage,
    "platform" | "sender" | "chat" | "source_id" | "raw"
  >,
): string {
  const isDwsMessage =
    message.source_id?.startsWith("dws:") || message.raw?.source === "dws";
  if (isDwsMessage) {
    const conversationId = trimHushIdentityPart(
      message.raw?.conversation_id,
    );
    const chatName = trimHushIdentityPart(message.chat);
    const conversationKey = conversationId ?? chatName;
    if (conversationKey) {
      return `${message.platform}:conversation:${conversationKey}`;
    }
  }
  return `${message.platform}:${message.sender}`;
}

function laterHushReadThrough(
  current: string | undefined,
  candidate: string,
): string {
  if (!current) return candidate;
  const currentTime = parseHushTimestamp(current);
  const candidateTime = parseHushTimestamp(candidate);
  return currentTime !== null &&
    candidateTime !== null &&
    candidateTime > currentTime
    ? candidate
    : current;
}

function orderHushMessages(messages: HushInboxMessage[]): HushInboxMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aTime = parseHushTimestamp(a.message.received_at);
      const bTime = parseHushTimestamp(b.message.received_at);
      if (aTime !== null && bTime !== null && aTime !== bTime) {
        return aTime - bTime;
      }
      if ((aTime !== null) !== (bTime !== null)) {
        return aTime !== null ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ message }) => message);
}

function parseHushTimestamp(value: string): number | null {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

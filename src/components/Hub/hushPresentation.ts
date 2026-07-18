export type HushFilter = "all" | "attention" | "unread";

export interface HushInboxMessage {
  id: string;
  platform: string;
  sender: string;
  chat?: string | null;
  text: string;
  tier: string;
  importance: number;
  suggested_reply?: string | null;
  received_at: string;
  source_id?: string | null;
  preview_limited?: boolean;
  raw?: Record<string, unknown>;
}

export interface DerivedContact {
  id: string;
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
}

export interface HushPlatformIdentity {
  key: "dingtalk" | "wechat" | "other";
  label: string;
}

const EMPTY_HUSH_CONVERSATION_STATE: HushConversationState = {
  attentionIds: [],
  readThrough: {},
};

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

export function getHushConversationIdentity(
  message: Pick<
    HushInboxMessage,
    "platform" | "sender" | "chat" | "source_id" | "raw"
  >,
): { id: string; name: string } {
  const platformKey =
    normalizeHushIdentityPart(message.platform) ?? "unknown-platform";
  const senderKey =
    normalizeHushIdentityPart(message.sender) ?? "unknown-sender";
  const senderName = message.sender.trim() || "Unknown sender";
  const source = normalizeHushIdentityPart(message.raw?.source);
  const sourceId = normalizeHushIdentityPart(message.source_id);
  const isDwsMessage =
    sourceId?.startsWith("dws:") === true || source === "dws";
  if (isDwsMessage) {
    const conversationKey =
      normalizeHushIdentityPart(message.raw?.conversation_id) ??
      normalizeHushIdentityPart(message.raw?.chat_id);
    if (conversationKey) {
      const chatName = message.chat?.trim();
      return {
        id: `${platformKey}:conversation:${conversationKey}`,
        name: chatName || senderName,
      };
    }
  }

  const isMacNotification =
    source === "macos_notification_center" ||
    sourceId?.startsWith("com.tencent.xinwechat:") === true ||
    sourceId?.startsWith("com.alibaba.dingtalkmac:") === true;
  const notificationThreadKey =
    normalizeHushIdentityPart(message.raw?.threadIdentifier) ??
    (isMacNotification
      ? (normalizeHushIdentityPart(message.raw?.chat) ??
        normalizeHushIdentityPart(message.chat))
      : null);
  if (notificationThreadKey) {
    return {
      id: `${platformKey}:conversation:${notificationThreadKey}`,
      name: senderName,
    };
  }

  return {
    id: `${platformKey}:${senderKey}`,
    name: senderName,
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
    return {
      attentionIds: Array.from(new Set(attentionIds)),
      readThrough,
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
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHushIdentityPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
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

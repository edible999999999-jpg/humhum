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
  message: Pick<HushInboxMessage, "platform" | "sender" | "chat" | "source_id" | "raw">,
): { id: string; name: string } {
  const isDwsMessage =
    message.source_id?.startsWith("dws:") || message.raw?.source === "dws";
  if (isDwsMessage) {
    const conversationId =
      typeof message.raw?.conversation_id === "string"
        ? message.raw.conversation_id.trim()
        : "";
    const chatName = message.chat?.trim() ?? "";
    const conversationKey = conversationId || chatName;
    if (conversationKey) {
      return {
        id: `${message.platform}:conversation:${conversationKey}`,
        name: chatName || message.sender,
      };
    }
  }

  return {
    id: `${message.platform}:${message.sender}`,
    name: message.sender,
  };
}

export function groupHushMessages(messages: HushInboxMessage[]): HushMessageGroup[] {
  const chronological = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aTime = Date.parse(a.message.received_at);
      const bTime = Date.parse(b.message.received_at);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime;
      }
      if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
        return Number.isFinite(aTime) ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ message }) => message);

  return chronological.reduce<HushMessageGroup[]>((groups, message) => {
    const previous = groups[groups.length - 1];
    if (previous?.sender === message.sender && previous.platform === message.platform) {
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
  const readThrough = state.readThrough[contact.id];
  if (!readThrough) return true;

  const latestTime = Date.parse(contact.lastMessageTime);
  const readTime = Date.parse(readThrough);
  if (Number.isFinite(latestTime) && Number.isFinite(readTime)) {
    return latestTime > readTime;
  }
  return contact.lastMessageTime > readThrough;
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

export function parseHushConversationState(raw: string | null): HushConversationState {
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

export function serializeHushConversationState(state: HushConversationState): string {
  return JSON.stringify({
    version: 1,
    attentionIds: Array.from(new Set(state.attentionIds)),
    readThrough: state.readThrough,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

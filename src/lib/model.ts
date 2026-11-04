import { messageText, normalizeText } from "./markdown";

export type Section = {
  id: string;
  title: string;
  body: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  sections: Section[];
  requestId?: string;
  source?: SourceReference | null;
  routing?: { decision: "branch" | "continue"; reason: string };
  model?: string;
  context?: { fullIds: string[]; summaryIds: string[]; truncated: boolean };
};

export type SourceReference = {
  explorationId: string;
  messageId: string;
  sectionId: string;
  quote?: string;
  endSectionId?: string;
};

export type Exploration = {
  id: string;
  title: string;
  summary: string;
  parentId: string | null;
  source: SourceReference | null;
  messages: Message[];
  position: [number, number, number];
};

export type Connection = {
  id: string;
  from: string;
  to: string;
  type: "related" | "synthesis";
  reason: string;
  status: "suggested" | "accepted";
};

export type Conversation = {
  id: string;
  title: string;
  rootId: string;
  explorations: Record<string, Exploration>;
  kind?: "sample" | "live";
  connections?: Connection[];
};

function findExploration(space: Conversation, id: string): Exploration {
  const exploration = space.explorations[id];
  if (!exploration) {
    throw new Error(`Exploration "${id}" does not exist.`);
  }
  return exploration;
}

export function getPath(space: Conversation, id: string): Exploration[] {
  const path: Exploration[] = [];
  const visited = new Set<string>();
  let currentId: string | null = id;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new Error(`Navigation parent cycle detected at "${currentId}".`);
    }
    visited.add(currentId);
    const current = findExploration(space, currentId);
    path.unshift(current);
    currentId = current.parentId;
  }

  if (path[0]?.id !== space.rootId) {
    throw new Error(`Exploration "${id}" is not connected to the conversation root.`);
  }
  return path;
}

export function getDepth(space: Conversation, id: string): number {
  return getPath(space, id).length - 1;
}

export function getChildren(space: Conversation, id: string): Exploration[] {
  findExploration(space, id);
  return Object.values(space.explorations).filter(
    (exploration) => exploration.parentId === id,
  );
}

export function getSectionChildren(
  space: Conversation,
  sectionId: string,
): Exploration[] {
  return Object.values(space.explorations).filter(
    (exploration) => exploration.source?.sectionId === sectionId,
  );
}

export const CONVERSATION_LIMITS = {
  explorations: 200,
  messages: 1000,
  sectionsPerMessage: 32,
  bodyLength: 50_000,
  totalText: 1_500_000,
  quoteLength: 12_000,
  coordinate: 10_000_000,
} as const;

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must contain plain data.`);
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => unsafeKeys.has(key))) {
    throw new Error(`${label} contains an unsafe property.`);
  }
  return result;
}

function fields(value: Record<string, unknown>, allowed: string[], label: string) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`${label} contains an unsupported field: ${extra}.`);
}

function text(value: unknown, label: string, max = 500, allowEmpty = true): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? "text" : "nonempty text"} up to ${max} characters.`);
  }
}

function identifier(value: unknown, label: string): asserts value is string {
  text(value, label, 160, false);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || unsafeKeys.has(value)) {
    throw new Error(`${label} is not a valid identifier.`);
  }
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${label} must be a list with at most ${max} items.`);
  }
  return value;
}

function referenceShape(value: unknown, label: string): asserts value is SourceReference {
  const source = object(value, label);
  fields(source, ["explorationId", "messageId", "sectionId", "quote", "endSectionId"], label);
  for (const field of ["explorationId", "messageId", "sectionId"]) identifier(source[field], `${label} ${field}`);
  if (source.endSectionId !== undefined) identifier(source.endSectionId, `${label} end section`);
  if (source.quote !== undefined) text(source.quote, `${label} quote`, CONVERSATION_LIMITS.quoteLength, false);
}

export function validateSourceReference(
  space: Conversation,
  value: unknown,
): asserts value is SourceReference {
  referenceShape(value, "Source reference");
  const exploration = space.explorations[value.explorationId];
  const message = exploration?.messages.find((item) => item.id === value.messageId);
  const start = message?.sections.findIndex((section) => section.id === value.sectionId) ?? -1;
  const end = value.endSectionId
    ? message?.sections.findIndex((section) => section.id === value.endSectionId) ?? -1
    : start;
  if (!message || message.role !== "assistant" || start < 0 || end < start) {
    throw new Error("The selection has an invalid source reference: its sections must belong to one assistant message.");
  }
  if (value.quote !== undefined) {
    const selected = { ...message, sections: message.sections.slice(start, end + 1) };
    const body = normalizeText(messageText(selected));
    if (!body.includes(normalizeText(value.quote))) {
      throw new Error("The selection has an invalid source reference: its quote does not match the source text.");
    }
  }
}

export function validateConversation(value: unknown): asserts value is Conversation {
  const space = object(value, "Conversation");
  fields(space, ["id", "title", "rootId", "explorations", "kind", "connections"], "Conversation");
  identifier(space.id, "Conversation ID");
  text(space.title, "Conversation title");
  identifier(space.rootId, "Conversation root ID");
  if (space.kind !== undefined && space.kind !== "sample" && space.kind !== "live") {
    throw new Error("Conversation kind must be sample or live.");
  }
  const explorations = object(space.explorations, "Explorations");
  const entries = Object.entries(explorations);
  if (entries.length === 0 || entries.length > CONVERSATION_LIMITS.explorations) {
    throw new Error(`A conversation must contain 1–${CONVERSATION_LIMITS.explorations} explorations.`);
  }
  if (!Object.hasOwn(explorations, space.rootId)) {
    throw new Error(`Conversation root "${space.rootId}" does not exist.`);
  }

  const messageIds = new Set<string>();
  const sectionIds = new Set<string>();
  const requestIds = new Set<string>();
  let totalText = 0;
  for (const [key, item] of entries) {
    identifier(key, "Exploration key");
    const exploration = object(item, `Exploration "${key}"`);
    fields(exploration, ["id", "title", "summary", "parentId", "source", "messages", "position"], `Exploration "${key}"`);
    if (key !== exploration.id) throw new Error(`Exploration key "${key}" must match its nonempty ID.`);
    text(exploration.title, "Exploration title");
    text(exploration.summary, "Exploration summary", 3000);
    totalText += exploration.title.length + exploration.summary.length;
    if (key === space.rootId) {
      if (exploration.parentId !== null || exploration.source !== null) {
        throw new Error("The conversation root cannot have a parent or source.");
      }
    } else {
      if (exploration.parentId === null) throw new Error(`Exploration "${key}" is missing its navigation parent.`);
      identifier(exploration.parentId, "Navigation parent");
      if (!Object.hasOwn(explorations, exploration.parentId)) {
        throw new Error(`Exploration "${key}" refers to missing parent "${exploration.parentId}".`);
      }
    }
    if (exploration.source !== null) referenceShape(exploration.source, "Exploration source");
    const position = list(exploration.position, "Position", 3);
    if (position.length !== 3 || position.some((number) => typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > CONVERSATION_LIMITS.coordinate)) {
      throw new Error(`Exploration "${key}" must have three bounded finite coordinates.`);
    }
    for (const item of list(exploration.messages, "Messages", CONVERSATION_LIMITS.messages)) {
      const message = object(item, "Message");
      fields(message, ["id", "role", "sections", "requestId", "source", "routing", "model", "context"], "Message");
      identifier(message.id, "Message ID");
      if (messageIds.has(message.id)) throw new Error(`Duplicate or empty message ID "${message.id}".`);
      messageIds.add(message.id);
      if (messageIds.size > CONVERSATION_LIMITS.messages) throw new Error("The conversation has too many messages.");
      if (message.role !== "user" && message.role !== "assistant") throw new Error(`Message "${message.id}" has an invalid author role.`);
      if (message.requestId !== undefined) {
        identifier(message.requestId, "Request ID");
        if (message.role === "assistant") {
          if (requestIds.has(message.requestId)) throw new Error(`Duplicate completed request ID "${message.requestId}".`);
          requestIds.add(message.requestId);
        }
      }
      if (message.source !== undefined && message.source !== null) referenceShape(message.source, "Message source");
      if (message.model !== undefined) text(message.model, "Model name", 200, false);
      if (message.routing !== undefined) {
        const routing = object(message.routing, "Routing");
        fields(routing, ["decision", "reason"], "Routing");
        if (routing.decision !== "branch" && routing.decision !== "continue") throw new Error("Routing decision must be branch or continue.");
        text(routing.reason, "Routing reason", 3000);
      }
      if (message.context !== undefined) {
        const context = object(message.context, "Context");
        fields(context, ["fullIds", "summaryIds", "truncated"], "Context");
        if (typeof context.truncated !== "boolean") throw new Error("Context truncated must be true or false.");
        for (const key of ["fullIds", "summaryIds"]) {
          for (const id of list(context[key], `Context ${key}`, CONVERSATION_LIMITS.explorations)) {
            identifier(id, "Context exploration ID");
            if (!Object.hasOwn(explorations, id)) throw new Error(`Context references missing exploration "${id}".`);
          }
        }
      }
      const sections = list(message.sections, "Sections", CONVERSATION_LIMITS.sectionsPerMessage);
      if (sections.length === 0) throw new Error("A message must contain at least one section.");
      for (const item of sections) {
        const section = object(item, "Section");
        fields(section, ["id", "title", "body"], "Section");
        identifier(section.id, "Section ID");
        if (sectionIds.has(section.id)) throw new Error(`Duplicate or empty section ID "${section.id}".`);
        sectionIds.add(section.id);
        text(section.title, "Section title");
        text(section.body, "Section body", CONVERSATION_LIMITS.bodyLength);
        totalText += section.title.length + section.body.length;
      }
    }
  }
  if (totalText > CONVERSATION_LIMITS.totalText) throw new Error("The conversation contains too much text to import.");

  const typed = value as Conversation;
  for (const exploration of Object.values(typed.explorations)) {
    getPath(typed, exploration.id);
    if (exploration.source) {
      validateSourceReference(typed, exploration.source);
      if (exploration.source.explorationId !== exploration.parentId) {
        throw new Error(`Exploration "${exploration.id}" must originate in its navigation parent.`);
      }
    }
    for (const message of exploration.messages) {
      if (message.source) validateSourceReference(typed, message.source);
    }
  }
  if (space.connections !== undefined) {
    const connectionIds = new Set<string>();
    for (const item of list(space.connections, "Connections", 2000)) {
      const connection = object(item, "Connection");
      fields(connection, ["id", "from", "to", "type", "reason", "status"], "Connection");
      identifier(connection.id, "Connection ID");
      if (connectionIds.has(connection.id)) throw new Error(`Duplicate connection ID "${connection.id}".`);
      connectionIds.add(connection.id);
      for (const key of ["from", "to"]) {
        identifier(connection[key], `Connection ${key}`);
        if (!Object.hasOwn(explorations, connection[key])) throw new Error("Connection refers to a missing exploration.");
      }
      if (connection.from === connection.to) throw new Error("A connection must link different explorations.");
      if (connection.type !== "related" && connection.type !== "synthesis") throw new Error("Unsupported connection type.");
      if (connection.status !== "suggested" && connection.status !== "accepted") throw new Error("Connection status must be suggested or accepted.");
      if (connection.type === "synthesis" && connection.status !== "accepted") throw new Error("A synthesis connection must be accepted.");
      text(connection.reason, "Connection reason", 3000);
    }
  }
}

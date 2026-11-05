import type { Conversation, Message } from "@/lib/model";

export type TranscriptMessage = { topicId: string; topicTitle: string; message: Message };
export type TranscriptTurn = { id: string; questions: TranscriptMessage[]; answers: TranscriptMessage[] };

/** A reading view of the graph. It never rewrites messages or their sources. */
export function conversationTranscript(space: Conversation, knownOrder: string[] = []): TranscriptTurn[] {
  const topics = Object.values(space.explorations);
  const requestIds = new Set(topics.flatMap((topic) => topic.messages.flatMap((message) => message.requestId ? [message.requestId] : [])));
  const turns = new Map<string, TranscriptTurn>();
  const messageTurns = new Map<string, string>();
  const topicTurns = new Map<string, string[]>();
  const edges = new Map<string, Set<string>>();
  const messageKey = (topicId: string, messageId: string) => JSON.stringify([topicId, messageId]);
  const connect = (before: string | undefined, after: string | undefined) => {
    if (!before || !after || before === after) return;
    const next = edges.get(before) ?? new Set<string>(); next.add(after); edges.set(before, next);
  };

  for (const topic of topics) {
    let previous: string | undefined;
    let precedingQuestion: string | undefined;
    const sequence: string[] = [];
    for (const message of topic.messages) {
      // Split answers copy the question into each destination. Their secondary
      // messages share the request's ID prefix but intentionally lack requestId.
      const split = /^topic-(?:question|answer)-(.+)-\d+$/.exec(message.id)?.[1];
      const requestId = message.requestId ?? (split && requestIds.has(split) ? split : undefined);
      const id = requestId ? `request:${requestId}` : message.role === "assistant" && precedingQuestion ? precedingQuestion : `message:${messageKey(topic.id, message.id)}`;
      if (message.role === "user") precedingQuestion = id;
      else precedingQuestion = undefined;
      const turn = turns.get(id) ?? { id, questions: [], answers: [] };
      const entry = { topicId: topic.id, topicTitle: topic.title, message };
      if (message.role === "assistant") turn.answers.push(entry);
      else {
        const key = (item: Message) => JSON.stringify([item.sections.map(({ title, body }) => ({ title, body })), item.source ?? null]);
        if (!turn.questions.some((item) => key(item.message) === key(message))) turn.questions.push(entry);
      }
      turns.set(id, turn); messageTurns.set(messageKey(topic.id, message.id), id);
      connect(previous, id); previous = id;
      if (sequence.at(-1) !== id) sequence.push(id);
    }
    topicTurns.set(topic.id, sequence);
  }

  for (const topic of topics) {
    const first = topicTurns.get(topic.id)?.[0];
    const source = topic.source;
    connect(source ? messageTurns.get(messageKey(source.explorationId, source.messageId)) : topic.parentId ? topicTurns.get(topic.parentId)?.[0] : undefined, first);
    for (const message of topic.messages) {
      const id = messageTurns.get(messageKey(topic.id, message.id));
      if (message.source) connect(messageTurns.get(messageKey(message.source.explorationId, message.source.messageId)), id);
      // A request can only include topics that already existed. This recovers
      // cross-topic order when the saved context record contains that evidence.
      for (const contextId of [...(message.context?.fullIds ?? []), ...(message.context?.summaryIds ?? [])]) {
        connect(topicTurns.get(contextId)?.[0], id);
      }
    }
  }
  const order = new Map([...knownOrder.filter((id) => turns.has(id)), ...[...turns.keys()].filter((id) => !knownOrder.includes(id))].map((id, index) => [id, index]));
  const waiting = new Map([...turns.keys()].map((id) => [id, 0]));
  for (const targets of edges.values()) for (const id of targets) waiting.set(id, (waiting.get(id) ?? 0) + 1);
  const remaining = new Set(turns.keys());
  const result: TranscriptTurn[] = [];
  while (remaining.size) {
    const available = [...remaining].filter((id) => waiting.get(id) === 0);
    // Older imports can contain conflicting provenance. Keep all content in a
    // stable order instead of hiding it or looping forever.
    const next = (available.length ? available : [...remaining]).sort((a, b) => order.get(a)! - order.get(b)!)[0];
    remaining.delete(next); result.push(turns.get(next)!);
    for (const id of edges.get(next) ?? []) waiting.set(id, (waiting.get(id) ?? 0) - 1);
  }
  return result;
}

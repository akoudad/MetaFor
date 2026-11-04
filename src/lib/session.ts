import type { AnswerRequest, AnswerResult } from "./contracts";
import type { Connection, Conversation, Exploration, Message } from "./model";
import { validateConversation, validateSourceReference } from "./model";

export function createConversation(): Conversation {
  return {
    id: `space-${crypto.randomUUID()}`,
    title: "New conversation",
    kind: "live",
    rootId: "root",
    explorations: {
      root: {
        id: "root",
        title: "New conversation",
        summary: "",
        parentId: null,
        source: null,
        messages: [],
        position: [0, 0, 0],
      },
    },
    connections: [],
  };
}

export function applyAnswer(
  space: Conversation,
  request: AnswerRequest,
  answer: AnswerResult,
): { conversation: Conversation; destinationId: string } {
  validateConversation(space);
  if (space.id !== request.conversation.id) {
    throw new Error("This answer belongs to a different conversation.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(request.requestId)) {
    throw new Error("The answer request has an invalid identifier.");
  }
  if (answer.requestId !== request.requestId) {
    throw new Error("The answer does not match the pending request.");
  }

  for (const exploration of Object.values(space.explorations)) {
    if (exploration.messages.some((message) => message.role === "assistant" && message.requestId === request.requestId)) {
      return { conversation: space, destinationId: exploration.id };
    }
  }

  if (typeof request.question !== "string" || !request.question.trim() || request.question.length > 16_000) {
    throw new Error("The question must contain 1–16,000 characters.");
  }
  if (request.selection) validateSourceReference(space, request.selection);
  const originId = request.selection?.explorationId ?? request.activeId;
  const origin = space.explorations[originId];
  if (!origin) throw new Error("The answer target no longer exists.");
  if (answer.decision !== "branch" && answer.decision !== "continue") {
    throw new Error("The answer has an invalid routing decision.");
  }
  if (!Array.isArray(answer.sections) || answer.sections.length === 0 || answer.sections.length > 32) {
    throw new Error("The answer must contain 1–32 sections.");
  }
  if (answer.sections.some((section) => !section || typeof section.title !== "string" || typeof section.body !== "string")) {
    throw new Error("Each answer section must contain a title and text.");
  }
  if (!answer.context || typeof answer.model !== "string" || !answer.model.trim()) {
    throw new Error("The answer is missing its model or context record.");
  }
  if (!Array.isArray(answer.related) || answer.related.length > 20) {
    throw new Error("The answer has an invalid list of related topics.");
  }

  const initialRoot = origin.id === space.rootId && !origin.messages.some((message) => message.role === "assistant");
  const decision = initialRoot ? "continue" : answer.decision;
  // A topic-level split has a navigation parent, but no selected passage.
  // Never invent a section source from the previous answer's final paragraph.
  const source = request.selection ? structuredClone(request.selection) : null;
  if (decision === "branch" && !origin.messages.some((message) => message.role === "assistant")) {
    throw new Error("Ask the first question before starting another topic.");
  }
  const destinationId = decision === "branch" ? `exploration-${request.requestId}` : originId;
  if (decision === "branch" && space.explorations[destinationId]) {
    throw new Error("The new exploration ID is already in use.");
  }
  const question: Message = {
    id: `question-${request.requestId}`,
    role: "user",
    requestId: request.requestId,
    source,
    sections: [{ id: `prompt-${request.requestId}`, title: "", body: request.question }],
  };
  const response: Message = {
    id: `answer-${request.requestId}`,
    role: "assistant",
    requestId: request.requestId,
    source,
    routing: { decision, reason: initialRoot && answer.decision === "branch" ? "The first answer starts the main conversation." : answer.reason },
    model: answer.model,
    context: structuredClone(answer.context),
    sections: answer.sections.map((section, index) => ({
      id: `section-${request.requestId}-${index}`,
      title: section.title,
      body: section.body,
    })),
  };
  const destination: Exploration = decision === "branch"
    ? {
      id: destinationId,
      title: answer.title,
      summary: answer.summary,
      parentId: originId,
      source,
      messages: [question, response],
      position: [origin.position[0], origin.position[1] - 800, origin.position[2] - 300],
    }
    : {
      ...origin,
      title: initialRoot ? answer.title : origin.title,
      summary: answer.summary,
      messages: [...origin.messages, question, response],
    };
  const connections: Connection[] = [...(space.connections ?? [])];
  for (const [index, related] of answer.related.entries()) {
    if (!related || typeof related.targetId !== "string" || !space.explorations[related.targetId]) {
      throw new Error("The answer references a related topic that does not exist.");
    }
    if (related.targetId === destinationId) continue;
    if (connections.some((connection) => (connection.from === destinationId && connection.to === related.targetId) || (connection.to === destinationId && connection.from === related.targetId))) continue;
    connections.push({
      id: `connection-${request.requestId}-${index}`,
      from: destinationId,
      to: related.targetId,
      type: "related",
      reason: related.reason,
      status: "suggested",
    });
  }
  const conversation: Conversation = {
    ...space,
    title: initialRoot ? answer.title : space.title,
    explorations: { ...space.explorations, [destinationId]: destination },
    connections,
  };
  validateConversation(conversation);
  return { conversation, destinationId };
}

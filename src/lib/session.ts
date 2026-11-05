import type { AnswerRequest, AnswerResult } from "./contracts";
import type { Connection, Conversation, Exploration, Message } from "./model";
import { validateConversation, validateSourceReference } from "./model";
import { validateAnnotationAnswers, validateAnnotations, validateSynthesisSources, validateTopicAnswers } from "./ai";

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
): { conversation: Conversation; destinationId: string; destinationIds: string[]; topicIds: string[] } {
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
      const topicIds = Array.from({ length: 8 }, (_, index) => Object.values(space.explorations).find((topic) => topic.messages.some((message) => message.role === "assistant" && message.id === `topic-answer-${request.requestId}-${index}`))?.id).filter((id): id is string => Boolean(id));
      return { conversation: space, destinationId: exploration.id, destinationIds: [exploration.id, ...topicIds], topicIds };
    }
  }

  if (typeof request.question !== "string" || !request.question.trim() || request.question.length > 16_000) {
    throw new Error("The question must contain 1–16,000 characters.");
  }
  if (request.selection) validateSourceReference(space, request.selection);
  const annotations = validateAnnotations(request.annotations, space);
  if (annotations.length && (request.selection || request.mode !== "auto")) throw new Error("Annotation questions require automatic placement without another selected passage.");
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
  if (!answer.context || !Array.isArray(answer.context.fullIds) || !Array.isArray(answer.context.summaryIds) || typeof answer.model !== "string" || !answer.model.trim()) {
    throw new Error("The answer is missing its model or context record.");
  }
  if (!Array.isArray(answer.related) || answer.related.length > 20) {
    throw new Error("The answer has an invalid list of related topics.");
  }

  const allowed = new Set([...answer.context.fullIds, ...answer.context.summaryIds]);
  const topics = validateTopicAnswers(answer.topics, originId, allowed);
  validateAnnotationAnswers(topics, annotations);
  if (topics.length && request.mode !== "auto") throw new Error("Separate topic answers require automatic placement.");
  if (topics.some((topic) => !Object.hasOwn(space.explorations, topic.targetId))) throw new Error("An additional answer target no longer exists.");
  if (topics.length && (answer.sections.length > 2 || JSON.stringify(answer.sections).length > 4000 || JSON.stringify([answer.sections, ...topics.map((topic) => topic.sections)]).length > 40000)) throw new Error("The multi-topic answer is too large or its overview is not brief.");

  const initialRoot = origin.id === space.rootId && !origin.messages.some((message) => message.role === "assistant");
  const decision = initialRoot || topics.length ? "continue" : answer.decision;
  const sourceIds = validateSynthesisSources(answer.sourceIds, decision, allowed);
  if (sourceIds.some((id) => !Object.hasOwn(space.explorations, id)) || topics.some((topic) => topic.sourceIds?.some((id) => !Object.hasOwn(space.explorations, id)))) throw new Error("A synthesis source no longer exists.");
  const explorations = { ...space.explorations };
  const connections: Connection[] = [...(space.connections ?? [])];
  const outputs = [
    { targetId: originId, decision, title: answer.title, summary: answer.summary, sections: answer.sections, sourceIds },
    ...topics,
  ];
  const destinationIds: string[] = [];
  for (const [outputIndex, output] of outputs.entries()) {
    const primary = outputIndex === 0;
    const part = outputIndex - 1;
    const annotation = !primary ? annotations.find((item) => item.id === topics[part].annotationId) : undefined;
    const source = annotation ? structuredClone(annotation.source) : request.selection ? structuredClone(request.selection) : null;
    const target = explorations[output.targetId];
    if (output.decision === "branch" && !target.messages.some((message) => message.role === "assistant")) throw new Error("Ask the first question before starting another topic.");
    const destinationId = output.decision === "continue" ? target.id : primary ? `exploration-${request.requestId}` : `topic-${request.requestId}-${part}`;
    if (output.decision === "branch" && Object.hasOwn(explorations, destinationId)) throw new Error("The new exploration ID is already in use.");
    const question: Message = {
      id: primary ? `question-${request.requestId}` : `topic-question-${request.requestId}-${part}`,
      role: "user", ...(primary ? { requestId: request.requestId } : {}), source,
      sections: [{ id: primary ? `prompt-${request.requestId}` : `topic-prompt-${request.requestId}-${part}`, title: "", body: annotation?.question ?? request.question }],
    };
    const response: Message = {
      id: primary ? `answer-${request.requestId}` : `topic-answer-${request.requestId}-${part}`,
      role: "assistant", ...(primary ? { requestId: request.requestId } : {}), source,
      routing: { decision: output.decision, reason: primary ? topics.length ? "The overview stays here; each subject has its own topic." : initialRoot && answer.decision === "branch" ? "The first answer starts the main conversation." : answer.reason : output.decision === "continue" ? "Continuing this subject in its existing topic." : "Exploring this subject in its own topic." },
      model: answer.model, context: structuredClone(answer.context),
      sections: output.sections.map((section, index) => ({ id: primary ? `section-${request.requestId}-${index}` : `topic-section-${request.requestId}-${part}-${index}`, title: section.title, body: section.body })),
    };
    explorations[destinationId] = output.decision === "branch" ? {
      id: destinationId, title: output.title, summary: output.summary, parentId: target.id,
      // The request may refer to a passage in another topic. Retain it on the
      // messages without claiming that it is this navigation parent's passage.
      source: source?.explorationId === target.id ? source : null,
      messages: [question, response], position: [target.position[0], target.position[1] - 800, target.position[2] - 300],
    } : {
      ...target, title: primary && initialRoot ? output.title : target.title, summary: output.summary,
      messages: [...target.messages, question, response],
    };
    if ((output.sourceIds?.length ?? 0) >= 2) {
      for (const [index, from] of output.sourceIds!.entries()) connections.push({ id: `synthesis-${request.requestId}-${outputIndex}-${index}`, from, to: destinationId, type: "synthesis", reason: `Combined in ${output.title}.`, status: "accepted" });
    }
    destinationIds.push(destinationId);
  }
  const destinationId = destinationIds[0];
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
    explorations,
    connections,
  };
  validateConversation(conversation);
  return { conversation, destinationId, destinationIds, topicIds: destinationIds.slice(1) };
}

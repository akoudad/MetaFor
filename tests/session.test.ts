import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import type { Conversation, SourceReference } from "../src/lib/model";
import { validateConversation, validateSourceReference } from "../src/lib/model";
import { createSampleConversation } from "../src/lib/sample";
import { applyAnswer, createConversation } from "../src/lib/session";

function request(space: Conversation, selection: SourceReference | null = null): AnswerRequest {
  return { requestId: "test-request", conversation: space, activeId: space.rootId, question: "Explain this in more detail.", selection, mode: "auto", includeIds: [] };
}

function answer(input: AnswerRequest): AnswerResult {
  return {
    requestId: input.requestId, decision: "branch", reason: "Explore this topic separately.",
    title: "A closer look", summary: "A short explanation.",
    sections: [{ title: "Details", body: "This is a **new** answer." }],
    related: [], context: { fullIds: [input.activeId], summaryIds: [], truncated: false }, model: "test-model",
  };
}

test("the first answer fills the empty root even if the model requests a branch", () => {
  const space = createConversation();
  const input = request(space);
  const result = applyAnswer(space, input, answer(input));
  assert.equal(result.destinationId, space.rootId);
  assert.equal(result.conversation.title, "A closer look");
  assert.equal(result.conversation.explorations[space.rootId].messages.length, 2);
  assert.equal(result.conversation.explorations[space.rootId].messages[1].routing?.decision, "continue");
  assert.equal(space.explorations[space.rootId].messages.length, 0);
  validateConversation(result.conversation);
});

test("branching retains an exact source and does not mutate existing answers", () => {
  const space = createSampleConversation();
  const original = JSON.stringify(space);
  const selection = { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", quote: "Compensation is one part of that comparison." };
  const input = request(space, selection);
  const result = applyAnswer(space, input, answer(input));
  const child = result.conversation.explorations[result.destinationId];
  assert.equal(child.parentId, space.rootId);
  assert.deepEqual(child.source, selection);
  assert.deepEqual(child.messages[1].source, selection);
  assert.equal(child.messages[1].sections[0].id, "section-test-request-0");
  assert.equal(JSON.stringify(space), original);
});

test("continue uses the captured selection topic and retains its source", () => {
  const space = createSampleConversation();
  const selection = { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity" };
  const input = request(space, selection);
  const response = { ...answer(input), decision: "continue" as const };
  const result = applyAnswer(space, input, response);
  assert.equal(result.destinationId, "compensation");
  const messages = result.conversation.explorations.compensation.messages;
  assert.deepEqual(messages.at(-1)?.source, selection);
  assert.deepEqual(messages.at(-2)?.source, selection);
  assert.equal(result.conversation.explorations[space.rootId].messages.length, space.explorations[space.rootId].messages.length);
});

test("an unselected new direction links to its parent topic without inventing a section source", () => {
  const space = createSampleConversation();
  const input = { ...request(space), question: "Explain browser caching." };
  const result = applyAnswer(space, input, { ...answer(input), title: "Browser caching" });
  const child = result.conversation.explorations[result.destinationId];
  assert.equal(child.parentId, space.rootId);
  assert.equal(child.source, null);
  assert.equal(child.messages[0].source, null);
  assert.equal(child.messages[1].source, null);
  validateConversation(result.conversation);
});

test("continuations refresh the topic summary while keeping its established title", () => {
  const space = createSampleConversation();
  const input = request(space);
  const original = JSON.stringify(space);
  const response = { ...answer(input), decision: "continue" as const, summary: "The target has changed to summer internships; keep preparing for interviews." };
  const result = applyAnswer(space, input, response);
  assert.equal(result.conversation.explorations[space.rootId].summary, response.summary);
  assert.equal(result.conversation.explorations[space.rootId].title, space.explorations[space.rootId].title);
  assert.equal(result.conversation.title, space.title);
  assert.equal(JSON.stringify(space), original);
  assert.throws(() => applyAnswer(space, input, { ...response, summary: "x".repeat(3001) }), /summary/);
  assert.equal(JSON.stringify(space), original);
});

test("retrying a completed request returns its existing answer", () => {
  const space = createSampleConversation();
  const input = request(space);
  const response = answer(input);
  const first = applyAnswer(space, input, response);
  const retry = applyAnswer(first.conversation, input, response);
  assert.equal(retry.destinationId, first.destinationId);
  assert.equal(retry.conversation, first.conversation);
  assert.equal(retry.conversation.explorations[first.destinationId].messages.length, 2);
});

test("rendered Markdown quotes can span sections in one assistant message", () => {
  const space = createSampleConversation();
  const message = space.explorations[space.rootId].messages[1];
  message.sections[0].body = "Start with **clear evidence**.";
  message.sections[1].title = "Next step";
  message.sections[1].body = "Then [review the result](https://example.com).";
  const source = { explorationId: space.rootId, messageId: message.id, sectionId: message.sections[0].id, endSectionId: message.sections[1].id, quote: "clear evidence.\n\nNext step Then review the result." };
  assert.doesNotThrow(() => validateSourceReference(space, source));
  assert.throws(() => validateSourceReference(space, { ...source, quote: "invented evidence" }), /quote does not match/);
  assert.throws(() => validateSourceReference(space, { ...source, endSectionId: "compensation-equity" }), /one assistant message/);
});

test("stale results and malformed sections fail without changing the conversation", () => {
  const space = createSampleConversation();
  const input = request(space);
  assert.throws(() => applyAnswer(createConversation(), input, answer(input)), /different conversation/);
  const malformed = { ...answer(input), sections: [null] } as unknown as AnswerResult;
  assert.throws(() => applyAnswer(space, input, malformed), (error) => error instanceof Error && !(error instanceof TypeError) && /section/.test(error.message));
});

function moroccoCities() {
  const space = createConversation();
  const input = { ...request(space), requestId: "morocco-cities", question: "Explain Rabat, Fes, Marrakech, and Tangier in separate detail." };
  const response: AnswerResult = {
    ...answer(input), title: "Morocco", summary: "Four cities to explore.",
    sections: [{ title: "Cities", body: "Explore these Moroccan cities individually." }],
    topics: ["Rabat", "Fes", "Marrakech", "Tangier"].map((title) => ({ targetId: space.rootId, decision: "branch", title, summary: `An overview of ${title}.`, sections: [{ title: "Overview", body: `A separate sample overview of ${title}.` }] })),
  };
  return { input, response, result: applyAnswer(space, input, response) };
}

test("one answer creates four city topics and a later answer places histories under the corresponding cities", () => {
  const { result: cities } = moroccoCities();
  assert.equal(cities.destinationId, cities.conversation.rootId);
  assert.equal(cities.destinationIds.length, 5);
  assert.deepEqual(cities.topicIds.map((id) => cities.conversation.explorations[id].title), ["Rabat", "Fes", "Marrakech", "Tangier"]);
  assert.ok(cities.topicIds.every((id) => cities.conversation.explorations[id].parentId === cities.conversation.rootId));
  const selection = { explorationId: cities.conversation.rootId, messageId: "answer-morocco-cities", sectionId: "section-morocco-cities-0", quote: "Moroccan cities" };
  const input = { ...request(cities.conversation, selection), requestId: "city-histories", question: "Explain the histories of Rabat, Fes, and Marrakech." };
  const response: AnswerResult = { ...answer(input), sections: [{ title: "Histories", body: "Each history follows its city." }], context: { fullIds: [input.activeId], summaryIds: cities.topicIds, truncated: false }, topics: cities.topicIds.slice(0, 3).map((targetId) => ({ targetId, decision: "branch", title: `${cities.conversation.explorations[targetId].title} history`, summary: "A focused historical overview.", sections: [{ title: "History", body: "Sample historical discussion." }] })) };
  const original = JSON.stringify(cities.conversation);
  const histories = applyAnswer(cities.conversation, input, response);
  assert.equal(histories.destinationId, cities.conversation.rootId);
  histories.topicIds.forEach((id, index) => {
    const history = histories.conversation.explorations[id];
    assert.equal(history.parentId, cities.topicIds[index]);
    assert.equal(history.source, null, "a cross-target source must not pretend to come from the city parent");
    assert.deepEqual(history.messages[0].source, selection);
    assert.deepEqual(history.messages[1].source, selection);
    assert.equal(history.messages[1].requestId, undefined);
  });
  assert.equal(JSON.stringify(cities.conversation), original);
  validateConversation(histories.conversation);
});

test("multi-topic replay returns every destination even if the retry payload changes", () => {
  const { input, response, result } = moroccoCities();
  const replay = applyAnswer(result.conversation, input, { ...response, topics: [], title: "A different retry" });
  assert.equal(replay.conversation, result.conversation);
  assert.deepEqual(replay.destinationIds, result.destinationIds);
  assert.deepEqual(replay.topicIds, result.topicIds);
  assert.equal(Object.values(replay.conversation.explorations).flatMap((item) => item.messages).filter((message) => message.role === "assistant" && message.requestId === input.requestId).length, 1);
});

test("an existing subject is continued without duplicating it or changing its established title", () => {
  const { result: cities } = moroccoCities();
  const targetId = cities.topicIds[0];
  const input = { ...request(cities.conversation), requestId: "continue-rabat" };
  const response: AnswerResult = { ...answer(input), context: { fullIds: [input.activeId], summaryIds: cities.topicIds, truncated: false }, topics: [{ targetId, decision: "continue", title: "Replacement title", summary: "Rabat with the new comparison incorporated.", sections: [{ title: "More detail", body: "An additional sample detail." }] }] };
  const result = applyAnswer(cities.conversation, input, response);
  assert.equal(Object.keys(result.conversation.explorations).length, 5);
  assert.equal(result.conversation.explorations[targetId].title, "Rabat");
  assert.equal(result.conversation.explorations[targetId].summary, response.topics![0].summary);
  assert.equal(result.conversation.explorations[targetId].messages.length, 4);
  assert.deepEqual(result.topicIds, [targetId]);
});

test("invalid later parts and generated-ID collisions leave the whole original conversation untouched", () => {
  const { result: cities } = moroccoCities();
  const input = { ...request(cities.conversation), requestId: "invalid-batch" };
  const good = { targetId: cities.topicIds[0], decision: "branch" as const, title: "History", summary: "History detail.", sections: [{ title: "Detail", body: "Sample text." }] };
  const response: AnswerResult = { ...answer(input), context: { fullIds: [input.activeId], summaryIds: cities.topicIds, truncated: false }, topics: [good, { ...good, targetId: "invented-city" }] };
  const original = JSON.stringify(cities.conversation);
  assert.throws(() => applyAnswer(cities.conversation, input, response), /target/);
  assert.equal(JSON.stringify(cities.conversation), original);
  const malformed = { ...response, topics: [good, { ...good, sections: [null] }] } as unknown as AnswerResult;
  assert.throws(() => applyAnswer(cities.conversation, input, malformed), (error) => error instanceof Error && !(error instanceof TypeError));
  assert.equal(JSON.stringify(cities.conversation), original);
  const collision = structuredClone(cities.conversation);
  collision.explorations[collision.rootId].messages[0].sections[0].id = "topic-section-invalid-batch-1-0";
  const beforeCollision = JSON.stringify(collision);
  assert.throws(() => applyAnswer(collision, input, { ...response, topics: [good, good] }), /Duplicate.*section/);
  assert.equal(JSON.stringify(collision), beforeCollision);
});

test("a single synthesis creates directed accepted provenance links without deleting its sources", () => {
  const { result: cities } = moroccoCities();
  const input = { ...request(cities.conversation), requestId: "combine-cities", question: "Combine the useful ideas from these cities." };
  const response: AnswerResult = { ...answer(input), sourceIds: cities.topicIds.slice(0, 3), context: { fullIds: [input.activeId], summaryIds: cities.topicIds, truncated: false } };
  const result = applyAnswer(cities.conversation, input, response);
  const links = result.conversation.connections!.filter((link) => link.type === "synthesis");
  assert.equal(result.conversation.explorations[result.destinationId].parentId, input.activeId);
  assert.deepEqual(links.map((link) => link.from), response.sourceIds);
  assert.ok(links.every((link) => link.to === result.destinationId && link.status === "accepted"));
  for (const id of cities.topicIds) assert.deepEqual(result.conversation.explorations[id], cities.conversation.explorations[id]);
  validateConversation(result.conversation);
});

test("multiple synthesis outputs remain atomic and each keeps its own source set", () => {
  const { result: cities } = moroccoCities();
  const input = { ...request(cities.conversation), requestId: "two-syntheses" };
  const topic = { targetId: input.activeId, decision: "branch" as const, title: "Combined comparison", summary: "A combined view.", sections: [{ title: "Comparison", body: "Sample combined interpretation." }] };
  const response: AnswerResult = { ...answer(input), context: { fullIds: [input.activeId], summaryIds: cities.topicIds, truncated: false }, topics: [{ ...topic, sourceIds: cities.topicIds.slice(0, 2) }, { ...topic, sourceIds: cities.topicIds.slice(2) }] };
  const result = applyAnswer(cities.conversation, input, response);
  result.topicIds.forEach((id, index) => assert.deepEqual(result.conversation.connections!.filter((link) => link.type === "synthesis" && link.to === id).map((link) => link.from), response.topics![index].sourceIds));
  const original = JSON.stringify(cities.conversation);
  assert.throws(() => applyAnswer(cities.conversation, input, { ...response, topics: [response.topics![0], { ...response.topics![1], sourceIds: ["invented-city", cities.topicIds[3]] }] }), /synthesis/);
  assert.equal(JSON.stringify(cities.conversation), original);
});

function annotationBatch() {
  const space = createSampleConversation();
  const input = { ...request(space), question: "Answer each annotated question separately.", annotations: [
    { id: "company-note", source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", quote: "Compensation is one part of that comparison." }, question: "How should I compare this?" },
    { id: "equity-note", source: { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity" }, question: "What changes this value?" },
  ] };
  const response: AnswerResult = { ...answer(input), decision: "continue", context: { fullIds: ["job-search", "compensation"], summaryIds: ["equity"], truncated: false }, sections: [{ title: "Overview", body: "Each selected passage has its own answer." }], topics: input.annotations.map((annotation) => ({ annotationId: annotation.id, targetId: annotation.source.explorationId, decision: "branch", title: annotation.id, summary: "A focused answer.", sections: [{ title: "Answer", body: `Reply to ${annotation.id}.` }] })) };
  return { space, input, response };
}

test("annotation batches atomically preserve each distinct question and source, including replay", () => {
  const { space, input, response } = annotationBatch();
  const original = JSON.stringify(space);
  const result = applyAnswer(space, input, response);
  result.topicIds.forEach((id, index) => {
    const topic = result.conversation.explorations[id];
    const annotation = input.annotations[index];
    assert.equal(topic.parentId, annotation.source.explorationId);
    assert.deepEqual(topic.source, annotation.source);
    assert.deepEqual(topic.messages[0].source, annotation.source);
    assert.deepEqual(topic.messages[1].source, annotation.source);
    assert.equal(topic.messages[0].sections[0].body, annotation.question);
    assert.equal(topic.messages[1].sections[0].body, response.topics![index].sections[0].body);
  });
  assert.equal(result.conversation.explorations[result.destinationId].messages.at(-1)!.source, null);
  assert.equal(JSON.stringify(space), original);
  const retry = applyAnswer(result.conversation, input, { ...response, topics: [] });
  assert.equal(retry.conversation, result.conversation);
  assert.deepEqual(retry.destinationIds, result.destinationIds);
});

test("annotation output can reuse a dedicated existing topic while keeping its original quote", () => {
  const { space, input, response } = annotationBatch();
  response.topics![1] = { ...response.topics![1], targetId: "equity", decision: "continue" };
  const result = applyAnswer(space, input, response);
  assert.equal(result.topicIds[1], "equity");
  const topic = result.conversation.explorations.equity;
  assert.equal(topic.messages.length, space.explorations.equity.messages.length + 2);
  assert.deepEqual(topic.messages.at(-1)!.source, input.annotations[1].source);
  assert.equal(topic.messages.at(-2)!.sections[0].body, input.annotations[1].question);
});

test("missing, duplicate, or crossed annotation outputs reject the whole batch without mutation", () => {
  const { space, input, response } = annotationBatch();
  const original = JSON.stringify(space);
  for (const topics of [
    [],
    [response.topics![0]],
    [response.topics![0], { ...response.topics![1], annotationId: response.topics![0].annotationId }],
    [response.topics![0], { ...response.topics![1], targetId: "job-search" }],
    [response.topics![0], { ...response.topics![1], annotationId: "invented" }],
  ]) {
    assert.throws(() => applyAnswer(space, input, { ...response, topics }), /annotation/);
    assert.equal(JSON.stringify(space), original);
  }
});

test("reusing a synthesis preserves inputs and does not duplicate provenance", () => {
  const initial = createConversation();
  const first = request(initial);
  const root = applyAnswer(initial, first, answer(first)).conversation;
  const splitRequest = { ...request(root), requestId: "separate-options" };
  const split = applyAnswer(root, splitRequest, { ...answer(splitRequest), topics: ["Option A", "Option B"].map((title) => ({ targetId: root.rootId, decision: "branch" as const, title, summary: title, sections: [{ title, body: `${title} details.` }] })) });
  const combineRequest = { ...request(split.conversation), requestId: "combine-options" };
  const combined = applyAnswer(split.conversation, combineRequest, { ...answer(combineRequest), sourceIds: split.topicIds, context: { fullIds: [root.rootId, ...split.topicIds], summaryIds: [], truncated: false } });
  const before = structuredClone(combined.conversation);
  const followRequest = { ...request(combined.conversation), requestId: "refine-comparison" };
  const response: AnswerResult = { ...answer(followRequest), decision: "continue", sections: [{ title: "Overview", body: "The comparison is updated in its existing topic." }], context: { fullIds: [root.rootId, combined.destinationId, ...split.topicIds], summaryIds: [], truncated: false }, topics: [{ targetId: combined.destinationId, decision: "continue", title: "Combined options", summary: "Refined comparison.", sections: [{ title: "Decision", body: "The refined combined answer." }], sourceIds: split.topicIds }] };
  const refined = applyAnswer(combined.conversation, followRequest, response);
  assert.deepEqual(refined.topicIds, [combined.destinationId]);
  assert.deepEqual(refined.conversation.connections, before.connections);
  assert.equal(refined.conversation.explorations[combined.destinationId].messages.length, before.explorations[combined.destinationId].messages.length + 2);
  for (const id of split.topicIds) assert.deepEqual(refined.conversation.explorations[id], before.explorations[id]);
  const invalid = structuredClone(response);
  invalid.topics![0].sourceIds = [combined.destinationId, split.topicIds[0]];
  assert.throws(() => applyAnswer(combined.conversation, followRequest, invalid), /synthesis/);
  assert.deepEqual(combined.conversation, before);
  validateConversation(refined.conversation);
});

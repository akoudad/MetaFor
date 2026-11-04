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

import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import { createConversation, applyAnswer } from "../src/lib/session";
import { answerSections, organizeAnswer, organizerMessages } from "../src/lib/organizer";

function fixture() {
  const conversation = createConversation();
  const request: AnswerRequest = { requestId: "organize", conversation, activeId: "root", question: "Explain each option in detail", selection: null, mode: "auto", includeIds: [] };
  const answer: AnswerResult = { requestId: request.requestId, decision: "continue", reason: "First answer", title: "Options", summary: "Two independent options", sections: [{ title: "Option A", body: "Exact **A** content." }, { title: "Option B", body: "Exact [B](https://example.com) content." }], related: [], context: { fullIds: ["root"], summaryIds: [], truncated: false }, model: "test" };
  const group = (title: string, sectionIds: string[]) => ({ title, summary: title, decision: "branch", sourceIds: [], sectionIds, targetId: "root" });
  const plan = { reason: "Separate independently explorable subjects.", overview: "Choose an option to explore.", primary: { decision: "continue", title: "Options", summary: "Two independent options", sourceIds: [], sectionIds: [] as string[] }, topics: [group("Option A", ["s0"]), group("Option B", ["s1"])] };
  return { request, answer, plan };
}

test("organizer separates substantive subjects while preserving every writer section exactly", () => {
  const { request, answer, plan } = fixture();
  const result = organizeAnswer(plan, request, answer);
  assert.deepEqual(result.topics!.flatMap((topic) => topic.sections), answer.sections);
  assert.equal(result.sections[0].body, plan.overview);
  const applied = applyAnswer(request.conversation, request, result);
  assert.equal(applied.topicIds.length, 2);
  assert.equal(Object.keys(applied.conversation.explorations).length, 3);
  assert.equal(Object.keys(request.conversation.explorations).length, 1);
});

test("organizer can retain a single coherent answer with several headings", () => {
  const { request, answer, plan } = fixture();
  plan.topics = [];
  plan.primary.sectionIds = ["s0", "s1"];
  const result = organizeAnswer(plan, request, answer);
  assert.deepEqual(result.sections, answer.sections);
  assert.deepEqual(result.topics, []);
});

test("organizer rejects dropped, duplicated, invented and empty section groups", () => {
  const { request, answer, plan } = fixture();
  for (const modify of [
    (copy: typeof plan) => { copy.topics.pop(); },
    (copy: typeof plan) => { copy.topics[1].sectionIds = ["s0"]; },
    (copy: typeof plan) => { copy.topics[1].sectionIds = ["made-up"]; },
    (copy: typeof plan) => { copy.topics[1].sectionIds = []; },
    (copy: typeof plan) => { copy.overview = ""; },
  ]) {
    const copy = structuredClone(plan); modify(copy);
    assert.throws(() => organizeAnswer(copy, request, answer), /organized safely/);
  }
});

test("organizer cannot send content to invented historical topics or bypass forced routing", () => {
  const { request, answer, plan } = fixture();
  const invalidTarget = structuredClone(plan); invalidTarget.topics[0].targetId = "not-supplied";
  assert.throws(() => organizeAnswer(invalidTarget, request, answer), /invalid topic answer/);
  assert.throws(() => organizeAnswer(plan, { ...request, mode: "continue" }, answer), /incomplete answer/);
});

test("organizer cannot reverse the reading order within a topic", () => {
  const { request, answer, plan } = fixture();
  plan.topics = [];
  plan.primary.sectionIds = ["s1", "s0"];
  assert.throws(() => organizeAnswer(plan, request, answer), /organized safely/);
});

test("organizer sees stable content references and only supplied existing topic summaries", () => {
  const { request, answer } = fixture();
  answer.topics = [{ targetId: "root", decision: "branch", title: "C", summary: "C", sections: [{ title: "C", body: "C text" }] }];
  assert.deepEqual(answerSections(answer).map((section) => section.id), ["s0", "s1", "s2"]);
  const data = JSON.parse(organizerMessages(request, answer)[1].content);
  assert.deepEqual(data.existingTopics.map((topic: { id: string }) => topic.id), ["root"]);
  assert.equal(data.sections[2].body, "C text");
});

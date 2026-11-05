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

test("a selected club follow-up becomes a focused child and retains its exact source", () => {
  const { request, answer, plan } = fixture();
  request.conversation.explorations.root.title = "Football clubs";
  request.conversation.explorations.root.messages = [{ id: "clubs", role: "assistant", sections: [{ id: "club-list", title: "Clubs", body: "Wydad and Raja are sample subjects." }] }];
  request.question = "wat their current status";
  request.selection = { explorationId: "root", messageId: "clubs", sectionId: "club-list", quote: "Wydad" };
  answer.title = "Wydad status";
  answer.summary = "A focused response about the selected club.";
  answer.sections = [{ title: "Current status", body: "Current competition details need verification from a current source." }];
  const result = organizeAnswer({ ...plan, overview: "", primary: { ...plan.primary, decision: "branch", title: answer.title, summary: answer.summary, sectionIds: ["s0"] }, topics: [] }, request, answer);
  const applied = applyAnswer(request.conversation, request, result);
  assert.notEqual(applied.destinationId, request.activeId);
  assert.deepEqual(applied.conversation.explorations[applied.destinationId].source, request.selection);
  assert.deepEqual(applied.conversation.explorations.root.messages, request.conversation.explorations.root.messages);
  const payload = JSON.parse(organizerMessages(request, answer)[1].content);
  assert.equal(payload.selectedPassage.text, "Wydad");
  request.selection = { explorationId: "root", messageId: "clubs", sectionId: "club-list" };
  assert.match(JSON.parse(organizerMessages(request, answer)[1].content).selectedPassage.text, /Wydad and Raja/);
});

test("detailed positions under one umbrella theme become separate topics without changing their text", () => {
  const { request, answer, plan } = fixture();
  request.question = "Explain different countries' positions on Western Sahara in detail.";
  const subjects = ["Country A", "Country B", "Country C"];
  answer.sections = subjects.map((title) => ({ title, body: `A detailed sample explanation of ${title}'s stated position; this is test data, not a current political claim.` }));
  const topics = subjects.map((title, index) => ({ ...plan.topics[0], title, summary: `The position of ${title}.`, sectionIds: [`s${index}`] }));
  const result = organizeAnswer({ ...plan, topics }, request, answer);
  const applied = applyAnswer(request.conversation, request, result);
  assert.deepEqual(applied.topicIds.map((id) => applied.conversation.explorations[id].title), subjects);
  assert.deepEqual(result.topics!.flatMap((item) => item.sections), answer.sections);
});

test("organizer preserves annotation ownership and rejects crossed sections or unassigned annotation content", () => {
  const { request, answer, plan } = fixture();
  request.conversation.explorations.root.messages = [{ id: "options", role: "assistant", sections: [{ id: "option-a", title: "A", body: "Alpha" }, { id: "option-b", title: "B", body: "Beta" }] }];
  request.annotations = [
    { id: "alpha-note", source: { explorationId: "root", messageId: "options", sectionId: "option-a", quote: "Alpha" }, question: "How does this work?" },
    { id: "beta-note", source: { explorationId: "root", messageId: "options", sectionId: "option-b", quote: "Beta" }, question: "What are its limits?" },
  ];
  answer.sections = [{ title: "Overview", body: "Two separately answered questions." }];
  answer.topics = request.annotations.map((annotation) => ({ annotationId: annotation.id, targetId: "root", decision: "branch", title: annotation.id, summary: "A focused answer.", sections: [{ title: "Answer", body: `Exact content for ${annotation.id}.` }] }));
  const annotatedPlan = { ...plan, primary: { ...plan.primary, sectionIds: ["s0"] }, topics: request.annotations.map((annotation, index) => ({ ...plan.topics[0], annotationId: annotation.id, sectionIds: [`s${index + 1}`] })) };
  const result = organizeAnswer(annotatedPlan, request, answer);
  assert.deepEqual(result.topics!.map((topic) => topic.annotationId), ["alpha-note", "beta-note"]);
  assert.deepEqual(result.topics!.flatMap((topic) => topic.sections), answer.topics.flatMap((topic) => topic.sections));
  for (const modify of [
    (copy: typeof annotatedPlan) => { copy.topics[0].sectionIds = ["s2"]; copy.topics[1].sectionIds = ["s1"]; },
    (copy: typeof annotatedPlan) => { copy.primary.sectionIds = ["s0", "s1"]; copy.topics.shift(); },
    (copy: typeof annotatedPlan) => { copy.topics[1].annotationId = "invented"; },
    (copy: typeof annotatedPlan) => { copy.topics[0].sectionIds = ["s0", "s1"]; copy.primary.sectionIds = []; },
  ]) {
    const copy = structuredClone(annotatedPlan); modify(copy);
    assert.throws(() => organizeAnswer(copy, request, answer), /organized safely/);
  }
});

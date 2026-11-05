import assert from "node:assert/strict";
import test from "node:test";
import { mergeHelpSnapshot, snapshotFromHelp } from "../chat-transfer";
import { parseSnapshot, serializeSnapshot } from "../../src/lib/storage";
import { buildAnswerContext } from "../../src/lib/ai";
import type { HelpSession } from "../shared";

function session(): HelpSession {
  return {
    id: "help-test-session", title: "Understanding the chart", createdAt: "2026-11-05T02:00:00.000Z", updatedAt: "2026-11-05T02:01:00.000Z",
    source: { id: "source-chart", image: "data:image/png;base64,aW1hZ2U=", width: 800, height: 500, capturedAt: "2026-11-05T02:00:00.000Z", appName: "Preview", title: "Quarterly report.pdf" },
    messages: [
      { id: "question-1", role: "user", text: "Why does the line drop?", createdAt: "2026-11-05T02:00:00.000Z" },
      { id: "answer-1", role: "assistant", text: "The line drops because the baseline changed.", createdAt: "2026-11-05T02:01:00.000Z" },
    ],
  };
}

test("Help transfers preserve source provenance and both sides of the conversation in valid .ingx", () => {
  const original = session();
  const snapshot = snapshotFromHelp(original);
  const restored = parseSnapshot(serializeSnapshot(snapshot));
  assert.deepEqual(snapshot, restored);
  assert.equal(restored.conversation.id, original.id, "native source lookup uses the same stable conversation ID");
  const messages = restored.conversation.explorations.root.messages;
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(messages[0].sections[1].body, original.messages[0].text);
  assert.equal(messages[1].sections[0].body, original.messages[1].text);
  assert.match(messages[0].sections[0].body, /Preview/);
  assert.match(messages[0].sections[0].body, /Quarterly report.pdf/);
  assert.match(messages[0].sections[0].body, /source-chart/);
  assert.ok(!serializeSnapshot(snapshot).includes(original.source!.image), "private screenshot bytes remain in the native source store");
});

test("reopening Help appends new replies while preserving Chat branches, annotation sources, and reading drafts", () => {
  const original = session();
  const existing = snapshotFromHelp(original);
  const source = { explorationId: "root", messageId: "help-message-answer-1", sectionId: "help-message-answer-1-text", quote: "the baseline changed" };
  existing.conversation.explorations.detail = { id: "detail", title: "Baseline", summary: "Inspecting the baseline", parentId: "root", source, position: [500, -800, -300], messages: [{ id: "detail-answer", role: "assistant", sections: [{ id: "detail-text", title: "", body: "A closer look at the baseline." }] }] };
  existing.view.activeId = "detail";
  existing.view.history = ["root"];
  existing.view.places.detail = { view: { x: 500, y: -800, z: 600 }, draft: "Compare this with the prior year", selection: source, scrollTop: 210 };
  const next = session();
  next.updatedAt = "2026-11-05T02:03:00.000Z";
  next.messages.push({ id: "question-2", role: "user", text: "What is a baseline?", createdAt: next.updatedAt }, { id: "answer-2", role: "assistant", text: "The baseline is the reference for comparison.", createdAt: next.updatedAt });
  const merged = mergeHelpSnapshot(existing, snapshotFromHelp(next));
  assert.deepEqual(merged.conversation.explorations.detail, existing.conversation.explorations.detail);
  assert.deepEqual(merged.view, existing.view);
  assert.equal(merged.conversation.explorations.root.messages.length, 4);
  assert.equal(existing.conversation.explorations.root.messages.length, 2, "merge never mutates saved input");
  assert.deepEqual(mergeHelpSnapshot(merged, snapshotFromHelp(next)), merged, "duplicate native delivery is idempotent");
});

test("transfers reject changed source messages and mismatched sessions instead of replacing saved work", () => {
  const initial = snapshotFromHelp(session());
  const changed = session();
  changed.messages[0].text = "A different request";
  assert.throws(() => mergeHelpSnapshot(initial, snapshotFromHelp(changed)), /message changed/);
  changed.id = "another-session";
  assert.throws(() => mergeHelpSnapshot(initial, snapshotFromHelp(changed)), /different sources/);
  const oversized = session();
  oversized.messages[0].text = "x".repeat(50_001);
  assert.throws(() => snapshotFromHelp(oversized), /50/);
});

test("a new Help session opens as an empty chat without fabricated messages", () => {
  const empty = session();
  empty.messages = []; empty.source = null;
  const snapshot = snapshotFromHelp(empty);
  assert.equal(snapshot.view.started, false);
  assert.equal(snapshot.conversation.explorations.root.messages.length, 0);
});

test("Help visual anchors stay attached to their question after transfer", () => {
  const original = session();
  original.messages[0].marks = [
    { id: "mark-1", kind: "rect", x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "1" },
    { id: "mark-2", kind: "arrow", x: 0.8, y: 0.9, width: -0.5, height: -0.4, label: "2" },
    { id: "mark-3", kind: "point", x: 0.4, y: 0.5, width: 0, height: 0, label: "3" },
  ];
  const snapshot = snapshotFromHelp(original);
  const question = snapshot.conversation.explorations.root.messages[0];
  assert.equal(question.id, "help-message-question-1");
  assert.equal(question.sections.find((section) => section.id === "help-message-question-1-text")?.body, original.messages[0].text);
  const annotations = question.sections.find((section) => section.id === "help-message-question-1-marks");
  assert.equal(annotations?.title, "Visual annotations");
  assert.match(annotations!.body, /original shared image/);
  assert.match(annotations!.body, /top left/);
  assert.match(annotations!.body, /signed offsets/);
  for (const mark of original.messages[0].marks) assert.ok(annotations!.body.includes(JSON.stringify(mark)));
  const context = buildAnswerContext({ requestId: "follow-up", conversation: snapshot.conversation, activeId: "root", question: "Explain annotation 2 again", selection: null, mode: "auto", includeIds: [] });
  assert.ok(context.payload.originalQuestion.text.includes(JSON.stringify(original.messages[0].marks[1])), "the writer receives the original arrow anchor with a follow-up");
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot);
  assert.deepEqual(mergeHelpSnapshot(snapshot, snapshotFromHelp(original)), snapshot);
  assert.ok(!serializeSnapshot(snapshot).includes(original.source!.image));
});

test("transferred annotation metadata rejects unbounded or invalid marks", () => {
  const original = session();
  original.messages[0].marks = Array.from({ length: 13 }, (_, index) => ({ id: `mark-${index}`, kind: "point", x: 0.5, y: 0.5, width: 0, height: 0 }));
  assert.throws(() => snapshotFromHelp(original), /12 annotations/);
  original.messages[0].marks = [{ id: "mark-1", kind: "point", x: 0.5, y: 0.5, width: 0, height: 0, label: "x".repeat(121) }];
  assert.throws(() => snapshotFromHelp(original), /label is too long/);
});

test("old Help imports gain missing visual anchors without replacing their original text or IDs", () => {
  const original = session();
  const old = snapshotFromHelp(original);
  const originalMessages = structuredClone(old.conversation.explorations.root.messages);
  original.messages[0].marks = [{ id: "mark-1", kind: "point", x: 0.5, y: 0.5, width: 0, height: 0, label: "1" }];
  const incoming = snapshotFromHelp(original);
  const merged = mergeHelpSnapshot(old, incoming);
  assert.deepEqual(merged.conversation.explorations.root.messages, incoming.conversation.explorations.root.messages);
  assert.deepEqual(old.conversation.explorations.root.messages, originalMessages, "migration does not mutate existing saved work");
  original.messages[0].text = "A changed question with the same ID";
  assert.throws(() => mergeHelpSnapshot(old, snapshotFromHelp(original)), /message changed/);
});

test("assistant highlights survive Chat context, export, and enrichment of older transfers", () => {
  const original = session();
  const old = snapshotFromHelp(original);
  const highlight = { id: "prior-1-1", kind: "rect" as const, x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "1" };
  original.messages[1].marks = [highlight];
  const incoming = snapshotFromHelp(original);
  const assistant = incoming.conversation.explorations.root.messages[1];
  assert.equal(assistant.sections[0].body, original.messages[1].text);
  const annotations = assistant.sections.find((section) => section.id === "help-message-answer-1-marks");
  assert.match(annotations!.body, /belong to this answer/);
  assert.ok(annotations!.body.includes(JSON.stringify(highlight)));
  const context = buildAnswerContext({ requestId: "highlight-follow-up", conversation: incoming.conversation, activeId: "root", question: "Explain the part you highlighted in your last answer", selection: null, mode: "auto", includeIds: [] });
  const answerContext = context.payload.topics.flatMap((topic) => topic.messages).find((message) => message.id === assistant.id);
  assert.ok(answerContext?.text.includes(JSON.stringify(highlight)), "the writer receives the assistant's selected highlight and geometry");
  assert.deepEqual(parseSnapshot(serializeSnapshot(incoming)), incoming);
  const merged = mergeHelpSnapshot(old, incoming);
  assert.deepEqual(merged.conversation.explorations.root.messages, incoming.conversation.explorations.root.messages);
  assert.deepEqual(mergeHelpSnapshot(merged, incoming), merged, "repeated handoff does not duplicate annotation metadata");
  assert.equal(old.conversation.explorations.root.messages[1].sections.length, 1);
  original.messages[1].text = "A replaced answer";
  assert.throws(() => mergeHelpSnapshot(old, snapshotFromHelp(original)), /message changed/);
});

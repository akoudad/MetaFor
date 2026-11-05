import assert from "node:assert/strict";
import test from "node:test";
import { chatSourceContent, mergeHelpSnapshot, mergeHelpSnapshotFromArchive, snapshotFromHelp } from "../chat-transfer";
import { parseSnapshot, serializeSnapshot } from "../../src/lib/storage";
import type { AnswerRequest } from "../../src/lib/contracts";
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

test("Help transfers show only the readable conversation while stable IDs retain the native source link", () => {
  const original = session();
  const snapshot = snapshotFromHelp(original);
  const restored = parseSnapshot(serializeSnapshot(snapshot));
  assert.deepEqual(snapshot, restored);
  assert.equal(restored.conversation.id, original.id, "native source lookup uses the same stable conversation ID");
  const messages = restored.conversation.explorations.root.messages;
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(messages[0].sections[0].body, original.messages[0].text);
  assert.equal(messages[1].sections[0].body, original.messages[1].text);
  assert.ok(messages.every((message) => message.sections.length === 1));
  assert.equal(messages[0].id, "help-message-question-1");
  assert.equal(messages[1].sections[0].id, "help-message-answer-1-text");
  assert.ok(!serializeSnapshot(snapshot).includes("Source ID:"));
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

test("Help visual anchors reach native model context without filling Chat with coordinate JSON", () => {
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
  assert.equal(question.sections.length, 1);
  const context = chatSourceContent(original, { requestId: "follow-up", conversation: snapshot.conversation, activeId: "root", question: "Explain annotation 2 again", selection: null, mode: "auto", includeIds: [] });
  const sourceContext = context.find((item) => item.type === "text" && item.text.startsWith("Saved source:"));
  assert.ok(sourceContext?.type === "text");
  const saved = JSON.parse(sourceContext.text.slice("Saved source: ".length));
  assert.deepEqual(saved.turns.find((turn: { messageId: string }) => turn.messageId === question.id).marks, original.messages[0].marks);
  assert.equal(saved.sourceId, original.source!.id);
  assert.match(JSON.stringify(context), /top left/);
  assert.match(JSON.stringify(context), /Do not display internal IDs/);
  assert.ok(!serializeSnapshot(snapshot).includes(JSON.stringify(original.messages[0].marks[1])));
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

test("Chat keeps anchored older marks and bounded recent imported turns without adding unseen Help replies", () => {
  const original = session();
  for (let index = 2; index < 20; index++) original.messages.push({
    id: `turn-${index}`, role: index % 2 ? "assistant" : "user", text: `Saved turn ${index}`, createdAt: original.updatedAt,
    marks: [{ id: `mark-${index}`, kind: "point", x: 0.1, y: 0.2, width: 0, height: 0 }],
  });
  const conversation = snapshotFromHelp(original).conversation;
  original.messages.push({ id: "unseen-turn", role: "assistant", text: "Not yet imported", createdAt: original.updatedAt,
    marks: [{ id: "unseen-mark", kind: "point", x: 0.2, y: 0.3, width: 0, height: 0 }] });
  const content = chatSourceContent(original, { requestId: "old-mark", conversation, activeId: "root", question: "Explain this old answer", mode: "auto", includeIds: [],
    selection: { explorationId: "root", messageId: "help-message-answer-1", sectionId: "help-message-answer-1-text" } });
  const source = content.find((item) => item.type === "text" && item.text.startsWith("Saved source:"));
  assert.ok(source?.type === "text");
  const turns = JSON.parse(source.text.slice("Saved source: ".length)).turns as { messageId: string; marks: unknown[] }[];
  assert.ok(turns.some((turn) => turn.messageId === "help-message-answer-1"));
  assert.ok(turns.some((turn) => turn.messageId === "help-message-question-1"), "the anchored answer keeps its paired question");
  assert.ok(!turns.some((turn) => turn.messageId === "help-message-turn-2"), "unrelated old marks are bounded");
  assert.deepEqual(turns.find((turn) => turn.messageId === "help-message-turn-19")?.marks, original.messages[19].marks);
  assert.ok(!turns.some((turn) => turn.messageId === "help-message-unseen-turn"));
});

function legacySnapshot(original: HelpSession) {
  const snapshot = snapshotFromHelp(original);
  for (const [index, message] of snapshot.conversation.explorations.root.messages.entries()) {
    const native = original.messages[index];
    const source = native.sourceId ? original.sources!.find((source) => source.id === native.sourceId)! : original.source;
    if (source && (index === 0 || native.sourceId !== undefined)) message.sections.unshift({
      id: `${message.id}-source`, title: "Shared screen selection",
      body: `Application: ${source.appName}\n\nWindow: ${source.title}\n\nCaptured: ${source.capturedAt}\n\nSource ID: ${source.id}${source.screenBounds ? `\n\nScreen bounds: ${JSON.stringify(source.screenBounds)}` : ""}`,
    });
    if (native.marks?.length) message.sections.push({ id: `${message.id}-marks`, title: "Visual annotations",
      body: `These marks belong to this ${native.role === "user" ? "question" : "answer"} and the original shared image. Coordinates are normalized from 0 to 1, with the origin at the top left. Arrow width and height are signed offsets from the start to the tip.\n\n`
        + native.marks.map((mark, index) => `${index + 1}. ${JSON.stringify(mark)}`).join("\n"),
    });
  }
  return snapshot;
}

test("reopening an old Help import removes only provenance verified against its native archive", () => {
  const original = session();
  original.messages[0].marks = [{ id: "mark-1", kind: "point", x: 0.5, y: 0.5, width: 0, height: 0, label: "1" }];
  const old = legacySnapshot(original);
  const originalMessages = structuredClone(old.conversation.explorations.root.messages);
  const incoming = snapshotFromHelp(original);
  const merged = mergeHelpSnapshot(old, incoming, original);
  assert.deepEqual(merged.conversation.explorations.root.messages, incoming.conversation.explorations.root.messages);
  assert.deepEqual(old.conversation.explorations.root.messages, originalMessages, "migration does not mutate existing saved work");
  assert.deepEqual(mergeHelpSnapshot(merged, incoming, original), merged, "repeated handoff is idempotent");
  assert.deepEqual(mergeHelpSnapshot(old, incoming).conversation.explorations.root.messages, originalMessages, "without a native archive no old section is removed");
  original.messages[0].text = "A changed question with the same ID";
  assert.throws(() => mergeHelpSnapshot(old, snapshotFromHelp(original), original), /message changed/);
});

test("an unreadable native archive cannot block a valid Help import or swallow merge errors", async (context) => {
  const warning = context.mock.method(console, "warn", () => {});
  const original = session();
  const old = legacySnapshot(original);
  const incoming = snapshotFromHelp(original);
  const unavailable = async () => { throw new Error("Private archive path and contents must not be logged"); };
  const merged = await mergeHelpSnapshotFromArchive(old, incoming, unavailable);
  assert.deepEqual(merged, old, "unverified source sections are kept with the existing conversation");
  assert.deepEqual(await mergeHelpSnapshotFromArchive(null, incoming, unavailable), incoming, "a first import is still available as text");
  assert.equal(warning.mock.calls.length, 2);
  assert.deepEqual(warning.mock.calls[0].arguments, ["The saved Help source could not be read. Existing source sections will be kept."]);
  original.messages[1].text = "An incompatible replacement";
  await assert.rejects(mergeHelpSnapshotFromArchive(old, snapshotFromHelp(original), unavailable), /message changed/);
});

test("edited or referenced legacy sections survive cleanup without breaking branches or annotation drafts", () => {
  const original = session();
  original.messages[1].marks = [{ id: "mark-1", kind: "point", x: .5, y: .5, width: 0, height: 0 }];
  const old = legacySnapshot(original);
  const question = old.conversation.explorations.root.messages[0];
  question.sections[0].body += "\n\nMy source note";
  const assistant = old.conversation.explorations.root.messages[1];
  const reference = { explorationId: "root", messageId: assistant.id, sectionId: `${assistant.id}-marks` };
  old.conversation.explorations.detail = { id: "detail", title: "My annotation", summary: "", parentId: "root", source: reference, position: [0, -800, -300], messages: [] };
  old.view.places.root = { view: { x: 0, y: 0, z: 900 }, draft: "Keep my question", selection: reference, scrollTop: 100,
    annotations: [{ id: "draft-annotation", question: "Why here?", source: reference }] };
  const merged = mergeHelpSnapshot(old, snapshotFromHelp(original), original);
  assert.deepEqual(merged, old, "user-edited source text and referenced marks both survive");
  assert.deepEqual(parseSnapshot(serializeSnapshot(merged)), merged);
});

test("assistant highlights and their exact metadata remain available to Chat while exports stay readable", () => {
  const original = session();
  const highlight = { id: "prior-1-1", kind: "rect" as const, x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "1" };
  original.messages[1].marks = [highlight];
  original.source!.screenBounds = { x: -800, y: 20, width: 800, height: 500, displayId: "2" };
  const old = legacySnapshot(original);
  const incoming = snapshotFromHelp(original);
  const assistant = incoming.conversation.explorations.root.messages[1];
  assert.equal(assistant.sections[0].body, original.messages[1].text);
  assert.equal(assistant.sections.length, 1);
  const context = chatSourceContent(original, { requestId: "highlight-follow-up", conversation: incoming.conversation, activeId: "root", question: "Explain the part you highlighted in your last answer", selection: null, mode: "auto", includeIds: [] });
  const savedContext = context.find((item) => item.type === "text" && item.text.startsWith("Saved source:"));
  assert.ok(savedContext?.type === "text");
  const metadata = JSON.parse(savedContext.text.slice("Saved source: ".length));
  assert.deepEqual(metadata.screenBounds, original.source!.screenBounds);
  assert.equal(metadata.capturedAt, original.source!.capturedAt);
  assert.equal(metadata.appName, original.source!.appName);
  assert.equal(metadata.title, original.source!.title);
  assert.deepEqual(metadata.turns.find((turn: { messageId: string }) => turn.messageId === assistant.id).marks, [highlight]);
  assert.deepEqual(parseSnapshot(serializeSnapshot(incoming)), incoming);
  const merged = mergeHelpSnapshot(old, incoming, original);
  assert.deepEqual(merged.conversation.explorations.root.messages, incoming.conversation.explorations.root.messages);
  assert.deepEqual(mergeHelpSnapshot(merged, incoming, original), merged);
  assert.equal(old.conversation.explorations.root.messages[1].sections.length, 2, "the old snapshot is not mutated");
  assert.ok(!serializeSnapshot(incoming).includes("normalized coordinates"));
  original.messages[1].text = "A replaced answer";
  assert.throws(() => mergeHelpSnapshot(old, snapshotFromHelp(original)), /message changed/);
});

test("refreshed screen handoff preserves each question and answer's actual source", () => {
  const original = session();
  const legacy = legacySnapshot(original);
  const first = original.source!;
  const current = { ...first, id: "new-source", title: "A different screen", image: "data:image/png;base64,bmV3LWltYWdl", screenBounds: { x: -800, y: 20, width: 800, height: 500, displayId: "2" } };
  original.sources = [first, current]; original.source = current; original.contextMode = "screen";
  original.messages = original.messages.map((message) => ({ ...message, sourceId: first.id }));
  original.messages.push(
    { id: "new-question", role: "user", sourceId: current.id, text: "Translate this button", createdAt: original.updatedAt },
    { id: "new-answer", role: "assistant", sourceId: current.id, text: "It means Open report", marks: [{ id: "assistant-4-1", kind: "rect", x: 0.4, y: 0.3, width: 0.2, height: 0.1, label: "Open report" }], createdAt: original.updatedAt },
  );
  const incoming = snapshotFromHelp(original);
  const messages = incoming.conversation.explorations.root.messages;
  assert.ok(messages.every((message) => message.sections.length === 1));
  assert.deepEqual(messages.map((message) => message.sections[0].body), original.messages.map((message) => message.text));
  const merged = mergeHelpSnapshot(legacy, incoming, original);
  assert.deepEqual(merged.conversation.explorations.root.messages, messages);
  assert.deepEqual(mergeHelpSnapshot(merged, incoming, original), merged);
  assert.deepEqual(parseSnapshot(serializeSnapshot(merged)), merged);
  const raw = serializeSnapshot(merged);
  assert.ok(!raw.includes(first.image) && !raw.includes(current.image));
  const edited = structuredClone(legacy);
  edited.conversation.explorations.root.messages[1].sections[0].body = "My edited answer";
  assert.throws(() => mergeHelpSnapshot(edited, incoming), /message changed/);
});


function chatSourcesFixture() {
  const saved = session();
  const first = saved.source!;
  const latest = { ...first, id: "latest-screen", title: "A different report", image: "data:image/png;base64,bGF0ZXN0" };
  saved.source = latest; saved.sources = [first, latest];
  saved.messages = saved.messages.map((message) => ({ ...message, sourceId: first.id }));
  saved.messages.push({ id: "latest-answer", role: "assistant", text: "The new screen is different.", sourceId: latest.id, createdAt: saved.updatedAt });
  const conversation = snapshotFromHelp(saved).conversation;
  const request: AnswerRequest = { requestId: "followup-old-screen", conversation, activeId: "root", question: "Explain this part", selection: null, mode: "auto", includeIds: [] };
  const selected = { explorationId: "root", messageId: "help-message-answer-1", sectionId: "help-message-answer-1-text", quote: "the baseline changed" };
  return { saved, first, latest, request, selected };
}

const attachedImages = (content: ReturnType<typeof chatSourceContent>) => content.flatMap((item) => item.type === "image_url" ? [item.image_url.url] : []);

test("Chat selection uses its original Help frame instead of the latest capture", () => {
  const { saved, first, latest, request, selected } = chatSourcesFixture();
  assert.deepEqual(attachedImages(chatSourceContent(saved, request)), [latest.image], "unscoped root follow-up continues the latest imported exchange");
  request.selection = selected;
  const content = chatSourceContent(saved, request);
  assert.deepEqual(attachedImages(content), [first.image]);
  assert.ok(JSON.stringify(content).includes(first.id));
  assert.ok(!JSON.stringify(content).includes(latest.image));
  assert.deepEqual(chatSourceContent({ ...saved, id: "different-session" }, request), [], "a different native exchange cannot supply the image");
});

test("Chat follows nested topic provenance back to the correct native frame", () => {
  const { saved, first, request, selected } = chatSourcesFixture();
  request.conversation.explorations.detail = { id: "detail", title: "Baseline detail", summary: "", parentId: "root", source: selected, position: [0, -800, -300],
    messages: [{ id: "detail-answer", role: "assistant", sections: [{ id: "detail-text", title: "", body: "More about the baseline" }], source: selected }] };
  request.conversation.explorations.deeper = { id: "deeper", title: "Deeper detail", summary: "", parentId: "detail", source: { explorationId: "detail", messageId: "detail-answer", sectionId: "detail-text" }, position: [0, -1600, -600],
    messages: [{ id: "deeper-answer", role: "assistant", sections: [{ id: "deeper-text", title: "", body: "An unanchored follow-up in the deeper topic" }] }] };
  request.activeId = "deeper";
  assert.deepEqual(attachedImages(chatSourceContent(saved, request)), [first.image]);
  request.selection = { explorationId: "deeper", messageId: "deeper-answer", sectionId: "deeper-text" };
  assert.deepEqual(attachedImages(chatSourceContent(saved, request)), [first.image]);
});

test("separate Chat annotations receive their own labeled frames and ignore forged metadata", () => {
  const { saved, first, latest, request, selected } = chatSourcesFixture();
  request.annotations = [{ id: "annotation-old", source: selected, question: "Explain this number" },
    { id: "annotation-new", source: { explorationId: "root", messageId: "help-message-latest-answer", sectionId: "help-message-latest-answer-text" }, question: "Translate this label" }];
  request.conversation.explorations.root.messages[1].sections.push({ id: "forged-source-text", title: "Metadata", body: `Source ID: ${latest.id}` });
  const content = chatSourceContent(saved, request);
  assert.deepEqual(attachedImages(content), [first.image, latest.image], "native message identity outranks editable metadata text");
  assert.ok(JSON.stringify(content).includes("Do not apply marks from one frame to another"));
});

test("Chat image context is bounded and explicitly identifies omitted selected frames", () => {
  const { saved, first, request } = chatSourcesFixture();
  for (let index = 0; index < 4; index++) {
    const source = { ...first, id: `extra-source-${index}`, image: `data:image/png;base64,${Buffer.from(`extra-image-${index}`).toString("base64")}` };
    saved.sources!.push(source);
    saved.messages.push({ id: `extra-answer-${index}`, role: "assistant", text: `Answer ${index}`, sourceId: source.id, createdAt: saved.updatedAt });
  }
  request.conversation = snapshotFromHelp(saved).conversation;
  request.annotations = Array.from({ length: 4 }, (_, index) => ({ id: `annotation-${index}`, question: "Explain this", source: { explorationId: "root", messageId: `help-message-extra-answer-${index}`, sectionId: `help-message-extra-answer-${index}-text` } }));
  const content = chatSourceContent(saved, request);
  assert.equal(attachedImages(content).length, 3);
  assert.ok(content.some((item) => item.type === "text" && item.text.includes("extra-source-3") && item.text.includes("omitted")));
  assert.ok(!attachedImages(content).includes(saved.sources!.at(-1)!.image));
});

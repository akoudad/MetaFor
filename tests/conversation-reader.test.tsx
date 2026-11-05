import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";
import type { Conversation, Message, SourceReference } from "../src/lib/model";
import { conversationTranscript } from "../src/components/conversation-transcript";

function message(id: string, role: Message["role"], body: string, requestId?: string): Message {
  return { id, role, ...(requestId ? { requestId } : {}), sections: [{ id: `${id}-section`, title: role === "assistant" ? `Details ${id}` : "", body }] };
}
function fixture(): Conversation {
  return {
    id: "reader-test", title: "Build a workshop", rootId: "root", kind: "live",
    explorations: {
      root: { id: "root", title: "Workshop overview", summary: "SUMMARY MUST NOT REPLACE THE ANSWER", parentId: null, source: null, position: [0, 0, 0], messages: [message("question-first", "user", "Compare the materials", "first"), message("answer-first", "assistant", "Here are the **complete choices**. [Reference](https://example.com/materials)", "first")] },
      wood: { id: "wood", title: "Wood", summary: "Short wood summary", parentId: "root", source: null, position: [0, 0, 0], messages: [message("topic-question-first-0", "user", "Compare the materials"), message("topic-answer-first-0", "assistant", "Full wood answer: grain, moisture, maintenance, and joinery.")] },
      steel: { id: "steel", title: "Steel", summary: "Short steel summary", parentId: "root", source: null, position: [0, 0, 0], messages: [message("topic-question-first-1", "user", "Compare the materials"), message("topic-answer-first-1", "assistant", "Full steel answer: corrosion, fasteners, and load capacity.")] },
    },
  };
}

test("split requests keep every full answer and show their repeated question once", () => {
  const turns = conversationTranscript(fixture());
  assert.equal(turns.length, 1);
  assert.equal(turns[0].questions.length, 1);
  assert.deepEqual(turns[0].answers.map(({ topicId }) => topicId), ["root", "wood", "steel"]);
  assert.match(turns[0].answers[1].message.sections[0].body, /grain, moisture, maintenance, and joinery/);
  assert.doesNotMatch(JSON.stringify(turns), /SUMMARY MUST|Short wood/);
});

test("different annotation questions and their quoted sources stay separate", () => {
  const space = fixture();
  const wood = space.explorations.wood.messages[0], steel = space.explorations.steel.messages[0];
  wood.sections[0].body = "How does this work?";
  steel.sections[0].body = "How does this work?";
  wood.source = { explorationId: "root", messageId: "answer-first", sectionId: "answer-first-section", quote: "wood" };
  steel.source = { ...wood.source, quote: "steel" };
  const turns = conversationTranscript(space);
  assert.equal(turns[0].questions.length, 3);
  assert.deepEqual(turns[0].questions.map(({ message }) => message.source?.quote), [undefined, "wood", "steel"]);
});

test("source and context evidence put a branch before a later root follow-up", () => {
  const space = fixture();
  space.explorations.wood.messages.push(message("question-second", "user", "Explain joinery", "second"), message("answer-second", "assistant", "A full joinery answer", "second"));
  space.explorations.root.messages.push(message("question-third", "user", "Summarize that explanation", "third"), { ...message("answer-third", "assistant", "A final answer", "third"), source: { explorationId: "wood", messageId: "answer-second", sectionId: "answer-second-section" } });
  assert.deepEqual(conversationTranscript(space).map(({ id }) => id), ["request:first", "request:second", "request:third"]);
});

test("observed turn order stays stable when a later question returns to another topic", () => {
  const space = fixture();
  space.explorations.wood.messages.push(message("question-second", "user", "Explain joinery", "second"), message("answer-second", "assistant", "A full joinery answer", "second"));
  const knownOrder = conversationTranscript(space).map(({ id }) => id);
  space.explorations.root.messages.push(message("question-third", "user", "A new question here", "third"), message("answer-third", "assistant", "A final answer", "third"));
  assert.deepEqual(conversationTranscript(space, knownOrder).map(({ id }) => id), ["request:first", "request:second", "request:third"]);
});

test("legacy messages retain their order and unrelated IDs are not mistaken for split copies", () => {
  const space = fixture();
  space.explorations.root.messages = [message("q", "user", "Legacy question"), message("a", "assistant", "Legacy answer"), message("q2", "user", "Another question"), message("a2", "assistant", "Another answer")];
  const turns = conversationTranscript(space);
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.slice(0, 2).flatMap((turn) => turn.answers.map(({ message }) => message.id)), ["a", "a2"]);
  assert.equal(turns.flatMap((turn) => turn.questions).length, 4);
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let ConversationPanel: typeof import("../src/components/ConversationPanel").default;
before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  [ui, { default: ConversationPanel }] = await Promise.all([import("@testing-library/react"), import("../src/components/ConversationPanel")]);
});
afterEach(() => { ui.cleanup(); dom.window.getSelection()?.removeAllRanges(); });
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("reader sections and their keyboard buttons reveal exact graph locations", () => {
  const navigated: SourceReference[] = [];
  ui.render(<ConversationPanel space={fixture()} activeId="root" onNavigate={(source) => navigated.push(source)} />);
  assert.equal(ui.screen.getAllByText("Compare the materials").length, 1);
  assert.ok(ui.screen.getByText(/Full steel answer/));
  ui.fireEvent.click(ui.screen.getByText(/Full wood answer/));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Show Details topic-answer-first-1 in conversation graph" }));
  assert.deepEqual(navigated.map(({ explorationId, sectionId }) => [explorationId, sectionId]), [["wood", "topic-answer-first-0-section"], ["steel", "topic-answer-first-1-section"]]);
});

test("selection and reference links do not move the graph", () => {
  const navigated: SourceReference[] = [];
  ui.render(<ConversationPanel space={fixture()} activeId="root" onNavigate={(source) => navigated.push(source)} />);
  const passage = ui.screen.getByText(/Full wood answer/);
  const range = document.createRange(); range.selectNodeContents(passage);
  dom.window.getSelection()!.addRange(range);
  ui.fireEvent.click(passage);
  dom.window.getSelection()!.removeAllRanges();
  const link = ui.screen.getByRole("link", { name: "Reference" });
  ui.fireEvent.click(link);
  assert.equal(link.getAttribute("href"), "https://example.com/materials");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.deepEqual(navigated, []);
});

test("the reader remains visible through Escape and topic changes", () => {
  const props = { space: fixture(), activeId: "root", onNavigate: () => {} };
  const mounted = ui.render(<ConversationPanel {...props} />);
  const reader = ui.screen.getByLabelText("Conversation messages");
  reader.focus();
  ui.fireEvent.keyDown(reader, { key: "Escape" });
  assert.equal(ui.screen.getByLabelText("Conversation messages"), reader);
  assert.ok(ui.screen.getByText(/Full wood answer/));
  assert.equal(document.activeElement, reader);
  assert.equal(ui.screen.queryByRole("button", { name: /^Conversation/ }), null);
  mounted.rerender(<ConversationPanel {...props} activeId="wood" />);
  assert.equal(ui.screen.getByLabelText("Conversation messages"), reader);
  assert.ok(ui.screen.getByText(/Full steel answer/));
  assert.equal(ui.screen.getByText(/Full wood answer/).closest(".conversation-answer")?.getAttribute("data-active"), "true");
});

test("new answers and topic changes preserve the reading position", () => {
  const space = fixture();
  const props = { space, activeId: "root", onNavigate: () => {} };
  const mounted = ui.render(<ConversationPanel {...props} />);
  const reader = ui.screen.getByLabelText("Conversation messages");
  Object.defineProperties(reader, { scrollHeight: { configurable: true, value: 1800 }, clientHeight: { configurable: true, value: 300 } });
  reader.scrollTop = 170; ui.fireEvent.scroll(reader);
  const changed = structuredClone(space);
  changed.explorations.root.messages.push(message("question-new", "user", "New question", "new"), message("answer-new", "assistant", "New full answer", "new"));
  mounted.rerender(<ConversationPanel {...props} space={changed} />);
  assert.equal(reader.scrollTop, 170);
  assert.ok(ui.screen.getByText("New full answer"));
  mounted.rerender(<ConversationPanel {...props} space={changed} activeId="wood" />);
  assert.equal(ui.screen.getByLabelText("Conversation messages"), reader);
  assert.equal(reader.scrollTop, 170);
});

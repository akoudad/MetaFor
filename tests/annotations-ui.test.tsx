import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import type { Snapshot } from "../src/lib/storage";
import { focusView, layoutSpace } from "../src/lib/spatial";

// This harness exercises the real components and storage, not browser layout.
// Reduced motion and fixed dimensions make camera visibility deterministic.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
const frames = new Map<number, ReturnType<typeof setTimeout>>();
const manualFrames = new Map<number, FrameRequestCallback>();
let manualAnimation = false;
let prefersReducedMotion = true;
let viewportWidth = 1100;
let frameId = 0;
let ui: typeof import("@testing-library/react");
let userEvent: typeof import("@testing-library/user-event").default;
let ConversationSpace: typeof import("../src/components/ConversationSpace").default;
let storage: typeof import("../src/lib/storage");
let requests: AnswerRequest[] = [];
let unexpectedRequests: string[] = [];
let answer: (request: AnswerRequest) => Promise<Response> | Response;

function globalValue(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(resolve("src/app/globals.css"), "utf8");
  dom.window.document.head.append(style);
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Text", "Event", "MouseEvent", "File", "FileList", "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver"] as const) {
    globalValue(name, name === "window" ? dom.window : dom.window[name]);
  }
  globalValue("PointerEvent", dom.window.MouseEvent);
  Object.defineProperty(dom.window, "PointerEvent", { configurable: true, value: dom.window.MouseEvent });
  globalValue("localStorage", dom.window.localStorage);
  globalValue("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  globalValue("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
  globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  globalValue("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++frameId;
    if (manualAnimation) manualFrames.set(id, callback);
    else frames.set(id, setTimeout(() => { frames.delete(id); callback(performance.now()); }, 1));
    return id;
  });
  globalValue("cancelAnimationFrame", (id: number) => { clearTimeout(frames.get(id)); frames.delete(id); manualFrames.delete(id); });
  globalValue("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(dom.window, "matchMedia", { value: (media: string) => ({ media, matches: prefersReducedMotion, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", { value: () => null });
  for (const [name, value] of Object.entries({ clientWidth: 1100, clientHeight: 780, offsetHeight: 413, scrollHeight: 2000 })) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, { configurable: true, get: () => name === "clientWidth" ? viewportWidth : value });
  }
  const scrollPositions = new WeakMap<HTMLElement, number>();
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() { return scrollPositions.get(this) ?? 0; },
    // jsdom has no scroll layout; real browsers clamp assignments to the scroll range.
    set(value: number) { scrollPositions.set(this, Math.max(0, Math.min(this.scrollHeight - this.clientHeight, Number(value) || 0))); },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 413, width: 600, height: 413, toJSON() { return {}; } });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new dom.window.DOMRect(180, 200, 220, 20) });
  Object.defineProperty(dom.window.Range.prototype, "getClientRects", { configurable: true, value: () => {
    const rect = new dom.window.DOMRect(180, 200, 220, 20);
    return { 0: rect, length: 1, item: (index: number) => index === 0 ? rect : null, [Symbol.iterator]: () => [rect].values() };
  } });
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  // Import React DOM only after document exists; its event support is detected once.
  [ui, { default: userEvent }, { default: ConversationSpace }, storage] = await Promise.all([
    import("@testing-library/react"), import("@testing-library/user-event"),
    import("../src/components/ConversationSpace"), import("../src/lib/storage"),
  ]);
});

beforeEach(() => {
  manualAnimation = false; prefersReducedMotion = true;
  viewportWidth = 1100;
  globalValue("indexedDB", new IDBFactory());
  dom.window.localStorage.clear();
  requests = [];
  unexpectedRequests = [];
  answer = () => { throw new Error("This test did not configure an answer."); };
  globalValue("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/status") return Response.json({ configured: true, model: "test-model", accessCodeRequired: false });
    if (String(input) === "/api/answer" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as AnswerRequest;
      requests.push(request);
      return answer(request);
    }
    unexpectedRequests.push(String(input));
    throw new Error(`Unexpected network request: ${String(input)}`);
  });
});

afterEach(async () => {
  ui.cleanup();
  dom.window.getSelection()?.removeAllRanges();
  for (const frame of frames.values()) clearTimeout(frame);
  frames.clear();
  manualFrames.clear();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("metaphore-spaces");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("A UI test left an IndexedDB connection open."));
  });
  assert.deepEqual(unexpectedRequests, [], "all external requests must stay mocked");
});

after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function fixture(activeId = "observatory"): Snapshot {
  const snapshot: Snapshot = {
    format: "ingx", version: 1, savedAt: "2020-01-01T00:00:00.000Z",
    conversation: {
      id: "ui-observatory", title: "Plan an observatory", rootId: "observatory", kind: "live", connections: [],
      explorations: {
        observatory: {
          id: "observatory", title: "Plan an observatory", summary: "Choose a site and equipment.", parentId: null, source: null, position: [0, 0, 0],
          messages: [{ id: "site-answer", role: "assistant", sections: [{ id: "choose-site", title: "Choose the site", body: "Compare weather, access, and the equipment you need." }] }],
        },
        weather: {
          id: "weather", title: "Weather records", summary: "Check the conditions before building.", parentId: "observatory", source: { explorationId: "observatory", messageId: "site-answer", sectionId: "choose-site" }, position: [-1000, 0, -1000],
          messages: [
            { id: "weather-answer-one", role: "assistant", sections: [{ id: "wind-notes", title: "Watch the wind", body: "Measure **wind exposure** before choosing the roof. Keep a log of storms." }] },
            { id: "weather-question-two", role: "user", sections: [{ id: "weather-question-text", title: "", body: "And what about rain?" }] },
            { id: "weather-answer-two", role: "assistant", sections: [{ id: "rain-notes", title: "Record rain", body: "Check drainage and record rainfall." }] },
          ],
        },
        equipment: {
          id: "equipment", title: "Choose equipment", summary: "Compare telescopes and mounts.", parentId: "observatory", source: { explorationId: "observatory", messageId: "site-answer", sectionId: "choose-site" }, position: [1000, 0, -1000],
          messages: [{ id: "equipment-answer", role: "assistant", sections: [{ id: "mount-notes", title: "Choose a mount", body: "Match the mount to the telescope and your observing plans." }] }],
        },
      },
    },
    view: { activeId, view: { x: 0, y: 0, z: 900 }, overview: false, started: true, places: {}, history: [], positions: {} },
  };
  const active = layoutSpace(snapshot.conversation).find((node) => node.id === activeId)!;
  snapshot.view.view = focusView(active.position, 1100, 780);
  return snapshot;
}

function result(request: AnswerRequest, decision: "branch" | "continue" = "branch"): AnswerResult {
  return {
    requestId: request.requestId, decision, reason: "This detail deserves its own topic.",
    title: "Protect the roof", summary: "Use wind measurements to choose a roof.",
    sections: [{ title: "Use measured conditions", body: "Keep a record of local gusts and use it to compare roof designs." }],
    related: [], context: { fullIds: [request.activeId], summaryIds: [], truncated: false }, model: "test-model",
  };
}

async function open(snapshot?: Snapshot) {
  if (snapshot) await storage.saveSnapshot(snapshot);
  ui.render(<ConversationSpace />);
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).disabled, false));
  return userEvent.setup({ document: dom.window.document, delay: null });
}

function activeTopic() {
  return ui.screen.getByRole("navigation", { name: "Conversation navigation" }).querySelector('[aria-current="location"]')?.getAttribute("aria-label")?.replace(/^Go to /, "");
}

function previewPassage(element: Element, quote: string) {
  // Real pointer selection focuses the reading surface rather than leaving a
  // previously edited textarea focused with a stale document selection.
  ui.act(() => element.closest<HTMLElement>(".topic-reading")?.focus());
  const walker = document.createTreeWalker(element, dom.window.NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const text = nodes.map((node) => node.data).join("");
  const from = text.indexOf(quote);
  assert.ok(from >= 0, "the requested exact passage must be rendered");
  const point = (offset: number) => {
    for (const node of nodes) {
      if (offset <= node.length) return { node, offset };
      offset -= node.length;
    }
    throw new Error("Selection exceeds the rendered passage.");
  };
  const start = point(from);
  const end = point(from + quote.length);
  const range = document.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  ui.fireEvent.pointerUp(element, { pointerId: 1, button: 0 });
}

function selectPassage(element: Element, quote: string) {
  previewPassage(element, quote);
  const action = ui.screen.getByRole("button", { name: "Ask about this" });
  ui.fireEvent.pointerDown(action, { button: 0 });
  ui.fireEvent.click(action);
}

function readerFor(id: string) {
  return document.querySelector<HTMLDivElement>(`[data-topic="${id}"] .topic-reading`)!;
}

function wheelSpace(deltaY: number, options: { ctrlKey?: boolean; deltaX?: number } = {}) {
  return ui.fireEvent.wheel(document.querySelector(".world-stage")!, { deltaY, deltaMode: 0, ...options });
}

async function quietWheel() {
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
}

async function leaveInitialBoundary(direction: 1 | -1) {
  await quietWheel();
  wheelSpace(direction * 120);
}

async function currentSnapshot(id?: string) {
  let saved: Snapshot | null = null;
  await ui.act(async () => {
    ui.fireEvent.pageHide(window);
    saved = await storage.loadSnapshot(id);
  });
  assert.ok(saved, "the current conversation must be saved");
  return saved as Snapshot;
}

function paragraph(section: string) {
  return document.querySelector(`[data-section-id="${section}"] .answer-markdown p`)!;
}

function input() {
  return (ui.screen.queryByRole("textbox", { name: "Annotation question" }) ?? ui.screen.getByRole("textbox", { name: "Your question" })) as HTMLTextAreaElement;
}

function annotatedResult(request: AnswerRequest): AnswerResult {
  return {
    ...result(request, "continue"), title: "Weather records", summary: "Wind and rainfall guide the design.",
    sections: [{ title: "Your annotations", body: "Each passage has its own focused reply." }],
    topics: request.annotations!.map((annotation, index) => ({
      annotationId: annotation.id, targetId: annotation.source.explorationId, decision: "branch",
      title: `Annotation reply ${index + 1}`, summary: `An answer to ${annotation.question}`,
      sections: [{ title: "Focused explanation", body: `Reply to: ${annotation.question}` }],
    })),
  };
}

test("selecting another passage queues the first question and sends two exact annotation pairs", async () => {
  const user = await open(fixture("weather"));
  answer = (request) => Response.json(annotatedResult(request));
  const reader = readerFor("weather");
  reader.scrollTop = 460; ui.fireEvent.scroll(reader);
  selectPassage(paragraph("wind-notes"), "wind exposure before choosing the roof");
  await user.type(input(), "Which wind measurements matter?");
  selectPassage(paragraph("rain-notes"), "Check drainage and record rainfall.");
  assert.equal((await currentSnapshot("ui-observatory")).view.places.weather.annotations?.[0].question, "Which wind measurements matter?");
  assert.equal(input().value, "");
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent?.includes("Check drainage and record rainfall."), true);
  assert.equal(reader.scrollTop, 460);
  assert.equal(requests.length, 0);
  await user.type(input(), "How long should I record the rain?");
  await user.click(ui.screen.getByRole("button", { name: "Send 2 annotations ↑" }));
  await ui.waitFor(() => assert.equal(requests.length, 1));
  const request = requests[0];
  assert.equal(request.selection, null);
  assert.deepEqual(request.annotations?.map(({ source, question }) => ({ source, question })), [
    { source: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure before choosing the roof" }, question: "Which wind measurements matter?" },
    { source: { explorationId: "weather", messageId: "weather-answer-two", sectionId: "rain-notes", quote: "Check drainage and record rainfall." }, question: "How long should I record the rain?" },
  ]);
  assert.equal(new Set(request.annotations!.map((item) => item.id)).size, 2);
  await ui.waitFor(() => assert.ok(document.querySelector(".world-stage[data-choice-parent]")));
  await ui.waitFor(() => assert.ok(ui.screen.getByRole("button", { name: "Enter Annotation reply 1" })));
  assert.ok(ui.screen.getByRole("button", { name: "Enter Annotation reply 2" }));
  const saved = await currentSnapshot("ui-observatory");
  const replies = Object.values(saved.conversation.explorations).filter((item) => item.title.startsWith("Annotation reply"));
  assert.equal(replies.length, 2);
  for (const [index, reply] of replies.entries()) {
    assert.deepEqual(reply.source, request.annotations![index].source);
    assert.equal(reply.messages.find((message) => message.role === "user")!.sections[0].body, request.annotations![index].question);
  }
  assert.equal(reader.scrollTop, 460, "an annotation batch never scrolls its source to the appended overview");
});

test("choosing a reused annotation topic reveals its new answer once and later preserves the reading position", async () => {
  const snapshot = fixture("observatory");
  for (const [id, scrollTop] of [["weather", 110], ["equipment", 180]] as const) {
    const point = layoutSpace(snapshot.conversation).find((node) => node.id === id)!.position;
    snapshot.view.places[id] = { view: focusView(point, 1100, 780), draft: `Saved ${id} draft`, selection: null, scrollTop };
  }
  const user = await open(snapshot);
  answer = (request) => Response.json({
    ...annotatedResult(request), title: "Plan an observatory",
    context: { fullIds: ["observatory", "weather", "equipment"], summaryIds: [], truncated: false },
    topics: request.annotations!.map((annotation, index) => ({
      annotationId: annotation.id, targetId: index === 0 ? "weather" : "equipment", decision: "continue",
      title: index === 0 ? "Weather records" : "Choose equipment", summary: "The latest details are added to the existing subject.",
      sections: [{ title: "New annotation answer", body: `Fresh answer to ${annotation.question}` }],
    })),
  });
  const source = readerFor("observatory");
  source.scrollTop = 240; ui.fireEvent.scroll(source);
  selectPassage(paragraph("choose-site"), "weather");
  await user.type(input(), "What measurements should I collect next?");
  selectPassage(paragraph("choose-site"), "the equipment you need");
  await user.type(input(), "What equipment should I compare next?");
  await user.click(ui.screen.getByRole("button", { name: "Send 2 annotations ↑" }));
  await ui.waitFor(() => assert.ok(document.querySelector(".world-stage[data-choice-parent]")));
  await ui.waitFor(() => assert.ok(ui.screen.getByRole("button", { name: "Enter Weather records" })));
  assert.equal(source.scrollTop, 240);
  const request = requests[0];
  for (const [index, id, offset] of [[0, "weather", 900], [1, "equipment", 820]] as const) {
    const reader = readerFor(id);
    const message = reader.querySelector<HTMLElement>(`[data-message-id="topic-answer-${request.requestId}-${index}"]`)!;
    assert.ok(message, "the reused topic contains the exact new assistant message after its old answer");
    message.getBoundingClientRect = () => new dom.window.DOMRect(0, offset - reader.scrollTop, 600, 100);
  }
  await user.click(ui.screen.getByRole("button", { name: "Enter Weather records" }));
  await ui.waitFor(() => assert.ok(readerFor("weather").scrollTop > 700, "the graph choice must reveal the new answer rather than restore the old 110px reading position"));
  assert.equal(input().value, "Saved weather draft");
  assert.equal(source.scrollTop, 240, "revealing the reply never moves its source reader");
  readerFor("weather").scrollTop = 470; ui.fireEvent.scroll(readerFor("weather"));
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  await ui.waitFor(() => assert.ok(readerFor("equipment").scrollTop > 700, "each reused answer has its own pending reveal target"));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Weather records"));
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.equal(readerFor("weather").scrollTop, 470, "the answer target is consumed once; ordinary navigation restores the user's newer reading position");
});

test("explicit annotation queue supports editing and queue-only submission with a paired readable reply", async () => {
  const user = await open(fixture("weather"));
  answer = (request) => Response.json(annotatedResult(request));
  const reader = readerFor("weather");
  reader.scrollTop = 370; ui.fireEvent.scroll(reader);
  selectPassage(paragraph("wind-notes"), "Keep a log of storms.");
  await user.type(input(), "What should my log contain?");
  await user.click(ui.screen.getByRole("button", { name: "Add another annotation +" }));
  assert.equal(input().value, "");
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  const queued = input();
  await user.clear(queued); await user.type(queued, "Which storm details should I record?");
  await user.click(ui.screen.getByRole("button", { name: "Send 1 annotations ↑" }));
  await ui.waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].question, "Answer each annotated question separately.");
  assert.equal(requests[0].annotations?.[0].question, "Which storm details should I record?");
  await ui.waitFor(() => assert.equal(activeTopic(), "Annotation reply 1"));
  const saved = await currentSnapshot("ui-observatory");
  const replyId = saved.view.activeId;
  assert.deepEqual(saved.view.annotationPair, { sourceId: "weather", replyId });
  for (const id of ["weather", replyId]) {
    const node = document.querySelector(`[data-node-id="${id}"]`) ?? document.querySelector(`[data-topic="${id}"]`)!.closest(".world-node")!;
    assert.equal(node.getAttribute("data-detail"), "full");
    assert.notEqual(node.getAttribute("aria-hidden"), "true");
  }
  assert.equal(reader.scrollTop, 370, "the source remains at the passage after the reply arrives");
  assert.equal(ui.fireEvent.wheel(reader, { deltaY: 80, deltaMode: 0 }), true, "the paired source reader retains native scrolling while it has room");
  assert.equal(activeTopic(), "Annotation reply 1", "reading the source does not replace the active reply or tear down the pair");
  wheelSpace(240, { ctrlKey: true });
  const zoomed = await currentSnapshot("ui-observatory");
  assert.deepEqual(zoomed.view.annotationPair, saved.view.annotationPair, "physical zoom retains the source/reply pair");
  assert.equal(activeTopic(), "Annotation reply 1");
  assert.ok(zoomed.view.view.z > saved.view.view.z, "physical zoom changes the camera rather than being reset by the pair layout");
  ui.cleanup();
  viewportWidth = 620;
  await open();
  await ui.waitFor(() => assert.equal(activeTopic(), "Annotation reply 1"));
  assert.equal(readerFor("weather").scrollTop, 370);
  const restored = await currentSnapshot("ui-observatory");
  assert.deepEqual(restored.view.annotationPair, saved.view.annotationPair);
  assert.notDeepEqual(restored.view.view, zoomed.view.view, "restoration fits the pair to the current narrow viewport rather than replaying its desktop camera");
  await ui.waitFor(() => {
    const node = document.querySelector(`[data-node-id="${replyId}"]`)!;
    assert.equal(node.getAttribute("data-detail"), "full");
    assert.notEqual(node.getAttribute("aria-hidden"), "true");
    assert.ok(ui.screen.getByRole("button", { name: "From Weather records ↗" }), "the narrow reply-only layout retains an explicit source return");
  });
  assert.equal(requests.length, 1, "restoring the paired reading view never sends again");
});

test("queued questions and the next selected draft survive reload without sending or losing the source position", async () => {
  const user = await open(fixture("weather"));
  const reader = readerFor("weather");
  reader.scrollTop = 525; ui.fireEvent.scroll(reader);
  selectPassage(paragraph("wind-notes"), "wind exposure");
  await user.type(input(), "How do I measure this?");
  selectPassage(paragraph("rain-notes"), "record rainfall");
  await user.type(input(), "How often should I record it?");
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(saved.view.places.weather.annotations?.[0].question, "How do I measure this?");
  assert.equal(saved.view.places.weather.annotations?.[1].source.quote, "record rainfall");
  assert.equal(saved.view.places.weather.annotations?.[1].question, "How often should I record it?");
  assert.equal(saved.view.places.weather.draft, "");
  ui.cleanup();
  const restoredUser = await open();
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null);
  await restoredUser.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(input().value, "How do I measure this?");
  await restoredUser.click(ui.screen.getByRole("button", { name: "Edit annotation 2" }));
  assert.equal(input().value, "How often should I record it?");
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent?.includes("record rainfall"), true);
  assert.equal(readerFor("weather").scrollTop, 525);
  assert.equal(requests.length, 0);
});

test("removing the last queued annotation keeps a cross-topic selected draft saved", async () => {
  const snapshot = fixture("weather");
  snapshot.view.places.weather = {
    view: snapshot.view.view, scrollTop: 180, draft: "Which equipment should I start with?",
    selection: { explorationId: "observatory", messageId: "site-answer", sectionId: "choose-site", quote: "the equipment you need" },
    annotations: [{ id: "old-annotation", source: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" }, question: "Which wind sensor?" }],
  };
  const user = await open(snapshot);
  await user.click(ui.screen.getByRole("button", { name: "Remove annotation 1" }));
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question for annotation 1" }), null);
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(saved.view.places.weather.annotations?.length, 0);
  assert.equal(saved.view.places.weather.selection?.explorationId, "observatory");
  ui.cleanup();
  await open();
  assert.equal(input().value, "", "restored legacy annotation stays separate from the normal prompt");
  await user.click(ui.screen.getByRole("button", { name: /Resume annotation/ }));
  assert.equal(input().value, "Which equipment should I start with?");
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent?.includes("the equipment you need"), true);
  assert.equal(requests.length, 0);
});

test("an oversized whole-section annotation is kept editable instead of becoming unsavable pending work", async () => {
  const snapshot = fixture("weather");
  snapshot.conversation.explorations.weather.messages[0].sections[0].body = "Long source passage. ".repeat(1300);
  const user = await open(snapshot);
  await user.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  await user.type(input(), "Explain this long section");
  await user.click(ui.screen.getByRole("button", { name: "Add another annotation +" }));
  await user.click(ui.screen.getByRole("button", { name: "Send 1 annotations ↑" }));
  assert.equal(requests.length, 0, "passage budgets must be checked before submission clears editable work");
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(input().value, "Explain this long section");
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(saved.view.pending, undefined);
  assert.equal(saved.view.places.weather.annotations?.[0].question, "Explain this long section");
});

test("stopped annotation request and a new annotation draft reload independently and only retry explicitly", async () => {
  const user = await open(fixture("weather"));
  answer = () => new Promise<Response>(() => {});
  selectPassage(paragraph("wind-notes"), "Keep a log of storms.");
  await user.type(input(), "What should the log include?");
  await user.click(ui.screen.getByRole("button", { name: "Add another annotation +" }));
  await user.click(ui.screen.getByRole("button", { name: "Send 1 annotations ↑" }));
  await ui.waitFor(() => assert.equal(requests.length, 1));
  const original = structuredClone(requests[0]);
  selectPassage(paragraph("rain-notes"), "record rainfall");
  await user.type(input(), "A later question about rainfall");
  await user.click(ui.screen.getByRole("button", { name: "Add another annotation +" }));
  await user.click(ui.screen.getByRole("button", { name: "Stop" }));
  const saved = await currentSnapshot("ui-observatory");
  assert.deepEqual(saved.view.pending?.annotations, original.annotations);
  assert.equal(saved.view.places.weather.annotations?.[0].question, "A later question about rainfall");
  ui.cleanup();
  const afterReload = await open();
  assert.equal(requests.length, 1);
  assert.equal((await currentSnapshot("ui-observatory")).view.places.weather.annotations?.[0].question, "A later question about rainfall");
  assert.ok(ui.screen.getByRole("button", { name: "Retry" }));
  answer = (request) => Response.json(annotatedResult(request));
  await afterReload.click(ui.screen.getByRole("button", { name: "Retry" }));
  await ui.waitFor(() => assert.equal(requests.length, 2));
  assert.equal(requests[1].requestId, original.requestId);
  assert.deepEqual(requests[1].annotations, original.annotations);
  await ui.waitFor(() => assert.ok(ui.screen.getByRole("button", { name: "Open answer ↗" })));
  assert.equal((await currentSnapshot("ui-observatory")).view.places.weather.annotations?.[0].question, "A later question about rainfall");
});

test("local annotation submission preserves the ordinary prompt and exact source", async () => {
  const user = await open(fixture("weather"));
  answer = () => new Promise<Response>(() => {});
  const ordinary = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(ordinary, "Compare all the sites later");
  const reader = readerFor("weather");
  reader.scrollTop = 320; ui.fireEvent.scroll(reader);
  selectPassage(paragraph("wind-notes"), "wind exposure");
  const local = ui.screen.getByRole("textbox", { name: "Annotation question" }) as HTMLTextAreaElement;
  assert.equal(document.activeElement, local);
  assert.equal(local.closest('[role="dialog"]')?.getAttribute("aria-label"), "Annotation");
  assert.equal(ordinary.value, "Compare all the sites later");
  assert.equal(local.value, "");
  await user.type(local, "Which instrument measures this?");
  await user.click(ui.screen.getByRole("button", { name: "Send annotation" }));
  await ui.waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].selection, null);
  assert.equal(requests[0].question, "Answer each annotated question separately.");
  assert.deepEqual(requests[0].annotations?.map(({ source, question }) => ({ source, question })), [{
    source: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" },
    question: "Which instrument measures this?",
  }]);
  assert.equal(ordinary.value, "Compare all the sites later");
  assert.equal(reader.scrollTop, 320);
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(saved.view.places.weather.draft, "Compare all the sites later");
  assert.equal(saved.view.places.weather.annotations?.length, 0);
  assert.equal(saved.view.pending?.annotations?.[0].question, "Which instrument measures this?");
});

test("closing and reopening a local annotation retains its draft without navigating", async () => {
  const user = await open(fixture("weather"));
  selectPassage(paragraph("wind-notes"), "Keep a log of storms.");
  await user.type(input(), "Which details should I record?");
  await user.keyboard("{Escape}");
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null);
  assert.equal(activeTopic(), "Weather records");
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(input().value, "Which details should I record?");
  assert.equal(document.activeElement, input());
  await user.click(ui.screen.getByRole("button", { name: "Close annotation" }));
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null);
  await user.click(ui.screen.getByRole("button", { name: "Open annotation 1 at source" }));
  assert.equal(input().value, "Which details should I record?");
  assert.equal(document.activeElement, input());
  assert.equal(activeTopic(), "Weather records");
  assert.equal(requests.length, 0);
  assert.equal((await currentSnapshot("ui-observatory")).view.places.weather.annotations?.[0].question, "Which details should I record?");
});

test("annotation Enter submits while Shift Enter and composition preserve editing", async () => {
  const user = await open(fixture("weather"));
  answer = () => new Promise<Response>(() => {});
  await user.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  const local = input();
  await user.type(local, "Explain the measurements");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  await user.type(local, "and compare instruments");
  assert.equal(local.value, "Explain the measurements\nand compare instruments");
  ui.fireEvent.keyDown(local, { key: "Enter", isComposing: true });
  assert.equal(requests.length, 0);
  await user.keyboard("{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].annotations?.[0].question, "Explain the measurements\nand compare instruments");
  assert.equal(requests[0].annotations?.[0].source.sectionId, "wind-notes");
});

test("editing a saved cross-topic annotation reveals its source without moving the draft owner", async () => {
  const snapshot = fixture("observatory");
  const source = { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" };
  snapshot.view.places.observatory = {
    view: snapshot.view.view, scrollTop: 230, selection: null, draft: "Keep my general question",
    annotations: [{ id: "cross-topic-draft", source, question: "Which measurement matters?" }],
  };
  const user = await open(snapshot);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  await ui.waitFor(() => assert.equal(document.activeElement, input()));
  assert.equal(input().value, "Which measurement matters?");
  assert.equal(activeTopic(), "Plan an observatory");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep my general question");
  const sourceNode = readerFor("weather").closest<HTMLElement>("[data-node-id]")!;
  assert.equal(sourceNode.dataset.detail, "full");
  assert.equal(sourceNode.style.visibility, "visible");
  await user.type(input(), " Explain why.");
  const saved = await currentSnapshot("ui-observatory");
  assert.deepEqual(saved.view.places.observatory.annotations?.[0], { id: "cross-topic-draft", source, question: "Which measurement matters? Explain why." });
  assert.equal(saved.view.places.observatory.scrollTop, 230);
  assert.equal(requests.length, 0);
});

test("selecting a paired source respects that topic's six saved annotation limit", async () => {
  const snapshot = fixture("equipment");
  snapshot.conversation.explorations.equipment.parentId = "weather";
  snapshot.conversation.explorations.equipment.source = { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" };
  snapshot.view.annotationPair = { sourceId: "weather", replyId: "equipment" };
  const queued = ["Measure", "wind exposure", "before choosing", "the roof.", "Keep a log", "of storms."].map((quote, index) => ({
    id: `weather-note-${index}`, source: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote }, question: `Explain passage ${index + 1}`,
  }));
  snapshot.view.places.weather = { view: snapshot.view.view, scrollTop: 170, selection: null, draft: "Keep the weather draft", annotations: queued };
  const user = await open(snapshot);
  await user.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  await ui.screen.findByText("Send these six annotations before adding another.");
  assert.equal(activeTopic(), "Weather records");
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null);
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep the weather draft");
  const saved = await currentSnapshot("ui-observatory");
  assert.deepEqual(saved.view.places.weather.annotations, queued);
  assert.equal(requests.length, 0);
});

test("a narrow cross-topic annotation editor keeps its source readable and its owner draft saved", async () => {
  viewportWidth = 620;
  const snapshot = fixture("observatory");
  const source = { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" };
  snapshot.view.places.observatory = {
    view: snapshot.view.view, scrollTop: 260, selection: null, draft: "Compare all the sites",
    annotations: [{ id: "narrow-source-note", source, question: "Which measurements matter?" }],
  };
  const user = await open(snapshot);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  await ui.waitFor(() => assert.equal(document.activeElement, input()));
  const sourceReader = readerFor("weather");
  const sourceNode = sourceReader.closest<HTMLElement>("[data-node-id]")!;
  const ownerNode = readerFor("observatory").closest<HTMLElement>("[data-node-id]")!;
  assert.equal(sourceNode.dataset.detail, "full");
  assert.equal(sourceNode.style.visibility, "visible", "the passage takes priority when two readable topics cannot fit");
  assert.equal(ownerNode.style.visibility, "hidden", "the temporary source view does not squeeze both topics into a narrow viewport");
  assert.equal(activeTopic(), "Plan an observatory", "the annotation stays in its original draft queue");
  assert.equal(ui.fireEvent.wheel(sourceReader, { deltaY: 80, deltaMode: 0 }), true);
  await user.type(input(), " Explain why.");
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(saved.view.annotationPair, undefined, "temporary editing presentation never leaks into the saved reply pair");
  assert.equal(saved.view.places.observatory.draft, "Compare all the sites");
  assert.equal(saved.view.places.observatory.scrollTop, 260);
  assert.deepEqual(saved.view.places.observatory.annotations?.[0], { id: "narrow-source-note", source, question: "Which measurements matter? Explain why." });
  ui.cleanup();
  await open();
  assert.equal(activeTopic(), "Plan an observatory");
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null);
  assert.equal(input().value, "Compare all the sites");
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(input().value, "Which measurements matter? Explain why.");
  assert.equal(readerFor("weather").closest<HTMLElement>("[data-node-id]")!.style.visibility, "visible");
  assert.equal(requests.length, 0);
});

test("five queued annotations preserve a legacy draft when a seventh source exceeds the limit", async () => {
  const snapshot = fixture("weather");
  const queued = ["Measure", "wind exposure", "before choosing", "the roof.", "Keep a log"].map((quote, index) => ({
    id: `legacy-limit-${index}`, source: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote }, question: `Explain passage ${index + 1}`,
  }));
  const legacySource = { explorationId: "weather", messageId: "weather-answer-two", sectionId: "rain-notes", quote: "record rainfall" };
  snapshot.view.places.weather = { view: snapshot.view.view, scrollTop: 190, selection: legacySource, draft: "How should I record it?", annotations: queued };
  const user = await open(snapshot);
  assert.equal(input().value, "", "the legacy selected question is not an ordinary draft");
  await user.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  await ui.screen.findByText("Send these six annotations before adding another.");
  const saved = await currentSnapshot("ui-observatory");
  const annotations = saved.view.places.weather.annotations!;
  assert.equal(annotations.length, 6);
  assert.deepEqual(annotations.slice(0, 5), queued);
  assert.deepEqual(annotations[5].source, legacySource);
  assert.equal(annotations[5].question, "How should I record it?");
  assert.equal(saved.view.places.weather.selection, null);
  assert.equal(saved.view.places.weather.draft, "");
  assert.equal(ui.screen.queryByRole("dialog", { name: "Annotation" }), null, "the new seventh source is not opened or saved");
  ui.cleanup();
  await open();
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 6" }));
  assert.equal(input().value, "How should I record it?");
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, "record rainfall");
  assert.equal(requests.length, 0);
});

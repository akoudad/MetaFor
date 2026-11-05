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
    Object.defineProperty(dom.window.HTMLElement.prototype, name, { configurable: true, get: () => value });
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
  const response: AnswerResult = {
    requestId: request.requestId, decision, reason: "This detail deserves its own topic.",
    title: "Protect the roof", summary: "Use wind measurements to choose a roof.",
    sections: [{ title: "Use measured conditions", body: "Keep a record of local gusts and use it to compare roof designs." }],
    related: [], context: { fullIds: [request.activeId], summaryIds: [], truncated: false }, model: "test-model",
  };
  if (request.annotations?.length) {
    response.decision = "continue";
    response.topics = request.annotations.map((annotation) => ({
      annotationId: annotation.id, targetId: annotation.source.explorationId, decision,
      title: decision === "continue" ? request.conversation.explorations[annotation.source.explorationId].title : response.title,
      summary: response.summary, sections: response.sections,
    }));
  }
  return response;
}

function annotationInput() {
  return ui.screen.getByRole("textbox", { name: "Annotation question" }) as HTMLTextAreaElement;
}

async function open(snapshot?: Snapshot) {
  if (snapshot) await storage.saveSnapshot(snapshot);
  ui.render(<ConversationSpace />);
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).disabled, false));
  return userEvent.setup({ document: dom.window.document, delay: null });
}

function activeTopic() {
  return ui.screen.getByRole("navigation", { name: "Conversation navigation" }).querySelector('[aria-current="location"]')?.getAttribute("aria-label");
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

async function choiceGraph() {
  await ui.waitFor(() => assert.ok(document.querySelector(".world-stage[data-choice-parent]")));
  assert.equal(document.querySelector(".topic-choice"), null, "choices belong in the graph, not a separate panel");
  return document.querySelector<HTMLElement>(".world-stage[data-choice-parent]")!;
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

test("selecting text offers an action without attaching context, calling the model, or taking focus", async () => {
  const user = await open(fixture("weather"));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Keep my existing draft");
  const reader = document.querySelector<HTMLElement>('[data-topic="weather"] .topic-reading')!;
  ui.act(() => reader.focus());
  const before = activeTopic();
  previewPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, "wind exposure before choosing the roof");
  assert.ok(ui.screen.getByRole("button", { name: "Ask about this" }));
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(document.activeElement, reader);
  assert.equal(composer.value, "Keep my existing draft");
  assert.equal(activeTopic(), before);
  assert.equal(requests.length, 0);
  ui.fireEvent.pageHide(window);
  const saved = (await storage.loadSnapshot("ui-observatory"))!;
  assert.equal(saved.view.places.weather.selection, null, "an uncommitted preview is not saved as question context");
});

test("Ask about this opens a local annotation while preserving the ordinary draft", async () => {
  const user = await open(fixture("weather"));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "How does this affect my design?");
  const quote = "wind exposure before choosing the roof";
  previewPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  await user.click(ui.screen.getByRole("button", { name: "Ask about this" }));
  assert.equal(ui.screen.queryByRole("button", { name: "Ask about this" }), null);
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote);
  assert.equal(document.activeElement, annotationInput());
  assert.equal(annotationInput().value, "");
  assert.equal(composer.value, "How does this affect my design?");
  assert.equal(requests.length, 0);
  ui.fireEvent.pageHide(window);
  const saved = (await storage.loadSnapshot("ui-observatory"))!;
  assert.deepEqual(saved.view.places.weather.annotations?.[0].source, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote });
  assert.equal(saved.view.places.weather.draft, "How does this affect my design?");
});

test("a cross-message selection removes an earlier preview and cannot attach a stale quote", async () => {
  await open(fixture("weather"));
  const first = document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!;
  const second = document.querySelector('[data-section-id="rain-notes"] .answer-markdown p')!;
  previewPassage(first, "wind exposure");
  assert.ok(ui.screen.getByRole("button", { name: "Ask about this" }));
  const range = document.createRange();
  range.setStart(first.firstChild!, 0);
  range.setEnd(second.firstChild!, 5);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  ui.fireEvent.pointerUp(second, { pointerId: 1, button: 0 });
  assert.equal(ui.screen.queryByRole("button", { name: "Ask about this" }), null);
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(requests.length, 0);
});

test("one selected passage can cross sections of the same answer without including Ask controls", async () => {
  const initial = fixture("weather");
  initial.conversation.explorations.weather.messages[0].sections.push({ id: "wind-meaning", title: "How to compare", body: "Use the same measurement height each day." });
  const user = await open(initial);
  const first = document.querySelector('[data-section-id="wind-notes"] .answer-markdown strong')!.firstChild!;
  const second = document.querySelector('[data-section-id="wind-meaning"] .answer-markdown p')!.firstChild!;
  const reader = document.querySelector<HTMLElement>('[data-topic="weather"] .topic-reading')!;
  ui.act(() => reader.focus());
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(second, "Use the same measurement height".length);
  const chosen = dom.window.getSelection()!;
  chosen.removeAllRanges(); chosen.addRange(range);
  const nativeText = chosen.toString();
  ui.fireEvent.pointerUp(second.parentElement!, { pointerId: 1, button: 0 });
  const action = ui.screen.queryByRole("button", { name: "Ask about this" });
  assert.ok(action, `Expected a same-answer selection action. Native range text: ${nativeText}`);
  await user.click(action);
  const quote = "wind exposure before choosing the roof. Keep a log of storms. How to compare Use the same measurement height";
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote);
  ui.fireEvent.pageHide(window);
  const saved = (await storage.loadSnapshot("ui-observatory"))!;
  assert.deepEqual(saved.view.places.weather.annotations?.[0].source, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", endSectionId: "wind-meaning", quote });
  assert.equal(requests.length, 0);
});

test("selection action stays within a horizontally offset visual viewport", async () => {
  const originalViewport = Object.getOwnPropertyDescriptor(dom.window, "visualViewport");
  const originalRects = Object.getOwnPropertyDescriptor(dom.window.Range.prototype, "getClientRects")!;
  const originalBounds = Object.getOwnPropertyDescriptor(dom.window.Range.prototype, "getBoundingClientRect")!;
  const rect = new dom.window.DOMRect(105, 200, 20, 20);
  Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: { offsetLeft: 100, offsetTop: 0, width: 300, height: 700, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rect });
  Object.defineProperty(dom.window.Range.prototype, "getClientRects", { configurable: true, value: () => [rect] });
  try {
    await open(fixture("weather"));
    previewPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, "wind exposure");
    const action = ui.screen.getByRole("button", { name: "Ask about this" });
    const x = Number.parseFloat(action.style.left);
    assert.ok(x >= 108, "action stays right of the visible viewport's left inset");
    assert.ok(x + 156 <= 392, "action stays left of the visible viewport's right inset");
  } finally {
    ui.cleanup();
    if (originalViewport) Object.defineProperty(dom.window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(dom.window, "visualViewport");
    Object.defineProperty(dom.window.Range.prototype, "getClientRects", originalRects);
    Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", originalBounds);
  }
});

test("textarea selection changes cannot revive a stale answer-selection action", async () => {
  const user = await open(fixture("weather"));
  const paragraph = document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!;
  previewPassage(paragraph, "wind exposure");
  const staleRange = dom.window.getSelection()!.getRangeAt(0).cloneRange();
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.click(composer);
  await user.type(composer, "Keep editing this draft");
  const selected = dom.window.getSelection()!;
  selected.removeAllRanges(); selected.addRange(staleRange);
  ui.fireEvent(document, new dom.window.Event("selectionchange"));
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  assert.equal(document.activeElement, composer);
  assert.equal(ui.screen.queryByRole("button", { name: "Ask about this" }), null);
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(composer.value, "Keep editing this draft");
  assert.equal(requests.length, 0);
});

test("selection previews dismiss on Escape, outside pointer, scrolling, resize, and topic navigation", async () => {
  const user = await open(fixture("weather"));
  const paragraph = document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!;
  const preview = () => {
    previewPassage(paragraph, "wind exposure");
    assert.ok(ui.screen.getByRole("button", { name: "Ask about this" }));
  };
  const dismissed = () => assert.equal(Boolean(ui.screen.queryByRole("button", { name: "Ask about this" })), false, "the selection action must stay dismissed");
  preview();
  ui.fireEvent.keyDown(window, { key: "Escape" });
  dismissed();
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  dismissed();
  assert.equal(activeTopic(), "Go to Weather records", "Escape dismisses the action before navigating back");
  preview();
  ui.fireEvent.pointerDown(document.body, { button: 0 });
  dismissed();
  preview();
  ui.fireEvent.scroll(document.querySelector('[data-topic="weather"] .topic-reading')!);
  dismissed();
  preview();
  ui.fireEvent.resize(window);
  dismissed();
  preview();
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  dismissed();
  assert.equal(activeTopic(), "Go to Choose equipment");
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(requests.length, 0);
});

test("section Ask controls still attach a source directly without submitting a question", async () => {
  const user = await open(fixture("weather"));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Keep this draft");
  await user.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, "Watch the wind");
  assert.equal(document.activeElement, annotationInput());
  assert.equal(annotationInput().value, "");
  assert.equal(composer.value, "Keep this draft");
  assert.equal(ui.screen.queryByRole("button", { name: "Ask about this" }), null);
  assert.equal(requests.length, 0);
});

test("plain wheel inside text stays native and topic headers read without changing views", async () => {
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Keep my research draft");
  const reader = readerFor("observatory");
  reader.scrollTop = 300; ui.fireEvent.scroll(reader);
  const camera = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!.style.transform;
  assert.equal(ui.fireEvent.wheel(reader, { deltaY: 120, deltaMode: 0 }), true, "ordinary text reading retains native browser scrolling");
  assert.equal(reader.scrollTop, 300, "jsdom does not emulate the browser's native wheel default");
  const header = document.querySelector('[data-topic="observatory"] .topic-header')!;
  reader.scrollTop = 420; ui.fireEvent.scroll(reader);
  assert.equal(ui.fireEvent.wheel(header, { deltaY: 80 }), false, "the app forwards header scrolling to that topic's reader");
  assert.ok(reader.scrollTop > 420);
  const advanced = reader.scrollTop;
  ui.fireEvent.wheel(header, { deltaY: -60 });
  assert.ok(reader.scrollTop < advanced);
  assert.equal(document.querySelector<HTMLElement>('[data-node-id="observatory"]')!.style.transform, camera);
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(composer.value, "Keep my research draft");
  assert.equal(requests.length, 0);
});

test("topic-owned slow and fast wheel bursts at either edge never navigate even when crossing into space", async () => {
  await open(fixture("weather"));
  const reader = readerFor("weather");
  const node = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
  const camera = node.style.transform;
  for (const direction of [1, -1]) {
    reader.scrollTop = direction > 0 ? reader.scrollHeight - reader.clientHeight : 0;
    for (const delta of [5, 35, 120, 300]) {
      ui.fireEvent.wheel(reader, { deltaY: delta * direction });
      wheelSpace(delta * direction);
      await quietWheel();
      assert.equal(activeTopic(), "Go to Weather records");
      assert.equal(node.style.transform, camera);
    }
  }
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  assert.equal(requests.length, 0);
});

test("short answers and native reader edges keep native scroll without navigation", async () => {
  await open(fixture("weather"));
  const reader = readerFor("weather");
  Object.defineProperty(reader, "scrollHeight", { configurable: true, value: reader.clientHeight });
  for (const deltaY of [-300, 300, -120, 120]) {
    assert.equal(ui.fireEvent.wheel(reader, { deltaY }), true);
    wheelSpace(deltaY);
    await quietWheel();
    assert.equal(activeTopic(), "Go to Weather records");
  }
});

test("Explore shows graph choices and Back restores the parent reading place", async () => {
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Keep the parent draft");
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  await user.click(ui.screen.getByRole("button", { name: "Explore topics from Plan an observatory" }));
  const graph = await choiceGraph();
  assert.equal(graph.querySelectorAll("button[data-graph-choice]").length, 2);
  wheelSpace(300); await quietWheel();
  assert.equal(graph.dataset.choiceParent, "observatory", "downward scrolling must not pick an arbitrary child");
  await user.click(ui.within(graph).getByRole("button", { name: "Enter Weather records" }));
  assert.equal(activeTopic(), "Go to Weather records");
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(reader.scrollTop, 315);
  assert.equal(composer.value, "Keep the parent draft");
});

test("visible depth controls identify the overview and restore the reader after exploring", async () => {
  const user = await open(fixture());
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  const controls = ui.screen.getByRole("navigation", { name: "Topic depth navigation" });
  await user.click(ui.within(controls).getByRole("button", { name: "Up to conversation overview" }));
  assert.ok(ui.within(controls).getByText("Conversation overview · 3 topics"));
  assert.ok(ui.screen.getByRole("button", { name: "Enter Plan an observatory" }).hasAttribute("aria-current"));
  await user.click(ui.within(controls).getByRole("button", { name: "Return to reading Plan an observatory" }));
  assert.equal(reader.scrollTop, 315);
  await user.click(ui.within(controls).getByRole("button", { name: "Explore 2 deeper topics" }));
  const graph = await choiceGraph();
  assert.ok(ui.within(controls).getByRole("button", { name: "Read parent topic Plan an observatory" }));
  await user.click(ui.within(graph).getByRole("button", { name: "Enter Weather records" }));
  await user.click(ui.within(controls).getByRole("button", { name: "Up to parent Plan an observatory" }));
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(reader.scrollTop, 315);
  assert.equal(requests.length, 0);
});

test("one organized answer opens directly without requiring a one-topic choice", async () => {
  answer = (request) => Response.json({
    ...result(request, "continue"),
    topics: [{ targetId: request.activeId, decision: "branch", title: "Roof materials", summary: "Compare durable materials.", sections: [{ title: "Weather resistance", body: "Choose materials that withstand measured gusts and rainfall." }] }],
  });
  const user = await open(fixture());
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain roof materials{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Roof materials"));
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  await ui.waitFor(() => assert.equal(document.querySelector('[data-topic^="topic-"]')?.closest<HTMLElement>("[data-node-id]")?.dataset.detail, "full"));
  await user.click(ui.screen.getByRole("button", { name: "Up to parent Plan an observatory" }));
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(requests.length, 1);
});

test("stopping from another topic exposes recovery without losing the next draft", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explain the site{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.type(composer, "Keep this separate draft");
  await user.click(ui.screen.getByRole("button", { name: "Stop generating" }));
  assert.ok(ui.screen.getByRole("button", { name: "Retry unfinished question" }));
  await user.click(ui.screen.getByRole("button", { name: "View question" }));
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.ok(ui.screen.getByText("Explain the site"));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.click(ui.screen.getByRole("button", { name: "Dismiss unfinished question" }));
  assert.equal(composer.value, "Keep this separate draft");
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  assert.equal(document.querySelector('[data-topic^="exploration-"]'), null);
  assert.equal(document.querySelector(".request-recovery"), null);
});

test("an unread answer stays discoverable through unrelated navigation", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain the site{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByRole("button", { name: "Open answer ↗" });
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  await user.click(ui.screen.getByRole("button", { name: "Conversation map" }));
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  assert.equal(activeTopic(), "Go to Protect the roof");
  assert.equal(ui.screen.queryByRole("button", { name: "Open answer ↗" }), null);
  assert.equal(requests.length, 1);
});

test("opening a late organized continuation reveals its new answer even when already visiting that topic", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Extend the weather analysis{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const reader = readerFor("weather");
  reader.scrollTop = 120; ui.fireEvent.scroll(reader);
  const request = requests[0];
  await ui.act(async () => { resolveAnswer(Response.json({
    ...result(request, "continue"),
    context: { fullIds: ["observatory", "weather"], summaryIds: [], truncated: false },
    topics: [{ targetId: "weather", decision: "continue", title: "Weather records", summary: "Updated weather analysis.", sections: [{ title: "Updated analysis", body: "Measure wind before committing to the design." }] }],
  })); });
  const added = reader.querySelector<HTMLElement>(`[data-message-id="topic-answer-${request.requestId}-0"]`)!;
  assert.ok(added, "the organized continuation must be accepted before testing its reading target");
  added.getBoundingClientRect = () => ({ x: 0, y: 400, top: 400, left: 0, right: 600, bottom: 500, width: 600, height: 100, toJSON() { return {}; } });
  assert.equal(reader.scrollTop, 120, "the late answer must not move a reader before opening it");
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  await ui.waitFor(() => assert.equal(reader.scrollTop, 504));
  assert.equal(activeTopic(), "Go to Weather records");
});

test("opening one late organized answer returns Back to the view actually visited", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explain roof materials{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  const reader = readerFor("equipment");
  reader.scrollTop = 245; ui.fireEvent.scroll(reader);
  await user.type(composer, "Keep my equipment question");
  const request = requests[0];
  await ui.act(async () => { resolveAnswer(Response.json({
    ...result(request, "continue"),
    topics: [{ targetId: request.activeId, decision: "branch", title: "Roof materials", summary: "Compare durable materials.", sections: [{ title: "Weather resistance", body: "Choose materials that withstand measured gusts and rainfall." }] }],
  })); });
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  assert.equal(activeTopic(), "Go to Roof materials");
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  assert.equal(activeTopic(), "Go to Choose equipment", "the unseen origin must not become a phantom Back step");
  assert.equal(reader.scrollTop, 245);
  assert.equal(composer.value, "Keep my equipment question");
  assert.equal(requests.length, 1);
});

test("dismissing a failed question elsewhere does not advertise a nonexistent answer", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain the site{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await ui.act(async () => { resolveAnswer(Response.json({ error: "Temporary failure" }, { status: 503 })); });
  await user.click(ui.screen.getByRole("button", { name: "Dismiss unfinished question" }));
  assert.equal(ui.screen.queryByRole("button", { name: "Open answer ↗" }), null);
  assert.equal(document.querySelector(".composer-notice"), null);
  assert.equal(document.querySelector(".request-recovery"), null);
});

test("saved chats keep intact conversations accessible and explain a damaged copy", async () => {
  const user = await open(fixture());
  localStorage.setItem("metaphore.ingx.v1:damaged-copy", "{broken");
  await user.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  const panel = ui.screen.getByRole("complementary", { name: "Saved chats" });
  await ui.within(panel).findByText(/Some saved copies could not be read/);
  assert.ok(ui.within(panel).getByRole("button", { name: /Plan an observatory/ }));
  assert.equal(localStorage.getItem("metaphore.ingx.v1:damaged-copy"), "{broken");
});

test("access dialog keeps keyboard focus inside and returns to composing on Escape", async () => {
  answer = () => Response.json({ error: "Enter the demo access code." }, { status: 401 });
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" });
  await user.type(composer, "Explain the site{Enter}");
  const dialog = await ui.screen.findByRole("dialog", { name: "Demo access" });
  assert.equal(document.activeElement, ui.within(dialog).getByLabelText("Demo access code"));
  await user.tab();
  assert.equal(document.activeElement, ui.within(dialog).getByRole("button", { name: "Continue" }));
  await user.tab();
  assert.equal(document.activeElement, ui.within(dialog).getByRole("button", { name: "Close access code" }));
  await user.tab({ shift: true });
  assert.equal(document.activeElement, ui.within(dialog).getByRole("button", { name: "Continue" }));
  await user.keyboard("{Escape}");
  assert.equal(ui.screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, composer);
  assert.equal(requests.length, 1);
});

test("Back follows visits while breadcrumb follows ancestry and normal focus reads one topic", async () => {
  const user = await open(fixture());
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  ui.fireEvent.pageHide(window);
  const current = (await storage.loadSnapshot("ui-observatory"))!;
  assert.equal(current.view.annotationPair, undefined, "ordinary focus does not force source pairing");
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  assert.equal(activeTopic(), "Go to Choose equipment");
  const path = ui.screen.getByRole("navigation", { name: "Conversation path" });
  await user.click(ui.within(path).getByRole("button", { name: "Plan an observatory" }));
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(reader.scrollTop, 315);
});

test("keyboard graph choices cycle, open, and return focus without consuming draft Escape", async () => {
  const user = await open(fixture());
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  ui.act(() => ui.screen.getByRole("button", { name: "Explore topics from Plan an observatory" }).focus());
  await user.keyboard("{Enter}");
  const graph = await choiceGraph();
  const choices = [...graph.querySelectorAll<HTMLButtonElement>("button[data-graph-choice]")];
  await ui.waitFor(() => assert.equal(document.activeElement, choices[0]));
  await user.keyboard("{ArrowRight}");
  assert.equal(document.activeElement, choices[1]);
  await user.keyboard("{ArrowLeft}");
  assert.equal(document.activeElement, choices[0]);
  await user.keyboard("{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  await ui.waitFor(() => assert.equal(document.activeElement, readerFor("weather")));
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  await user.click(ui.screen.getByRole("button", { name: "Explore topics from Plan an observatory" }));
  await choiceGraph();
  await user.keyboard("{Escape}");
  await ui.waitFor(() => assert.ok(document.activeElement === reader, "focus returns to the parent reader"));
  assert.equal(reader.scrollTop, 315);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" });
  await user.type(composer, "Do not lose this draft");
  await user.keyboard("{Escape}");
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal((composer as HTMLTextAreaElement).value, "Do not lose this draft");
});

test("reloading during a fork restores the parent reading view, passage, draft, and scroll position", async () => {
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Compare these site constraints");
  selectPassage(document.querySelector('[data-section-id="choose-site"] .answer-markdown p')!, "weather, access");
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  ui.fireEvent.pageHide(window);
  const before = (await storage.loadSnapshot("ui-observatory"))!;
  await user.click(ui.screen.getByRole("button", { name: "Explore topics from Plan an observatory" }));
  await choiceGraph();
  ui.fireEvent.pageHide(window);
  const saved = (await storage.loadSnapshot("ui-observatory"))!;
  assert.deepEqual(saved.view.view, before.view.view, "a transient fork camera must not become the saved reading camera");
  assert.deepEqual(saved.view.places.observatory.view, before.view.places.observatory.view);
  assert.equal(saved.view.overview, false);
  assert.equal(saved.view.places.observatory.scrollTop, 315);
  assert.equal(saved.view.places.observatory.draft, "Compare these site constraints");
  assert.deepEqual(saved.view.places.observatory.annotations, before.view.places.observatory.annotations);
  ui.cleanup();
  await open();
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  assert.equal(activeTopic(), "Go to Plan an observatory");
  assert.equal(readerFor("observatory").scrollTop, 315);
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Compare these site constraints");
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, "weather, access");
  assert.equal(requests.length, 0);
});

test("empty-space scrolling moves between reading, parent, graph choices, and overview one gesture at a time", async () => {
  const user = await open(fixture());
  const reader = readerFor("observatory");
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  wheelSpace(120);
  const graph = await choiceGraph();
  assert.equal(graph.dataset.choiceParent, "observatory");
  wheelSpace(-300);
  assert.equal(graph.dataset.choiceParent, "observatory", "reversal in the same gesture cannot leave the graph");
  await quietWheel(); wheelSpace(-120);
  await ui.waitFor(() => assert.equal(graph.dataset.choiceParent, undefined));
  assert.equal(reader.scrollTop, 315);
  await quietWheel(); wheelSpace(-120);
  await ui.screen.findByText("Plan an observatory, depth 0, overview");
  await quietWheel(); wheelSpace(120);
  await ui.waitFor(() => assert.equal(ui.screen.queryByText("Plan an observatory, depth 0, overview"), null));
  assert.equal(reader.scrollTop, 315);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await quietWheel(); wheelSpace(-120);
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
  assert.equal(reader.scrollTop, 315);
});

test("a fresh chat is empty and its first answer is placed automatically", async () => {
  answer = (request) => Response.json(result(request, "continue"));
  const user = await open();
  assert.ok(ui.screen.getByRole("heading", { name: "What’s on your mind?" }));
  assert.ok(ui.screen.getByRole("button", { name: "New chat" }));
  assert.ok(ui.screen.getByRole("button", { name: "Saved chats" }));
  assert.equal(ui.screen.queryByRole("button", { name: /sample/i }), null);
  assert.equal(ui.screen.queryByRole("combobox", { name: "Answer placement" }), null);
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Help plan an observatory{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].activeId, "root");
  assert.equal(requests[0].mode, "auto");
  assert.equal(ui.screen.queryByRole("button", { name: "Open as branch" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: "Keep in parent" }), null);
});

test("a city batch creates four explicit choices and later histories retain their correct city ancestors", async () => {
  const cities = ["Marrakesh", "Fes", "Rabat", "Tangier"];
  answer = (request) => {
    const response = { ...result(request, "continue"), title: "Morocco trip", summary: "Explore four cities and their places.", sections: [{ title: "Four cities", body: cities.join(", ") }] };
    if (requests.length === 1) return Response.json(response);
    const history = requests.length === 3;
    const names = history ? cities.slice(0, 3) : cities;
    return Response.json({
      ...response,
      sections: [{ title: history ? "City histories" : "Places by city", body: history ? "The three histories are organized beneath their cities." : "Each city has its own collection of seven places." }],
      context: { fullIds: Object.keys(request.conversation.explorations), summaryIds: [], truncated: false },
      topics: names.map((city) => ({
        targetId: history ? Object.values(request.conversation.explorations).find((item) => item.title === city)!.id : request.activeId,
        decision: "branch", title: history ? `${city} history` : city,
        summary: history ? `A history of ${city}.` : `Seven places in ${city}.`,
        sections: history ? [{ title: "History", body: `A focused historical account of ${city}.` }] : Array.from({ length: 7 }, (_, index) => ({ title: `Place ${index + 1}`, body: `${city} place ${index + 1} details.` })),
      })),
    });
  };
  const user = await open();
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Suggest four Moroccan cities{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Morocco trip"));
  const first = await currentSnapshot();
  assert.equal(Object.keys(first.conversation.explorations).length, 1, "a brief shortlist stays in one answer");
  const originalAnswer = structuredClone(first.conversation.explorations.root.messages[1]);
  await user.type(composer, "Give me seven places in each city{Enter}");
  const cityGraph = await choiceGraph();
  assert.equal(cityGraph.querySelectorAll("button[data-graph-choice]").length, 4);
  for (const city of cities) assert.ok(ui.within(cityGraph).getByRole("button", { name: `Enter ${city}` }));
  assert.equal(activeTopic(), "Go to Morocco trip", "a batch must not choose its first destination for the user");
  const organized = await currentSnapshot();
  assert.equal(Object.keys(organized.conversation.explorations).length, 5);
  assert.deepEqual(organized.conversation.explorations.root.messages[1], originalAnswer);
  assert.equal(organized.conversation.explorations.root.messages.at(-1)!.sections.length, 1);
  const cityIds = Object.fromEntries(cities.map((city) => [city, Object.values(organized.conversation.explorations).find((item) => item.title === city)!.id]));
  for (const city of cities) {
    const topic = organized.conversation.explorations[cityIds[city]];
    assert.equal(topic.parentId, "root");
    assert.equal(topic.messages.at(-1)!.sections.length, 7);
  }
  await user.click(ui.within(cityGraph).getByRole("button", { name: "Enter Marrakesh" }));
  await user.type(composer, "Keep this city draft");
  const cityReader = readerFor(cityIds.Marrakesh);
  cityReader.scrollTop = 315; ui.fireEvent.scroll(cityReader);
  await user.click(ui.screen.getByRole("button", { name: "Go to Morocco trip" }));
  await user.type(composer, "Explain the histories of the first three cities{Enter}");
  const historyGraph = await choiceGraph();
  assert.equal(historyGraph.querySelectorAll("button[data-graph-choice]").length, 3, "choices are the returned topics, not all children of the request origin");
  for (const city of cities.slice(0, 3)) {
    assert.ok(ui.within(historyGraph).getByRole("button", { name: `Enter ${city} history` }));
  }
  const histories = await currentSnapshot();
  assert.equal(Object.keys(histories.conversation.explorations).length, 8);
  for (const city of cities.slice(0, 3)) {
    const topic = Object.values(histories.conversation.explorations).find((item) => item.title === `${city} history`)!;
    assert.equal(topic.parentId, cityIds[city]);
    await ui.waitFor(() => assert.equal(document.querySelector<HTMLElement>(`[data-node-id="${cityIds[city]}"]`)!.style.visibility, "visible", "a history's city ancestor remains visible in the batch overview"));
  }
  await ui.waitFor(() => assert.equal(document.querySelector<HTMLElement>(`[data-node-id="${cityIds.Tangier}"]`)!.style.visibility, "hidden", "unaffected topics are not substituted for the explicit result choices"));
  await user.click(ui.within(historyGraph).getByRole("button", { name: "Enter Marrakesh history" }));
  await user.click(await ui.screen.findByRole("button", { name: "Back to Marrakesh ↗" }));
  assert.equal(activeTopic(), "Go to Marrakesh");
  assert.equal(composer.value, "Keep this city draft");
  assert.equal(cityReader.scrollTop, 315);
  assert.equal(requests.length, 3);
});

test("a late batch stays in the background and opens only its affected topics without losing the next draft", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explore roof design and site access separately{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.type(composer, "My next weather question");
  const request = requests[0];
  await ui.act(async () => { resolveAnswer(Response.json({
    ...result(request, "continue"), sections: [{ title: "Two topics", body: "Roof design and site access are ready to explore." }],
    topics: ["Roof design", "Site access"].map((title) => ({ targetId: request.activeId, decision: "branch", title, summary: `Explore ${title.toLowerCase()}.`, sections: [{ title, body: `${title} details.` }] })),
  })); });
  await ui.screen.findByText("Your answer is ready in 2 topics.", { exact: false });
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(composer.value, "My next weather question");
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  const graph = await choiceGraph();
  assert.equal(graph.querySelectorAll("button[data-graph-choice]").length, 2);
  assert.ok(ui.within(graph).getByRole("button", { name: "Enter Roof design" }));
  assert.ok(ui.within(graph).getByRole("button", { name: "Enter Site access" }));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  assert.equal(composer.value, "My next weather question");
  assert.equal(requests.length, 1);
});

test("an unopened batch cannot redirect a later failed question away from its retry card", async () => {
  const responses: ((value: Response) => void)[] = [];
  answer = () => new Promise<Response>((resolve) => { responses.push(resolve); });
  const user = await open(fixture());
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explore roof design and site access separately{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const first = requests[0];
  await ui.act(async () => { responses[0](Response.json({
    ...result(first, "continue"), sections: [{ title: "Two topics", body: "Roof design and site access are ready to explore." }],
    topics: ["Roof design", "Site access"].map((title) => ({ targetId: first.activeId, decision: "branch", title, summary: `Explore ${title.toLowerCase()}.`, sections: [{ title, body: `${title} details.` }] })),
  })); });
  await ui.screen.findByText("Your answer is ready in 2 topics.", { exact: false });
  await user.type(composer, "Explain the rainfall records{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 2));
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  await user.type(composer, "Keep my equipment draft");
  await ui.act(async () => { responses[1](Response.json({ error: "The model is temporarily unavailable." }, { status: 503 })); });
  await ui.screen.findByText("The question in another topic needs a retry.", { exact: false });
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null, "the old batch must not replace the failed question's reading view");
  assert.ok(await ui.screen.findByRole("button", { name: "Retry" }));
  assert.ok(ui.screen.getByText("Explain the rainfall records"));
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  assert.equal(composer.value, "Keep my equipment draft");
  const saved = await currentSnapshot("ui-observatory");
  assert.equal(Object.keys(saved.conversation.explorations).length, 5, "the earlier batch remains saved even after its notice is cleared");
  assert.equal(saved.view.pending?.requestId, requests[1].requestId);
  assert.equal(requests.length, 2);
});

test("a malformed batch leaves every original topic intact and retains a retryable question", async () => {
  const initial = fixture();
  const original = structuredClone(initial.conversation);
  answer = (request) => Response.json({
    ...result(request, "continue"), sections: [{ title: "Overview", body: "Two proposed topics." }],
    topics: [
      { targetId: request.activeId, decision: "branch", title: "Valid first topic", summary: "A valid entry before the invalid entry.", sections: [{ title: "Details", body: "This must not partially appear." }] },
      { targetId: "missing-city", decision: "branch", title: "Invalid target", summary: "This target does not exist.", sections: [{ title: "Details", body: "Reject the complete batch." }] },
    ],
  });
  const user = await open(initial);
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Organize two subjects{Enter}");
  await ui.screen.findByRole("button", { name: "Retry" });
  assert.equal(ui.screen.queryByRole("button", { name: "Go to Valid first topic" }), null);
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  const saved = await currentSnapshot("ui-observatory");
  assert.deepEqual(saved.conversation, original, "invalid batches cannot update the overview or create a subset of the proposed nodes");
  assert.equal(saved.view.pending?.question, "Organize two subjects");
  assert.equal(requests.length, 1);
});

test("an exact passage from an older arbitrary answer becomes the new branch source", async () => {
  answer = (request) => Response.json(result(request));
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const paragraph = document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!;
  const quote = "wind exposure before choosing the roof";
  selectPassage(paragraph, quote);
  await ui.waitFor(() => assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote));
  await user.type(annotationInput(), "How should this change the design?{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].activeId, "weather");
  assert.equal(requests[0].mode, "auto");
  assert.deepEqual(requests[0].annotations?.[0].source, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote });
  assert.equal(document.querySelector(".topic.is-focused .source-quote p")?.textContent, quote);
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  const branch = saved!.conversation.explorations[saved!.view.activeId];
  assert.equal(branch.parentId, "weather", `Saved active topic: ${saved!.view.activeId}; topics: ${Object.keys(saved!.conversation.explorations).join(", ")}`);
  assert.deepEqual(branch.source, requests[0].annotations?.[0].source);
});

test("a deferred answer preserves navigation and a draft edited in another topic", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "How do I measure the wind?{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  const draft = "Compare two lightweight mounts";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByText("Your answer is ready.", { exact: false });
  assert.equal(activeTopic(), "Go to Choose equipment");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  assert.equal(saved!.view.activeId, "equipment");
  assert.equal(saved!.view.places.equipment.draft, draft);
  assert.ok(saved!.conversation.explorations[`exploration-${requests[0].requestId}`]);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
});

test("editing the same topic's next draft prevents a pending answer from taking over", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "How do I measure the wind?{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  await user.clear(composer);
  const nextDraft = "Also compare rain protection";
  await user.type(composer, nextDraft);
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByText("Your answer is ready.", { exact: false });
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(document.activeElement, composer);
  assert.equal(composer.value, nextDraft);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].question, "How do I measure the wind?");
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  assert.equal(saved!.view.activeId, "weather");
  assert.equal(saved!.view.places.weather.draft, nextDraft);
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, nextDraft);
});

test("remounting restores the draft, passage, reader position, and positioned topic view", async () => {
  const initial = fixture();
  initial.view.positions = { weather: { x: 1234, y: -260, z: -1050 } };
  const user = await open(initial);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const quote = "wind exposure before choosing the roof";
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  const draft = "Explain the wind measurement";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  const reader = document.querySelector<HTMLDivElement>('[data-topic="weather"] .topic-reading')!;
  reader.scrollTop = 315;
  ui.fireEvent.scroll(reader);
  const node = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
  await ui.waitFor(() => assert.equal(node.style.visibility, "visible"));
  const transform = node.style.transform;
  assert.ok(transform, "the saved topic is projected through the camera");
  ui.fireEvent.pageHide(window);
  ui.cleanup();
  await open();
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote);
  assert.equal(document.querySelector<HTMLDivElement>('[data-topic="weather"] .topic-reading')!.scrollTop, 315);
  await ui.waitFor(() => assert.equal(document.querySelector<HTMLElement>('[data-node-id="weather"]')!.style.transform, transform));
  ui.fireEvent.pageHide(window);
  const restored = await storage.loadSnapshot("ui-observatory");
  assert.deepEqual(restored!.view.positions, initial.view.positions);
  assert.equal(restored!.view.places.weather.scrollTop, 315);
  assert.deepEqual(restored!.view.places.weather.annotations?.[0].source, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote });
  assert.equal(requests.length, 0);
});

test("a crowded conversation keeps keyboard navigation, long-answer outlines, and drafts usable", async (context) => {
  const crowded = fixture();
  const longSections = Array.from({ length: 6 }, (_, index) => ({
    id: `survey-section-${index + 1}`,
    title: `Survey section ${index + 1}`,
    body: `Keep the original measurement notes for section ${index + 1}.\n\n${"Record the date, conditions, and instrument settings before comparing observations. ".repeat(32)}`,
  }));
  for (let index = 1; index <= 32; index++) {
    const id = `field-notes-${index}`;
    crowded.conversation.explorations[id] = {
      id, title: `Field notes ${index}`, summary: `A separate set of field observations, number ${index}.`,
      parentId: "observatory", source: { explorationId: "observatory", messageId: "site-answer", sectionId: "choose-site" }, position: [0, 0, -1050],
      messages: [{ id: `${id}-answer`, role: "assistant", sections: index === 32 ? longSections : [{ id: `${id}-section`, title: "Observation", body: `Compare the observations from location ${index}.` }] }],
    };
  }
  assert.ok(Object.keys(crowded.conversation.explorations).length > 25);
  const characters = longSections.reduce((total, section) => total + section.body.length, 0);
  assert.ok(characters > 10_000);
  const started = performance.now();
  const user = await open(crowded);
  context.diagnostic(`Restored 35 topics with a ${characters}-character answer in ${Math.round(performance.now() - started)} ms in jsdom; not a browser performance measurement.`);

  const first = ui.screen.getByRole("button", { name: "Go to Plan an observatory" });
  const last = ui.screen.getByRole("button", { name: "Go to Field notes 32" });
  await user.click(first);
  await user.keyboard("{End}");
  assert.equal(document.activeElement, last);
  assert.equal(activeTopic(), "Go to Plan an observatory", "moving rail focus should only preview a topic");
  await user.keyboard("{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Field notes 32"));
  await user.keyboard("{Home}");
  assert.equal(document.activeElement, first);
  assert.equal(activeTopic(), "Go to Field notes 32");
  await user.keyboard("{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
  await user.keyboard("{End}{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Field notes 32"));

  const article = document.querySelector<HTMLElement>('[data-topic="field-notes-32"]')!;
  const reader = article.querySelector<HTMLDivElement>(".topic-reading")!;
  const section = article.querySelector<HTMLElement>('[data-section-id="survey-section-5"]')!;
  // Supply this section's offscreen position: jsdom cannot measure text layout.
  // This verifies that the outline targets the requested existing section.
  section.getBoundingClientRect = () => ({ x: 0, y: 1600 - reader.scrollTop, top: 1600 - reader.scrollTop, left: 0, right: 600, bottom: 1800 - reader.scrollTop, width: 600, height: 200, toJSON() { return {}; } });
  const outline = await ui.within(article).findByRole("button", { name: /In this topic/ });
  await user.click(outline);
  await user.click(ui.within(article).getByRole("button", { name: /^Survey section 5$/ }));
  assert.ok(reader.scrollTop > 0, "choosing a distant section must move the reading position");
  assert.equal(outline.getAttribute("aria-expanded"), "false");
  const quote = "Keep the original measurement notes for section 5.";
  selectPassage(section.querySelector(".answer-markdown p")!, quote);
  await ui.waitFor(() => assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote));
  const draft = "Help me compare this measurement";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  await user.click(ui.screen.getByRole("button", { name: "Conversation map" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  assert.equal(activeTopic(), "Go to Field notes 32");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote);
  assert.equal(requests.length, 0);
});

test("an invalid .ingx import leaves the active workspace and unsent draft intact", async () => {
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  const draft = "Keep my equipment question";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  const file = new dom.window.File(["{"], "broken.ingx", { type: "application/json" });
  // jsdom does not expose File.text in every supported runtime.
  Object.defineProperty(file, "text", { value: async () => "{" });
  await user.upload(ui.screen.getByLabelText("Import conversation file"), file);
  await ui.screen.findByText("This file is not valid JSON. Choose an intact .ingx export.");
  assert.equal(activeTopic(), "Go to Choose equipment");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  assert.equal(requests.length, 0);
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  assert.equal(saved!.conversation.title, "Plan an observatory");
  assert.equal(saved!.view.activeId, "equipment");
  assert.equal(saved!.view.places.equipment.draft, draft);
});

test("scrolling and zooming during a request leaves its answer in the background and clears the sent draft", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explain protection from wind{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  const reader = document.querySelector<HTMLDivElement>('[data-topic="weather"] .topic-reading')!;
  reader.scrollTop = 315;
  ui.fireEvent.scroll(reader);
  ui.fireEvent.wheel(reader, { deltaY: -120, deltaMode: 0 });
  await user.click(ui.screen.getByRole("button", { name: "Zoom out" }));
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByText("Your answer is ready.", { exact: false });
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(composer.value, "", "a completed question must not stay available for accidental resubmission");
  await user.click(composer);
  await user.keyboard("{Enter}");
  assert.equal(requests.length, 1);
  ui.fireEvent.pageHide(window);
  const snapshot = await storage.loadSnapshot("ui-observatory");
  assert.equal(snapshot!.view.places.weather.draft, "");
  assert.ok(snapshot!.conversation.explorations[`exploration-${requests[0].requestId}`]);
});

test("a slow valid import disables composing until it restores the imported workspace", async () => {
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Keep the original draft");
  const incoming = fixture("equipment");
  incoming.conversation.id = "incoming-space";
  incoming.conversation.title = "Imported research";
  incoming.view.places.equipment = { view: incoming.view.view, draft: "Imported equipment question", selection: null, scrollTop: 0 };
  let resolveFile!: (value: string) => void;
  const contents = new Promise<string>((resolve) => { resolveFile = resolve; });
  const file = new dom.window.File(["pending"], "research.ingx", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => contents });
  await user.upload(ui.screen.getByLabelText("Import conversation file"), file);
  assert.equal(composer.disabled, true);
  assert.ok(ui.screen.getByText("Opening conversation…"));
  await user.type(composer, "Do not append this");
  ui.fireEvent.submit(composer.form!);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Go to Choose equipment" }));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Ask about Watch the wind" }));
  assert.equal(activeTopic(), "Go to Weather records", "pending storage transitions must also block keyboard-activated navigation");
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(requests.length, 0);
  assert.equal(composer.value, "Keep the original draft");
  await ui.act(async () => { resolveFile(storage.serializeSnapshot(incoming)); });
  await ui.waitFor(() => assert.equal(composer.disabled, false));
  assert.equal(activeTopic(), "Go to Choose equipment");
  assert.equal(composer.value, "Imported equipment question");
  assert.equal((await storage.loadSnapshot("ui-observatory"))!.view.places.weather.draft, "Keep the original draft");
  const imported = (await storage.listSnapshots()).find((entry) => entry.title === "Imported research");
  assert.ok(imported);
  const restored = await storage.loadSnapshot(imported.id);
  assert.equal(restored!.conversation.title, "Imported research");
  assert.notEqual(restored!.conversation.id, incoming.conversation.id, "import opens a separate saved copy");
});

test("a failed slow import re-enables composing without replacing the current draft", async () => {
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Preserve this draft after failure");
  let rejectFile!: (error: Error) => void;
  const contents = new Promise<string>((_, reject) => { rejectFile = reject; });
  const file = new dom.window.File(["pending"], "unreadable.ingx", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => contents });
  await user.upload(ui.screen.getByLabelText("Import conversation file"), file);
  assert.equal(composer.disabled, true);
  await ui.act(async () => { rejectFile(new Error("The file could not be read.")); });
  await ui.screen.findByText("The file could not be read.");
  assert.equal(composer.disabled, false);
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(composer.value, "Preserve this draft after failure");
  await user.type(composer, " Still editable.");
  assert.equal(composer.value, "Preserve this draft after failure Still editable.");
  assert.equal(requests.length, 0);
});


test("legacy annotation continuation retains its source and can be explored without placement controls", async () => {
  answer = (request) => Response.json(result(request, requests.length === 1 ? "continue" : "branch"));
  const initial = fixture("weather");
  const source = { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure before choosing the roof" };
  initial.view.places.weather = { view: initial.view.view, scrollTop: 0, draft: "Clarify the roof recommendation", selection: source };
  const user = await open(initial);
  await user.click(ui.screen.getByRole("button", { name: /Resume annotation/ }));
  await user.type(annotationInput(), "{Enter}");
  await ui.waitFor(() => assert.ok(document.querySelector(`[data-message-id="answer-${requests[0].requestId}"]`)));
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(ui.screen.queryByRole("combobox", { name: "Answer placement" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: /Open as branch|Keep in parent/ }), null);
  assert.equal(ui.screen.queryByText(/Opened a branch|Continued here/), null);
  const quote = "record of local gusts";
  selectPassage(document.querySelector(`[data-message-id="answer-${requests[0].requestId}"] .answer-markdown p`)!, quote);
  await user.type(annotationInput(), "Explore measuring those gusts{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.ok(requests.every((request) => request.mode === "auto"));
  assert.deepEqual(requests[0].selection, source);
  assert.equal(requests[1].annotations?.[0].source.messageId, `answer-${requests[0].requestId}`);
  assert.equal(requests[1].annotations?.[0].source.quote, quote);
  ui.fireEvent.pageHide(window);
  const snapshot = storage.parseSnapshot(storage.serializeSnapshot((await storage.loadSnapshot("ui-observatory"))!));
  const continued = snapshot.conversation.explorations.weather.messages.find((message) => message.id === `answer-${requests[0].requestId}`)!;
  assert.deepEqual(continued.source, requests[0].selection);
  assert.equal(continued.sections[0].body, result(requests[0]).sections[0].body);
  assert.deepEqual(snapshot.conversation.explorations[snapshot.view.activeId].source, requests[1].annotations?.[0].source);
});

test("New chat preserves previous content and drafts in Saved chats", async () => {
  const initial = fixture();
  const user = await open(initial);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const quote = "wind exposure before choosing the roof";
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  const draft = "Keep my unfinished weather question";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  await user.click(ui.screen.getByRole("button", { name: "New chat" }));
  await ui.screen.findByRole("heading", { name: "What’s on your mind?" });
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "");
  const preserved = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.deepEqual(preserved.conversation, initial.conversation);
  assert.equal(preserved.view.places.weather.draft, draft);
  assert.equal(preserved.view.places.weather.annotations?.[0].source.quote, quote);
  const freshDraft = "A different unfinished question";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), freshDraft);
  await user.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  const savedPanel = ui.screen.getByRole("complementary", { name: "Saved chats" });
  await user.click(await ui.within(savedPanel).findByRole("button", { name: /^Plan an observatory/ }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  await user.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal(document.querySelector(".annotation-popover-source")?.textContent, quote);
  const library = await storage.listSnapshots();
  assert.equal(library.length, 2);
  const fresh = (await storage.loadSnapshot(library.find((item) => item.id !== initial.conversation.id)!.id))!;
  assert.equal(fresh.view.places[fresh.conversation.rootId].draft, freshDraft);
  assert.equal(requests.length, 0);
});

test("a legacy sample stays saved but startup opens an empty chat", async () => {
  const real = fixture();
  real.view.places.observatory = { view: real.view.view, draft: "My original research", selection: null, scrollTop: 0 };
  await storage.saveSnapshot(real);
  const legacy = fixture();
  legacy.conversation.id = "legacy-demo";
  legacy.conversation.title = "Legacy example";
  legacy.conversation.kind = "sample";
  legacy.savedAt = "2025-01-01T00:00:00.000Z";
  const user = await open(legacy);
  assert.ok(ui.screen.getByRole("heading", { name: "What’s on your mind?" }));
  assert.equal(ui.screen.queryByRole("navigation", { name: "Conversation navigation" }), null);
  assert.deepEqual((await storage.loadSnapshot("legacy-demo"))!.conversation, legacy.conversation);
  await user.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  const panel = ui.screen.getByRole("complementary", { name: "Saved chats" });
  assert.ok(await ui.within(panel).findByRole("button", { name: /^Legacy example/ }));
  await user.click(await ui.within(panel).findByRole("button", { name: /^Plan an observatory/ }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "My original research");
  assert.equal((await storage.listSnapshots()).length, 2);
  assert.equal(requests.length, 0);
});

test("Reset layout clears saved manual positions while retaining content and reading state", async () => {
  const initial = fixture();
  initial.view.positions = { weather: { x: 1234, y: -260, z: -1050 } };
  const user = await open(initial);
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const quote = "wind exposure before choosing the roof";
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  const draft = "Keep this while arranging the topics";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  const reader = document.querySelector<HTMLDivElement>('[data-topic="weather"] .topic-reading')!;
  reader.scrollTop = 315; ui.fireEvent.scroll(reader);
  const handle = ui.screen.getByRole("button", { name: "Move Weather records" });
  ui.fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
  ui.fireEvent.pointerMove(handle, { clientX: 180, clientY: 130 });
  ui.fireEvent.pointerUp(handle, { button: 0, clientX: 180, clientY: 130 });
  ui.fireEvent.pageHide(window);
  const moved = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.notDeepEqual(moved.view.positions?.weather, initial.view.positions.weather, "moving a handle should persist the new position");
  await user.click(ui.screen.getByRole("button", { name: "Conversation menu" }));
  await user.click(ui.screen.getByRole("button", { name: "Reset layout" }));
  ui.fireEvent.pageHide(window);
  const reset = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.deepEqual(reset.view.positions, {});
  assert.equal(reset.view.overview, true);
  assert.equal(reset.view.activeId, "weather");
  assert.deepEqual(reset.conversation, initial.conversation);
  assert.equal(reset.view.places.weather.draft, draft);
  assert.equal(reset.view.places.weather.annotations?.[0].source.quote, quote);
  assert.equal(reset.view.places.weather.scrollTop, 315);
  assert.notDeepEqual(reset.view.view, moved.view.view);
  ui.cleanup(); await open();
  ui.fireEvent.pageHide(window);
  assert.deepEqual((await storage.loadSnapshot(initial.conversation.id))!.view.positions, {});
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  assert.equal(requests.length, 0);
});

test("a failed save cannot replace the current chat when New chat is chosen", async () => {
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const draft = "Do not lose this question";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  const database = indexedDB;
  const local = localStorage;
  globalValue("indexedDB", undefined);
  globalValue("localStorage", { getItem: () => null, setItem: () => { throw new Error("Storage blocked"); } });
  try {
    await user.click(ui.screen.getByRole("button", { name: "New chat" }));
    await ui.screen.findByText(/Could not save this space locally/);
    assert.equal(activeTopic(), "Go to Weather records");
    const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    assert.equal(composer.value, draft);
    assert.equal(composer.disabled, false);
    assert.equal(requests.length, 0);
  } finally {
    globalValue("indexedDB", database);
    globalValue("localStorage", local);
  }
});

test("an automatically separated topic links to its parent without inventing a selected passage", async () => {
  answer = (request) => Response.json(result(request));
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explore roof design as a separate topic{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.equal(requests[0].mode, "auto");
  assert.equal(requests[0].selection, null);
  assert.equal(document.querySelector(".topic.is-focused .source-quote"), null);
  await user.click(ui.screen.getByRole("button", { name: "Back to Weather records ↗" }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  ui.fireEvent.pageHide(window);
  const saved = (await storage.loadSnapshot("ui-observatory"))!;
  const child = Object.values(saved.conversation.explorations).find((item) => item.messages.some((message) => message.requestId === requests[0].requestId))!;
  assert.equal(child.parentId, "weather");
  assert.equal(child.source, null);
  assert.equal(requests.length, 1);
});

test("grabbing during camera easing freezes the displayed view and uses its drag scale", async () => {
  manualAnimation = true; prefersReducedMotion = false;
  const user = await open(fixture());
  const stepFrame = async (time: number) => {
    const callbacks = [...manualFrames.values()]; manualFrames.clear();
    await ui.act(async () => { for (const callback of callbacks) callback(time); });
  };
  await stepFrame(1000);
  const root = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!;
  const scaleOf = () => Number(root.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
  const originalScale = scaleOf();
  await user.click(ui.screen.getByRole("button", { name: "Zoom out" }));
  await stepFrame(1016);
  const displayedScale = scaleOf();
  assert.ok(displayedScale < originalScale && displayedScale > originalScale / 1.5, "the camera must still be between its old view and zoom target");
  const focal = 780 / (2 * Math.tan(25 * Math.PI / 180));
  const displayedZ = focal / displayedScale;
  const handle = ui.screen.getByRole("button", { name: "Move Plan an observatory" });
  ui.fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
  await stepFrame(1032);
  assert.ok(Math.abs(scaleOf() - displayedScale) < 1e-9, "grabbing must stop the unfinished zoom without changing its displayed scale");
  ui.fireEvent.pointerMove(handle, { clientX: 160, clientY: 124 });
  ui.fireEvent.pointerUp(handle, { button: 0, clientX: 160, clientY: 124 });
  ui.fireEvent.pageHide(window);
  const snapshot = (await storage.loadSnapshot("ui-observatory"))!;
  assert.ok(Math.abs(snapshot.view.view.z - displayedZ) < 1e-9, "the saved target must be the camera seen when grabbing");
  assert.ok(Math.abs(snapshot.view.positions!.observatory.x - 60 / displayedScale) < 1e-9);
  assert.ok(Math.abs(snapshot.view.positions!.observatory.y + 24 / displayedScale) < 1e-9);
  assert.equal(requests.length, 0);
});

test("old automatic-layout views recover an offscreen active topic without losing reading state", async () => {
  const initial = fixture("weather");
  initial.view.view = { x: -100_000, y: 100_000, z: 900 };
  initial.view.places.weather = { view: initial.view.view, draft: "Keep these notes", selection: { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote: "wind exposure" }, scrollTop: 250 };
  await open(initial);
  const node = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
  await ui.waitFor(() => assert.equal(node.style.visibility, "visible"));
  ui.fireEvent.pageHide(window);
  const snapshot = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.notDeepEqual(snapshot.view.view, initial.view.view);
  assert.deepEqual(snapshot.conversation, initial.conversation);
  assert.equal(snapshot.view.places.weather.draft, "Keep these notes");
  assert.deepEqual(snapshot.view.places.weather.selection, initial.view.places.weather.selection);
  assert.equal(snapshot.view.places.weather.scrollTop, 250);
  assert.deepEqual(snapshot.view.places.weather.view, snapshot.view.view);
});

test("a valid saved view keeps its precise camera instead of recentering", async () => {
  const initial = fixture();
  initial.view.view = { x: 40, y: -25, z: 950 };
  initial.view.places.observatory = { view: initial.view.view, draft: "Keep this viewpoint", selection: null, scrollTop: 125 };
  await open(initial);
  const node = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!;
  await ui.waitFor(() => assert.equal(node.style.visibility, "visible"));
  ui.fireEvent.pageHide(window);
  const snapshot = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.deepEqual(snapshot.view.view, initial.view.view);
  assert.equal(snapshot.view.places.observatory.scrollTop, 125);
  assert.equal(snapshot.view.places.observatory.draft, "Keep this viewpoint");
});

test("an unrelated manual position does not prevent recovery of an offscreen automatic topic", async () => {
  const initial = fixture("weather");
  initial.view.positions = { observatory: { x: 1200, y: 450, z: 0 } };
  initial.view.view = { x: -100_000, y: 100_000, z: 900 };
  initial.view.places.weather = { view: initial.view.view, draft: "Keep the weather notes", selection: null, scrollTop: 180 };
  await open(initial);
  const active = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
  await ui.waitFor(() => assert.equal(active.style.visibility, "visible"));
  ui.fireEvent.pageHide(window);
  const snapshot = (await storage.loadSnapshot(initial.conversation.id))!;
  assert.notDeepEqual(snapshot.view.view, initial.view.view);
  assert.deepEqual(snapshot.view.positions, initial.view.positions);
  assert.deepEqual(snapshot.conversation, initial.conversation);
  assert.equal(snapshot.view.places.weather.draft, "Keep the weather notes");
  assert.equal(snapshot.view.places.weather.scrollTop, 180);
});

test("submission clears immediately while its card and captured passage retain the question", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture("weather"));
  const quote = "wind exposure before choosing the roof";
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  const local = annotationInput();
  const question = "How do I measure this?";
  await user.type(local, `${question}{Enter}`);
  assert.equal(ui.screen.queryByRole("textbox", { name: "Annotation question" }), null, "submitted editor closes before the answer resolves");
  assert.equal(composer.value, "");
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal(document.querySelector(".pending-answer .original-question")?.textContent, `1. ${question}`);
  assert.equal(requests[0].annotations?.[0].source.quote, quote);

  // A next draft with identical words is still a separate draft. Old response
  // cleanup must not erase it, and Enter must not submit it while unresolved.
  await user.type(composer, `${question}{Enter}`);
  assert.equal(requests.length, 1);
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByText("Your answer is ready", { exact: false });
  assert.equal(composer.value, question);
  assert.equal(activeTopic(), "Go to Weather records");
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  assert.equal(saved!.view.pending, undefined);
  assert.equal(saved!.view.places.weather.draft, question);
});

test("Stop retains a retryable question and Dismiss keeps the next draft", async () => {
  let staleResolve!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { staleResolve = resolve; });
  const user = await open(fixture("weather"));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explain roof loads{Enter}Next draft stays here");
  await user.click(ui.screen.getByRole("button", { name: "Stop" }));
  assert.ok(ui.screen.getByRole("button", { name: "Retry" }));
  assert.equal(composer.value, "Next draft stays here");
  await user.type(composer, "{Enter}");
  assert.equal(requests.length, 1);
  ui.fireEvent.pageHide(window);
  assert.equal((await storage.loadSnapshot("ui-observatory"))!.view.pending?.question, "Explain roof loads");
  await user.click(ui.screen.getByRole("button", { name: "Dismiss" }));
  assert.equal(composer.value, "Next draft stays here");
  assert.equal(document.querySelector(".pending-answer"), null);
  await ui.act(async () => { staleResolve(Response.json(result(requests[0]))); });
  assert.equal(document.querySelector('[data-topic^="exploration-"]'), null, "an aborted response cannot reappear after dismissal");
  ui.fireEvent.pageHide(window);
  assert.equal((await storage.loadSnapshot("ui-observatory"))!.view.pending, undefined);
});

test("an error retries the captured request without consuming or replacing the next draft", async () => {
  answer = () => Response.json({ error: "Temporary test failure" }, { status: 503 });
  const user = await open(fixture("weather"));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explain the original question{Enter}");
  await ui.screen.findByRole("button", { name: "Retry" });
  assert.equal(composer.value, "");
  await user.type(composer, "New draft after the error{Enter}");
  assert.equal(requests.length, 1, "error recovery cannot silently become a different request");
  answer = (request) => Response.json(result(request, "continue"));
  await user.click(ui.screen.getByRole("button", { name: "Retry" }));
  await ui.waitFor(() => assert.equal(document.querySelector(".pending-answer"), null));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(composer.value, "New draft after the error");
});

test("reload preserves an unfinished question and another topic's draft without auto-sending", async () => {
  answer = () => new Promise<Response>(() => {});
  const user = await open(fixture("weather"));
  const quote = "wind exposure before choosing the roof";
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, quote);
  await user.type(annotationInput(), "Explain this exact passage{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Focus topic: Choose equipment" }));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Next equipment question");
  ui.fireEvent.pageHide(window);
  const before = await storage.loadSnapshot("ui-observatory");
  assert.equal(before!.view.pending?.annotations?.[0].question, "Explain this exact passage");
  assert.equal(before!.view.places.weather.draft, "");
  assert.equal(before!.view.places.equipment.draft, "Next equipment question");
  ui.cleanup();
  await open();
  assert.equal(requests.length, 1, "restoring recovery metadata must never call the model");
  assert.equal(activeTopic(), "Go to Choose equipment");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Next equipment question");
  await user.click(ui.screen.getByRole("button", { name: "Open answer ↗" }));
  assert.equal(activeTopic(), "Go to Weather records");
  answer = (request) => Response.json(result(request));
  await user.click(ui.screen.getByRole("button", { name: "Retry" }));
  await ui.waitFor(() => assert.equal(document.querySelector(".pending-answer"), null));
  assert.equal(requests[1].question, requests[0].question);
  assert.equal(requests[1].requestId, requests[0].requestId);
  assert.deepEqual(requests[1].annotations, requests[0].annotations);
  await user.click(ui.screen.getByRole("button", { name: "Focus topic: Choose equipment" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Next equipment question");
});

test("New chat saves a paused question and draft that return from Saved chats", async () => {
  answer = () => new Promise<Response>(() => {});
  const user = await open(fixture("weather"));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Keep this submitted question{Enter}Keep this next draft");
  await user.click(ui.screen.getByRole("button", { name: "Stop" }));
  await user.click(ui.screen.getByRole("button", { name: "New chat" }));
  await ui.screen.findByRole("heading", { name: "What’s on your mind?" });
  await user.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  await user.click(await ui.screen.findByRole("button", { name: /Plan an observatory\d/ }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  assert.equal(document.querySelector(".pending-answer .original-question")?.textContent, "Keep this submitted question");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep this next draft");
  assert.equal(requests.length, 1);
});

test("typing during a new topic's arrival freezes the displayed camera and preserves the draft", async () => {
  manualAnimation = true; prefersReducedMotion = false;
  answer = (request) => Response.json(result(request));
  const user = await open(fixture());
  const stepFrame = async (time: number) => {
    const callbacks = [...manualFrames.values()]; manualFrames.clear();
    await ui.act(async () => { for (const callback of callbacks) callback(time); });
  };
  await stepFrame(1000);
  const root = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!;
  const start = root.style.transform;
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  await user.type(composer, "Explore roof design{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  for (let frame = 1; frame <= 8; frame++) await stepFrame(1000 + frame * 50);
  const displayed = root.style.transform;
  assert.notEqual(displayed, start, "a followed new topic should begin its spatial camera journey");
  await user.type(composer, "Keep this viewpoint while I type");
  await stepFrame(1450);
  assert.equal(root.style.transform, displayed, "typing must stop at the visible camera, not resume toward the old destination");
  for (let frame = 1; frame <= 30; frame++) await stepFrame(1450 + frame * 50);
  assert.equal(root.style.transform, displayed);
  ui.fireEvent.pageHide(window);
  const snapshot = (await storage.loadSnapshot("ui-observatory"))!;
  const displayedScale = Number(displayed.match(/scale\(([^)]+)\)/)?.[1]);
  const focal = 780 / (2 * Math.tan(25 * Math.PI / 180));
  assert.ok(Math.abs(snapshot.view.view.z - focal / displayedScale) < 1e-9);
  assert.equal(snapshot.view.places[snapshot.view.activeId].draft, "Keep this viewpoint while I type");
});

test("choosing context for the next question prevents a pending answer from clearing it", async () => {
  let resolveAnswer!: (value: Response) => void;
  answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  const user = await open(fixture("weather"));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain the weather{Enter}");
  await user.click(ui.screen.getByRole("button", { name: "Conversation menu" }));
  await user.click(ui.screen.getByRole("button", { name: "Connections" }));
  const checkbox = ui.screen.getByRole("checkbox", { name: "Choose equipment" }) as HTMLInputElement;
  await user.click(checkbox);
  await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
  await ui.screen.findByText("Your answer is ready.", { exact: false });
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(checkbox.checked, true, "new context choices must not be cleared by the previous answer");
  assert.equal(requests.length, 1);
});

for (const input of ["keyboard", "scrollbar"] as const) {
  test(`navigation regression: ${input} reading prevents a pending answer from moving the reader`, async () => {
    let resolveAnswer!: (value: Response) => void;
    answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
    const user = await open(fixture("weather"));
    await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain roof measurements{Enter}");
    await ui.waitFor(() => assert.equal(requests.length, 1));
    await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const reader = readerFor("weather");
    const node = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
    const camera = node.style.transform;

    // Do not click or wheel first: each input must independently stop following
    // a late answer. jsdom needs the native scroll result applied explicitly.
    if (input === "keyboard") {
      reader.focus();
      ui.fireEvent.keyDown(reader, { key: "PageUp" });
    } else {
      ui.fireEvent.pointerDown(reader, { button: 0, pointerId: 1 });
    }
    reader.scrollTop = 315; ui.fireEvent.scroll(reader);
    await ui.act(async () => { resolveAnswer(Response.json(result(requests[0], "continue"))); });
    await ui.screen.findByText("Your answer is ready.", { exact: false });
    assert.equal(activeTopic(), "Go to Weather records");
    assert.equal(reader.scrollTop, 315);
    assert.equal(node.style.transform, camera);
    const saved = await currentSnapshot("ui-observatory");
    assert.equal(saved.view.places.weather.scrollTop, 315);
    assert.ok(saved.conversation.explorations.weather.messages.some((message) => message.sections.some((section) => section.title === "Use measured conditions")));
  });
}

test("navigation regression: Center leaves a source pair at the canonical topic camera", async () => {
  const initial = fixture("weather");
  initial.view.annotationPair = { sourceId: "observatory", replyId: "weather" };
  initial.view.history = ["observatory"];
  const user = await open(initial);
  const reader = readerFor("weather");
  reader.scrollTop = 275; ui.fireEvent.scroll(reader);
  await user.click(ui.screen.getByRole("button", { name: "Center current topic" }));
  const saved = await currentSnapshot("ui-observatory");
  const point = layoutSpace(initial.conversation).find((node) => node.id === "weather")!.position;
  assert.equal(saved.view.annotationPair, undefined);
  assert.deepEqual(saved.view.view, focusView(point, 1100, 780));
  assert.equal(saved.view.places.weather.scrollTop, 275);
  assert.equal(activeTopic(), "Go to Weather records");
  const node = document.querySelector<HTMLElement>('[data-node-id="weather"]')!;
  await ui.waitFor(() => assert.equal(node.style.visibility, "visible"));
  assert.equal(node.dataset.detail, "full");
});

test("navigation regression: Escape with empty history preserves a restored source pair", async () => {
  const initial = fixture("weather");
  initial.view.annotationPair = { sourceId: "observatory", replyId: "weather" };
  await open(initial);
  const before = await currentSnapshot("ui-observatory");
  const reader = readerFor("weather");
  reader.focus();
  ui.fireEvent.keyDown(reader, { key: "Escape" });
  const after = await currentSnapshot("ui-observatory");
  assert.deepEqual(after.view.annotationPair, before.view.annotationPair);
  assert.deepEqual(after.view.view, before.view.view);
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal((ui.screen.getByRole("button", { name: "Return to previous view" }) as HTMLButtonElement).disabled, true);
});

test("navigation regression: visiting a source does not attach it to the next question", async () => {
  const initial = fixture("weather");
  const parent = layoutSpace(initial.conversation).find((node) => node.id === "observatory")!.position;
  initial.view.places.observatory = { view: focusView(parent, 1100, 780), draft: "Compare all the options", selection: null, scrollTop: 200 };
  answer = (request) => Response.json(result(request, "continue"));
  const user = await open(initial);
  await user.click(ui.screen.getByRole("button", { name: /From Plan an observatory/ }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
  await ui.waitFor(() => assert.ok(document.querySelector('[data-section-id="choose-site"].source-revealed')));
  const composer = ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
  assert.equal(composer.value, "Compare all the options");
  assert.equal(document.querySelector(".annotation-popover-source"), null);
  assert.equal((await currentSnapshot("ui-observatory")).view.places.observatory.selection, null);
  await user.type(composer, "{Enter}");
  await ui.waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].activeId, "observatory");
  assert.equal(requests[0].question, "Compare all the options");
  assert.equal(requests[0].selection, null);
});

test("navigation regression: focused reading caps nearby topics, pairs retain readers, and maps stay compact", async () => {
  const { default: SpatialWorld } = await import("../src/components/SpatialWorld");
  const nodes = [
    { id: "reader", position: { x: 0, y: 0, z: 0 } },
    { id: "neighbor", position: { x: -350, y: 0, z: 0 } },
  ];
  const view = focusView(nodes[0].position, 1100, 780);
  const scene = (activeId?: string, fullDetailIds?: string[], compact = false) => <SpatialWorld nodes={nodes} links={[]} view={view} reducedMotion activeId={activeId} fullDetailIds={fullDetailIds} compact={compact}>
    {(node) => <p>{node.id}</p>}
  </SpatialWorld>;
  const rendered = ui.render(scene());
  const neighbor = document.querySelector<HTMLElement>('[data-node-id="neighbor"]')!;
  const reader = document.querySelector<HTMLElement>('[data-node-id="reader"]')!;
  await ui.waitFor(() => assert.equal(neighbor.dataset.detail, "full", "unconstrained projection uses scale"));
  assert.equal(neighbor.style.visibility, "visible", "the regression needs a nearby card in view");

  rendered.rerender(scene("reader"));
  await ui.waitFor(() => assert.equal(neighbor.dataset.detail, "summary"));
  assert.equal(reader.dataset.detail, "full");

  rendered.rerender(scene("reader", ["reader", "neighbor"]));
  await ui.waitFor(() => assert.equal(neighbor.dataset.detail, "full", "explicit source pairing must retain both readers"));
  rendered.rerender(scene(undefined, undefined, true));
  await ui.waitFor(() => assert.equal(neighbor.dataset.detail, "summary", "maps cannot contain accidentally expanded readers"));
  assert.equal(reader.dataset.detail, "summary");
});

test("space navigation cancels when its gesture crosses into a topic", async () => {
  await open(fixture());
  const reader = readerFor("observatory");
  wheelSpace(40);
  assert.equal(ui.fireEvent.wheel(reader, { deltaY: 50 }), true);
  wheelSpace(500);
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  assert.equal(activeTopic(), "Go to Plan an observatory");
  await quietWheel(); wheelSpace(100);
  assert.equal((await choiceGraph()).dataset.choiceParent, "observatory");
});

test("one child opens on a fresh space gesture and momentum cannot cross another level", async () => {
  const initial = fixture();
  delete initial.conversation.explorations.equipment;
  await open(initial);
  wheelSpace(100_000);
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  wheelSpace(-100_000);
  assert.equal(activeTopic(), "Go to Weather records");
  await quietWheel(); wheelSpace(-120);
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
});

test("scrolling into a compact focused topic restores reading before exploring children", async () => {
  const initial = fixture();
  initial.view.positions = { observatory: { x: 0, y: 0, z: 0 } };
  initial.view.view = { x: 0, y: 0, z: 3000 };
  await open(initial);
  const node = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!;
  await ui.waitFor(() => assert.notEqual(node.dataset.detail, "full"));
  wheelSpace(120);
  await ui.waitFor(() => assert.equal(node.dataset.detail, "full"));
  assert.equal(document.querySelector(".world-stage[data-choice-parent]"), null);
  await quietWheel(); wheelSpace(120);
  await choiceGraph();
});

test("scrolling out to a parent opens its reader even when its saved camera was zoomed out", async () => {
  const initial = fixture("weather");
  initial.view.places.observatory = { view: { x: 0, y: 0, z: 9000 }, draft: "Keep the parent question", selection: null, scrollTop: 315 };
  await open(initial);
  wheelSpace(-120);
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Plan an observatory"));
  const node = document.querySelector<HTMLElement>('[data-node-id="observatory"]')!;
  await ui.waitFor(() => assert.equal(node.dataset.detail, "full"));
  assert.equal(readerFor("observatory").scrollTop, 315);
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep the parent question");
  const saved = await currentSnapshot("ui-observatory");
  const parent = layoutSpace(initial.conversation).find((item) => item.id === "observatory")!.position;
  assert.deepEqual(saved.view.view, focusView(parent, 1100, 780));
});

for (const outcome of ["success", "error", "cancel"] as const) {
  test(`global thinking remains while navigating and clears on ${outcome}`, async () => {
    let resolveAnswer!: (value: Response) => void;
    answer = () => new Promise<Response>((resolve) => { resolveAnswer = resolve; });
    const user = await open(fixture());
    await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explain the site requirements{Enter}");
    const status = document.querySelector<HTMLElement>(".generation-status")!;
    assert.equal(ui.within(status).getByRole("status").textContent, "Thinking…");
    await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
    assert.ok(status.isConnected);
    assert.ok(ui.screen.getByRole("button", { name: "Stop generating" }));
    if (outcome === "cancel") {
      await user.click(ui.screen.getByRole("button", { name: "Stop generating" }));
      await ui.act(async () => { resolveAnswer(Response.json(result(requests[0]))); });
    } else {
      await ui.act(async () => { resolveAnswer(outcome === "success"
        ? Response.json(result(requests[0]))
        : Response.json({ error: "Temporary model failure" }, { status: 503 })); });
    }
    await ui.waitFor(() => assert.equal(document.querySelector(".generation-status"), null));
    assert.equal(activeTopic(), "Go to Weather records");
    assert.equal(requests.length, 1);
    if (outcome === "cancel") assert.equal(document.querySelector('[data-topic^="exploration-"]'), null, "a stopped answer cannot arrive later");
  });
}

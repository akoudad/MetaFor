import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import type { Snapshot } from "../src/lib/storage";

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
  return {
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
  return ui.screen.getByRole("navigation", { name: "Conversation navigation" }).querySelector('[aria-current="location"]')?.getAttribute("aria-label");
}

function selectPassage(element: Element, quote: string) {
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

test("an exact passage from an older arbitrary answer becomes the new branch source", async () => {
  answer = (request) => Response.json(result(request));
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  const paragraph = document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!;
  const quote = "wind exposure before choosing the roof";
  selectPassage(paragraph, quote);
  await ui.waitFor(() => assert.equal(document.querySelector(".selection-chip p")?.textContent, quote));
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "How should this change the design?{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].activeId, "weather");
  assert.equal(requests[0].mode, "auto");
  assert.deepEqual(requests[0].selection, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote });
  assert.equal(document.querySelector(".topic.is-focused .source-quote p")?.textContent, quote);
  ui.fireEvent.pageHide(window);
  const saved = await storage.loadSnapshot("ui-observatory");
  const branch = saved!.conversation.explorations[saved!.view.activeId];
  assert.equal(branch.parentId, "weather", `Saved active topic: ${saved!.view.activeId}; topics: ${Object.keys(saved!.conversation.explorations).join(", ")}`);
  assert.deepEqual(branch.source, requests[0].selection);
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
  assert.equal(document.querySelector(".selection-chip p")?.textContent, quote);
  assert.equal(document.querySelector<HTMLDivElement>('[data-topic="weather"] .topic-reading')!.scrollTop, 315);
  await ui.waitFor(() => assert.equal(document.querySelector<HTMLElement>('[data-node-id="weather"]')!.style.transform, transform));
  ui.fireEvent.pageHide(window);
  const restored = await storage.loadSnapshot("ui-observatory");
  assert.deepEqual(restored!.view.positions, initial.view.positions);
  assert.equal(restored!.view.places.weather.scrollTop, 315);
  assert.deepEqual(restored!.view.places.weather.selection, { explorationId: "weather", messageId: "weather-answer-one", sectionId: "wind-notes", quote });
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
  await ui.waitFor(() => assert.equal(document.querySelector(".selection-chip p")?.textContent, quote));
  const draft = "Help me compare this measurement";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), draft);
  await user.click(ui.screen.getByRole("button", { name: /^Overview/ }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  await user.click(ui.screen.getByRole("button", { name: "Return to previous view" }));
  assert.equal(activeTopic(), "Go to Field notes 32");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  assert.equal(document.querySelector(".selection-chip p")?.textContent, quote);
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
  assert.equal(document.querySelector(".selection-chip"), null);
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


test("automatic continuation retains its source and can be explored without placement controls", async () => {
  answer = (request) => Response.json(result(request, requests.length === 1 ? "continue" : "branch"));
  const user = await open(fixture());
  await user.click(ui.screen.getByRole("button", { name: "Go to Weather records" }));
  selectPassage(document.querySelector('[data-section-id="wind-notes"] .answer-markdown p')!, "wind exposure before choosing the roof");
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Clarify the roof recommendation{Enter}");
  await ui.waitFor(() => assert.ok(document.querySelector(`[data-message-id="answer-${requests[0].requestId}"]`)));
  assert.equal(activeTopic(), "Go to Weather records");
  assert.equal(ui.screen.queryByRole("combobox", { name: "Answer placement" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: /Open as branch|Keep in parent/ }), null);
  assert.equal(ui.screen.queryByText(/Opened a branch|Continued here/), null);
  const quote = "record of local gusts";
  selectPassage(document.querySelector(`[data-message-id="answer-${requests[0].requestId}"] .answer-markdown p`)!, quote);
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), "Explore measuring those gusts{Enter}");
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Protect the roof"));
  assert.ok(requests.every((request) => request.mode === "auto"));
  assert.equal(requests[1].selection?.messageId, `answer-${requests[0].requestId}`);
  assert.equal(requests[1].selection?.quote, quote);
  ui.fireEvent.pageHide(window);
  const snapshot = storage.parseSnapshot(storage.serializeSnapshot((await storage.loadSnapshot("ui-observatory"))!));
  const continued = snapshot.conversation.explorations.weather.messages.find((message) => message.id === `answer-${requests[0].requestId}`)!;
  assert.deepEqual(continued.source, requests[0].selection);
  assert.equal(continued.sections[0].body, result(requests[0]).sections[0].body);
  assert.deepEqual(snapshot.conversation.explorations[snapshot.view.activeId].source, requests[1].selection);
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
  assert.equal(preserved.view.places.weather.selection?.quote, quote);
  const freshDraft = "A different unfinished question";
  await user.type(ui.screen.getByRole("textbox", { name: "Your question" }), freshDraft);
  await user.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  const savedPanel = ui.screen.getByRole("complementary", { name: "Saved chats" });
  await user.click(await ui.within(savedPanel).findByRole("button", { name: /^Plan an observatory/ }));
  await ui.waitFor(() => assert.equal(activeTopic(), "Go to Weather records"));
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, draft);
  assert.equal(document.querySelector(".selection-chip p")?.textContent, quote);
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
  assert.equal(reset.view.places.weather.selection?.quote, quote);
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
  assert.equal(document.querySelector(".selection-chip"), null);
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

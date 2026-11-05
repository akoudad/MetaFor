import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { snapshotFromHelp, mergeHelpSnapshot } from "../chat-transfer";
import type { DesktopChatBridge } from "../../src/components/ConversationSpace";
import type { AnswerRequest } from "../../src/lib/contracts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
const frames = new Map<number, ReturnType<typeof setTimeout>>();
let frameID = 0;
let ui: typeof import("@testing-library/react");
let ConversationSpace: typeof import("../../src/components/ConversationSpace").default;
let storage: typeof import("../../src/lib/storage");
let deliver: (value: string) => void;
let currentID: string;
let desktop: DesktopChatBridge;
let statusRequests: number;
let answer: (request: AnswerRequest) => Promise<Response>;

function globalValue(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Text", "Event", "MouseEvent", "File", "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver"] as const) globalValue(name, name === "window" ? dom.window : dom.window[name]);
  globalValue("localStorage", dom.window.localStorage);
  globalValue("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  globalValue("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
  globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  globalValue("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++frameID; frames.set(id, setTimeout(() => { frames.delete(id); callback(performance.now()); }, 1)); return id; });
  globalValue("cancelAnimationFrame", (id: number) => { clearTimeout(frames.get(id)); frames.delete(id); });
  globalValue("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(dom.window, "matchMedia", { value: (media: string) => ({ media, matches: true, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", { value: () => null });
  for (const [name, value] of Object.entries({ clientWidth: 1100, clientHeight: 780, offsetHeight: 413, scrollHeight: 2000 })) Object.defineProperty(dom.window.HTMLElement.prototype, name, { configurable: true, get: () => value });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 413, width: 600, height: 413, toJSON() { return {}; } });
  [ui, { default: ConversationSpace }, storage] = await Promise.all([import("@testing-library/react"), import("../../src/components/ConversationSpace"), import("../../src/lib/storage")]);
});

beforeEach(() => {
  globalValue("indexedDB", new IDBFactory()); dom.window.localStorage.clear();
  currentID = ""; statusRequests = 0;
  answer = async () => { throw new Error("Unexpected model request."); };
  globalValue("fetch", async (input: string, init?: RequestInit) => {
    if (input === "/api/status") { statusRequests += 1; return Response.json({ configured: true, model: "test-model", accessCodeRequired: false }); }
    if (input === "/api/answer") return answer(JSON.parse(String(init?.body)) as AnswerRequest);
    throw new Error(`Unexpected network request: ${input}`);
  });
  desktop = {
    onOpenConversation(callback) { deliver = callback; return () => { deliver = () => {}; }; },
    async prepareImport(content) { const next = storage.parseSnapshot(content); return mergeHelpSnapshot(await storage.loadSnapshot(next.conversation.id), next); },
    onConversationChanged(id) { currentID = id; }, openHelp() {}, openSettings() {},
  };
});

afterEach(async () => {
  ui.cleanup();
  for (const frame of frames.values()) clearTimeout(frame);
  frames.clear();
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("metaphore-spaces"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("The desktop UI test left storage open.")); });
});
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});

function incoming() {
  return snapshotFromHelp({
    id: "help-ui-source", title: "Explain this diagram", source: null,
    createdAt: "2026-11-05T02:00:00.000Z", updatedAt: "2026-11-05T02:01:00.000Z",
    messages: [{ id: "help-question", role: "user", text: "What do these arrows mean?", createdAt: "2026-11-05T02:00:00.000Z" }, { id: "help-answer", role: "assistant", text: "The arrows show how information moves.", createdAt: "2026-11-05T02:01:00.000Z" }],
  });
}

async function open() {
  ui.render(<ConversationSpace desktop={desktop} />);
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).disabled, false));
}

test("opening a Help exchange first saves the normal Chat draft and restores it through Saved chats", async () => {
  await open();
  const originalID = currentID;
  ui.fireEvent.change(ui.screen.getByRole("textbox", { name: "Your question" }), { target: { value: "Keep my unsent question here" } });
  ui.act(() => deliver(storage.serializeSnapshot(incoming())));
  await ui.waitFor(() => assert.equal(currentID, "help-ui-source"));
  const saved = await storage.loadSnapshot(originalID);
  assert.equal(saved?.view.places.root.draft, "Keep my unsent question here");
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Saved chats" }));
  const library = await ui.screen.findByRole("complementary", { name: "Saved chats" });
  await ui.waitFor(() => assert.ok(ui.within(library).getByRole("button", { name: /New conversation/ })));
  ui.fireEvent.click(ui.within(library).getByRole("button", { name: /New conversation/ }));
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep my unsent question here"));
});

test("Help waits for an active Chat answer, then opens without losing the completed answer", async () => {
  let finish: (() => void) | undefined;
  answer = async (request) => new Promise((resolve) => {
    finish = () => resolve(Response.json({ requestId: request.requestId, decision: "continue", reason: "Main answer", title: "Original conversation", summary: "The answer is kept", sections: [{ title: "", body: "This answer must survive opening Help." }], related: [], context: { fullIds: [request.activeId], summaryIds: [], truncated: false }, model: "test-model" }));
  });
  await open();
  const originalID = currentID;
  ui.fireEvent.change(ui.screen.getByRole("textbox", { name: "Your question" }), { target: { value: "Answer my original question" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question" }));
  await ui.waitFor(() => assert.ok(finish));
  ui.act(() => deliver(storage.serializeSnapshot(incoming())));
  assert.equal(currentID, originalID);
  await ui.act(async () => finish!());
  await ui.waitFor(() => assert.equal(currentID, "help-ui-source"));
  const saved = await storage.loadSnapshot(originalID);
  assert.ok(saved?.conversation.explorations.root.messages.some((message) => message.sections.some((section) => section.body === "This answer must survive opening Help.")));
  assert.equal(saved?.view.pending, undefined);
});

test("bad desktop transfers keep the current draft and settings changes refresh model status", async () => {
  await open();
  const originalID = currentID;
  ui.fireEvent.change(ui.screen.getByRole("textbox", { name: "Your question" }), { target: { value: "Keep this too" } });
  ui.act(() => deliver("not valid json"));
  await ui.screen.findByText(/This file is not valid JSON/);
  assert.equal(currentID, originalID);
  assert.equal((ui.screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).value, "Keep this too");
  const previous = statusRequests;
  ui.act(() => window.dispatchEvent(new Event("metafor-settings-changed")));
  await ui.waitFor(() => assert.equal(statusRequests, previous + 1));
});

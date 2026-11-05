import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { CropRect, DesktopBridge, HelpSession } from "../shared";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://metafor.local" });
let ui: typeof import("@testing-library/react");
let Help: typeof import("../renderer/Help").default;
let Selection: typeof import("../renderer/Selection").default;
let bridge: DesktopBridge;
let session: HelpSession;
const now = "2026-11-05T00:00:00.000Z";
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { name: string; value?: unknown }[] = [];
const record = (name: string, value?: unknown) => { calls.push({ name, value }); };

before(async () => {
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "HTMLTextAreaElement", "MutationObserver"] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : dom.window[name] });
  }
  Object.defineProperty(dom.window, "PointerEvent", { configurable: true, value: dom.window.MouseEvent });
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) });
  [ui, { default: Help }, { default: Selection }] = await Promise.all([import("@testing-library/react"), import("../renderer/Help"), import("../renderer/Selection")]);
});

beforeEach(() => {
  calls.length = 0;
  session = { id: "help-one", title: "Diagram", createdAt: now, updatedAt: now, messages: [], source: { id: "source-one", image: "data:image/png;base64,aA==", capturedAt: now, appName: "Preview", title: "Diagram", width: 1000, height: 500 } };
  const partial: Partial<DesktopBridge> = {
    getHelpSession: async () => session,
    getSettings: async () => ({ configured: true, model: "test", baseURL: "https://api.example.test", shortcut: "CommandOrControl+Shift+H", shortcutRegistered: true, screenPermission: "granted", storagePath: "/tmp" }),
    onHelpSession: () => () => {},
    onCapture: () => () => {},
    hideHelp: async () => { record("hide"); },
    openSettings: async () => { record("settings"); },
    captureScreen: async () => { record("capture"); },
    getCapture: async () => ({ image: "data:image/png;base64,aA==", width: 1000, height: 500, displayId: "display-1" }),
    selectCapture: async (value: CropRect) => { record("crop", value); },
    cancelCapture: async () => { record("cancelCapture"); },
    cancelHelp: async (id: string) => { record("cancelHelp", id); },
    listHelp: async () => [],
    newHelp: async () => { record("newHelp"); return { ...session, id: "help-two", source: null, messages: [] }; },
    openHelpInChat: async (id: string) => { record("chat", id); },
    askHelp: async (value) => { record("ask", value); return { ...session, messages: [{ id: "q1", role: "user", text: value.question, createdAt: now }, { id: "a1", role: "assistant", text: "This explains the selected diagram.", createdAt: now }] }; },
  };
  bridge = partial as DesktopBridge;
  window.metaforDesktop = bridge;
});

afterEach(() => ui.cleanup());
after(() => { dom.window.close(); for (const [name, value] of originals) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });

test("a local crop is reviewed without sending it, then explicit Send creates a linked exchange", async () => {
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  assert.equal(calls.length, 0);
  ui.fireEvent.change(question, { target: { value: "Explain this detail" } });
  assert.equal(calls.length, 0, "typing does not transmit the screenshot");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question and selected image" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls.find((item) => item.name === "ask")?.value, { sessionId: "help-one", question: "Explain this detail", marks: [] });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: /Continue in Metafor Chat/ }));
  await ui.waitFor(() => assert.ok(calls.some((item) => item.name === "chat" && item.value === "help-one")));
});

test("Help resumes after Keychain unlock without requiring focus or losing the question", async () => {
  const settings = { ...(await bridge.getSettings()), configured: false, credentialLoading: true, hasSavedKey: true };
  bridge.getSettings = async () => settings;
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  await ui.screen.findByText(/Waiting for macOS Keychain/);
  ui.fireEvent.change(question, { target: { value: "Keep this question while unlocking" } });
  assert.equal((ui.screen.getByRole("button", { name: "Send question and selected image" }) as HTMLButtonElement).disabled, true);
  ui.fireEvent.keyDown(question, { key: "Enter" });
  assert.ok(!calls.some((call) => call.name === "ask"));
  ui.act(() => window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: { ...settings, configured: true, credentialLoading: false } })));
  assert.ok(!ui.screen.queryByText(/Waiting for macOS Keychain/));
  assert.equal((question as HTMLTextAreaElement).value, "Keep this question while unlocking");
  assert.equal((ui.screen.getByRole("button", { name: "Send question and selected image" }) as HTMLButtonElement).disabled, false);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question and selected image" }));
  await ui.screen.findByText("This explains the selected diagram.");
});

test("failed requests retain the question and marks, and Stop sharing removes the active source", async () => {
  bridge.askHelp = async () => { throw new Error("The provider is unavailable. Please retry."); };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(question, { target: { value: "What is point 1?" } });
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question and selected image" }));
  await ui.screen.findByRole("alert");
  assert.equal((question as HTMLTextAreaElement).value, "What is point 1?");
  assert.ok(ui.screen.getByText("1 mark added. Write beside the image, or choose a number to reopen its annotation."));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Stop sharing" }));
  await ui.screen.findByRole("button", { name: "Select something on screen" });
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question about selected content" }), null);
});

test("arrows retain their direction and pending work has a stop control", async () => {
  let reject: (error: Error) => void = () => {};
  bridge.askHelp = (value) => { record("ask", value); return new Promise((_, no) => { reject = no; }); };
  bridge.cancelHelp = async () => { reject(new Error("Cancelled. Your question is kept.")); };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Arrow" }));
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 800, clientY: 400, pointerId: 1 });
  ui.fireEvent.pointerMove(image, { clientX: 300, clientY: 150, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 300, clientY: 150, pointerId: 1 });
  ui.fireEvent.change(question, { target: { value: "Explain the arrow" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByRole("status");
  assert.deepEqual((calls.find((item) => item.name === "ask")!.value as { marks: unknown[] }).marks, [{ id: "mark-1", label: "1", kind: "arrow", x: .8, y: .8, width: -.5, height: -.5 }]);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Stop" }));
  await ui.screen.findByRole("alert");
  assert.equal((question as HTMLTextAreaElement).value, "Explain the arrow");
});

test("screen selection sends only normalized crop coordinates; Escape cancels", async () => {
  ui.render(<Selection />);
  await ui.screen.findByAltText("Your frozen screen, visible only on this Mac until you send a question");
  const surface = document.querySelector(".capture-surface")!;
  ui.fireEvent.pointerDown(surface, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerMove(surface, { clientX: 700, clientY: 300, pointerId: 1 });
  ui.fireEvent.pointerUp(surface, { button: 0, clientX: 700, clientY: 300, pointerId: 1 });
  await ui.waitFor(() => assert.equal(calls.filter((item) => item.name === "crop").length, 1));
  const crop = calls.find((item) => item.name === "crop")!.value as CropRect;
  assert.ok(Math.abs(crop.x - .2) < 1e-9 && Math.abs(crop.y - .2) < 1e-9 && Math.abs(crop.width - .5) < 1e-9 && Math.abs(crop.height - .4) < 1e-9);
  assert.equal(calls.some((item) => item.name === "ask"), false);
  ui.fireEvent.keyDown(window, { key: "Escape" });
  await ui.waitFor(() => assert.ok(calls.some((item) => item.name === "cancelCapture")));
});

test("deleting a saved exchange requires confirmation, refreshes history, and clears its active source", async () => {
  let saved = true;
  bridge.listHelp = async () => saved ? [{ id: "help-one", title: "Diagram", updatedAt: now }] : [];
  bridge.deleteHelp = async (id) => {
    record("delete", id); saved = false;
    session = { ...session, id: "help-new", source: null, messages: [] };
  };
  ui.render(<Help />);
  await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Delete Diagram" }));
  assert.equal(calls.some((item) => item.name === "delete"), false);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Keep exchange" }));
  assert.equal(ui.screen.queryByRole("button", { name: "Delete exchange" }), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Delete Diagram" }));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Delete exchange" }));
  await ui.screen.findByText("No saved exchanges yet.");
  assert.deepEqual(calls.filter((item) => item.name === "delete"), [{ name: "delete", value: "help-one" }]);
  assert.ok(ui.screen.getByRole("button", { name: "Select something on screen" }));
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question about selected content" }), null);
});

test("unreadable history rows explain their state while healthy exchanges open and bad files can be deleted", async () => {
  let broken = true;
  bridge.listHelp = async () => [
    { id: session.id, title: "Healthy exchange", updatedAt: now },
    ...(broken ? [{ id: "help-broken", title: "Unreadable saved exchange", updatedAt: null, status: "unreadable" as const }] : []),
  ];
  bridge.resumeHelp = async (id) => { record("resume", id); return session; };
  bridge.deleteHelp = async (id) => { record("delete", id); broken = false; };
  ui.render(<Help />);
  await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  const unreadable = await ui.screen.findByRole("button", { name: /^Unreadable saved exchange/ });
  assert.equal((unreadable as HTMLButtonElement).disabled, true);
  assert.ok(ui.screen.getByText("Could not open · file kept unchanged"));
  const healthy = ui.screen.getByRole("button", { name: /^Healthy exchange/ });
  assert.equal((healthy as HTMLButtonElement).disabled, false);
  ui.fireEvent.click(healthy);
  await ui.waitFor(() => assert.deepEqual(calls.find((item) => item.name === "resume")?.value, "help-one"));
  await ui.waitFor(() => assert.equal(ui.screen.queryByRole("complementary", { name: "Saved Help exchanges" }), null));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Delete Unreadable saved exchange" }));
  assert.equal(calls.some((item) => item.name === "delete"), false);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Delete exchange" }));
  await ui.waitFor(() => assert.deepEqual(calls.find((item) => item.name === "delete")?.value, "help-broken"));
  await ui.waitFor(() => assert.equal(ui.screen.queryByText("Unreadable saved exchange"), null));
  assert.ok(ui.screen.getByRole("button", { name: /^Healthy exchange/ }));
});

test("a late reply cannot replace a newly selected source", async () => {
  let receive: (value: HelpSession) => void = () => {};
  let resolve: (value: HelpSession) => void = () => {};
  bridge.onHelpSession = (callback) => { receive = callback; return () => {}; };
  bridge.askHelp = () => new Promise((done) => { resolve = done; });
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(question, { target: { value: "Explain the original source" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByRole("status");
  const original = session;
  await ui.act(async () => {
    receive({ ...session, id: "help-new", title: "New source", source: { ...session.source!, id: "new-source", title: "New source" } });
    resolve({ ...original, messages: [{ id: "late-answer", role: "assistant", text: "Old answer must stay in its original exchange.", createdAt: now }] });
  });
  assert.equal(ui.screen.queryByText("Old answer must stay in its original exchange."), null);
  assert.ok(ui.screen.getByText("New source"));
});

test("a late initial session lookup cannot replace a new capture or erase its question", async () => {
  let resolve!: (value: HelpSession) => void;
  let receive!: (value: HelpSession) => void;
  bridge.getHelpSession = () => new Promise((done) => { resolve = done; });
  bridge.onHelpSession = (callback) => { receive = callback; return () => {}; };
  ui.render(<Help />);
  const next = { ...session, id: "help-new-capture", source: { ...session.source!, id: "new-source", title: "New capture" } };
  ui.act(() => receive(next));
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(question, { target: { value: "Question about my new capture" } });
  await ui.act(async () => { resolve(session); });
  assert.ok(ui.screen.getByText("New capture"));
  assert.equal(ui.screen.queryByText("Diagram"), null);
  assert.equal((question as HTMLTextAreaElement).value, "Question about my new capture");
});

test("drawing a mark opens its local editor; annotation submission preserves the footer draft and other marked questions", async () => {
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "My separate general question" } });
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  const first = await ui.screen.findByRole("textbox", { name: "Question about marked detail" });
  assert.equal(document.activeElement, first);
  assert.ok(first.closest(".help-source"), "the annotation input stays in the source region");
  ui.fireEvent.change(first, { target: { value: "Question for the first marked detail" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Close annotation editor" }));
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 600, clientY: 300, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 600, clientY: 300, pointerId: 1 });
  const second = await ui.screen.findByRole("textbox", { name: "Question about marked detail" });
  assert.equal(document.activeElement, second);
  ui.fireEvent.change(second, { target: { value: "Question for the second marked detail" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls.find((item) => item.name === "ask")?.value, { sessionId: "help-one", question: "Question for the second marked detail", marks: [{ id: "mark-2", label: "2", kind: "point", x: .6, y: .6, width: 0, height: 0 }] });
  assert.equal((ordinary as HTMLTextAreaElement).value, "My separate general question");
  assert.ok(document.querySelector(".help-image"), "the source remains expanded after an annotation answer");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "Question for the first marked detail");
});

test("an unsuccessful inline annotation keeps its own draft without replacing the ordinary question", async () => {
  bridge.askHelp = async () => { throw new Error("The model is unavailable."); };
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "Still my normal draft" } });
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  const annotation = await ui.screen.findByRole("textbox", { name: "Question about marked detail" });
  ui.fireEvent.change(annotation, { target: { value: "Explain this marked detail" } });
  ui.fireEvent.keyDown(annotation, { key: "Enter" });
  await ui.screen.findByRole("alert");
  assert.equal((annotation as HTMLTextAreaElement).value, "Explain this marked detail");
  assert.equal((ordinary as HTMLTextAreaElement).value, "Still my normal draft");
  ui.fireEvent.keyDown(annotation, { key: "Escape" });
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question about marked detail" }), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "Explain this marked detail");
});

test("previewing a historical mark does not retarget an unfinished annotation", async () => {
  session.messages = [{ id: "past-question", role: "user", text: "An earlier detail", createdAt: now, marks: [{ id: "mark-1", label: "1", kind: "point", x: .9, y: .9, width: 0, height: 0 }] }];
  ui.render(<Help />);
  await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.change(await ui.screen.findByRole("textbox", { name: "Question about marked detail" }), { target: { value: "My new marked detail" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "1 marked detail ↗" }));
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question about marked detail" }), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "My new marked detail");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual((calls.find((item) => item.name === "ask")?.value as { marks: unknown[] }).marks, [{ id: "mark-1", label: "1", kind: "point", x: .2, y: .2, width: 0, height: 0 }]);
});

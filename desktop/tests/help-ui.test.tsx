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
const layouts: boolean[] = [];
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
  layouts.length = 0;
  session = { id: "help-one", title: "Diagram", createdAt: now, updatedAt: now, messages: [], source: { id: "source-one", image: "data:image/png;base64,aA==", capturedAt: now, appName: "Preview", title: "Diagram", width: 1000, height: 500 } };
  const partial: Partial<DesktopBridge> = {
    getHelpSession: async () => session,
    getSettings: async () => ({ configured: true, model: "test", baseURL: "https://api.example.test", shortcut: "CommandOrControl+Shift+H", shortcutRegistered: true, screenPermission: "granted", storagePath: "/tmp" }),
    onHelpSession: () => () => {},
    onCapture: () => () => {},
    hideHelp: async () => { record("hide"); },
    setHelpLayout: async ({ expanded }) => { layouts.push(expanded); },
    openSettings: async () => { record("settings"); },
    captureScreen: async (mode) => { record("capture", mode); },
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

async function inspectSource() {
  if (document.querySelector(".help-image")) return;
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Inspect source" }));
}

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
  assert.deepEqual(calls.find((item) => item.name === "ask")?.value, { sessionId: "help-one", sourceId: "source-one", question: "Explain this detail", marks: [] });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: /Continue in Metafor Chat/ }));
  await ui.waitFor(() => assert.ok(calls.some((item) => item.name === "chat" && item.value === "help-one")));
});

test("a first question reads the current screen on Send without requiring a crop", async () => {
  session = { ...session, source: null, contextMode: "screen" };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
  assert.equal(ui.screen.queryByRole("button", { name: "This snapshot" }), null);
  ui.fireEvent.change(question, { target: { value: "What does this warning mean?" } });
  assert.equal(calls.length, 0, "typing does not read or transmit the screen");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question and selected image" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", question: "What does this warning mean?", marks: [], refreshScreen: true } }]);
  assert.equal((question as HTMLTextAreaElement).value, "");
});

test("Use current screen requests a full snapshot; region selection stays optional", async () => {
  session = { ...session, source: null, contextMode: "screen" };
  ui.render(<Help />);
  await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Use current screen" }));
  await ui.waitFor(() => assert.deepEqual(calls, [{ name: "capture", value: "screen" }]));
});

test("an ordinary current-screen follow-up accepts its refreshed source and clears the submitted draft", async () => {
  session.contextMode = "screen";
  const previous = session.source!;
  const next = { ...previous, id: "source-refreshed", image: "data:image/png;base64,bmV3", title: "New working screen" };
  bridge.askHelp = async (value) => {
    record("ask", value);
    return { ...session, source: next, sources: [previous], messages: [
      { id: "fresh-question", role: "user", text: value.question, createdAt: now, sourceId: next.id },
      { id: "fresh-answer", role: "assistant", text: "This answer belongs to the refreshed screen.", createdAt: now, sourceId: next.id },
    ] };
  };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
  ui.fireEvent.change(question, { target: { value: "And what should I read now?" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByText("This answer belongs to the refreshed screen.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", question: "And what should I read now?", marks: [], refreshScreen: true } }]);
  assert.equal((question as HTMLTextAreaElement).value, "");
  await inspectSource();
  assert.equal(ui.screen.getByAltText("Selected content from Preview").getAttribute("src"), next.image);
  assert.equal(ui.screen.queryByText("Diagram"), null);
});

test("an inline annotation pins its exact snapshot even in current-screen mode and preserves the footer draft", async () => {
  session.contextMode = "screen";
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "My separate current-screen question" } });
  await inspectSource();
  await inspectSource();
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 250, clientY: 200, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 250, clientY: 200, pointerId: 1 });
  ui.fireEvent.change(await ui.screen.findByRole("textbox", { name: "Question about marked detail" }), { target: { value: "Explain this captured detail" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", sourceId: "source-one", question: "Explain this captured detail", marks: [{ id: "mark-1", label: "1", kind: "point", x: .25, y: .4, width: 0, height: 0 }] } }]);
  assert.equal((ordinary as HTMLTextAreaElement).value, "My separate current-screen question");
  assert.ok(document.querySelector(".help-image"), "the annotated source stays open");
});

test("earlier source preview shows its own image and pins follow-ups without placing old marks on the current screen", async () => {
  session.contextMode = "screen";
  const oldSource = { ...session.source!, id: "source-earlier", appName: "Safari", title: "Earlier page", image: "data:image/png;base64,b2xk", width: 600, height: 900 };
  session.sources = [oldSource];
  session.messages = [{ id: "past-question", role: "user", text: "A question on the old page", createdAt: now, sourceId: oldSource.id, marks: [{ id: "old-mark", label: "Old detail", kind: "point", x: .4, y: .6, width: 0, height: 0 }] }];
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  await inspectSource();
  assert.equal(document.querySelectorAll(".visual-mark").length, 0, "old marks are not projected on the latest image");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "1 marked detail ↗" }));
  assert.equal(ui.screen.getByAltText("Selected content from Safari").getAttribute("src"), oldSource.image);
  assert.equal(document.querySelector(".help-image svg")?.getAttribute("viewBox"), "0 0 1000 1500");
  assert.equal(document.querySelector(".visual-mark text")?.textContent, "1", "the marker stays compact");
  assert.equal(document.querySelector(".visual-mark title")?.textContent, "Old detail");
  assert.equal(ui.screen.getByRole("button", { name: "This snapshot" }).getAttribute("aria-pressed"), "true");
  ui.fireEvent.change(question, { target: { value: "Explain that earlier page more" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", sourceId: oldSource.id, question: "Explain that earlier page more", marks: [] } }]);
  await inspectSource();
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Return to current view" }));
  assert.equal(ui.screen.getByAltText("Selected content from Preview").getAttribute("src"), session.source!.image);
  assert.equal(document.querySelectorAll(".visual-mark").length, 0);
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
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
  await inspectSource();
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send question and selected image" }));
  await ui.screen.findByRole("alert");
  assert.equal((question as HTMLTextAreaElement).value, "What is point 1?");
  await inspectSource();
  assert.ok(ui.screen.getByText("1 mark added. Write beside the image, or choose a number to reopen its annotation."));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Stop sharing" }));
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("textbox", { name: "Question about selected content" }) as HTMLTextAreaElement).value, ""));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about selected content" }) as HTMLTextAreaElement).value, "");
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
});

test("arrows retain their direction and pending work has a stop control", async () => {
  let reject: (error: Error) => void = () => {};
  bridge.askHelp = (value) => { record("ask", value); return new Promise((_, no) => { reject = no; }); };
  bridge.cancelHelp = async () => { reject(new Error("Cancelled. Your question is kept.")); };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  await inspectSource();
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Arrow" }));
  await inspectSource();
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
  assert.ok(ui.screen.getByRole("button", { name: "Use current screen" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about selected content" }) as HTMLTextAreaElement).value, "");
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
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
  await inspectSource();
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
  await inspectSource();
  assert.ok(ui.screen.getByText("New capture"));
  assert.equal(ui.screen.queryByText("Diagram"), null);
  assert.equal((question as HTMLTextAreaElement).value, "Question about my new capture");
});

test("drawing a mark opens its local editor; annotation submission preserves the footer draft and other marked questions", async () => {
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "My separate general question" } });
  await inspectSource();
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
  assert.deepEqual(calls.find((item) => item.name === "ask")?.value, { sessionId: "help-one", sourceId: "source-one", question: "Question for the second marked detail", marks: [{ id: "mark-2", label: "2", kind: "point", x: .6, y: .6, width: 0, height: 0 }] });
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
  await inspectSource();
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
  await inspectSource();
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

test("switching between captured sources preserves separate annotation drafts and sends the inspected source", async () => {
  const oldSource = { ...session.source!, id: "source-earlier", title: "Earlier document", image: "data:image/png;base64,b2xk" };
  session.sources = [oldSource];
  session.messages = [{ id: "past-question", role: "user", text: "The old document", createdAt: now, sourceId: oldSource.id }];
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "My independent footer draft" } });
  await inspectSource();
  const draw = (x: number, y: number) => {
    const image = document.querySelector(".help-image")!;
    ui.fireEvent.pointerDown(image, { button: 0, clientX: x, clientY: y, pointerId: 1 });
    ui.fireEvent.pointerUp(image, { button: 0, clientX: x, clientY: y, pointerId: 1 });
  };
  draw(200, 100);
  ui.fireEvent.change(await ui.screen.findByRole("textbox", { name: "Question about marked detail" }), { target: { value: "Draft on the current document" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "View source ↗" }));
  assert.equal(ui.screen.getByAltText("Selected content from Preview").getAttribute("src"), oldSource.image);
  assert.equal(ui.screen.queryByRole("button", { name: "Edit annotation 1" }), null, "the current document's draft must not appear on another image");
  draw(700, 350);
  ui.fireEvent.change(await ui.screen.findByRole("textbox", { name: "Question about marked detail" }), { target: { value: "Draft on the earlier document" } });

  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Return to current view" }));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "Draft on the current document");
  assert.equal(document.querySelector(".visual-mark circle")?.getAttribute("cx"), "200");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "View source ↗" }));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "Draft on the earlier document");
  assert.equal(document.querySelector(".visual-mark circle")?.getAttribute("cx"), "700");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", sourceId: "source-earlier", question: "Draft on the earlier document", marks: [{ id: "mark-1", label: "1", kind: "point", x: .7, y: .7, width: 0, height: 0 }] } }]);
  assert.equal((ordinary as HTMLTextAreaElement).value, "My independent footer draft");
});

test("choosing current screen keeps snapshot annotations dormant through history navigation", async () => {
  const oldSource = { ...session.source!, id: "source-earlier", title: "Earlier document", image: "data:image/png;base64,b2xk" };
  session.sources = [oldSource];
  session.messages = [{ id: "past-question", role: "user", text: "The old document", createdAt: now, sourceId: oldSource.id }];
  ui.render(<Help />);
  const ordinary = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(ordinary, { target: { value: "My next screen question" } });
  await inspectSource();
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 300, clientY: 200, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 300, clientY: 200, pointerId: 1 });
  ui.fireEvent.change(await ui.screen.findByRole("textbox", { name: "Question about marked detail" }), { target: { value: "Keep this annotation for later" } });

  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Current screen" }));
  assert.equal(ui.screen.queryByRole("textbox", { name: "Question about marked detail" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: "Edit annotation 1" }), null);
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "View source ↗" }));
  assert.equal(ui.screen.queryByRole("button", { name: "Edit annotation 1" }), null, "the dormant draft is not attached to the historical image");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Return to current view" }));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Edit annotation 1" }));
  assert.equal((ui.screen.getByRole("textbox", { name: "Question about marked detail" }) as HTMLTextAreaElement).value, "Keep this annotation for later");
  assert.equal(document.querySelector(".visual-mark circle")?.getAttribute("cx"), "300");
  assert.equal((ordinary as HTMLTextAreaElement).value, "My next screen question");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("This explains the selected diagram.");
  assert.deepEqual(calls, [{ name: "ask", value: { sessionId: "help-one", sourceId: "source-one", question: "Keep this annotation for later", marks: [{ id: "mark-1", label: "1", kind: "point", x: .3, y: .4, width: 0, height: 0 }] } }]);
});

test("Help opens as a focused compact prompt and expands only when its source is requested", async () => {
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  assert.equal(document.activeElement, question);
  assert.equal(document.querySelector(".help-image"), null);
  assert.equal(ui.screen.queryByText("Diagram"), null);
  assert.equal(ui.screen.queryByRole("button", { name: "Source" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: "This snapshot" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: "Inspect source" }), null);
  assert.deepEqual(layouts, [false], "loading settings must not flash the expanded panel");
  ui.fireEvent.change(question, { target: { value: "A draft that stays in the prompt" } });
  await inspectSource();
  assert.ok(ui.screen.getByAltText("Selected content from Preview"));
  assert.equal(layouts.at(-1), true);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Close source" }));
  assert.equal(document.querySelector(".help-image"), null);
  assert.equal(layouts.at(-1), false);
  assert.equal((question as HTMLTextAreaElement).value, "A draft that stays in the prompt");
  (question as HTMLTextAreaElement).blur();
  await ui.act(async () => { ui.fireEvent.focus(window); });
  assert.equal(document.activeElement, question, "invoking Help again makes typing immediately available");
});

test("only the latest exchange opens above the prompt, with earlier messages and collapsing available", async () => {
  session.messages = [
    { id: "q-old", role: "user", text: "Old question", createdAt: now },
    { id: "a-old", role: "assistant", text: "Old answer", createdAt: now },
    { id: "q-new", role: "user", text: "Latest question", createdAt: now },
    { id: "a-new", role: "assistant", text: "Latest answer text", createdAt: now },
  ];
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  assert.equal(ui.screen.queryByText("Latest question"), null, "the question is kept in history instead of taking screen space twice");
  assert.ok(ui.screen.getByText("Latest answer text"));
  assert.equal(ui.screen.queryByText("Old answer"), null);
  assert.equal(document.querySelector(".help-image"), null);
  assert.equal(layouts.at(-1), true);
  ui.fireEvent.change(question, { target: { value: "My follow-up draft" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Earlier messages" }));
  assert.ok(ui.screen.getByText("Old answer"));
  assert.ok(ui.screen.getByText("Latest question"));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Latest answer" }));
  assert.equal(ui.screen.queryByText("Old answer"), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Hide answer" }));
  assert.equal(ui.screen.queryByText("Latest answer text"), null);
  assert.equal(layouts.at(-1), false);
  assert.equal((question as HTMLTextAreaElement).value, "My follow-up draft");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Show answer" }));
  assert.ok(ui.screen.getByText("Latest answer text"));
  assert.equal(layouts.at(-1), true);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  await ui.screen.findByText("No saved exchanges yet.");
  assert.ok(ui.screen.getByRole("textbox", { name: "Question about selected content" }), "history leaves the composer available");
  assert.equal((question as HTMLTextAreaElement).value, "My follow-up draft");
});

test("a fresh long answer starts at the beginning while an inline answer preserves the inspected source", async () => {
  session.messages = [{ id: "old-answer", role: "assistant", text: "The old response", createdAt: now }];
  let answerNumber = 0;
  bridge.askHelp = async (value) => ({ ...session, messages: [
    ...session.messages,
    { id: `question-${++answerNumber}`, role: "user", text: value.question, createdAt: now },
    { id: `answer-${answerNumber}`, role: "assistant", text: `${answerNumber === 1 ? "New answer begins here." : "Inline answer begins here."}\n\n${"A longer explanation.\n\n".repeat(35)}`, createdAt: now },
  ] });
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  const scroll = document.querySelector(".help-scroll") as HTMLElement;
  scroll.scrollTop = 300;
  ui.fireEvent.change(question, { target: { value: "Explain the whole thing" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByText("New answer begins here.");
  assert.equal(scroll.scrollTop, 0, "the new response opens at its beginning");
  await inspectSource();
  const image = document.querySelector(".help-image")!;
  ui.fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  ui.fireEvent.pointerUp(image, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
  const annotation = await ui.screen.findByRole("textbox", { name: "Question about marked detail" });
  ui.fireEvent.change(annotation, { target: { value: "Explain only this detail" } });
  scroll.scrollTop = 120;
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Send annotation ↑" }));
  await ui.screen.findByText("Inline answer begins here.");
  assert.equal(scroll.scrollTop, 120, "the inline response does not move away from the selected source");
  assert.ok(document.querySelector(".help-image"));
});

test("marked answers offer Show on screen and both the close control and Escape dismiss guidance", async () => {
  const mark: NonNullable<HelpSession["messages"][number]["marks"]>[number] = { id: "answer-mark", kind: "point", label: "Read this field", x: .3, y: .4, width: 0, height: 0 };
  session.messages = [{ id: "marked-answer", role: "assistant", text: "Read the marked field.", createdAt: now, marks: [mark], sourceId: session.source!.id }];
  bridge.showGuidance = async (value) => { record("guidance", value); };
  bridge.closeGuidance = async () => { record("closeGuidance"); };
  ui.render(<Help />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Show on screen" }));
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Hide screen highlights" }));
  assert.deepEqual(calls, [{ name: "guidance", value: { sessionId: "help-one", messageId: "marked-answer" } }, { name: "closeGuidance", value: undefined }]);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Show on screen" }));
  await ui.screen.findByRole("button", { name: "Hide screen highlights" });
  ui.fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(ui.screen.queryByRole("button", { name: "Hide screen highlights" }), null);
  assert.equal(calls.filter((call) => call.name === "closeGuidance").length, 2);
  assert.equal(document.querySelector(".help-image"), null, "screen guidance does not force a screenshot preview into the prompt");
});

test("native guidance dismissal clears its control while preserving the answer", async () => {
  let visible!: (show: boolean) => void;
  bridge.onGuidanceChanged = (callback) => { visible = callback; return () => {}; };
  bridge.showGuidance = async () => {};
  session.messages = [{ id: "marked-answer", role: "assistant", text: "Keep this answer after the screen changes.", createdAt: now,
    marks: [{ id: "mark", kind: "point", label: "Read here", x: .3, y: .4, width: 0, height: 0 }], sourceId: session.source!.id }];
  ui.render(<Help />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Show on screen" }));
  assert.equal(ui.screen.queryByRole("button", { name: "Hide screen highlights" }), null, "pending or cancelled startup is not visible guidance");
  await ui.act(async () => visible(true));
  await ui.screen.findByRole("button", { name: "Hide screen highlights" });
  await ui.act(async () => visible(false));
  assert.equal(ui.screen.queryByRole("button", { name: "Hide screen highlights" }), null);
  assert.ok(ui.screen.getByText("Keep this answer after the screen changes."));
});


test("a new invocation hides an inspected source and an ordinary send from History returns to the answer", async () => {
  let receive!: (value: HelpSession) => void;
  bridge.onHelpSession = (callback) => { receive = callback; return () => {}; };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  await inspectSource();
  assert.ok(document.querySelector(".help-image"));
  const next = { ...session, contextMode: "screen" as const, source: { ...session.source!, id: "new-screen", title: "New application" } };
  ui.act(() => receive(next));
  assert.equal(document.querySelector(".help-image"), null, "invoking Help never opens a capture preview");
  assert.equal(ui.screen.queryByRole("button", { name: "This snapshot" }), null);
  assert.equal(ui.screen.queryByText("Uses your screen when you send. Shared with your model."), null);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "History" }));
  await ui.screen.findByText("No saved exchanges yet.");
  ui.fireEvent.change(question, { target: { value: "What should I do here?" } });
  ui.fireEvent.keyDown(question, { key: "Enter" });
  await ui.screen.findByText("This explains the selected diagram.");
  assert.equal(ui.screen.queryByRole("complementary", { name: "Saved Help exchanges" }), null);
  assert.equal(document.querySelector(".help-image"), null, "an ordinary answer never opens the saved capture");
  assert.deepEqual(calls.find((call) => call.name === "ask")?.value, { sessionId: "help-one", question: "What should I do here?", marks: [], refreshScreen: true });
});

test("compact answers have a bounded height and expanding preserves every paragraph and the follow-up draft", async () => {
  const heights: number[] = [];
  bridge.setHelpLayout = async ({ height }) => { if (height) heights.push(height); };
  session.messages = [{ id: "q", role: "user", text: "My original question", createdAt: now },
    { id: "a", role: "assistant", text: `First paragraph.\n\n${"More detail.\n\n".repeat(50)}Final paragraph.`, createdAt: now }];
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(question, { target: { value: "Draft for later" } });
  assert.equal(heights.at(-1), 330);
  assert.equal(ui.screen.queryByText("My original question"), null);
  assert.ok(ui.screen.getByText("Final paragraph."), "compact presentation never truncates stored or rendered answer content");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Expand answer" }));
  assert.equal(heights.at(-1), 580);
  assert.equal((question as HTMLTextAreaElement).value, "Draft for later");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Compact answer" }));
  assert.equal(heights.at(-1), 330);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Show question" }));
  assert.ok(ui.screen.getByText("My original question"));
});


test("Help model chooser reserves space, persists selection, and preserves the question", async () => {
  const { MODEL_CHOICES } = await import("../model-choices");
  const heights: number[] = [];
  bridge.setHelpLayout = async ({ height }) => { if (height) heights.push(height); };
  const saved = { ...(await bridge.getSettings()), model: "muse-spark-1.3", reasoningEffort: "medium" as const };
  bridge.getSettings = async () => saved;
  bridge.listModels = async () => ({ choices: [...MODEL_CHOICES] });
  bridge.selectModel = async (id) => {
    record("model", id);
    const choice = MODEL_CHOICES.find((item) => item.id === id)!;
    return { ...saved, model: choice.model, reasoningEffort: choice.reasoningEffort };
  };
  ui.render(<Help />);
  const question = await ui.screen.findByRole("textbox", { name: "Question about selected content" });
  ui.fireEvent.change(question, { target: { value: "Keep my draft while choosing" } });
  assert.equal(heights.at(-1), 110);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Choose model: Muse Spark 1.3 · Balanced" }));
  assert.equal(heights.at(-1), 370);
  ui.fireEvent.click(await ui.screen.findByRole("option", { name: /Muse Wonder 1.0.*Deep/ }));
  await ui.screen.findByRole("button", { name: "Choose model: Muse Wonder 1.0 · Deep" });
  assert.deepEqual(calls, [{ name: "model", value: "wonder-deep" }]);
  await ui.waitFor(() => assert.equal(heights.at(-1), 110));
  assert.equal((question as HTMLTextAreaElement).value, "Keep my draft while choosing");
});

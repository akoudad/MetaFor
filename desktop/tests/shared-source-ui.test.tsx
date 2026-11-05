import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { DesktopBridge, HelpSession } from "../shared";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let SharedSource: typeof import("../renderer/SharedSource").default;
let saved: HelpSession | null;
let changed: () => void;
let calls: string[];
let visible: boolean;
let bridge: Pick<DesktopBridge, "getHelp" | "onHelpSession" | "resumeHelp" | "openHelp">;
const visibility = (value: boolean) => { visible = value; };

function session(): HelpSession {
  return {
    id: "help-source", title: "Read this chart", createdAt: "2026-11-05T02:00:00.000Z", updatedAt: "2026-11-05T02:01:00.000Z",
    source: { id: "chart-source", appName: "Preview", title: "Wide chart", image: "data:image/png;base64,aW1hZ2U=", width: 800, height: 200, capturedAt: "2026-11-05T02:00:00.000Z" },
    messages: [{ id: "question-1", role: "user", text: "What changed here?", createdAt: "2026-11-05T02:00:00.000Z", marks: [
      { id: "mark-1", kind: "arrow", label: "1", x: 0.8, y: 0.9, width: -0.5, height: -0.4 },
      { id: "mark-2", kind: "point", label: "2", x: 0.4, y: 0.5, width: 0, height: 0 },
    ] }],
  };
}

before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  [ui, { default: SharedSource }] = await Promise.all([import("@testing-library/react"), import("../renderer/SharedSource")]);
});

beforeEach(() => {
  saved = session(); calls = []; visible = false;
  bridge = {
    async getHelp(id) { calls.push(id); return saved ? structuredClone(saved) : null; },
    onHelpSession(callback) { changed = () => callback(saved ?? session()); return () => { changed = () => {}; }; },
    async resumeHelp() { return saved!; }, async openHelp() {},
  };
});
afterEach(() => ui.cleanup());
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});

async function openSource() {
  const rendered = ui.render(<SharedSource bridge={bridge} conversationId="help-source" revision={0} onVisibilityChange={visibility} />);
  const button = await ui.screen.findByRole("button", { name: "Shared source" });
  ui.fireEvent.click(button);
  await ui.screen.findByRole("complementary", { name: "Original shared source" });
  return rendered;
}

test("returning to Chat after deleting Help clears its source and explains text-only continuation", async () => {
  await openSource();
  assert.equal(visible, true);
  saved = null;
  ui.act(() => window.dispatchEvent(new Event("focus")));
  await ui.screen.findByText(/will continue using text only/);
  assert.equal(ui.screen.queryByRole("complementary", { name: "Original shared source" }), null);
  assert.equal(ui.screen.queryByRole("button", { name: "Shared source" }), null);
  assert.equal(visible, false);
  assert.deepEqual(calls, ["help-source", "help-source"]);
});

test("Help changes refresh an open source without closing it or losing the chosen annotation view", async () => {
  await openSource();
  ui.fireEvent.change(ui.screen.getByLabelText("Source and annotations"), { target: { value: "" } });
  saved!.source!.title = "Updated source title";
  ui.act(() => changed());
  await ui.screen.findByRole("heading", { name: "Updated source title" });
  assert.equal(visible, true);
  assert.equal((ui.screen.getByLabelText("Source and annotations") as HTMLSelectElement).value, "");
  assert.equal(ui.screen.queryByRole("img", { name: "Annotations on the shared source" }), null);
});

test("wide sources preserve arrow direction and circular geometry and disclose captured context", async () => {
  await openSource();
  const svg = ui.screen.getByRole("img", { name: "Annotations on the shared source" });
  assert.equal(svg.getAttribute("viewBox"), "0 0 800 200");
  const arrow = svg.querySelector("line")!;
  assert.equal(Number(arrow.getAttribute("x1")), 640);
  assert.equal(Number(arrow.getAttribute("y1")), 180);
  assert.ok(Math.abs(Number(arrow.getAttribute("x2")) - 240) < 0.0001);
  assert.equal(Number(arrow.getAttribute("y2")), 100);
  assert.equal(svg.querySelector("marker")?.getAttribute("markerUnits"), "userSpaceOnUse");
  assert.equal(svg.querySelector("marker")?.getAttribute("markerWidth"), "20");
  assert.equal(Number(svg.querySelector("circle")?.getAttribute("cx")), 320);
  assert.equal(Number(svg.querySelector("circle")?.getAttribute("cy")), 100);
  assert.ok(ui.screen.getByText("Saved screen context"));
  assert.ok(ui.screen.getByText(/Chat does not read your current screen/));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Close shared source" }));
  assert.ok(ui.screen.getByText("Saved screen context"), "saved context remains disclosed with the panel closed");
});

test("the source picker includes unmarked exchanges and keeps historical marks on their matching image", async () => {
  const oldSource = saved!.source!;
  const currentSource = { ...oldSource, id: "current-source", title: "Current document", appName: "Notes", image: "data:image/png;base64,bmV3", width: 600, height: 900 };
  saved!.source = currentSource;
  saved!.sources = [oldSource];
  saved!.messages[0].sourceId = oldSource.id;
  saved!.messages.push({ id: "question-2", role: "user", text: "Explain the new document", createdAt: "2026-11-05T02:02:00.000Z", sourceId: currentSource.id });
  await openSource();
  const picker = ui.screen.getByLabelText("Source and annotations") as HTMLSelectElement;
  assert.equal(picker.value, "question-2", "a source-only exchange is selectable without annotations");
  assert.ok(ui.screen.getByRole("option", { name: /Explain the new document/ }));
  assert.equal(ui.screen.getByAltText("Screen selection from Notes: Current document").getAttribute("src"), currentSource.image);
  assert.equal(ui.screen.queryByRole("img", { name: "Annotations on the shared source" }), null, "historical marks are not painted on the new source");

  ui.fireEvent.change(picker, { target: { value: "question-1" } });
  assert.equal(ui.screen.getByAltText("Screen selection from Preview: Wide chart").getAttribute("src"), oldSource.image);
  const svg = ui.screen.getByRole("img", { name: "Annotations on the shared source" });
  assert.equal(svg.getAttribute("viewBox"), "0 0 800 200");
  assert.equal(svg.querySelector("line")?.getAttribute("x1"), "640");
  assert.equal(svg.querySelector("line")?.getAttribute("y1"), "180");

  ui.fireEvent.change(picker, { target: { value: "" } });
  assert.equal(ui.screen.getByAltText("Screen selection from Notes: Current document").getAttribute("src"), currentSource.image);
  assert.equal(ui.screen.queryByRole("img", { name: "Annotations on the shared source" }), null);
});

test("a new captured view does not replace the historical source being inspected", async () => {
  const oldSource = saved!.source!;
  saved!.messages[0].sourceId = oldSource.id;
  await openSource();
  assert.equal((ui.screen.getByLabelText("Source and annotations") as HTMLSelectElement).value, "question-1");
  saved!.sources = [oldSource];
  saved!.source = { ...oldSource, id: "another-source", title: "Another screen", image: "data:image/png;base64,bmV3" };
  saved!.messages.push({ id: "question-2", role: "user", text: "A later question", createdAt: "2026-11-05T02:02:00.000Z", sourceId: "another-source" });
  ui.act(() => changed());
  await ui.screen.findByRole("option", { name: /A later question/ });
  assert.equal((ui.screen.getByLabelText("Source and annotations") as HTMLSelectElement).value, "question-1");
  assert.equal(ui.screen.getByAltText("Screen selection from Preview: Wide chart").getAttribute("src"), oldSource.image);
  assert.equal(ui.screen.getByRole("img", { name: "Annotations on the shared source" }).getAttribute("viewBox"), "0 0 800 200");
});

test("a delayed source lookup cannot attach a crop to a different imported conversation", async () => {
  let resolve!: (value: HelpSession | null) => void;
  bridge.getHelp = (id) => { calls.push(id); return new Promise((done) => { resolve = done; }); };
  const rendered = ui.render(<SharedSource bridge={bridge} conversationId="help-source" revision={0} onVisibilityChange={visibility} />);
  await ui.waitFor(() => assert.ok(resolve));
  rendered.rerender(<SharedSource bridge={bridge} conversationId="space-imported" revision={0} onVisibilityChange={visibility} />);
  await ui.act(async () => resolve(session()));
  assert.equal(ui.screen.queryByRole("button", { name: "Shared source" }), null);
  assert.equal(ui.screen.queryByText("Saved screen context"), null);
  assert.deepEqual(calls, ["help-source"], "ordinary imports never look up a private Help source");
});

test("an unreadable saved source removes the stale image and reports the error", async () => {
  await openSource();
  bridge.getHelp = async () => { throw new Error("This Help exchange could not be read."); };
  ui.act(() => changed());
  await ui.screen.findByRole("alert");
  assert.equal(ui.screen.queryByRole("complementary", { name: "Original shared source" }), null);
  assert.equal(visible, false);
});

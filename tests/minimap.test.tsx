import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let SpaceMap: typeof import("../src/components/SpaceMap").default;

before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  [ui, { default: SpaceMap }] = await Promise.all([import("@testing-library/react"), import("../src/components/SpaceMap")]);
});

afterEach(() => ui.cleanup());
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("the map supports click, roving keyboard navigation, and an overview action", () => {
  const nodes = Array.from({ length: 3 }, (_, index) => ({ id: `topic-${index}`, position: { x: index * 880, y: -index * 1280, z: -index * 1050 } }));
  const navigated: string[] = [];
  let overviews = 0;
  ui.render(<SpaceMap nodes={nodes} links={[{ from: "topic-0", to: "topic-1" }, { from: "missing", to: "topic-2" }]} activeId="topic-1" view={{ x: 0, y: 0, z: 900 }} labels={{ "topic-0": "Overview", "topic-1": "Weather", "topic-2": "Equipment" }} onNavigate={(id) => navigated.push(id)} onOverview={() => { overviews += 1; }} />);
  assert.equal(document.querySelectorAll(".space-map-node[tabindex='0']").length, 1);
  assert.equal(document.querySelectorAll(".space-map-edge").length, 1);
  const weather = ui.screen.getByRole("button", { name: "Focus topic: Weather" });
  assert.equal(weather.getAttribute("aria-current"), "location");
  ui.act(() => weather.focus());
  ui.fireEvent.keyDown(weather, { key: "ArrowDown" });
  const equipment = ui.screen.getByRole("button", { name: "Focus topic: Equipment" });
  assert.equal(document.activeElement, equipment);
  assert.equal(equipment.getAttribute("tabindex"), "0");
  assert.equal(weather.getAttribute("tabindex"), "-1");
  ui.fireEvent.keyDown(equipment, { key: "Enter" });
  ui.fireEvent.keyDown(equipment, { key: "Home" });
  const overview = ui.screen.getByRole("button", { name: "Focus topic: Overview" });
  assert.equal(document.activeElement, overview);
  ui.fireEvent.keyDown(overview, { key: " " });
  ui.fireEvent.click(weather);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Show Conversation map" }));
  assert.deepEqual(navigated, ["topic-2", "topic-0", "topic-1"]);
  assert.equal(overviews, 1);
});

test("a large map has one node tab stop and updates when topics move or disappear", () => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({ id: `topic-${index}`, position: { x: (index % 10) * 880, y: -index * 1280, z: -index * 1050 } }));
  const props = { nodes, links: [], activeId: "topic-100", view: { x: 0, y: 0, z: 900 }, onNavigate() {}, onOverview() {} };
  const mounted = ui.render(<SpaceMap {...props} />);
  assert.equal(document.querySelectorAll(".space-map-node[tabindex='0']").length, 1);
  const before = document.querySelector("[data-map-node='topic-0']")!.getAttribute("transform");
  mounted.rerender(<SpaceMap {...props} nodes={[{ ...nodes[0], position: { x: -50000, y: 0, z: 0 } }, ...nodes.slice(1)]} />);
  assert.notEqual(document.querySelector("[data-map-node='topic-0']")!.getAttribute("transform"), before);
  mounted.rerender(<SpaceMap {...props} nodes={[]} />);
  assert.equal(document.querySelectorAll(".space-map-node").length, 0);
  assert.ok(ui.screen.getByText("No topics yet"));
  assert.equal(document.querySelector(".space-map-camera"), null);
});

test("map node titles appear on hover and keyboard focus without navigating", () => {
  const nodes = [
    { id: "source", position: { x: 0, y: 0, z: 0 } },
    { id: "detail", position: { x: 880, y: -1280, z: -1050 } },
  ];
  const navigated: string[] = [];
  const props = { nodes, links: [], activeId: "source", view: { x: 0, y: 0, z: 900 }, labels: { source: "Original research question", detail: "A detailed exploration with a longer descriptive title" }, onNavigate: (id: string) => navigated.push(id), onOverview() {} };
  const mounted = ui.render(<SpaceMap {...props} />);
  assert.ok(ui.screen.getByText("Conversation map"));
  assert.ok(ui.screen.getByRole("group", { name: "Conversation map topics" }));
  const source = ui.screen.getByRole("button", { name: "Focus topic: Original research question" });
  const detail = ui.screen.getByRole("button", { name: `Focus topic: ${props.labels.detail}` });
  assert.equal(ui.screen.queryByRole("tooltip"), null);
  ui.fireEvent.pointerEnter(source);
  const hoverTip = ui.screen.getByRole("tooltip");
  assert.equal(hoverTip.textContent, props.labels.source);
  assert.equal(source.getAttribute("aria-describedby"), hoverTip.id);
  assert.equal(hoverTip.style.left, "4px");
  assert.equal(hoverTip.style.right, "4px");
  assert.deepEqual(navigated, []);
  ui.fireEvent.pointerLeave(source);
  assert.equal(ui.screen.queryByRole("tooltip"), null);
  ui.act(() => source.focus());
  assert.equal(ui.screen.getByRole("tooltip").textContent, props.labels.source);
  ui.fireEvent.pointerEnter(source);
  ui.fireEvent.keyDown(source, { key: "ArrowDown" });
  assert.equal(document.activeElement, detail);
  assert.equal(ui.screen.getByRole("tooltip").textContent, props.labels.detail);
  assert.deepEqual(navigated, []);
  ui.fireEvent.keyDown(detail, { key: "Escape" });
  assert.equal(ui.screen.queryByRole("tooltip"), null);
  ui.fireEvent.keyDown(detail, { key: "Enter" });
  assert.deepEqual(navigated, ["detail"]);
  ui.fireEvent.pointerEnter(source);
  mounted.rerender(<SpaceMap {...props} nodes={[]} />);
  assert.equal(ui.screen.queryByRole("tooltip"), null, "removed nodes cannot leave stale tooltip titles");
});

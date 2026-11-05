import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";
import type { Conversation } from "../src/lib/model";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let TopicCard: typeof import("../src/components/TopicCard").default;

before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  [ui, { default: TopicCard }] = await Promise.all([import("@testing-library/react"), import("../src/components/TopicCard")]);
});

afterEach(() => ui.cleanup());
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("existing deeper replies appear beside their source section while reading", () => {
  const space: Conversation = { id: "reading", title: "Research", rootId: "root", explorations: {
    root: { id: "root", title: "Research overview", summary: "", parentId: null, source: null, position: [0, 0, 0], messages: [{ id: "answer", role: "assistant", sections: [
      { id: "first", title: "First subject", body: "A passage that already has a detailed reply." },
      { id: "last", title: "Last subject", body: "A separate passage with its own discussion." },
    ] }] },
    detail: { id: "detail", title: "Deeper explanation", summary: "", parentId: "root", source: { explorationId: "root", messageId: "answer", sectionId: "first" }, position: [0, 0, 0], messages: [] },
    separate: { id: "separate", title: "Separate discussion", summary: "", parentId: "root", source: { explorationId: "root", messageId: "answer", sectionId: "last" }, position: [0, 0, 0], messages: [] },
  } };
  const opened: string[] = [];
  let explored = 0;
  const noop = () => {};
  const props = { space, item: space.explorations.root, active: true, selection: null, readingRef: noop, onScroll: noop, onFocus: noop, onHover: noop, onSelect: noop, onOpen: (id: string) => opened.push(id), onExplore: () => { explored += 1; }, onSource: noop, onRetry: noop, onCancel: noop, onDismiss: noop };
  const mounted = ui.render(<TopicCard {...props} />);
  const detail = ui.screen.getByRole("button", { name: "Deeper explanation ↗" });
  const separate = ui.screen.getByRole("button", { name: "Separate discussion ↗" });
  assert.equal(detail.closest("[data-section-id]")?.getAttribute("data-section-id"), "first");
  assert.equal(separate.closest("[data-section-id]")?.getAttribute("data-section-id"), "last");
  assert.ok(detail.hasAttribute("data-no-selection"), "navigation labels must not leak into quoted selections");
  ui.fireEvent.click(detail);
  ui.fireEvent.click(separate);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Explore topics from Research overview" }));
  assert.deepEqual(opened, ["detail", "separate"]);
  assert.equal(explored, 1);
  assert.equal(ui.screen.getByRole("button", { name: "Enter Research overview" }).getAttribute("aria-current"), "location");
  mounted.rerender(<TopicCard {...props} active={false} />);
  assert.equal(ui.screen.getByRole("button", { name: "Enter Research overview" }).getAttribute("aria-current"), null);
});

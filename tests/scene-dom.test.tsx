import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { fitOverview, focusView } from "../src/lib/spatial";
import type { SpatialLink, SpatialTransition, WorldPoint } from "../src/components/SpatialWorld";

test("the real scene preserves masked readers, interrupts arrival, honors reduced motion, and cleans up", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let time = 100;
  let observerDisconnected = false;
  let cleanup = () => {};

  try {
    for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver"] as const) install(key, dom.window[key]);
    install("window", dom.window);
    install("IS_REACT_ACT_ENVIRONMENT", true);
    install("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    install("cancelAnimationFrame", (id: number) => frames.delete(id));
    install("ResizeObserver", class { observe() {} disconnect() { observerDisconnected = true; } });
    Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 1100 });
    Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { get: () => 780 });
    // Isolate camera/card lifecycle; cosmetic canvas drawing has no role here.
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", { value: () => null });
    const ui = await import("@testing-library/react");
    const { default: SpatialWorld } = await import("../src/components/SpatialWorld");
    cleanup = ui.cleanup;
    const source = { id: "source", position: { x: 0, y: 0, z: 0 } };
    const start = focusView(source.position, 1100, 780);
    let rendered: WorldPoint | undefined;
    let state = {
      nodes: [source], links: [] as SpatialLink[], activeId: source.id,
      view: start, reducedMotion: false, transition: null as SpatialTransition | null,
      visibleIds: undefined as string[] | undefined,
    };
    const content = () => <SpatialWorld {...state} onViewChange={(view) => { rendered = view; }}>
      {(node) => <article><div data-reader-id={node.id} style={{ height: 100, overflow: "auto" }}><p style={{ height: 1000 }}>{node.id}</p></div></article>}
    </SpatialWorld>;
    const scene = ui.render(content());
    const update = (changes: Partial<typeof state>) => { state = { ...state, ...changes }; scene.rerender(content()); };
    const tick = () => ui.act(() => {
      time += 1000 / 60;
      const scheduled = [...frames.values()];
      frames.clear();
      for (const callback of scheduled) callback(time);
    });
    const advance = (count: number) => { for (let index = 0; index < count; index++) tick(); };
    tick();
    assert.deepEqual(rendered, start);
    assert.equal(frames.size, 0, "existing content must not start an arrival animation");

    const child = { id: "child", position: { x: 880, y: -1280, z: -1050 } };
    update({
      nodes: [source, child], links: [{ from: source.id, to: child.id }], activeId: child.id,
      view: focusView(child.position, 1100, 780), transition: { key: "arrival-1", fromId: source.id, toId: child.id, follow: true },
    });
    advance(20);
    assert.ok(frames.size > 0, "the arrival should still be in progress");
    const interruptedView = { ...rendered! };
    update({ transition: null });
    tick();
    assert.deepEqual(rendered, interruptedView, "clearing a token must not continue toward its stale destination");
    assert.equal(frames.size, 0);

    update({ view: start });
    advance(100);
    const second = { id: "second", position: { x: -880, y: -1280, z: -1050 } };
    const destination = focusView(second.position, 1100, 780);
    update({
      nodes: [...state.nodes, second], activeId: second.id, view: destination,
      transition: { key: "arrival-2", fromId: source.id, toId: second.id, follow: true },
    });
    advance(10);
    update({ reducedMotion: true });
    tick();
    assert.deepEqual(rendered, destination);
    assert.equal(frames.size, 0);
    assert.equal(dom.window.document.querySelector<HTMLElement>('[data-node-id="second"]')!.inert, false);

    const overview = fitOverview(state.nodes, 1100, 780);
    update({
      view: overview, transition: null,
      links: [{ from: source.id, to: child.id }, { from: source.id, to: second.id }],
    });
    tick();
    const sourceCard = dom.window.document.querySelector<HTMLElement>('[data-node-id="source"]')!;
    const childCard = dom.window.document.querySelector<HTMLElement>('[data-node-id="child"]')!;
    const secondCard = dom.window.document.querySelector<HTMLElement>('[data-node-id="second"]')!;
    const childReader = childCard.querySelector<HTMLElement>('[data-reader-id="child"]')!;
    const lines = dom.window.document.querySelectorAll<SVGLineElement>("line");
    childReader.scrollTop = 173;
    assert.equal(childCard.style.visibility, "visible");
    assert.equal(lines[0].style.visibility, "visible");

    update({ visibleIds: [source.id, second.id] });
    tick();
    assert.equal(childCard.style.visibility, "hidden");
    assert.equal(childCard.style.opacity, "0");
    assert.equal(childCard.inert, true);
    assert.equal(childCard.getAttribute("aria-hidden"), "true");
    assert.equal(sourceCard.inert, false);
    assert.equal(secondCard.inert, false);
    assert.equal(lines[0].style.visibility, "hidden", "links to excluded cards must also hide");
    assert.equal(lines[1].style.visibility, "visible");
    assert.deepEqual(rendered, overview, "a visibility mask must not change the camera");

    update({ visibleIds: [] });
    tick();
    assert.equal(sourceCard.style.visibility, "hidden");
    assert.equal(secondCard.style.visibility, "hidden");
    assert.equal(lines[1].style.visibility, "hidden");
    update({ visibleIds: undefined });
    tick();
    assert.equal(dom.window.document.querySelector('[data-reader-id="child"]'), childReader, "masking must retain the mounted reader");
    assert.equal(childReader.scrollTop, 173, "returning must retain the exact reading position");
    assert.equal(childCard.style.visibility, "visible");
    assert.equal(childCard.inert, false);
    assert.equal(childCard.hasAttribute("aria-hidden"), false);
    assert.equal(lines[0].style.visibility, "visible");

    update({ reducedMotion: false, transition: null, view: start });
    tick();
    assert.ok(frames.size > 0);
    cleanup();
    assert.equal(frames.size, 0, "unmount must cancel a camera frame already queued");
    assert.equal(observerDisconnected, true);
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(frames.size, 0, "removed listeners must not restart the scene");
  } finally {
    cleanup();
    frames.clear();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { connectionBounds, connectionEndpoints, fitOverview, focusView } from "../src/lib/spatial";
import type { DetailLevel } from "../src/lib/spatial";
import type { SpatialLink, SpatialTransition, WorldPoint } from "../src/components/SpatialWorld";

test("the real scene preserves readers, animates and interrupts arrivals, honors reduced motion, and cleans up", async () => {
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

    const batch = [
      { id: "paris", position: { x: -380, y: -840, z: -420 } },
      { id: "berlin", position: { x: 380, y: -840, z: -420 } },
      { id: "rome", position: { x: 1260, y: -2120, z: -1470 } },
      { id: "madrid", position: { x: -1260, y: -2120, z: -1470 } },
    ];
    const origins = [source, source, child, second];
    const batchView = fitOverview([...state.nodes, ...batch], 1100, 780);
    update({
      nodes: [...state.nodes, ...batch], view: batchView, reducedMotion: false,
      links: [...state.links, ...batch.map((node, index) => ({ from: origins[index].id, to: node.id, type: "origin" as const })),
        { from: child.id, to: batch[0].id, type: "synthesis", status: "accepted" }],
      transition: { key: "batch-1", fromId: source.id, toId: batch[0].id, toIds: batch.map((node) => node.id), follow: true },
    });
    tick();
    const batchCards = batch.map((node) => dom.window.document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)!);
    for (let index = 0; index < batchCards.length; index++) {
      const originCard = dom.window.document.querySelector<HTMLElement>(`[data-node-id="${origins[index].id}"]`)!;
      assert.equal(batchCards[index].style.left, originCard.style.left, "each batch card must emerge from its own navigation parent");
      assert.equal(batchCards[index].style.top, originCard.style.top);
      assert.equal(batchCards[index].inert, true);
    }
    advance(35);
    const projection = (element: HTMLElement) => connectionBounds({
      x: parseFloat(element.style.left), y: parseFloat(element.style.top),
      scale: Number(element.style.transform.match(/scale\(([^)]+)\)/)![1]),
    }, element.dataset.detail as DetailLevel);
    const batchLines = dom.window.document.querySelectorAll<SVGLineElement>("line");
    assert.equal(batchLines[2].style.visibility, "hidden", "synthesis inputs replace the redundant navigation-origin drawing");
    for (const [line, originCard, targetCard] of [[batchLines[3], sourceCard, batchCards[1]], [batchLines[6], childCard, batchCards[0]]] as const) {
      assert.equal(line.style.visibility, "visible");
      const endpoints = connectionEndpoints(projection(originCard), projection(targetCard))!;
      const drawn = Math.hypot(Number(line.getAttribute("x2")) - endpoints.start.x, Number(line.getAttribute("y2")) - endpoints.start.y);
      const complete = Math.hypot(endpoints.end.x - endpoints.start.x, endpoints.end.y - endpoints.start.y);
      assert.ok(drawn > 0 && drawn < complete * 0.99, "origin and synthesis arrows should grow toward an entering card");
      assert.ok(line.hasAttribute("marker-end"));
    }
    const batchInterrupted = { ...rendered! };
    update({ transition: null });
    tick();
    assert.deepEqual(rendered, batchInterrupted);
    assert.equal(frames.size, 0, "interrupting a batch must stop the camera too");

    const background = [
      { id: "background-a", position: { x: -380, y: -2780, z: -1470 } },
      { id: "background-b", position: { x: 380, y: -2780, z: -1470 } },
    ];
    update({
      nodes: [...state.nodes, ...background], view: batchInterrupted,
      links: [...state.links, ...background.map((node) => ({ from: source.id, to: node.id, type: "origin" as const }))],
      transition: { key: "batch-background", fromId: source.id, toId: background[0].id, toIds: background.map((node) => node.id), follow: false },
    });
    advance(12);
    assert.deepEqual(rendered, batchInterrupted, "background batch arrivals must not move the camera");
    assert.ok(frames.size > 0);
    update({ reducedMotion: true });
    tick();
    assert.equal(frames.size, 0, "reduced motion must finish a batch without further animation");

    const finalBatch = [
      { id: "final-a", position: { x: -380, y: -3440, z: -1890 } },
      { id: "final-b", position: { x: 380, y: -3440, z: -1890 } },
    ];
    const finalView = fitOverview([...state.nodes, ...finalBatch], 1100, 780);
    update({
      nodes: [...state.nodes, ...finalBatch], view: finalView, reducedMotion: false,
      links: [...state.links, ...finalBatch.map((node) => ({ from: source.id, to: node.id, type: "origin" as const }))],
      transition: { key: "batch-finish", fromId: source.id, toId: finalBatch[0].id, toIds: finalBatch.map((node) => node.id), follow: true },
    });
    advance(80);
    assert.deepEqual(rendered, finalView, "the completed batch must stay in its group view");
    assert.equal(frames.size, 0);
    for (const node of finalBatch) assert.equal(dom.window.document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)!.inert, false);
    assert.equal(childReader.scrollTop, 173);

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

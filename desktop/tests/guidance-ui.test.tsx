import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { DesktopBridge, GuidancePayload, VisualMark } from "../shared";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://metafor.local" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let Guidance: typeof import("../renderer/Guidance").default;
let layoutLabels: typeof import("../renderer/Guidance").layoutGuidanceLabels;
let payload: GuidancePayload;
let closeCalls: number;

before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const styles = document.createElement("style");
  styles.textContent = 'html,body,#root { background: #000; color-scheme: dark; }' + readFileSync(new URL("../renderer/guidance.css", import.meta.url), "utf8");
  document.head.append(styles);
  [ui, { default: Guidance, layoutGuidanceLabels: layoutLabels }] = await Promise.all([import("@testing-library/react"), import("../renderer/Guidance")]);
});

beforeEach(() => {
  closeCalls = 0;
  document.documentElement.dataset.desktopSurface = "guidance";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  payload = {
    source: { id: "source-1", appName: "Preview", title: "Diagram", capturedAt: "2026-11-05T03:00:00.000Z", image: "data:image/png;base64,aW1hZ2U=", width: 2000, height: 1200 },
    answer: "The labels explain this captured diagram.",
    marks: [
      { id: "rect-1", kind: "rect", x: .1, y: .2, width: .3, height: .4, label: "Main section" },
      { id: "arrow-1", kind: "arrow", x: .8, y: .9, width: -.5, height: -.6, label: "Follow this direction" },
      { id: "point-1", kind: "point", x: .95, y: .9, width: 0, height: 0, label: "Translated label" },
    ],
  };
  window.metaforDesktop = {
    getGuidance: async () => payload,
    closeGuidance: async () => { closeCalls++; },
  } as DesktopBridge;
});

afterEach(() => ui.cleanup());
after(() => {
  dom.window.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});

test("live guidance draws normalized marks without a screenshot, dim layer, toolbar, or answer panel", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  ui.render(<Guidance />, { container: root });
  const svg = await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  assert.equal(svg.getAttribute("viewBox"), "0 0 2000 1200");
  assert.equal(svg.getAttribute("preserveAspectRatio"), "none", "marks map to the native source bounds");
  const rect = svg.querySelector("rect")!;
  assert.deepEqual(["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name))), [200, 240, 600, 480]);
  const arrow = svg.querySelector("line")!;
  const coordinates = ["x1", "y1", "x2", "y2"].map((name) => Number(arrow.getAttribute(name)));
  for (const [index, expected] of [1600, 1080, 600, 360].entries()) assert.ok(Math.abs(coordinates[index] - expected) < .0001);
  assert.ok(arrow.getAttribute("marker-end")?.startsWith("url(#"));
  assert.equal(Number(svg.querySelector("circle")?.getAttribute("cx")), 1900);
  assert.equal(Number(svg.querySelector("circle")?.getAttribute("cy")), 1080);
  assert.equal(document.querySelector("img, canvas, header, details, button, .guidance-answer, .guidance-image"), null);
  assert.equal(ui.screen.queryByText(payload.answer), null);
  for (const element of [document.documentElement, document.body, root, document.querySelector(".metafor-guidance")!]) {
    assert.equal(window.getComputedStyle(element).backgroundColor, "rgba(0, 0, 0, 0)", "the underlying live app stays visible");
    assert.equal(window.getComputedStyle(element).pointerEvents, "none");
  }
  assert.ok(["none", "rgba(0, 0, 0, 0)"].includes(window.getComputedStyle(rect).fill), "a highlighted rectangle does not dim or paint over its source");
});

test("contrast and glow layers share exact geometry without filling highlighted content", async () => {
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  for (const mark of document.querySelectorAll(".guidance-mark")) {
    const contrast = mark.querySelector(".guidance-contrast")!.firstElementChild!;
    const accent = mark.querySelector(".guidance-accent")!.firstElementChild!;
    assert.equal(contrast.tagName, accent.tagName);
    for (const attribute of ["x", "y", "width", "height", "rx", "x1", "x2", "y1", "y2", "cx", "cy", "r"]) {
      assert.equal(contrast.getAttribute(attribute), accent.getAttribute(attribute), `${attribute} must remain anchored to the same source detail`);
    }
    const baseStyle = window.getComputedStyle(contrast);
    const edgeStyle = window.getComputedStyle(accent);
    assert.ok(["none", "rgba(0, 0, 0, 0)"].includes(baseStyle.fill));
    assert.ok(["none", "rgba(0, 0, 0, 0)"].includes(edgeStyle.fill));
    assert.equal(edgeStyle.getPropertyValue("vector-effect"), "non-scaling-stroke", "retina capture scaling must not make the edge faint");
    assert.ok(parseFloat(edgeStyle.strokeWidth) >= 2, "the visible edge stays clear at screen resolution");
    assert.ok(parseFloat(baseStyle.strokeWidth) >= parseFloat(edgeStyle.strokeWidth) + 2, "the dark keyline remains visible around the colored edge on bright pages");
    assert.notEqual(baseStyle.stroke, edgeStyle.stroke);
  }
});

test("labels remain near their targets and within screen edges after resize", async () => {
  const labels = layoutLabels(payload.marks, { width: 1000, height: 600 });
  for (const label of labels) {
    assert.ok(label.left >= 12 && label.left + label.width <= 988);
    assert.ok(label.top >= 12 && label.top + label.height <= 588);
  }
  const arrowLabel = labels.find((label) => label.mark.id === "arrow-1")!;
  assert.ok(arrowLabel.left < 400, "arrow label follows its destination rather than its starting point");
  const rectLabel = labels.find((label) => label.mark.id === "rect-1")!;
  assert.ok(rectLabel.top + rectLabel.height < 120, "rectangle label leaves the highlighted content unobscured");
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  ui.fireEvent(window, new Event("resize"));
  const last = document.querySelectorAll<HTMLElement>(".guidance-label")[2];
  assert.ok(Number.parseFloat(last.style.left) + Number.parseFloat(last.style.width) <= 588);
  assert.equal(document.querySelector(".guidance-mark rect")?.getAttribute("x"), "200");
  for (const label of layoutLabels(payload.marks, { width: 80, height: 60 })) {
    assert.ok(label.left >= 0 && label.left + label.width <= 80);
    assert.ok(label.top >= 0 && label.top + label.height <= 60);
  }
});

type Box = { left: number; top: number; width: number; height: number };
const intersection = (a: Box, b: Box) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

test("labels avoid every highlighted target, including later unlabeled targets", () => {
  const marks: VisualMark[] = [
    { id: "lower", kind: "rect", x: .4, y: .38, width: .2, height: .06, label: "Lower action" },
    { id: "upper", kind: "rect", x: .4, y: .3, width: .2, height: .06 },
    { id: "point", kind: "point", x: .25, y: .2, width: 0, height: 0, label: "First point" },
    { id: "arrow", kind: "arrow", x: .9, y: .7, width: -.2, height: -.3, label: "Arrow destination" },
  ];
  const evidence: Box[] = [
    { left: 400, top: 228, width: 200, height: 36 },
    { left: 400, top: 180, width: 200, height: 36 },
    { left: 238, top: 108, width: 24, height: 24 },
    { left: 688, top: 228, width: 24, height: 24 },
  ];
  for (const ordered of [marks, [...marks].reverse()]) {
    const labels = layoutLabels(ordered, { width: 1000, height: 600 });
    assert.equal(labels.length, 3, "an unlabeled target remains protected without adding a label");
    labels.forEach((label, index) => {
      for (const box of [...evidence, ...labels.slice(0, index)]) assert.equal(intersection(label, box), 0, `${label.mark.id} must leave all evidence and earlier labels readable`);
    });
  }
});

test("crowded label placement chooses deterministic minimum overlap within the viewport", () => {
  const viewport = { width: 160, height: 100 };
  const marks: VisualMark[] = [
    { id: "all", kind: "rect", x: 0, y: 0, width: 1, height: 1 },
    { id: "first", kind: "point", x: .85, y: .85, width: 0, height: 0, label: "One" },
    { id: "second", kind: "point", x: .25, y: .7, width: 0, height: 0, label: "Two" },
  ];
  const launcher = { left: 0, top: 0, width: 160, height: 50 };
  const targets = [
    { left: 0, top: 0, ...viewport },
    { left: 124, top: 73, width: 24, height: 24 },
    { left: 28, top: 58, width: 24, height: 24 },
  ];
  const labels = layoutLabels(marks, viewport, [launcher]);
  assert.deepEqual(labels, layoutLabels(marks, viewport, [launcher]));
  labels.forEach((label, index) => {
    assert.ok(label.left >= 12 && label.left + label.width <= 148 && label.top >= 12 && label.top + label.height <= 88);
    const obstacles = [...targets, launcher, ...labels.slice(0, index)].map((box) => ({ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }));
    const score = (box: Box) => obstacles.reduce((total, obstacle) => total + intersection(box, obstacle), 0);
    let minimum = Infinity;
    for (let left = 12; left <= 148 - label.width; left++) for (let top = 12; top <= 88 - label.height; top++) minimum = Math.min(minimum, score({ ...label, left, top }));
    assert.ok(score(label) <= minimum + .00001, "fallback must minimize covered area when there is no empty slot");
  });
});

test("live labels avoid actual Help bounds on an offset display and after resize", async () => {
  payload.source.screenBounds = { x: -1400, y: 25, width: 1000, height: 600, displayId: "7" };
  payload.viewportBounds = { x: -1400, y: 25, width: 1000, height: 600 };
  payload.helpBounds = { x: -1100, y: 350, width: 620, height: 250 };
  payload.marks = [{ id: "near-help", kind: "point", x: .6, y: .78, width: 0, height: 0, label: "Read this detail" }];
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  for (const size of [{ width: 1000, height: 600 }, { width: 800, height: 480 }]) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: size.width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: size.height });
    ui.fireEvent(window, new Event("resize"));
    const element = document.querySelector<HTMLElement>(".guidance-label")!;
    const label = { left: parseFloat(element.style.left), top: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.maxHeight) };
    const help = { left: 300 / 1000 * size.width, top: 325 / 600 * size.height, width: 620 / 1000 * size.width, height: 250 / 600 * size.height };
    assert.equal(intersection(label, help), 0, "screen points must be projected into the current overlay, not interpreted as capture pixels");
  }
});

test("Help layout updates reflow labels without moving source marks or accepting stale reads", async () => {
  payload.source.screenBounds = { x: 0, y: 0, width: 1000, height: 600, displayId: "7" };
  payload.viewportBounds = { x: 0, y: 0, width: 1000, height: 600 };
  payload.marks = [{ id: "target", kind: "point", x: .5, y: .5, width: 0, height: 0, label: "This detail" }];
  const initial = structuredClone(payload);
  let listener!: (value: GuidancePayload) => void;
  let resolve!: (value: GuidancePayload) => void;
  let unsubscribed = false;
  window.metaforDesktop.getGuidance = () => new Promise((done) => { resolve = done; });
  window.metaforDesktop.onGuidanceLayoutChanged = (callback) => { listener = callback; return () => { unsubscribed = true; }; };
  const rendered = ui.render(<Guidance />);
  const preferred = layoutLabels(payload.marks, { width: 1000, height: 600 })[0];
  const bounds = { x: Math.floor(preferred.left - 5), y: Math.floor(preferred.top - 5), width: Math.ceil(preferred.width + 10), height: Math.ceil(preferred.height + 10) };
  await ui.act(async () => listener({ ...payload, helpBounds: bounds }));
  const before = document.querySelector(".guidance-label")!.getAttribute("style");
  await ui.act(async () => resolve(initial));
  assert.equal(document.querySelector(".guidance-label")!.getAttribute("style"), before, "the delayed initial read cannot replace the latest panel position");
  const label = document.querySelector<HTMLElement>(".guidance-label")!;
  assert.equal(intersection({ left: parseFloat(label.style.left), top: parseFloat(label.style.top), width: parseFloat(label.style.width), height: parseFloat(label.style.maxHeight) }, { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }), 0);
  const point = document.querySelector(".guidance-accent circle")!;
  assert.equal(point.getAttribute("cx"), "1000");
  assert.equal(point.getAttribute("cy"), "600");
  assert.equal(closeCalls, 0);
  rendered.unmount();
  assert.equal(unsubscribed, true);
  await ui.act(async () => listener(initial));
  assert.equal(document.querySelector(".guidance-mark"), null);
});

test("invalid layout updates clear existing guidance and close the overlay", async () => {
  let listener!: (value: GuidancePayload) => void;
  window.metaforDesktop.onGuidanceLayoutChanged = (callback) => { listener = callback; return () => {}; };
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  await ui.act(async () => listener({ ...payload, helpBounds: { x: NaN, y: 0, width: 200, height: 100 } }));
  await ui.waitFor(() => assert.equal(closeCalls, 1));
  assert.equal(document.querySelector(".guidance-mark, .guidance-label"), null);
});

test("invalid Help bounds close guidance instead of bypassing launcher protection", async () => {
  payload.source.screenBounds = { x: 0, y: 0, width: 1000, height: 600, displayId: "7" };
  for (const bounds of [
    { x: NaN, y: 400, width: 620, height: 110 },
    { x: 200, y: 400, width: -1, height: 110 },
    { x: 200, y: 400, width: 620, height: 17000 },
  ]) {
    payload.helpBounds = bounds;
    const previous = closeCalls;
    const rendered = ui.render(<Guidance />);
    await ui.waitFor(() => assert.equal(closeCalls, previous + 1));
    assert.equal(document.querySelector(".guidance-label, .guidance-mark"), null);
    rendered.unmount();
  }
});

test("untrusted labels stay plain text and no source image or answer is rendered", async () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  payload.source.title = "Private source title";
  payload.marks = [{ ...payload.marks[0], label: hostile }];
  payload.answer = "Private answer content";
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  assert.equal(document.querySelectorAll("img, script, [onerror]").length, 0);
  assert.equal(document.querySelector(".guidance-label")?.textContent, hostile);
  assert.equal(document.body.textContent?.includes(payload.answer), false);
  assert.equal(document.body.textContent?.includes(payload.source.title), false);
  assert.equal(document.body.innerHTML.includes(payload.source.image), false);
});

test("the click-through surface has no focusable controls or keyboard interception", async () => {
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  assert.equal(document.querySelector("button, input, textarea, select, a[href], details, [tabindex]"), null);
  const escape = new window.KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  window.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(closeCalls, 0, "Help and the native timeout own dismissal");
});

test("unavailable or failed payloads close quietly instead of covering the live app", async () => {
  window.metaforDesktop.getGuidance = async () => null;
  const rendered = ui.render(<Guidance />);
  await ui.waitFor(() => assert.equal(closeCalls, 1));
  assert.equal(document.querySelector(".metafor-guidance")?.childElementCount, 0);
  rendered.unmount();
  window.metaforDesktop.getGuidance = async () => { throw new Error("Private IPC failure details"); };
  window.metaforDesktop.closeGuidance = async () => { closeCalls++; throw new Error("IPC unavailable"); };
  ui.render(<Guidance />);
  await ui.waitFor(() => assert.equal(closeCalls, 2));
  assert.equal(document.querySelector(".metafor-guidance")?.childElementCount, 0);
  assert.equal(document.body.textContent?.includes("Private IPC failure"), false);
});

test("loading remains transparent and late payloads cannot revive an unmounted overlay", async () => {
  let resolve!: (value: GuidancePayload | null) => void;
  window.metaforDesktop.getGuidance = () => new Promise((done) => { resolve = done; });
  const rendered = ui.render(<Guidance />);
  assert.equal(document.querySelector(".metafor-guidance")?.childElementCount, 0);
  assert.equal(window.getComputedStyle(document.querySelector(".metafor-guidance")!).backgroundColor, "rgba(0, 0, 0, 0)");
  rendered.unmount();
  await ui.act(async () => resolve(payload));
  assert.equal(document.querySelector(".metafor-guidance"), null);
  assert.equal(closeCalls, 0);
});

test("invalid source geometry and out-of-bounds marks never draw on unrelated screen regions", async () => {
  for (const mutate of [
    () => { payload.source.width = Number.POSITIVE_INFINITY; },
    () => { payload.source.image = "https://untrusted.example/screen.png"; },
    () => { payload.marks[1].width = .5; },
    () => { payload.marks[0].width = -.1; },
    () => { payload.marks[2].height = .1; },
  ]) {
    const original = structuredClone(payload);
    mutate();
    const before = closeCalls;
    const rendered = ui.render(<Guidance />);
    await ui.waitFor(() => assert.equal(closeCalls, before + 1));
    assert.equal(document.querySelector(".guidance-mark, img"), null);
    rendered.unmount();
    payload = original;
  }
});

test("native window offsets never shift full-screen or cropped-source pointers", async () => {
  payload.marks[2] = { ...payload.marks[2], x: .7, y: .7 };
  const cases = [
    { source: { x: 0, y: 0, width: 1000, height: 600 }, viewport: { x: 0, y: 25, width: 1000, height: 600 } },
    { source: { x: -800, y: 10, width: 300, height: 200 }, viewport: { x: -800, y: 38, width: 300, height: 200 } },
    { source: { x: -1400, y: 0, width: 1400, height: 900 }, viewport: { x: -1350, y: 25, width: 1200, height: 800 } },
  ];
  for (const entry of cases) {
    payload.source.screenBounds = { ...entry.source, displayId: "7" };
    payload.viewportBounds = entry.viewport;
    const rendered = ui.render(<Guidance />);
    const svg = await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
    const screenX = (element: Element, attribute: string) => Number(element.getAttribute(attribute)) / payload.source.width * entry.viewport.width + entry.viewport.x;
    const screenY = (element: Element, attribute: string) => Number(element.getAttribute(attribute)) / payload.source.height * entry.viewport.height + entry.viewport.y;
    const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .0001, `${actual} should remain at screen coordinate ${expected}`);
    const rect = svg.querySelector("rect")!, arrow = svg.querySelector("line")!, point = svg.querySelector("circle")!;
    near(screenX(rect, "x"), entry.source.x + .1 * entry.source.width);
    near(screenY(rect, "y"), entry.source.y + .2 * entry.source.height);
    near(Number(rect.getAttribute("width")) / payload.source.width * entry.viewport.width, .3 * entry.source.width);
    near(Number(rect.getAttribute("height")) / payload.source.height * entry.viewport.height, .4 * entry.source.height);
    near(screenX(arrow, "x2"), entry.source.x + .3 * entry.source.width);
    near(screenY(arrow, "y2"), entry.source.y + .3 * entry.source.height);
    near(screenX(point, "cx"), entry.source.x + .7 * entry.source.width);
    near(screenY(point, "cy"), entry.source.y + .7 * entry.source.height);
    rendered.unmount();
  }
});

test("marks clipped by the menu bar stay clipped instead of being moved onto another control", async () => {
  payload.source.screenBounds = { x: 0, y: 0, width: 1000, height: 600, displayId: "7" };
  payload.viewportBounds = { x: 0, y: 25, width: 1000, height: 600 };
  payload.marks = [
    { id: "menu", kind: "point", x: .3, y: .01, width: 0, height: 0, label: "Menu item" },
    { id: "partial", kind: "rect", x: .2, y: .02, width: .1, height: .1, label: "Partially visible" },
  ];
  ui.render(<Guidance />);
  await ui.screen.findByRole("img", { name: "Metafor guidance marks" });
  assert.equal(document.querySelector('[data-mark-id="menu"]'), null);
  assert.equal(ui.screen.queryByText("Menu item"), null);
  const rect = document.querySelector('[data-mark-id="partial"] rect')!;
  assert.ok(Number(rect.getAttribute("y")) < 0, "the clipped rectangle keeps its true position");
  assert.equal(Number(rect.getAttribute("height")), 120, "clipping never stretches the source region");
});

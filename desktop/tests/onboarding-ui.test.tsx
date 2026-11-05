import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { DesktopBridge } from "../shared";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://metafor.local" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let ChatOverlays: typeof import("../renderer/ChatOverlays").default;
let bridge: DesktopBridge;
let complete = false;
let saves = 0;
let openSettings: () => void;
let openGuide: () => void;

before(async () => {
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : dom.window[name] });
  }
  [ui, { default: ChatOverlays }] = await Promise.all([import("@testing-library/react"), import("../renderer/ChatOverlays")]);
});
beforeEach(() => {
  complete = false; saves = 0;
  bridge = {
    onboardingComplete: async () => complete,
    completeOnboarding: async () => { saves++; complete = true; },
    onOpenOnboarding: (callback) => { openGuide = callback; return () => { openGuide = () => {}; }; },
    onOpenSettings: (callback) => { openSettings = callback; return () => { openSettings = () => {}; }; },
    getSettings: async () => ({ configured: false, model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1", shortcut: "Alt+M", shortcutRegistered: true, screenPermission: "not-determined", storagePath: "/fixture" }),
  } as DesktopBridge;
  window.metaforDesktop = bridge;
});
afterEach(() => ui.cleanup());
after(() => { dom.window.close(); for (const [name, value] of originals) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });

test("first open explains Chat, Help, and the shortcut, then stays dismissed until requested", async () => {
  const mounted = ui.render(<ChatOverlays />);
  await ui.screen.findByRole("dialog", { name: "Welcome to Metafor" });
  assert.ok(ui.screen.getByRole("heading", { name: "Metafor Chat" }));
  assert.ok(ui.screen.getByRole("heading", { name: "Metafor Help" }));
  assert.ok(ui.screen.getByText("Option + M"));
  assert.ok(ui.screen.getByText("Press it again to hide Help."));
  assert.ok(ui.screen.getByText(/Add your API key in/));
  const start = ui.screen.getByRole("button", { name: "Get started" });
  assert.equal(document.activeElement, start);
  ui.fireEvent.keyDown(start, { key: "Tab" });
  assert.equal(document.activeElement, ui.screen.getByRole("button", { name: "Open settings" }));
  ui.fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  assert.equal(document.activeElement, start);
  ui.fireEvent.click(start);
  await ui.waitFor(() => assert.ok(!ui.screen.queryByRole("dialog")));
  assert.equal(saves, 1);
  mounted.unmount();
  ui.render(<ChatOverlays />);
  await ui.act(async () => {});
  assert.ok(!ui.screen.queryByRole("dialog"));
  ui.act(() => openGuide());
  assert.ok(ui.screen.getByRole("dialog", { name: "Welcome to Metafor" }));
  ui.fireEvent.keyDown(ui.screen.getByRole("button", { name: "Get started" }), { key: "Escape" });
  await ui.waitFor(() => assert.ok(!ui.screen.queryByRole("dialog")));
});

test("Open settings dismisses the guide and leads directly to model setup", async () => {
  ui.render(<ChatOverlays />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Open settings" }));
  await ui.screen.findByRole("dialog", { name: "Metafor settings" });
  assert.equal(complete, true);
  assert.ok(!ui.screen.queryByRole("dialog", { name: "Welcome to Metafor" }));
  assert.ok(await ui.screen.findByLabelText("API key"));
});

test("settings recovery takes priority over a delayed first-open check", async () => {
  let resolve!: (value: boolean) => void;
  bridge.onboardingComplete = () => new Promise((finish) => { resolve = finish; });
  ui.render(<ChatOverlays />);
  ui.act(() => openSettings());
  await ui.act(async () => { resolve(false); });
  assert.ok(ui.screen.getByRole("dialog", { name: "Metafor settings" }));
  assert.ok(!ui.screen.queryByRole("dialog", { name: "Welcome to Metafor" }));
  assert.equal(saves, 0);
});

test("saving failure keeps a retry and a way to continue without resetting first-open state", async () => {
  bridge.completeOnboarding = async () => { throw new Error("disk unavailable"); };
  ui.render(<ChatOverlays />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Get started" }));
  assert.match((await ui.screen.findByRole("alert")).textContent!, /Try again/);
  assert.equal(complete, false);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Close for now" }));
  assert.ok(!ui.screen.queryByRole("dialog"));
});

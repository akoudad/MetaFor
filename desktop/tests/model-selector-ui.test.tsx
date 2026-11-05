import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { MODEL_CHOICES } from "../models";
import type { DesktopBridge, DesktopSettings } from "../shared";

const require = createRequire(import.meta.url); require.extensions[".css"] = () => {};
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://metafor.local" });
const originals = new Map<string, PropertyDescriptor | undefined>();
let ui: typeof import("@testing-library/react");
let ModelSelector: typeof import("../renderer/ModelSelector").default;
let settings: DesktopSettings;
let bridge: DesktopBridge;
let listeners: Set<(settings: DesktopSettings) => void>;

before(async () => {
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : dom.window[name] });
  }
  [ui, { default: ModelSelector }] = await Promise.all([import("@testing-library/react"), import("../renderer/ModelSelector")]);
});
beforeEach(() => {
  settings = { configured: true, model: "muse-spark-1.3", reasoningEffort: "medium", baseURL: "https://api.meta.ai/v1", shortcut: "Alt+M", shortcutRegistered: true, screenPermission: "granted", storagePath: "/tmp" };
  listeners = new Set();
  bridge = { getSettings: async () => settings, listModels: async () => ({ choices: [...MODEL_CHOICES] }), onSettingsChanged: (callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; }, selectModel: async (id) => {
    const choice = MODEL_CHOICES.find((item) => item.id === id)!;
    settings = { ...settings, model: choice.model, reasoningEffort: choice.reasoningEffort };
    for (const callback of listeners) callback(settings);
    return settings;
  } } as DesktopBridge;
  window.metaforDesktop = bridge;
});
afterEach(() => ui.cleanup());
after(() => { dom.window.close(); for (const [name, value] of originals) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });

test("the picker displays real model and intent, commits choice, and syncs other mode", async () => {
  const visibility: boolean[] = [];
  ui.render(<><ModelSelector onOpenChange={(open) => visibility.push(open)} /><ModelSelector /></>);
  await ui.waitFor(() => assert.equal(ui.screen.getAllByRole("button", { name: /Choose model: Muse Spark 1.3 · Balanced/ }).length, 2));
  ui.fireEvent.click(ui.screen.getAllByRole("button", { name: /Choose model:/ })[0]);
  const deep = await ui.screen.findByRole("option", { name: /Muse Wonder 1.0.*Deep/ });
  assert.ok(visibility.includes(true));
  ui.fireEvent.click(deep);
  await ui.waitFor(() => assert.equal(ui.screen.getAllByRole("button", { name: /Choose model: Muse Wonder 1.0 · Deep/ }).length, 2));
  assert.ok(!ui.screen.queryByRole("listbox"));
  assert.equal(visibility.at(-1), false);
  assert.equal(settings.reasoningEffort, "high");
});

test("a failed switch retains the old label and offers a useful error", async () => {
  bridge.selectModel = async () => { throw new Error("Your model choice could not be saved. The previous choice is still active."); };
  ui.render(<ModelSelector />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: /Choose model: Muse Spark/ }));
  ui.fireEvent.click(await ui.screen.findByRole("option", { name: /Deep/ }));
  await ui.screen.findByRole("alert");
  assert.ok(ui.screen.getByRole("button", { name: /Choose model: Muse Spark 1.3 · Balanced/ }));
  assert.equal(settings.model, "muse-spark-1.3");
});

test("busy state closes the picker, disables selection, and keyboard Escape returns focus", async () => {
  const rendered = ui.render(<ModelSelector />);
  const trigger = await ui.screen.findByRole("button", { name: /Choose model: Muse Spark/ });
  ui.fireEvent.click(trigger); await ui.screen.findByRole("listbox");
  ui.fireEvent.keyDown(trigger, { key: "ArrowDown" });
  assert.equal(document.activeElement?.getAttribute("role"), "option");
  ui.fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  assert.equal(document.activeElement, trigger);
  assert.ok(!ui.screen.queryByRole("listbox"));
  ui.fireEvent.click(trigger); await ui.screen.findByRole("listbox");
  rendered.rerender(<ModelSelector disabled />);
  assert.equal((trigger as HTMLButtonElement).disabled, true);
  assert.ok(!ui.screen.queryByRole("listbox"));
});

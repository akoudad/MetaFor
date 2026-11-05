import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { DesktopBridge, DesktopSettings } from "../shared";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://metafor.local" });
let ui: typeof import("@testing-library/react");
let Settings: typeof import("../renderer/Settings").default;
let settings: DesktopSettings;
let bridge: DesktopBridge;
let closed = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
const preferenceWarning = "Saved settings could not be read.";
const credentialWarning = "The saved key could not be unlocked.";

before(async () => {
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : dom.window[name] });
  }
  [ui, { default: Settings }] = await Promise.all([import("@testing-library/react"), import("../renderer/Settings")]);
});
beforeEach(() => {
  closed = 0;
  settings = { configured: false, model: "vision-model", baseURL: "https://example.test/v1", shortcut: "CommandOrControl+Alt+Control+M", shortcutRegistered: true, screenPermission: "not-determined", storagePath: "/tmp", warnings: { preferences: preferenceWarning, credential: credentialWarning } };
  bridge = { getSettings: async () => settings } as DesktopBridge;
  window.metaforDesktop = bridge;
});
afterEach(() => ui.cleanup());
after(() => { dom.window.close(); for (const [name, value] of originals) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });

test("Settings retains a key recovery warning after saving model details without a replacement", async () => {
  let submitted: unknown;
  bridge.saveSettings = async (value) => { submitted = value; return { ...settings, warnings: { credential: credentialWarning } }; };
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByText(preferenceWarning);
  assert.ok(ui.screen.getByText(credentialWarning));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  await ui.waitFor(() => assert.ok(!ui.screen.queryByText(preferenceWarning)));
  assert.ok(ui.screen.getByText(credentialWarning));
  assert.equal(closed, 0);
  assert.equal((submitted as { apiKey?: string }).apiKey, undefined);
  bridge.saveSettings = async () => ({ ...settings, configured: true, warnings: {} });
  ui.fireEvent.change(ui.screen.getByLabelText("API key"), { target: { value: "replacement" } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  await ui.waitFor(() => assert.equal(closed, 1));
});

test("an unreadable saved key can be removed even though no usable key is configured", async () => {
  bridge.removeKey = async () => ({ ...settings, warnings: { preferences: preferenceWarning } });
  ui.render(<Settings onClose={() => closed++} />);
  const remove = await ui.screen.findByRole("button", { name: "Remove key" });
  ui.fireEvent.click(remove);
  await ui.waitFor(() => assert.ok(!ui.screen.queryByText(credentialWarning)));
  assert.ok(ui.screen.getByText(preferenceWarning));
  assert.ok(!ui.screen.queryByRole("button", { name: "Remove key" }));
});

test("older settings responses without warnings still save and close normally", async () => {
  delete settings.warnings;
  bridge.saveSettings = async () => settings;
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByDisplayValue(settings.model);
  assert.ok(!ui.screen.queryByRole("alert"));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  await ui.waitFor(() => assert.equal(closed, 1));
});

test("a retained key remains removable while provider settings need recovery", async () => {
  settings = { ...settings, configured: false, hasSavedKey: true, warnings: { preferences: preferenceWarning } };
  bridge.removeKey = async () => ({ ...settings, hasSavedKey: false });
  ui.render(<Settings onClose={() => closed++} />);
  const remove = await ui.screen.findByRole("button", { name: "Remove key" });
  assert.ok(ui.screen.getByPlaceholderText("Key saved · leave empty to keep it"));
  ui.fireEvent.click(remove);
  await ui.waitFor(() => assert.ok(!ui.screen.queryByRole("button", { name: "Remove key" })));
  assert.ok(ui.screen.getByText(preferenceWarning));
});

test("Keychain completion refreshes status without replacing settings edits", async () => {
  settings = { ...settings, configured: false, hasSavedKey: true, credentialLoading: true, warnings: {} };
  let saves = 0;
  bridge.saveSettings = async () => { saves++; return settings; };
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByText(/Waiting for macOS Keychain/);
  const edits = { "API key": "replacement-draft", Model: "edited-model", "API base URL": "https://edited.test/v1", "Help shortcut": "CommandOrControl+Alt+K" };
  for (const [label, value] of Object.entries(edits)) ui.fireEvent.change(ui.screen.getByLabelText(label), { target: { value } });
  assert.equal((ui.screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled, true);
  assert.equal((ui.screen.getByRole("button", { name: "Remove key" }) as HTMLButtonElement).disabled, false);
  ui.fireEvent.submit(document.querySelector("form")!);
  assert.equal(saves, 0, "Enter must not submit while the saved key is unlocking");
  ui.act(() => window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: { ...settings, configured: true, credentialLoading: false } })));
  assert.ok(!ui.screen.queryByText(/Waiting for macOS Keychain/));
  assert.equal((ui.screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled, false);
  for (const [label, value] of Object.entries(edits)) assert.equal((ui.screen.getByLabelText(label) as HTMLInputElement).value, value);
});

test("a retained key can be removed during unlock without clearing an unsaved replacement", async () => {
  settings = { ...settings, configured: false, hasSavedKey: true, credentialLoading: true, warnings: {} };
  let removed = false;
  bridge.removeKey = async () => { removed = true; return { ...settings, hasSavedKey: false, credentialLoading: false }; };
  ui.render(<Settings onClose={() => closed++} />);
  const remove = await ui.screen.findByRole("button", { name: "Remove key" });
  ui.fireEvent.change(ui.screen.getByLabelText("API key"), { target: { value: "new-unsaved-key" } });
  ui.fireEvent.click(remove);
  await ui.waitFor(() => assert.ok(!ui.screen.queryByRole("button", { name: "Remove key" })));
  assert.ok(removed);
  assert.ok(!ui.screen.queryByText(/Waiting for macOS Keychain/));
  assert.equal((ui.screen.getByLabelText("API key") as HTMLInputElement).value, "new-unsaved-key");
});

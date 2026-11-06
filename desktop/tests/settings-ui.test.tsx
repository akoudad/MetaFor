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
  assert.match((await ui.screen.findByRole("status")).textContent!, /Settings saved/);
  assert.equal(closed, 0);
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

test("older settings responses without warnings still report saved settings", async () => {
  delete settings.warnings;
  settings.configured = true;
  bridge.saveSettings = async () => settings;
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByDisplayValue(settings.model);
  assert.ok(!ui.screen.queryByRole("alert"));
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  assert.match((await ui.screen.findByRole("status")).textContent!, /Settings saved/);
  assert.equal(closed, 0);
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

test("an unavailable startup shortcut is shown until a replacement registers", async () => {
  settings = { ...settings, configured: true, shortcut: "Alt+M", shortcutRegistered: false, warnings: {} };
  let submitted: unknown;
  bridge.saveSettings = async (value) => { submitted = value; return { ...settings, shortcut: value.shortcut, shortcutRegistered: true }; };
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByText(/Help shortcut Alt\+M is unavailable/);
  ui.fireEvent.change(ui.screen.getByLabelText("Help shortcut"), { target: { value: "Alt+Shift+M" } });
  assert.ok(ui.screen.getByText(/Help shortcut Alt\+M is unavailable/), "an unsaved draft must not claim registration succeeded");
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  assert.match((await ui.screen.findByRole("status")).textContent!, /Settings saved/);
  assert.equal(closed, 0);
  assert.equal((submitted as { shortcut: string }).shortcut, "Alt+Shift+M");
  assert.ok(!ui.screen.queryByText(/Help shortcut .* is unavailable/));
});

test("saving with an unavailable shortcut keeps its warning visible", async () => {
  settings = { ...settings, configured: true, shortcutRegistered: false, warnings: {} };
  bridge.saveSettings = async () => settings;
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByText(/Help shortcut .* is unavailable/);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  await ui.waitFor(() => assert.equal((ui.screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled, false));
  assert.equal(closed, 0);
  assert.ok(ui.screen.getByText(/Help shortcut .* is unavailable/));
});


test("connection checks distinguish saved keys, verified access, and rejected credentials", async () => {
  settings = { ...settings, configured: true, model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1", warnings: {} };
  let checks = 0;
  bridge.listModels = async () => { checks++; return { choices: [{ id: "spark-balanced", model: settings.model, name: "Spark", mode: "Balanced", reasoningEffort: "medium", description: "Fixture" }] }; };
  ui.render(<Settings onClose={() => closed++} />);
  assert.match((await ui.screen.findByRole("status")).textContent!, /has not been checked/);
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Check connection" }));
  await ui.screen.findByText(/Connection verified: API key accepted/);
  assert.equal(checks, 1);
  bridge.listModels = async () => { throw new Error("The API key could not list models. Check it in Settings."); };
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Check connection" }));
  assert.match((await ui.screen.findByRole("alert")).textContent!, /API key could not list models/);
  assert.ok(!ui.screen.queryByText(/Connection verified/));
  ui.fireEvent.change(ui.screen.getByLabelText("API key"), { target: { value: "unsaved-replacement" } });
  assert.equal((ui.screen.getByRole("button", { name: "Check connection" }) as HTMLButtonElement).disabled, true);
  assert.match(ui.screen.getByRole("status").textContent!, /Save these changes/);
});

test("custom providers never claim model-list verification", async () => {
  settings = { ...settings, configured: true, warnings: {} };
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByText(/Custom provider access is checked/);
  assert.ok(!ui.screen.queryByRole("button", { name: "Check connection" }));
});

test("late connection results cannot verify a changed credential", async () => {
  settings = { ...settings, configured: true, model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1", warnings: {} };
  let finish!: (value: { choices: [] }) => void;
  bridge.listModels = () => new Promise((resolve) => { finish = resolve; });
  ui.render(<Settings onClose={() => closed++} />);
  ui.fireEvent.click(await ui.screen.findByRole("button", { name: "Check connection" }));
  ui.act(() => window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: { ...settings, configured: false, hasSavedKey: false } })));
  await ui.act(async () => finish({ choices: [] }));
  assert.ok(!ui.screen.queryByText(/API key accepted/));
});


test("normalized saved settings remain checkable without requiring another save", async () => {
  settings = { ...settings, configured: true, model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1", warnings: {} };
  bridge.saveSettings = async () => settings;
  ui.render(<Settings onClose={() => closed++} />);
  await ui.screen.findByDisplayValue(settings.model);
  ui.fireEvent.change(ui.screen.getByLabelText("API base URL"), { target: { value: "https://api.meta.ai/v1/" } });
  ui.fireEvent.change(ui.screen.getByLabelText("Model"), { target: { value: " muse-spark-1.3 " } });
  ui.fireEvent.click(ui.screen.getByRole("button", { name: "Save settings" }));
  await ui.screen.findByText(/Settings saved on this Mac/);
  assert.equal((ui.screen.getByLabelText("API base URL") as HTMLInputElement).value, settings.baseURL);
  assert.equal((ui.screen.getByLabelText("Model") as HTMLInputElement).value, settings.model);
  assert.equal((ui.screen.getByRole("button", { name: "Check connection" }) as HTMLButtonElement).disabled, false);
});

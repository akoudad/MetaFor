import assert from "node:assert/strict";
import { before, test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import type { DesktopSettings } from "../shared";
import { HelpStore, emptyHelp } from "../store";
import { createConversation } from "../../src/lib/session";

let code: string;
const require = createRequire(import.meta.url);
before(async () => {
  const result = await build({ entryPoints: ["desktop/main.ts"], bundle: true, platform: "node", format: "cjs", external: ["electron"], write: false });
  code = result.outputFiles[0].text;
});

async function start(directory: string, env: Record<string, string> = {}, failCredentialWrite = false, decryptedKey?: string | Promise<string>, encryption?: Promise<Buffer>, modelFixture = false) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const windows: TestWindow[] = [];
  const alerts: string[] = [];
  const shortcuts = new Set<string>();
  const providerRequests: { url: string; authorization: string | null; body?: any }[] = [];
  let initialized = Promise.resolve();
  let quit = false;
  let menu: any[] = [];
  const locations: Record<string, string> = { appData: directory, userData: directory };
  class TestWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "metafor://app/index.html" },
      setWindowOpenHandler() {}, isLoading: () => false,
      send: (channel: string) => this.sent.push(channel),
    });
    sent: string[] = [];
    url = "";
    constructor() { super(); windows.push(this); }
    async loadURL(url: string) { this.url = url; }
    isDestroyed() { return false; }
    show() {} showInactive() {} hide() {} focus() {} setBounds() {}
    setVisibleOnAllWorkspaces() {}
  }
  const electron = {
    app: Object.assign(new EventEmitter(), {
      setName() {}, getPath: (name: string) => locations[name], setPath: (name: string, value: string) => { locations[name] = value; },
      requestSingleInstanceLock: () => true, quit: () => { quit = true; },
      whenReady: () => ({ then: (fn: () => Promise<void>) => { initialized = Promise.resolve().then(fn); return initialized; } }),
    }),
    BrowserWindow: TestWindow,
    Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu(items: any[]) { menu = items; } },
    Tray: class { setToolTip() {} setContextMenu() {} },
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    globalShortcut: { isRegistered: (value: string) => shortcuts.has(value), register: (value: string) => { shortcuts.add(value); return true; }, unregister: (value: string) => shortcuts.delete(value), unregisterAll: () => shortcuts.clear() },
    dialog: { showErrorBox: (title: string) => alerts.push(title) },
    safeStorage: { decryptStringAsync: async () => { if (decryptedKey !== undefined) return { result: await decryptedKey, shouldReEncrypt: false }; throw new Error("private-native-keychain-error"); }, isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (value: string) => encryption ?? Buffer.from(`encrypted:${value}`) },
    screen: { getAllDisplays: () => [], getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1400, height: 900 } }) },
    systemPreferences: { getMediaAccessStatus: () => "not-determined" },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
  };
  const context = vm.createContext({
    require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "node:fs/promises" && failCredentialWrite) return { ...require(name), rename: async (from: string, to: string) => {
        if (to === path.join(directory, "credential.enc")) throw new Error("simulated atomic key write failure");
        return require(name).rename(from, to);
      } };
      return require(name);
    }, module: { exports: {} }, exports: {},
    __dirname: path.resolve("desktop"), process: { env: { METAFOR_USER_DATA: directory, ...env }, pid: process.pid },
    console, crypto: globalThis.crypto, Buffer, URL, Response, Headers, structuredClone, AbortController, TextDecoder, clearTimeout, setTimeout,
    fetch: async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      providerRequests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization"), body });
      if (!modelFixture) return new Response("fixture provider unavailable", { status: 503 });
      if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "muse-spark-1.3" }, { id: "muse-wonder-1.0" }] });
      const schema = body.response_format.json_schema.name;
      const answer = schema === "metafor_help" ? { answer: "A short explanation.", highlightIds: [], visualMarks: [] }
        : schema === "metafor_organization" ? { reason: "One answer.", overview: "", primary: { decision: "continue", title: "Explanation", summary: "A short explanation.", sectionIds: ["s0"], sourceIds: [] }, topics: [] }
        : { decision: "continue", reason: "One answer.", title: "Explanation", summary: "A short explanation.", sections: [{ title: "Explanation", body: "A short explanation." }], related: [] };
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] });
    },
  });
  vm.runInContext(code, context);
  await initialized;
  const call = async (name: string, ...args: unknown[]) => {
    const sender = (name === "ask-help" ? windows.find((window) => window.url.includes("surface=help"))! : windows[0]).webContents;
    // Electron IPC deserializes inputs inside the receiving JS realm.
    const received = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(args))})`, context);
    return handlers.get(`metafor:${name}`)!({ sender, senderFrame: sender.mainFrame }, ...received);
  };
  if (!(decryptedKey instanceof Promise)) await until(async () => !(await call("settings")).credentialLoading);
  return { windows, alerts, shortcuts, call, quit, providerRequests, openQuickStart: () => menu[0].submenu.find((item: any) => item.label === "Quick start…").click() };
}

async function until(check: () => Promise<boolean>) {
  for (let tries = 0; tries < 200; tries++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail("The expected async startup state did not arrive.");
}

const valid = { model: "vision-model", baseURL: "https://example.test/v1", shortcut: "CommandOrControl+Shift+H" };
async function profile(action: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metafor-startup-"));
  try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("quick start completion survives relaunch without changing settings, keys, or Help history", async () => profile(async (directory) => {
  const preferences = JSON.stringify(valid);
  await writeFile(path.join(directory, "preferences.json"), preferences);
  await writeFile(path.join(directory, "credential.enc"), "unchanged-encrypted-key");
  const store = new HelpStore(path.join(directory, "Help"));
  const exchange = emptyHelp(); await store.save(exchange);
  const runtime = await start(directory, {}, false, "retained-key");
  assert.equal(await runtime.call("onboarding-complete"), false);
  assert.equal(runtime.windows.length, 1, "quick start uses Chat rather than another native window");
  await runtime.call("complete-onboarding");
  assert.equal(await runtime.call("onboarding-complete"), true);
  const relaunched = await start(directory, {}, false, "retained-key");
  assert.equal(await relaunched.call("onboarding-complete"), true);
  relaunched.openQuickStart();
  assert.ok(relaunched.windows[0].sent.includes("metafor:open-onboarding"));
  assert.equal(await readFile(path.join(directory, "preferences.json"), "utf8"), preferences);
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "unchanged-encrypted-key");
  assert.deepEqual(await store.get(exchange.id), exchange);
  assert.equal(runtime.providerRequests.length, 0);
}));

test("unreadable quick start state leaves Chat usable and a failed completion reports a retry", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "onboarding.json"), "invalid-state");
  const runtime = await start(directory);
  assert.equal(await runtime.call("onboarding-complete"), false);
  assert.equal(runtime.quit, false);
  assert.deepEqual(runtime.alerts, []);
  assert.equal(await readFile(path.join(directory, "onboarding.json"), "utf8"), "invalid-state");
  await rm(path.join(directory, "onboarding.json"));
  await mkdir(path.join(directory, "onboarding.json"));
  await assert.rejects(runtime.call("complete-onboarding"), /Quick start could not be saved/);
  assert.equal(runtime.quit, false);
  await rm(path.join(directory, "onboarding.json"), { recursive: true });
  await runtime.call("complete-onboarding");
  assert.equal(await runtime.call("onboarding-complete"), true);
}));

test("unreadable preferences and encrypted key cannot block Chat or overwrite existing files", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), "{private-corrupt-settings");
  await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
  const runtime = await start(directory);
  assert.equal(runtime.quit, false);
  assert.equal(runtime.windows[0].url, "metafor://app/index.html");
  assert.deepEqual(runtime.alerts, [], "startup must not wait behind a synchronous native dialog");
  const settings: DesktopSettings = await runtime.call("settings");
  assert.ok(settings.warnings?.preferences);
  assert.ok(settings.warnings?.credential);
  assert.equal(settings.configured, false);
  assert.ok(!JSON.stringify(settings).includes("private-native-keychain-error"));
  assert.equal(await readFile(path.join(directory, "preferences.json"), "utf8"), "{private-corrupt-settings");
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "old-encrypted-key");
  await runtime.call("ready");
  assert.deepEqual(runtime.windows[0].sent.filter((name) => name === "metafor:open-settings"), ["metafor:open-settings"]);
  await runtime.call("ready");
  assert.equal(runtime.windows[0].sent.filter((name) => name === "metafor:open-settings").length, 1, "a readiness retry must not reopen Settings repeatedly");
  const withoutKey: DesktopSettings = await runtime.call("save-settings", valid);
  assert.equal(withoutKey.warnings?.preferences, undefined);
  assert.ok(withoutKey.warnings?.credential, "saving model details alone cannot claim the key recovered");
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "old-encrypted-key");
  const repaired: DesktopSettings = await runtime.call("save-settings", { ...valid, apiKey: "replacement-key" });
  assert.equal(repaired.configured, true);
  assert.equal(repaired.warnings?.credential, undefined);
}));

test("removing an unreadable key clears only its warning and keeps preference recovery visible", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), "not-json");
  await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
  const runtime = await start(directory);
  const settings: DesktopSettings = await runtime.call("remove-key");
  assert.equal(settings.configured, false);
  assert.equal(settings.warnings?.credential, undefined);
  assert.ok(settings.warnings?.preferences);
  await assert.rejects(readFile(path.join(directory, "credential.enc")), { code: "ENOENT" });
}));

test("explicit owner import recovers warnings without a startup dialog", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), "not-json");
  await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
  const runtime = await start(directory, { METAFOR_IMPORT_MODEL: "1", MODEL_API_KEY: "owner-key", MODEL_API_MODEL: valid.model, MODEL_API_BASE_URL: valid.baseURL });
  const settings: DesktopSettings = await runtime.call("settings");
  assert.equal(settings.configured, true);
  assert.equal(Object.keys(settings.warnings ?? {}).length, 0);
  assert.deepEqual(runtime.alerts, []);
  await runtime.call("ready");
  assert.deepEqual(runtime.windows[0].sent.filter((name) => name === "metafor:open-settings"), []);
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "encrypted:owner-key");
}));

test("fresh profiles register the new default while saved user shortcuts remain unchanged", async () => profile(async (directory) => {
  const fresh = await start(directory);
  assert.ok(fresh.shortcuts.has("Alt+M"));
  assert.equal(Object.keys((await fresh.call("settings")).warnings).length, 0);
  for (const shortcut of ["CommandOrControl+Alt+Control+M", "CommandOrControl+Alt+M"]) {
    await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ ...valid, shortcut }));
    const migrated = await start(directory);
    assert.ok(migrated.shortcuts.has("Alt+M"));
    assert.equal((await migrated.call("settings")).shortcut, "Alt+M");
  }
  for (const shortcut of [valid.shortcut, "Alt+Space"]) {
    await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ ...valid, shortcut }));
    const saved = await start(directory);
    assert.ok(saved.shortcuts.has(shortcut));
    assert.equal((await saved.call("settings")).shortcut, shortcut);
  }
}));


test("a failed owner key import restores original preferences and never pairs a new key with an old endpoint", async () => profile(async (directory) => {
  const previous = JSON.stringify(valid);
  await writeFile(path.join(directory, "preferences.json"), previous);
  await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
  const runtime = await start(directory, { METAFOR_IMPORT_MODEL: "1", MODEL_API_KEY: "new-provider-key", MODEL_API_MODEL: "other-model", MODEL_API_BASE_URL: "https://other-provider.test/v1" }, true);
  const settings: DesktopSettings = await runtime.call("settings");
  assert.equal(settings.configured, false);
  assert.equal(settings.baseURL, valid.baseURL);
  assert.equal(settings.model, valid.model);
  assert.ok(settings.warnings?.credential);
  assert.equal(await readFile(path.join(directory, "preferences.json"), "utf8"), previous);
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "old-encrypted-key");
  assert.equal(runtime.windows[0].url, "metafor://app/index.html");
  assert.deepEqual(runtime.alerts, []);
}));

test("a retained key cannot reach Chat or Help providers until model settings are recovered", async () => {
  for (const preferences of ["not-json", null]) await profile(async (directory) => {
    if (preferences !== null) await writeFile(path.join(directory, "preferences.json"), preferences);
    await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
    const runtime = await start(directory, {}, false, "retained-provider-key");
    const settings: DesktopSettings = await runtime.call("settings");
    assert.equal(settings.configured, false);
    assert.equal(settings.hasSavedKey, true);
    assert.equal((await runtime.call("api", { path: "/api/status" })).body.configured, false);
    const conversation = createConversation();
    const request = { path: "/api/answer", body: { requestId: "recovery-test", conversation, activeId: conversation.rootId, question: "Explain this idea", selection: null, mode: "auto", includeIds: [] } };
    const blocked = await runtime.call("api", request);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, "settings_recovery");
    assert.match(blocked.body.error, /model and API URL in Settings/);
    const exchange = emptyHelp();
    exchange.source = { id: "source-1", appName: "Fixture", title: "Source", capturedAt: new Date().toISOString(), width: 10, height: 10, image: "data:image/png;base64,aGVsbG8=" };
    await new HelpStore(path.join(directory, "Help")).save(exchange);
    await runtime.call("open-help");
    await runtime.call("resume-help", exchange.id);
    await assert.rejects(runtime.call("ask-help", { sessionId: exchange.id, question: "Explain this", marks: [] }), /model and API URL in Settings/);
    assert.equal(runtime.providerRequests.length, 0);
    const recovered: DesktopSettings = await runtime.call("save-settings", valid);
    assert.equal(recovered.configured, true);
    assert.equal(recovered.hasSavedKey, true);
    const requested = await runtime.call("api", request);
    assert.equal(runtime.providerRequests.length, 1, JSON.stringify(requested));
    await assert.rejects(runtime.call("ask-help", { sessionId: exchange.id, question: "Explain this", marks: [] }), /503/);
    assert.equal(runtime.providerRequests.length, 2, "both surfaces can request only after explicit recovery");
    assert.ok(runtime.providerRequests.every((request) => request.url.startsWith(valid.baseURL) && request.authorization === "Bearer retained-provider-key"));
    assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "old-encrypted-key");
  });
});


test("Chat opens during delayed Keychain unlock; removing the key invalidates late results", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify(valid));
  await writeFile(path.join(directory, "credential.enc"), "old-encrypted-key");
  let unlock!: (value: string) => void;
  const delayed = new Promise<string>((resolve) => { unlock = resolve; });
  const runtime = await start(directory, {}, false, delayed);
  assert.equal(runtime.windows[0].url, "metafor://app/index.html");
  assert.ok(runtime.shortcuts.has(valid.shortcut));
  await until(async () => (await runtime.call("settings")).hasSavedKey);
  const pending = await runtime.call("settings");
  assert.equal(pending.credentialLoading, true);
  assert.equal(pending.configured, false);
  assert.equal((await runtime.call("api", { path: "/api/status" })).body.configured, false);
  const blocked = await runtime.call("api", { path: "/api/answer" });
  assert.equal(blocked.body.code, "credential_loading");
  await assert.rejects(runtime.call("save-settings", { ...valid, apiKey: "new-key" }), /Waiting for macOS Keychain/);
  assert.equal(runtime.providerRequests.length, 0);
  const removed: DesktopSettings = await runtime.call("remove-key");
  assert.equal(removed.credentialLoading, false);
  assert.equal(removed.hasSavedKey, false);
  await assert.rejects(readFile(path.join(directory, "credential.enc")), { code: "ENOENT" });
  await runtime.call("save-settings", { ...valid, apiKey: "new-key" });
  unlock("old-retained-key");
  await new Promise((resolve) => setTimeout(resolve, 15));
  const current: DesktopSettings = await runtime.call("settings");
  assert.equal(current.configured, true);
  assert.equal(current.credentialLoading, false);
  const conversation = createConversation();
  await runtime.call("api", { path: "/api/answer", body: { requestId: "after-removal", conversation, activeId: conversation.rootId, question: "Explain this", selection: null, mode: "auto", includeIds: [] } });
  assert.equal(runtime.providerRequests[0]?.authorization, "Bearer new-key");
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "encrypted:new-key");
}));


test("asynchronous key saves keep IPC responsive and exclude concurrent settings writes", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify(valid));
  let finish!: (value: Buffer) => void;
  const encryption = new Promise<Buffer>((resolve) => { finish = resolve; });
  const runtime = await start(directory, {}, false, undefined, encryption);
  const saving = runtime.call("save-settings", { ...valid, apiKey: "replacement" });
  assert.equal((await runtime.call("settings")).configured, false);
  await assert.rejects(runtime.call("remove-key"), /current settings change/);
  await assert.rejects(runtime.call("save-settings", valid), /current settings change/);
  finish(Buffer.from("encrypted:replacement"));
  assert.equal((await saving).configured, true);
  assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "encrypted:replacement");
}));

test("model choice persists without touching credentials and routes Chat writer, organizer, and Help", async () => profile(async (directory) => {
  const preferences = { ...valid, model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1" };
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify(preferences));
  await writeFile(path.join(directory, "credential.enc"), "unchanged-encrypted-key");
  const runtime = await start(directory, {}, false, "retained-key", undefined, true);
  assert.equal((await runtime.call("settings")).reasoningEffort, "medium", "existing default becomes Balanced");
  const exchange = emptyHelp();
  exchange.source = { id: "source-1", appName: "Fixture", title: "Source", capturedAt: new Date().toISOString(), width: 10, height: 10, image: "data:image/png;base64,aGVsbG8=" };
  await new HelpStore(path.join(directory, "Help")).save(exchange);
  await runtime.call("open-help"); await runtime.call("resume-help", exchange.id);
  const choices = await runtime.call("list-models");
  assert.equal(choices.choices.length, 3);
  assert.ok(!JSON.stringify(choices).includes("retained-key"));
  for (const [id, model, effort] of [["spark-fast", "muse-spark-1.3", "minimal"], ["wonder-deep", "muse-wonder-1.0", "high"], ["spark-balanced", "muse-spark-1.3", "medium"]]) {
    const selected = await runtime.call("select-model", id);
    assert.equal(selected.model, model); assert.equal(selected.reasoningEffort, effort);
    const conversation = createConversation();
    const before = runtime.providerRequests.length;
    const result = await runtime.call("api", { path: "/api/answer", body: { requestId: `model-${id}`, conversation, activeId: conversation.rootId, question: "Explain an idea", selection: null, mode: "auto", includeIds: [] } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    await runtime.call("ask-help", { sessionId: exchange.id, question: "Explain this", marks: [] });
    const actual = runtime.providerRequests.slice(before);
    const expectedSchemas = id === "spark-fast"
      ? ["metafor_answer", "metafor_help"]
      : ["metafor_answer", "metafor_organization", "metafor_help"];
    assert.deepEqual(actual.map((item) => item.body.response_format.json_schema.name), expectedSchemas);
    assert.ok(actual.every((item) => item.body.model === model && item.body.reasoning_effort === effort));
    const saved = JSON.parse(await readFile(path.join(directory, "preferences.json"), "utf8"));
    assert.equal(saved.model, model); assert.equal(saved.reasoningEffort, effort);
    assert.equal(saved.shortcut, preferences.shortcut);
    assert.equal(await readFile(path.join(directory, "credential.enc"), "utf8"), "unchanged-encrypted-key");
  }
  const savedBefore = await readFile(path.join(directory, "preferences.json"), "utf8");
  await assert.rejects(runtime.call("select-model", "imaginary-fast-model"), /not available/);
  assert.equal(await readFile(path.join(directory, "preferences.json"), "utf8"), savedBefore);
  assert.ok(runtime.windows.every((window) => window.sent.includes("metafor:settings-changed")), "both modes receive the selected model");
  const relaunched = await start(directory, {}, false, "retained-key");
  assert.equal((await relaunched.call("settings")).reasoningEffort, "medium");
  assert.equal((await relaunched.call("settings")).model, "muse-spark-1.3");
}));

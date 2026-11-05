import assert from "node:assert/strict";
import { before, test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";

let code: string;
const require = createRequire(import.meta.url);
const valid = { model: "vision-model", baseURL: "https://example.test/v1", shortcut: "CommandOrControl+Shift+H", captureConsent: true };
before(async () => {
  const result = await build({ entryPoints: ["desktop/main.ts"], bundle: true, platform: "node", format: "cjs", external: ["electron"], write: false });
  code = result.outputFiles[0].text;
});

type Options = {
  consent?: Promise<{ response: number }>;
  capture?: () => Promise<void>;
  selectionLoad?: () => Promise<void>;
  permission?: string;
  encrypt?: Promise<Buffer>;
};

async function start(directory: string, options: Options = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const windows: TestWindow[] = [];
  const alerts: string[] = [];
  const crops: unknown[] = [];
  let captureCount = 0;
  let initialized = Promise.resolve();
  class TestWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "metafor://app/index.html" },
      setWindowOpenHandler() {}, isLoading: () => false, send() {},
    });
    url = "";
    visible: boolean;
    destroyed = false;
    inactiveShows = 0;
    focusCount = 0;
    bounds: unknown;
    constructor(options: { show?: boolean }) { super(); this.visible = options.show !== false; windows.push(this); }
    async loadURL(url: string) {
      this.url = url; this.webContents.mainFrame.url = url;
      if (url.includes("surface=selection")) await options.selectionLoad?.();
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; this.inactiveShows++; }
    hide() { this.visible = false; }
    focus() { this.focusCount++; }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {}
    setBounds(value: unknown) { this.bounds = value; }
    close() {
      let prevented = false;
      this.emit("close", { preventDefault: () => { prevented = true; } });
      if (!prevented) { this.destroyed = true; this.visible = false; this.emit("closed"); }
    }
  }
  const display = { id: 7, scaleFactor: 2, size: { width: 1400, height: 900 }, bounds: { x: -1400, y: 0, width: 1400, height: 900 }, workArea: { x: -1400, y: 25, width: 1400, height: 875 } };
  const electron = {
    app: Object.assign(new EventEmitter(), {
      setName() {}, getPath: () => directory, setPath() {}, requestSingleInstanceLock: () => true, quit() {},
      whenReady: () => ({ then: (fn: () => Promise<void>) => { initialized = Promise.resolve().then(fn); return initialized; } }),
    }),
    BrowserWindow: TestWindow,
    Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu() {} },
    Tray: class { setToolTip() {} setContextMenu() {} },
    nativeImage: {
      createFromPath: () => ({ setTemplateImage() {} }),
      createFromDataURL: () => ({ crop: (rect: unknown) => { crops.push(rect); return { toJPEG: () => Buffer.from("approved crop") }; } }),
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    globalShortcut: { isRegistered: () => false, register: () => true, unregister() {}, unregisterAll() {} },
    dialog: { showMessageBox: () => options.consent ?? Promise.resolve({ response: 0 }), showErrorBox: (_title: string, message: string) => alerts.push(message) },
    safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async () => options.encrypt ?? Buffer.from("encrypted") },
    screen: { getCursorScreenPoint: () => ({ x: -100, y: 100 }), getDisplayNearestPoint: () => display },
    desktopCapturer: { getSources: async () => {
      captureCount++; await options.capture?.();
      return [{ display_id: "7", thumbnail: { isEmpty: () => false, getSize: () => ({ width: 2800, height: 1800 }), toDataURL: () => "data:image/png;base64,ZnVsbCBmcmFtZQ==" } }];
    } },
    systemPreferences: { getMediaAccessStatus: () => options.permission ?? "granted" },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
  };
  const context = vm.createContext({
    require: (name: string) => name === "electron" ? electron : name === "node:child_process" ? {
      execFile: (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => callback(null, { stdout: JSON.stringify({ appName: "Preview", windowTitle: "Report" }) }),
    } : require(name),
    module: { exports: {} }, exports: {}, __dirname: path.resolve("desktop"), process: { env: { METAFOR_USER_DATA: directory }, pid: process.pid },
    console, crypto: globalThis.crypto, Buffer, URL, Response, Headers, structuredClone, AbortController, TextDecoder, clearTimeout, setTimeout,
    fetch: () => { throw new Error("Capture must not send any model request"); },
  });
  vm.runInContext(code, context); await initialized;
  const call = async (surface: "chat" | "help" | "selection", name: string, ...args: unknown[]) => {
    const window = surface === "chat" ? windows[0] : windows.findLast((item) => item.url.includes(`surface=${surface}`) && !item.destroyed)!;
    const received = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(args))})`, context);
    return handlers.get(`metafor:${name}`)!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...received);
  };
  await until(async () => !(await call("chat", "settings")).credentialLoading);
  return { windows, call, alerts, crops, captureCount: () => captureCount };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let tries = 0; tries < 200; tries++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail("The expected capture state did not arrive.");
}

async function profile(action: (directory: string) => Promise<void>, captureConsent = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metafor-capture-"));
  try { await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ ...valid, captureConsent })); await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("denied screen capture restores Chat without opening an unwanted Help window", async () => profile(async (directory) => {
  const runtime = await start(directory, { permission: "denied" });
  await assert.rejects(runtime.call("chat", "capture"), /Allow Metafor/);
  assert.equal(runtime.windows.length, 1);
  assert.equal(runtime.windows[0].visible, true);
  assert.equal(runtime.windows[0].inactiveShows, 1);
  assert.equal(runtime.windows[0].focusCount, 0);
  assert.equal(runtime.crops.length, 0);
}));

test("cancel restores only the windows visible before capture and permits retry", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "open-help");
  const companion = runtime.windows[1];
  await runtime.call("help", "capture");
  assert.equal(runtime.windows[0].visible, false); assert.equal(companion.visible, false);
  await runtime.call("selection", "cancel-capture");
  assert.equal(runtime.windows[0].visible, true); assert.equal(companion.visible, true);
  assert.equal(companion.inactiveShows, 1);
  companion.hide(); runtime.windows[0].hide();
  await runtime.call("chat", "capture");
  await runtime.call("selection", "cancel-capture");
  assert.equal(runtime.windows[0].visible, false); assert.equal(companion.visible, false);
  assert.equal(runtime.captureCount(), 2); assert.equal(runtime.crops.length, 0);
}));

test("selection load failure destroys its overlay, restores Chat, and allows another capture", async () => profile(async (directory) => {
  const options: Options = { selectionLoad: async () => { throw new Error("fixture load failure"); } };
  const runtime = await start(directory, options);
  await assert.rejects(runtime.call("chat", "capture"), /selection could not open/);
  assert.equal(runtime.windows[1].destroyed, true); assert.equal(runtime.windows[0].visible, true);
  options.selectionLoad = undefined;
  await runtime.call("chat", "capture");
  assert.equal(runtime.captureCount(), 2);
  await runtime.call("selection", "cancel-capture");
}));

test("selection renderer crash clears the full frame and restores the prior windows", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "capture");
  const overlay = runtime.windows[1];
  overlay.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(overlay.destroyed, true); assert.equal(runtime.windows[0].visible, true);
  assert.match(runtime.alerts[0], /screen was not sent/);
  await runtime.call("chat", "capture");
  assert.equal(runtime.captureCount(), 2);
  await runtime.call("selection", "cancel-capture");
}));

test("late failure from a canceled overlay cannot clear a newer capture", async () => profile(async (directory) => {
  let rejectLoad!: (error: Error) => void;
  const options: Options = { selectionLoad: () => new Promise((_resolve, reject) => { rejectLoad = reject; }) };
  const runtime = await start(directory, options);
  const first = runtime.call("chat", "capture");
  await until(() => runtime.windows.length === 2);
  await runtime.call("selection", "cancel-capture");
  options.selectionLoad = undefined;
  await runtime.call("chat", "capture");
  const latest = runtime.windows[2];
  rejectLoad(new Error("late load rejection")); await first;
  assert.equal(latest.destroyed, false);
  assert.ok(await runtime.call("selection", "get-capture"));
  await runtime.call("selection", "cancel-capture");
}));

test("successful crop discards the full frame, keeps the source visible, and does not send", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "capture");
  const overlay = runtime.windows[1];
  await runtime.call("selection", "select-capture", { x: .2, y: .25, width: .3, height: .5 });
  assert.equal(overlay.destroyed, true); assert.equal(runtime.windows[0].visible, false);
  const companion = runtime.windows.findLast((window) => window.url.includes("surface=help"))!;
  assert.equal(companion.visible, true);
  const exchange = await runtime.call("help", "help-session");
  assert.equal(exchange.messages.length, 0);
  assert.equal(exchange.source.width, 840); assert.equal(exchange.source.height, 900);
  assert.equal(exchange.source.image, `data:image/jpeg;base64,${Buffer.from("approved crop").toString("base64")}`);
  assert.ok(!JSON.stringify(exchange).includes("ZnVsbCBmcmFtZQ=="));
}));

test("capture consent and settings saves cannot overwrite each other's preferences", async () => profile(async (directory) => {
  let allow!: (value: { response: number }) => void;
  const options: Options = { consent: new Promise((resolve) => { allow = resolve; }) };
  const runtime = await start(directory, options);
  const capture = runtime.call("chat", "capture");
  await assert.rejects(runtime.call("chat", "save-settings", { ...valid, baseURL: "https://changed.test/v1" }), /Finish the screen capture/);
  allow({ response: 0 }); await capture;
  await runtime.call("selection", "cancel-capture");
  const saved = JSON.parse(await readFile(path.join(directory, "preferences.json"), "utf8"));
  assert.equal(saved.baseURL, valid.baseURL); assert.equal(saved.captureConsent, true);
}, false));

test("a pending credential save prevents capture from racing preference persistence", async () => profile(async (directory) => {
  let unlock!: (value: Buffer) => void;
  const runtime = await start(directory, { encrypt: new Promise((resolve) => { unlock = resolve; }) });
  const save = runtime.call("chat", "save-settings", { ...valid, apiKey: "fixture-key" });
  await assert.rejects(runtime.call("chat", "capture"), /Wait for the current settings change/);
  assert.equal(runtime.captureCount(), 0);
  unlock(Buffer.from("encrypted fixture")); await save;
}));

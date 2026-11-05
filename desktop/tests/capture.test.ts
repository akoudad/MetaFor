import assert from "node:assert/strict";
import { before, test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { snapshotFromHelp } from "../chat-transfer";

let code: string;
const require = createRequire(import.meta.url);
const valid = { model: "vision-model", baseURL: "https://example.test/v1", shortcut: "CommandOrControl+Shift+H", captureConsent: true, screenContextConsent: true };
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
  image?: string;
  answer?: { answer: string; highlightIds: string[]; visualMarks?: unknown[] };
  answerWait?: Promise<void>;
  guidanceLoad?: () => Promise<void>;
  cursorDisplay?: number;
  shortcutAvailable?: boolean;
  appName?: string;
  contentTop?: number;
  shownContentTop?: number;
  imagePixel?: (image: string, x: number, y: number) => number;
  observerStart?: (observer: TestObserver) => void;
};

class TestObserver extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  stdin = Object.assign(new EventEmitter(), { end() {} });
  exitCode: number | null = null;
  signalCode: string | null = null;
  signals: string[] = [];
  kill(signal: string) { this.signals.push(signal); this.signalCode = signal; this.emit("exit"); return true; }
  send(token: string) { this.stdout.emit("data", `${token}\n`); }
}

async function start(directory: string, options: Options = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const windows: TestWindow[] = [];
  const alerts: string[] = [];
  const crops: unknown[] = [];
  const prompts: unknown[] = [];
  const provenanceArgs: string[][] = [];
  const observers: TestObserver[] = [];
  const sent: { channel: string; value: any }[] = [];
  const consentDialogs: { message: string; detail: string }[] = [];
  const shortcuts = new Map<string, () => void>();
  let captureCount = 0;
  let initialized = Promise.resolve();
  let guidanceExpiry: (() => void) | null = null;
  class TestWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "metafor://app/index.html" },
      setWindowOpenHandler() {}, isLoading: () => false, send(channel: string, value: any) { sent.push({ channel, value }); },
    });
    url = "";
    visible: boolean;
    destroyed = false;
    inactiveShows = 0;
    focusCount = 0;
    bounds: unknown;
    options: Record<string, unknown>;
    ignoresMouse = false;
    forwardsMouse = false;
    constructor(options: { show?: boolean; x?: number; y?: number; width?: number; height?: number }) { super(); this.options = options; this.visible = options.show !== false; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; windows.push(this); }
    async loadURL(url: string) {
      this.url = url; this.webContents.mainFrame.url = url;
      if (url.includes("surface=selection")) await options.selectionLoad?.();
      if (url.includes("surface=guidance")) await options.guidanceLoad?.();
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; this.emit("show"); }
    showInactive() { this.visible = true; this.inactiveShows++; this.emit("show"); }
    hide() { this.visible = false; }
    focus() { this.focusCount++; }
    moveTop() {}
    setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }) { this.ignoresMouse = ignore; this.forwardsMouse = options?.forward ?? false; }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {}
    setBounds(value: unknown) { this.bounds = value; }
    getContentBounds() {
      const bounds = this.bounds as { x: number; y: number; width: number; height: number };
      return { ...bounds, y: Math.max(options.contentTop ?? -Infinity, this.visible ? options.shownContentTop ?? -Infinity : -Infinity, bounds.y) };
    }
    close() {
      let prevented = false;
      this.emit("close", { preventDefault: () => { prevented = true; } });
      if (!prevented) { this.destroyed = true; this.visible = false; this.emit("closed"); }
    }
  }
  const display = { id: 7, scaleFactor: 2, size: { width: 1400, height: 900 }, bounds: { x: -1400, y: 0, width: 1400, height: 900 }, workArea: { x: -1400, y: 25, width: 1400, height: 875 } };
  const secondDisplay = { ...display, id: 8, bounds: { ...display.bounds, x: 0 }, workArea: { ...display.workArea, x: 0 } };
  const displays = [display, secondDisplay];
  function fakeImage(image: string, region = { x: 0, y: 0, width: 2800, height: 1800 }) {
    const value = image.includes("ZnVsbCBmcmFtZQ==") || image.includes(Buffer.from("approved crop").toString("base64")) ? 20 : 150;
    return {
      crop: (rect: { x: number; y: number; width: number; height: number }) => { crops.push(rect); return fakeImage(image, { ...rect, x: region.x + rect.x, y: region.y + rect.y }); },
      resize: () => fakeImage(image, region),
      toBitmap: () => {
        const bitmap = Buffer.alloc(128 * 128 * 4, value);
        if (options.imagePixel) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
          const color = options.imagePixel(image, (region.x + (x + .5) * region.width / 128) / 2800, (region.y + (y + .5) * region.height / 128) / 1800);
          for (let channel = 0; channel < 3; channel++) bitmap[(y * 128 + x) * 4 + channel] = color;
        }
        return bitmap;
      },
      toJPEG: () => Buffer.from("approved crop"),
    };
  }
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
      createFromDataURL: fakeImage,
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    globalShortcut: {
      isRegistered: (value: string) => shortcuts.has(value),
      register: (value: string, callback: () => void) => { if (options.shortcutAvailable === false) return false; shortcuts.set(value, callback); return true; },
      unregister: (value: string) => shortcuts.delete(value), unregisterAll: () => shortcuts.clear(),
    },
    dialog: { showMessageBox: (value: { message: string; detail: string }) => { consentDialogs.push(value); return options.consent ?? Promise.resolve({ response: 0 }); }, showErrorBox: (_title: string, message: string) => alerts.push(message) },
    safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async () => options.encrypt ?? Buffer.from("encrypted") },
    screen: { getCursorScreenPoint: () => ({ x: -100, y: 100 }), getDisplayNearestPoint: () => displays.find((item) => item.id === options.cursorDisplay) ?? display, getAllDisplays: () => displays },
    desktopCapturer: { getSources: async () => {
      captureCount++; await options.capture?.();
      return displays.map((display) => ({ display_id: String(display.id), thumbnail: { isEmpty: () => false, getSize: () => ({ width: 2800, height: 1800 }), toDataURL: () => options.image ?? "data:image/png;base64,ZnVsbCBmcmFtZQ==" } }));
    } },
    systemPreferences: { getMediaAccessStatus: () => options.permission ?? "granted" },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
  };
  const context = vm.createContext({
    require: (name: string) => name === "electron" ? electron : name === "node:child_process" ? {
      execFile: (_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => { provenanceArgs.push(Array.from(args)); callback(null, { stdout: JSON.stringify({ appName: options.appName ?? "Preview", windowTitle: "Report" }) }); },
      spawn: (_file: string, args: string[]) => {
        assert.deepEqual(Array.from(args), ["--exclude-pid", String(process.pid)]);
        const observer = new TestObserver(); observers.push(observer);
        queueMicrotask(() => options.observerStart ? options.observerStart(observer) : observer.send("ready"));
        return observer;
      },
    } : require(name),
    module: { exports: {} }, exports: {}, __dirname: path.resolve("desktop"), process: { env: { METAFOR_USER_DATA: directory }, pid: process.pid },
    console, crypto: globalThis.crypto, Buffer, URL, Response, Headers, structuredClone, AbortController, TextDecoder, TextEncoder, clearTimeout, setTimeout: (callback: () => void, delay: number) => { if (delay === 12000) guidanceExpiry = callback; return setTimeout(callback, delay); },
    fetch: async (_url: string, init: RequestInit) => {
      if (!options.answer) throw new Error("Capture must not send any model request");
      prompts.push(JSON.parse(String(init.body)));
      await options.answerWait;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(options.answer) } }] }), { status: 200 });
    },
  });
  vm.runInContext(code, context); await initialized;
  const call = async (surface: "chat" | "help" | "selection" | "guidance", name: string, ...args: unknown[]) => {
    const window = surface === "chat" ? windows[0] : windows.findLast((item) => item.url.includes(`surface=${surface}`) && !item.destroyed)!;
    const received = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(args))})`, context);
    return handlers.get(`metafor:${name}`)!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...received);
  };
  await until(async () => !(await call("chat", "settings")).credentialLoading);
  return { windows, call, alerts, crops, prompts, provenanceArgs, observers, sent, consentDialogs, pressShortcut: (value = valid.shortcut) => { assert.ok(shortcuts.has(value)); shortcuts.get(value)!(); }, captureCount: () => captureCount, expireGuidance: () => guidanceExpiry?.(), activate: () => electron.app.emit("activate"), secondInstance: () => electron.app.emit("second-instance"), quit: () => electron.app.emit("before-quit") };
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
  await runtime.call("help", "capture", "region");
  assert.equal(runtime.windows[0].visible, false); assert.equal(companion.visible, false);
  await runtime.call("selection", "cancel-capture");
  assert.equal(runtime.windows[0].visible, false); assert.equal(companion.visible, true);
  assert.equal(companion.inactiveShows, 2);
  companion.hide(); runtime.windows[0].hide();
  await runtime.call("chat", "capture", "region");
  await runtime.call("selection", "cancel-capture");
  assert.equal(runtime.windows[0].visible, false); assert.equal(companion.visible, false);
  assert.equal(runtime.captureCount(), 2); assert.equal(runtime.crops.length, 0);
}));

test("selection load failure destroys its overlay, restores Chat, and allows another capture", async () => profile(async (directory) => {
  const options: Options = { selectionLoad: async () => { throw new Error("fixture load failure"); } };
  const runtime = await start(directory, options);
  await assert.rejects(runtime.call("chat", "capture", "region"), /selection could not open/);
  assert.equal(runtime.windows[1].destroyed, true); assert.equal(runtime.windows[0].visible, true);
  options.selectionLoad = undefined;
  await runtime.call("chat", "capture", "region");
  assert.equal(runtime.captureCount(), 2);
  await runtime.call("selection", "cancel-capture");
}));

test("selection renderer crash clears the full frame and restores the prior windows", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "capture", "region");
  const overlay = runtime.windows[1];
  overlay.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(overlay.destroyed, true); assert.equal(runtime.windows[0].visible, true);
  assert.match(runtime.alerts[0], /screen was not sent/);
  await runtime.call("chat", "capture", "region");
  assert.equal(runtime.captureCount(), 2);
  await runtime.call("selection", "cancel-capture");
}));

test("late failure from a canceled overlay cannot clear a newer capture", async () => profile(async (directory) => {
  let rejectLoad!: (error: Error) => void;
  const options: Options = { selectionLoad: () => new Promise((_resolve, reject) => { rejectLoad = reject; }) };
  const runtime = await start(directory, options);
  const first = runtime.call("chat", "capture", "region");
  await until(() => runtime.windows.length === 2);
  await runtime.call("selection", "cancel-capture");
  options.selectionLoad = undefined;
  await runtime.call("chat", "capture", "region");
  const latest = runtime.windows[2];
  rejectLoad(new Error("late load rejection")); await first;
  assert.equal(latest.destroyed, false);
  assert.ok(await runtime.call("selection", "get-capture"));
  await runtime.call("selection", "cancel-capture");
}));

test("successful crop discards the full frame, keeps the source visible, and does not send", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "capture", "region");
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
  const capture = runtime.call("chat", "capture", "region");
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
  await assert.rejects(runtime.call("chat", "capture", "region"), /Wait for the current settings change/);
  assert.equal(runtime.captureCount(), 0);
  unlock(Buffer.from("encrypted fixture")); await save;
}));

test("default capture opens Help with the whole display, without a selector or provider request", async () => profile(async (directory) => {
  const runtime = await start(directory);
  await runtime.call("chat", "capture");
  assert.equal(runtime.captureCount(), 1);
  assert.equal(runtime.windows.some((window) => window.url.includes("surface=selection")), false);
  assert.equal(runtime.windows[0].visible, false, "the underlying app remains visible behind Help");
  const exchange = await runtime.call("help", "help-session");
  assert.equal(exchange.contextMode, "screen");
  assert.equal(exchange.source.width, 2800); assert.equal(exchange.source.height, 1800);
  assert.equal(exchange.source.screenBounds.displayId, "7");
  assert.equal(exchange.source.screenBounds.x, -1400);
  assert.equal(exchange.sources[0].id, exchange.source.id);
  assert.equal(exchange.messages.length, 0);
  assert.equal(runtime.prompts.length, 0); assert.equal(runtime.crops.length, 0);
}));

test("legacy crop consent does not approve sharing a whole screen", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ ...valid, screenContextConsent: false }));
  const runtime = await start(directory, { consent: Promise.resolve({ response: 1 }) });
  await runtime.call("chat", "capture");
  assert.equal(runtime.consentDialogs.length, 1);
  assert.match(runtime.consentDialogs[0].detail, /normal Help question captures the display again/);
  assert.equal(runtime.captureCount(), 0); assert.equal(runtime.windows.length, 1);
  assert.equal(runtime.windows[0].visible, true);
  assert.equal(JSON.parse(await readFile(path.join(directory, "preferences.json"), "utf8")).screenContextConsent, false);
}));

const answer = { answer: "The toolbar contains the controls.", highlightIds: [], visualMarks: [{ kind: "point", x: .3, y: .2, width: 0, height: 0, label: "Toolbar" }] };
const mark = { id: "question-mark", kind: "rect", x: .2, y: .2, width: .3, height: .3, label: "What is this?" };
async function configure(runtime: Awaited<ReturnType<typeof start>>) {
  await runtime.call("chat", "save-settings", { ...valid, apiKey: "fixture-key" });
}

test("a question from empty Help captures on Send and keeps refreshed source identities across follow-ups", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "open-help");
  const initial = await runtime.call("help", "help-session");
  assert.equal(initial.source, null);
  const first = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain this screen", marks: [], refreshScreen: true });
  assert.equal(first.id, initial.id); assert.equal(first.messages.length, 2); assert.equal(first.sources.length, 1);
  assert.ok(first.messages.every((message: { sourceId: string }) => message.sourceId === first.source.id));
  assert.equal(runtime.windows[0].visible, false); assert.equal(runtime.windows[1].visible, true);
  const originalId = first.source.id;
  options.image = `data:image/png;base64,${Buffer.from("second screen").toString("base64")}`;
  const second = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "What changed?", marks: [], refreshScreen: true });
  assert.equal(second.messages.length, 4); assert.equal(second.sources.length, 2);
  assert.notEqual(second.source.id, originalId);
  assert.equal(second.messages[0].sourceId, originalId); assert.equal(second.messages[1].sourceId, originalId);
  assert.equal(second.messages[2].sourceId, second.source.id); assert.equal(second.messages[3].sourceId, second.source.id);
  assert.equal(first.messages[1].marks[0].x, second.messages[1].marks[0].x);
  const repeated = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain further", marks: [], refreshScreen: true });
  assert.equal(repeated.sources.length, 2, "an identical screen is not duplicated");
  assert.equal(repeated.source.id, second.source.id);
  const count = runtime.captureCount();
  const pinned = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain my old mark", marks: [mark], sourceId: originalId });
  assert.equal(runtime.captureCount(), count, "annotations never silently refresh their source");
  assert.equal(pinned.source.id, second.source.id, "answering an old annotation keeps the current screen and reader position");
  assert.equal(pinned.messages.at(-1).sourceId, originalId);
  assert.equal(pinned.messages.at(-2).marks[0].id, mark.id);
  assert.equal(pinned.sources.length, 2);
  const saved = await runtime.call("chat", "get-help", initial.id);
  assert.equal(saved.messages.length, 8);
  assert.equal(runtime.prompts.length, 4);
  await assert.rejects(runtime.call("help", "ask-help", { sessionId: initial.id, question: "Wrong refresh", marks: [mark], refreshScreen: true }), /Annotations stay attached/);
  assert.equal(runtime.captureCount(), count);
}));

test("refresh failure and cancellation preserve the prior exchange and permit retry without a provider send", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const original = JSON.stringify(await runtime.call("help", "help-session"));
  const id = JSON.parse(original).id;
  options.capture = async () => { throw new Error("screen unavailable"); };
  await assert.rejects(runtime.call("help", "ask-help", { sessionId: id, question: "Explain", marks: [], refreshScreen: true }), /Screen Recording/);
  assert.equal(JSON.stringify(await runtime.call("help", "help-session")), original);
  assert.equal(runtime.windows[1].visible, true); assert.equal(runtime.prompts.length, 0);
  let release!: () => void;
  options.capture = () => new Promise<void>((resolve) => { release = resolve; });
  const pending = runtime.call("help", "ask-help", { sessionId: id, question: "Explain", marks: [], refreshScreen: true });
  const rejection = assert.rejects(pending, /answer stopped/);
  await until(() => !!release);
  await runtime.call("help", "cancel-help", id); release(); await rejection;
  assert.equal(JSON.stringify(await runtime.call("help", "help-session")), original);
  assert.equal(runtime.windows[1].visible, true); assert.equal(runtime.prompts.length, 0);
  options.capture = undefined;
  const completed = await runtime.call("help", "ask-help", { sessionId: id, question: "Explain", marks: [], refreshScreen: true });
  assert.equal(completed.messages.length, 2); assert.equal(runtime.prompts.length, 1);
}));

test("a full refreshed archive stops before the model and preserves history for a new exchange", async () => profile(async (directory) => {
  const options: Options = { answer, image: `data:image/png;base64,${Buffer.alloc(9 * 1024 * 1024).toString("base64")}` };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "open-help");
  const initial = await runtime.call("help", "help-session");
  const first = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain this screen", marks: [], refreshScreen: true });
  assert.equal(first.messages.length, 2, "one large frame can be saved without duplicating it");
  options.image = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024, 1).toString("base64")}`;
  await assert.rejects(runtime.call("help", "ask-help", { sessionId: first.id, question: "What changed?", marks: [], refreshScreen: true }), /Start a new Help exchange/);
  assert.equal(runtime.prompts.length, 1, "capacity failure must happen before an expensive provider request");
  const current = await runtime.call("help", "help-session");
  const saved = await runtime.call("chat", "get-help", first.id);
  for (const session of [current, saved]) {
    assert.equal(session.messages.length, 2);
    assert.equal(session.sources.length, 1);
    assert.equal(session.source.id, first.source.id);
  }
  const next = await runtime.call("help", "new-help");
  const retried = await runtime.call("help", "ask-help", { sessionId: next.id, question: "Explain the new screen", marks: [], refreshScreen: true });
  assert.equal(retried.messages.length, 2); assert.equal(runtime.prompts.length, 2);
  assert.equal((await runtime.call("chat", "get-help", first.id)).messages.length, 2, "starting fresh leaves earlier answers accessible");
}));

test("live Guidance rejects changed sources, stays transparent, and never intercepts input", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const first = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point to the controls", marks: [] });
  options.image = `data:image/png;base64,${Buffer.from("new application").toString("base64")}`;
  const second = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Now this one", marks: [], refreshScreen: true });
  const captures = runtime.captureCount(), sends = runtime.prompts.length;
  await assert.rejects(runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: first.messages[1].id }), /Screen changed/);
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: second.messages[3].id });
  const guidance = runtime.windows.findLast((window) => window.url.includes("surface=guidance"))!;
  assert.equal(guidance.visible, true);
  assert.deepEqual(guidance.bounds, { x: -1400, y: 0, width: 1400, height: 900 });
  assert.equal(guidance.options.transparent, true); assert.equal(guidance.options.focusable, false);
  assert.equal(guidance.options.backgroundColor, "#00000000");
  assert.equal(guidance.ignoresMouse, true); assert.equal(guidance.forwardsMouse, true);
  assert.equal(guidance.focusCount, 0);
  const payload = await runtime.call("guidance", "get-guidance");
  assert.equal(payload.source.id, second.source.id); assert.equal(payload.marks[0].label, "Toolbar");
  assert.deepEqual(payload.viewportBounds, guidance.getContentBounds());
  assert.deepEqual(payload.helpBounds, runtime.windows.find((window) => window.url.includes("surface=help"))!.getContentBounds());
  let titlePrevented = false;
  guidance.emit("page-title-updated", { preventDefault: () => { titlePrevented = true; } });
  assert.equal(titlePrevented, true); assert.equal(guidance.options.title, "Metafor Guidance");
  assert.equal(runtime.captureCount(), captures + 2, "validation captures stay local");
  assert.equal(runtime.prompts.length, sends);
  await assert.rejects(runtime.call("guidance", "capture"), /only available inside/);
  await assert.rejects(runtime.call("guidance", "settings"), /only available inside/);
  await assert.rejects(runtime.call("guidance", "set-help-layout", { expanded: true }), /only available inside/);
  runtime.expireGuidance(); assert.equal(guidance.destroyed, true);
  assert.deepEqual(runtime.observers[0].signals, ["SIGTERM"]);
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: second.messages[3].id });
  const reopened = runtime.windows.at(-1)!;
  await runtime.call("help", "hide-help"); assert.equal(reopened.destroyed, true);
  assert.deepEqual(runtime.observers[1].signals, ["SIGTERM"]);
  runtime.activate();
  options.appName = "Different app";
  await assert.rejects(runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: second.messages[3].id }), /Screen changed/);
}));

test("Guidance load failure clears the window and allows retry", async () => profile(async (directory) => {
  const options: Options = { answer, guidanceLoad: async () => { throw new Error("fixture render failure"); } };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point there", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  await assert.rejects(runtime.call("help", "show-guidance", request), /visual explanation could not open/);
  assert.equal(runtime.windows.at(-1)!.destroyed, true);
  options.guidanceLoad = undefined;
  await runtime.call("help", "show-guidance", request);
  assert.equal(runtime.windows.at(-1)!.visible, true);
  await runtime.call("guidance", "close-guidance");
  assert.equal(runtime.windows.at(-1)!.destroyed, true);
}));

test("live Guidance accepts remote animation but rejects moved targets, nearby changes, and a broad page change", async () => profile(async (directory) => {
  const image = (name: string) => `data:image/png;base64,${Buffer.from(name).toString("base64")}`;
  const animated = image("remote motion"), moved = image("moved control"), nearby = image("nearby changes"), broad = image("broad changes");
  const options: Options = { answer, imagePixel: (frame, x, y) => {
    const center = frame === moved ? .34 : .3;
    if (Math.abs(x - center) < .008 && Math.abs(y - .2) < .012) return 30;
    if (frame === animated && x > .2 && x < .75 && y > .35 && y < .75) return 40;
    if (frame === nearby && x > .316 && x < .327 && y > .17 && y < .23) return 30;
    if (frame === broad && (x < .25 || x > .35 || y < .15 || y > .25)) return 30;
    return 220;
  } };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point to this control", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  const sends = runtime.prompts.length;
  options.image = animated;
  await runtime.call("help", "show-guidance", request);
  assert.equal(runtime.windows.at(-1)!.visible, true);
  await runtime.call("help", "close-guidance");
  for (const changed of [moved, nearby, broad]) {
    options.image = changed;
    await assert.rejects(runtime.call("help", "show-guidance", request), /Screen changed/);
  }
  assert.equal(runtime.prompts.length, sends, "all frame checks remain local");
  assert.equal((await runtime.call("help", "help-session")).messages.at(-1).text, answered.messages[1].text);
}));

test("question refresh stays on the source display while a new shortcut capture follows the cursor", async () => profile(async (directory) => {
  const options: Options = { answer, cursorDisplay: 7 };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  options.cursorDisplay = 8;
  const refreshed = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain", marks: [], refreshScreen: true });
  assert.equal(refreshed.source.screenBounds.displayId, "7");
  assert.deepEqual(runtime.provenanceArgs.at(-1), ["--exclude-pid", String(process.pid), "--display-id", "7"]);
  await runtime.call("chat", "capture");
  assert.equal((await runtime.call("help", "help-session")).source.screenBounds.displayId, "8");
  assert.deepEqual(runtime.provenanceArgs.at(-1), ["--exclude-pid", String(process.pid), "--display-id", "8"]);
}));

test("cropped live Guidance keeps exact source bounds instead of expanding the screenshot", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer }); await configure(runtime);
  await runtime.call("chat", "capture", "region");
  await runtime.call("selection", "select-capture", { x: .2, y: .25, width: .1, height: .1 });
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain here", marks: [] });
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  const { displayId: _displayId, ...bounds } = initial.source.screenBounds;
  assert.equal(JSON.stringify(runtime.windows.at(-1)!.bounds), JSON.stringify(bounds));
}));

test("Guidance reports its actual native origin when macOS clamps below the menu bar", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer, contentTop: 25 }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  const payload = await runtime.call("guidance", "get-guidance");
  assert.equal(payload.source.screenBounds.y, 0, "source coordinates remain unchanged");
  assert.deepEqual(payload.viewportBounds, { x: -1400, y: 25, width: 1400, height: 900 });
}));

test("Guidance publishes a native clamp that occurs only when the overlay is shown", async () => profile(async (directory) => {
  const options: Options = { answer, shownContentTop: 40 };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  options.guidanceLoad = async () => {
    const payload = await runtime.call("guidance", "get-guidance");
    assert.equal(payload.viewportBounds.y, 0, "the native origin has not been clamped before show");
  };
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  const expected = { x: -1400, y: 40, width: 1400, height: 900 };
  const published = runtime.sent.findLast((event) => event.channel === "metafor:guidance-layout-changed")?.value;
  assert.deepEqual(published?.viewportBounds, expected, "the visible renderer receives the corrected origin without another IPC read");
  assert.equal(published.source.screenBounds.y, 0, "source coordinates remain unchanged");
  assert.deepEqual((await runtime.call("guidance", "get-guidance")).viewportBounds, expected);
}));

test("Guidance refreshes native bounds on move, resize, and a later renderer read", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  const window = runtime.windows.at(-1)!;
  const original = await runtime.call("guidance", "get-guidance");
  for (const [event, bounds] of [
    ["move", { x: -1360, y: 40, width: 1400, height: 900 }],
    ["resize", { x: -1360, y: 40, width: 1200, height: 820 }],
  ] as const) {
    window.setBounds(bounds); window.emit(event);
    const published = runtime.sent.findLast((entry) => entry.channel === "metafor:guidance-layout-changed")?.value;
    assert.deepEqual(published?.viewportBounds, bounds, `${event} publishes the actual native bounds`);
    assert.deepEqual(published.source, original.source);
    assert.deepEqual(published.marks, original.marks);
  }
  const latest = { x: -1300, y: 55, width: 1180, height: 780 };
  window.setBounds(latest);
  assert.deepEqual((await runtime.call("guidance", "get-guidance")).viewportBounds, latest, "a renderer read also catches geometry changes without a native event");
}));

test("late geometry events from a replaced Guidance window cannot alter the current overlay", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  await runtime.call("help", "show-guidance", request);
  const previous = runtime.windows.at(-1)!;
  await runtime.call("help", "show-guidance", request);
  const current = runtime.windows.at(-1)!;
  assert.equal(previous.destroyed, true);
  current.setBounds({ x: -1380, y: 40, width: 1380, height: 860 }); current.emit("move");
  const payload = await runtime.call("guidance", "get-guidance");
  const eventCount = runtime.sent.length;
  previous.setBounds({ x: 200, y: 300, width: 400, height: 500 });
  for (const event of ["show", "move", "resize"]) previous.emit(event);
  assert.equal(runtime.sent.length, eventCount, "a stale native window cannot publish a layout change");
  assert.equal(await runtime.call("guidance", "get-guidance"), payload, "the current payload is untouched");
  assert.equal(current.destroyed, false);
}));

test("successful Guidance keeps Chat behind the verified source while failures restore it", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  const chat = runtime.windows[0]; await runtime.call("help", "help-in-chat", initial.id);
  await runtime.call("chat", "show-guidance", request);
  assert.equal(chat.visible, false, "Chat must not cover the validated source");
  assert.equal(runtime.windows.find((window) => window.url.includes("surface=help"))!.visible, false);
  await runtime.call("help", "close-guidance");
  chat.show(); options.image = `data:image/png;base64,${Buffer.from("a different screen").toString("base64")}`;
  await assert.rejects(runtime.call("chat", "show-guidance", request), /Screen changed/);
  assert.equal(chat.visible, true, "a refused overlay leaves the original windows visible");
}));

test("a reserved shortcut is reported and cannot replace saved preferences", async () => profile(async (directory) => {
  const runtime = await start(directory, { shortcutAvailable: false });
  const original = await readFile(path.join(directory, "preferences.json"), "utf8");
  assert.equal((await runtime.call("chat", "settings")).shortcutRegistered, false);
  await assert.rejects(runtime.call("chat", "save-settings", { ...valid, shortcut: "Alt+M" }), /Settings could not be saved/);
  assert.equal(await readFile(path.join(directory, "preferences.json"), "utf8"), original);
  assert.equal((await runtime.call("chat", "settings")).shortcut, valid.shortcut);
}));

test("Chat API attaches a selected historical answer's image instead of the latest screen", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const first = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain", marks: [] });
  options.image = `data:image/png;base64,${Buffer.from("a newer screen").toString("base64")}`;
  const second = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Now here", marks: [], refreshScreen: true });
  const snapshot = snapshotFromHelp(second);
  const messageId = `help-message-${first.messages[1].id}`;
  await runtime.call("chat", "api", { path: "/api/answer", body: { requestId: "historical-chat-source", conversation: snapshot.conversation, activeId: "root", question: "Explain this toolbar", selection: { explorationId: "root", messageId, sectionId: `${messageId}-text`, quote: "The toolbar contains the controls." }, mode: "auto", includeIds: [] } });
  const writer = runtime.prompts.find((prompt: any) => prompt.response_format?.json_schema?.name === "metafor_answer") as any;
  assert.ok(writer, "the native Chat endpoint reaches the writer");
  const images = writer.messages.at(-1).content.filter((part: any) => part.type === "image_url").map((part: any) => part.image_url.url);
  assert.deepEqual(images, [first.source.image]);
  assert.ok(!images.includes(second.source.image));
}));

test("Help is a transparent bottom-center panel that expands upward on the invocation display", async () => profile(async (directory) => {
  const options: Options = { cursorDisplay: 7 };
  const runtime = await start(directory, options);
  await runtime.call("chat", "capture");
  const panel = runtime.windows.findLast((window) => window.url.includes("surface=help"))!;
  const collapsed = panel.bounds as { x: number; y: number; width: number; height: number };
  assert.equal(panel.options.type, "panel"); assert.equal(panel.options.transparent, true); assert.equal(panel.options.frame, false);
  assert.equal(collapsed.width, 620); assert.equal(collapsed.height, 110);
  assert.equal(collapsed.x + collapsed.width / 2, -700);
  let titlePrevented = false;
  panel.emit("page-title-updated", { preventDefault: () => { titlePrevented = true; } });
  assert.equal(titlePrevented, true); assert.equal(panel.options.title, "Metafor Help");
  options.cursorDisplay = 8;
  await runtime.call("help", "set-help-layout", { expanded: true });
  const expanded = panel.bounds as typeof collapsed;
  assert.equal(expanded.height, 450); assert.equal(expanded.x, collapsed.x);
  assert.equal(expanded.y + expanded.height, collapsed.y + collapsed.height);
  await runtime.call("help", "set-help-layout", { expanded: true, height: 280 });
  assert.equal((panel.bounds as typeof collapsed).height, 280);
  assert.equal((panel.bounds as typeof collapsed).y + (panel.bounds as typeof collapsed).height, collapsed.y + collapsed.height);
  await assert.rejects(runtime.call("help", "set-help-layout", { expanded: true, width: 2000 }), /valid Help layout/);
  await assert.rejects(runtime.call("help", "set-help-layout", { expanded: true, height: "280" }), /valid Help layout/);
  await assert.rejects(runtime.call("help", "set-help-layout", { expanded: true, height: -20 }), /valid Help layout/);
  await assert.rejects(runtime.call("chat", "set-help-layout", { expanded: true }), /only available inside/);
  runtime.activate(); assert.equal(runtime.windows[0].visible, false, "Help activation must not raise Chat over the user's work");
}));

test("Help mode survives activation and reopen during refresh without exposing Chat or capturing its own windows", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  const originalChat = runtime.windows[0];
  await runtime.call("chat", "open-help");
  const panel = runtime.windows.find((window) => window.url.includes("surface=help"))!;
  assert.equal(originalChat.visible, false); assert.equal(originalChat.destroyed, false);
  options.capture = async () => {
    runtime.activate(); runtime.secondInstance();
    // macOS can also raise an existing native window without creating it.
    originalChat.show(); panel.show();
    assert.equal(originalChat.visible, false, "Chat must stay out of the captured frame");
    assert.equal(panel.visible, false, "the temporarily hidden Help bar must stay out of the frame");
    assert.equal(runtime.windows.length, 2, "activation must not create another Chat window");
  };
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Explain the current application", marks: [], refreshScreen: true });
  assert.equal(originalChat.visible, false); assert.equal(panel.visible, true);
  assert.equal(answered.messages.length, 2); assert.equal(runtime.prompts.length, 1);
  await runtime.call("help", "hide-help"); runtime.activate();
  assert.equal(originalChat.visible, false); assert.equal(panel.visible, true);
  await runtime.call("help", "hide-help"); runtime.secondInstance();
  assert.equal(originalChat.visible, false); assert.equal(panel.visible, true);
  options.capture = async () => { runtime.activate(); throw new Error("fixture capture failure"); };
  await assert.rejects(runtime.call("help", "ask-help", { sessionId: initial.id, question: "Refresh again", marks: [], refreshScreen: true }), /Screen Recording/);
  assert.equal(originalChat.visible, false, "refresh failure cannot restore Chat in Help mode");
  assert.equal(panel.visible, true);
  await runtime.call("help", "help-in-chat", initial.id);
  assert.equal(originalChat.visible, true, "only explicit Continue in Chat changes modes");
  assert.equal(panel.visible, false); assert.equal(runtime.windows[0], originalChat); assert.equal(runtime.windows.length, 2);
  originalChat.hide(); runtime.activate();
  assert.equal(originalChat.visible, true, "normal Chat activation remains available after the explicit switch");
}));

test("hiding Help during local guidance validation cannot resurrect the bar or overlay", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  let release!: () => void;
  options.capture = () => new Promise<void>((resolve) => { release = resolve; });
  const showing = runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  await until(() => !!release);
  await runtime.call("help", "hide-help"); release(); await showing;
  assert.equal(runtime.windows.some((window) => window.url.includes("surface=guidance") && !window.destroyed), false);
  assert.equal(runtime.windows.find((window) => window.url.includes("surface=help"))!.visible, false);
}));

test("Option M toggles compact Help without capturing on dismissal", async () => profile(async (directory) => {
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ ...valid, shortcut: "Alt+M" }));
  const runtime = await start(directory);
  runtime.pressShortcut("Alt+M");
  await until(() => runtime.windows.some((window) => window.url.includes("surface=help") && window.visible));
  const panel = runtime.windows[1];
  assert.equal((panel.bounds as { height: number }).height, 110);
  assert.equal(runtime.windows[0].visible, false);
  assert.equal(runtime.captureCount(), 1);
  runtime.pressShortcut("Alt+M");
  assert.equal(panel.visible, false); assert.equal(runtime.captureCount(), 1);
  runtime.pressShortcut("Alt+M");
  await until(() => panel.visible);
  assert.equal(runtime.captureCount(), 2);
  assert.equal(runtime.windows.length, 2, "the same native bar is reused");
  assert.deepEqual(runtime.alerts, []);
}));

test("shortcut dismissal invalidates a pending capture before another one opens", async () => profile(async (directory) => {
  let release!: () => void;
  const options: Options = { capture: () => new Promise<void>((resolve) => { release = resolve; }) };
  const runtime = await start(directory, options);
  const pending = runtime.call("chat", "capture");
  await until(() => !!release);
  runtime.pressShortcut();
  options.capture = undefined;
  runtime.pressShortcut();
  await until(() => runtime.windows.some((window) => window.url.includes("surface=help") && window.visible));
  const session = await runtime.call("help", "help-session");
  release(); await pending;
  assert.equal((await runtime.call("help", "help-session")).id, session.id, "a stale capture cannot replace the reopened session");
  assert.equal(runtime.windows.length, 2); assert.equal(runtime.windows[1].visible, true);
  assert.equal(runtime.captureCount(), 2); assert.deepEqual(runtime.alerts, []);
}));

test("shortcut dismissal cancels first-use consent and region selection", async () => profile(async (directory) => {
  let allow!: (value: { response: number }) => void;
  const options: Options = { consent: new Promise((resolve) => { allow = resolve; }) };
  const runtime = await start(directory, options);
  const pending = runtime.call("chat", "capture", "region");
  await until(() => runtime.consentDialogs.length === 1);
  runtime.pressShortcut(); allow({ response: 0 }); await pending;
  assert.equal(runtime.captureCount(), 0); assert.equal(runtime.windows.length, 1);
  options.consent = undefined;
  await runtime.call("chat", "capture", "region");
  const selection = runtime.windows[1];
  runtime.pressShortcut();
  assert.equal(selection.destroyed, true);
  assert.equal(runtime.windows.some((window) => window.url.includes("surface=help")), false);
}, false));

test("shortcut dismissal closes guidance and rejects late automatic marks", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const result = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const marks = { sessionId: initial.id, messageId: result.messages[1].id };
  await runtime.call("help", "show-guidance", marks);
  const overlay = runtime.windows.at(-1)!;
  const captures = runtime.captureCount();
  runtime.pressShortcut();
  assert.equal(overlay.destroyed, true); assert.equal(runtime.windows[1].visible, false);
  await runtime.call("help", "show-guidance", marks);
  assert.equal(runtime.captureCount(), captures, "a hidden renderer cannot restart guidance capture");
  assert.equal((await runtime.call("help", "help-session")).messages.length, 2);
}));

test("a running answer can be hidden and reopened without a new source or request", async () => profile(async (directory) => {
  let finish!: () => void;
  const runtime = await start(directory, { answer, answerWait: new Promise((resolve) => { finish = resolve; }) }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const pending = runtime.call("help", "ask-help", { sessionId: initial.id, question: "Keep answering", marks: [] });
  await until(() => runtime.prompts.length === 1);
  runtime.pressShortcut(); assert.equal(runtime.windows[1].visible, false);
  runtime.pressShortcut(); assert.equal(runtime.windows[1].visible, true);
  assert.equal(runtime.captureCount(), 1);
  assert.equal((await runtime.call("help", "help-session")).id, initial.id);
  finish(); const result = await pending;
  assert.equal(result.messages.length, 2); assert.equal(runtime.prompts.length, 1);
  assert.deepEqual(runtime.alerts, []);
}));

test("dismissing a hidden Help bar during question refresh cannot restore it", async () => profile(async (directory) => {
  const options: Options = { answer };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  let release!: () => void;
  options.capture = () => new Promise<void>((resolve) => { release = resolve; });
  const pending = runtime.call("help", "ask-help", { sessionId: initial.id, question: "Read this screen", marks: [], refreshScreen: true });
  const rejected = assert.rejects(pending, /Screen sharing stopped/);
  await until(() => !!release);
  assert.equal(runtime.windows[1].visible, false, "capture has temporarily hidden the bar");
  runtime.pressShortcut(); release(); await rejected;
  assert.equal(runtime.windows[1].visible, false); assert.equal(runtime.windows[0].visible, false);
  assert.equal(runtime.prompts.length, 0, "a dismissed capture is never sent");
}));

test("Guidance waits for its observer and fails closed without losing the answer", async () => profile(async (directory) => {
  const options: Options = { answer, observerStart: () => {} };
  const runtime = await start(directory, options); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  const showing = runtime.call("help", "show-guidance", request);
  const rejection = assert.rejects(showing, /could not open safely/);
  await until(() => runtime.observers.length === 1);
  const pending = runtime.windows.at(-1)!;
  assert.equal(pending.visible, false); assert.equal(pending.url, "");
  runtime.observers[0].send("unavailable"); await rejection;
  assert.equal(pending.destroyed, true);
  assert.equal((await runtime.call("help", "help-session")).messages[1].text, answered.messages[1].text);
  options.observerStart = undefined;
  await runtime.call("help", "show-guidance", request);
  assert.equal(runtime.windows.at(-1)!.visible, true);
  runtime.quit();
  assert.equal(runtime.windows.at(-1)!.destroyed, true);
  assert.deepEqual(runtime.observers[1].signals, ["SIGTERM"]);
}));

test("external interaction invalidates Guidance; late old events cannot close a new overlay", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer }); await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const request = { sessionId: initial.id, messageId: answered.messages[1].id };
  await runtime.call("help", "show-guidance", request);
  const old = runtime.windows.at(-1)!;
  runtime.observers[0].send("invalidate");
  assert.equal(old.destroyed, true);
  assert.equal((await runtime.call("help", "help-session")).messages.length, 2);
  await runtime.call("help", "show-guidance", request);
  const fresh = runtime.windows.at(-1)!;
  runtime.observers[0].send("invalidate"); runtime.observers[0].emit("error", new Error("late error"));
  assert.equal(fresh.visible, true);
  await runtime.call("help", "set-help-layout", { expanded: true });
  assert.equal(fresh.destroyed, false, "resizing Help reflows the label keep-out without losing the highlight");
  const payload = await runtime.call("guidance", "get-guidance");
  assert.deepEqual(runtime.sent.findLast((event) => event.channel === "metafor:guidance-layout-changed")?.value.helpBounds, payload.helpBounds);
  assert.deepEqual(payload.helpBounds, runtime.windows.find((window) => window.url.includes("surface=help"))!.getContentBounds());
  assert.deepEqual(runtime.observers[1].signals, []);
  runtime.observers[1].send("invalidate");
  assert.equal(fresh.destroyed, true, "external interaction still invalidates resized guidance");
}));

test("an interaction while Guidance loads cannot display a stale overlay", async () => profile(async (directory) => {
  let release!: () => void;
  const runtime = await start(directory, { answer, guidanceLoad: () => new Promise<void>((resolve) => { release = resolve; }) });
  await configure(runtime); await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  const showing = runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  await until(() => !!release);
  runtime.observers[0].send("invalidate"); release(); await showing;
  assert.equal(runtime.windows.at(-1)!.destroyed, true);
  assert.equal(runtime.windows.at(-1)!.inactiveShows, 0);
}));

test("the Help answer moves clear of a bottom-center target and keeps it clear after resizing", async () => profile(async (directory) => {
  const runtime = await start(directory, { answer: { answer: "Read this area.", highlightIds: [], visualMarks: [{ kind: "rect", x: .4, y: .6, width: .2, height: .3, label: "Target" }] } });
  await configure(runtime);
  await runtime.call("chat", "capture");
  const initial = await runtime.call("help", "help-session");
  const answered = await runtime.call("help", "ask-help", { sessionId: initial.id, question: "Point here", marks: [] });
  await runtime.call("help", "set-help-layout", { expanded: true, height: 310 });
  const panel = runtime.windows.find((window) => window.url.includes("surface=help"))!;
  const before = panel.getContentBounds();
  await runtime.call("help", "show-guidance", { sessionId: initial.id, messageId: answered.messages[1].id });
  const target = { x: -1400 + .4 * 1400, y: .6 * 900, width: .2 * 1400, height: .3 * 900 };
  for (const height of [310, 450, 110]) {
    await runtime.call("help", "set-help-layout", { expanded: height !== 110, height });
    const placed = panel.getContentBounds();
    const overlap = Math.max(0, Math.min(placed.x + placed.width, target.x + target.width) - Math.max(placed.x, target.x))
      * Math.max(0, Math.min(placed.y + placed.height, target.y + target.height) - Math.max(placed.y, target.y));
    assert.equal(overlap, 0, "the target remains visible at every answer size");
    assert.equal(placed.width, before.width, "placement never sacrifices readable width");
    const payload = await runtime.call("guidance", "get-guidance");
    assert.deepEqual(payload.helpBounds, placed);
  }
}));

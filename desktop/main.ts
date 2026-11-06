import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, net, ipcMain, globalShortcut, desktopCapturer, screen, dialog, shell, safeStorage, systemPreferences, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateAnswer, getProviderStatus } from "../src/lib/provider";
import { validateAnswerRequest, AnswerError } from "../src/lib/ai";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";
import { chatSourceContent, snapshotFromHelp } from "./chat-transfer";
import { cropToPixels, guidanceCheckRegions, placeHelpLauncher, placeHelpAvoidingTargets, sameGuidanceBackdrop, sameVisibleRegion, type Rect } from "./geometry";
import { answerHelp, validateMarks, validateModelConfig } from "./help-model";
import { availableModels } from "./models";
import { reasoningEffort, type ReasoningEffort } from "../src/lib/reasoning";
import { assertHelpAnswerCapacity, atomicWrite, HelpStore, emptyHelp } from "./store";
import { observeGuidance, type GuidanceObserver } from "./guidance-observer";
import type { CapturePayload, CropRect, DesktopSettings, GuidancePayload, HelpSession, HelpSource, ModelCatalog, VisualMark } from "./shared";

protocol.registerSchemesAsPrivileged([{ scheme: "metafor", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName("Metafor");
app.setPath("userData", process.env.METAFOR_USER_DATA || path.join(app.getPath("appData"), "Metafor"));
const run = promisify(execFile);
const rendererRoot = path.join(__dirname, "renderer");
let chat: BrowserWindow | null = null;
let help: BrowserWindow | null = null;
// Visibility is temporary during capture; it must never decide the app's mode.
let activeMode: "chat" | "help" = "chat";
let windowsReady = false;
let helpDisplayId: number | null = null;
let helpExpanded = false;
let helpHeight: number | undefined;
let selection: BrowserWindow | null = null;
let guidance: BrowserWindow | null = null;
let guidancePayload: GuidancePayload | null = null;
let guidanceTimer: ReturnType<typeof setTimeout> | null = null;
let guidanceEpoch = 0;
let guidanceObserver: GuidanceObserver | null = null;
let tray: Tray;
let quitting = false;
let currentHelp = emptyHelp();
let capture: CapturePayload | null = null;
let captureDisplay: Electron.Display | null = null;
let captureSource: HelpSource | null = null;
let sourceInfo = { appName: "Screen", title: "Selected region" };
let pendingConversation: string | null = null;
let pendingSettings = false;
let pendingOnboarding = false;
let captureBusy = false;
type CaptureAttempt = { restore: BrowserWindow[]; overlay: BrowserWindow | null };
let captureAttempt: CaptureAttempt | null = null;
let settingsBusy = false;
let store: HelpStore;
let credential = "";
let credentialLoading = true;
let hasSavedKey = false;
let credentialEpoch = 0;
let chatReady = false;
let config = { model: "muse-spark-1.3", reasoningEffort: "medium" as ReasoningEffort, baseURL: "https://api.meta.ai/v1", shortcut: "Alt+M", captureConsent: false, screenContextConsent: false };
let modelCatalog: { baseURL: string; key: string; expires: number; catalog: ModelCatalog } | null = null;
let shortcutRegistered = false;
const settingsWarnings: NonNullable<DesktopSettings["warnings"]> = {};
const requests = new Map<string, AbortController>();
const helpRequests = new Map<string, AbortController>();

const preferenceFile = () => path.join(app.getPath("userData"), "preferences.json");
const credentialFile = () => path.join(app.getPath("userData"), "credential.enc");
const recoveryMessage = "Review and save the model and API URL in Settings before asking a question. Your saved key is unchanged.";
const loadingMessage = "Waiting for macOS Keychain. You can keep browsing your chats while the saved key unlocks.";
const environment = () => ({ MODEL_API_KEY: credentialLoading || settingsWarnings.preferences ? "" : credential, MODEL_API_MODEL: config.model, MODEL_API_REASONING_EFFORT: config.reasoningEffort, MODEL_API_BASE_URL: config.baseURL });
const settings = (): DesktopSettings => ({ configured: !!credential && !credentialLoading && !settingsWarnings.preferences, hasSavedKey, credentialLoading, model: config.model, reasoningEffort: config.reasoningEffort, baseURL: config.baseURL, shortcut: config.shortcut, shortcutRegistered, screenPermission: systemPreferences.getMediaAccessStatus("screen"), storagePath: app.getPath("userData"), warnings: { ...settingsWarnings } });

async function listModels(): Promise<ModelCatalog> {
  if (credentialLoading) throw new Error(loadingMessage);
  if (settingsWarnings.preferences) throw new Error(recoveryMessage);
  const baseURL = config.baseURL; const key = credential;
  if (modelCatalog?.baseURL === baseURL && modelCatalog.key === key && modelCatalog.expires > Date.now()) return modelCatalog.catalog;
  const catalog = await availableModels({ ...config, apiKey: key });
  if (baseURL !== config.baseURL || key !== credential) throw new Error("Model settings changed. Open the chooser again.");
  modelCatalog = { baseURL, key, expires: Date.now() + 60000, catalog };
  return catalog;
}

function notifySettings() {
  for (const window of [chat, help]) if (window && !window.isDestroyed()) window.webContents.send("metafor:settings-changed", settings());
}

async function keychainTask<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Keychain timed out")), 15000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function encryptKey(key: string) {
  return keychainTask((async () => {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Keychain is unavailable");
    return safeStorage.encryptStringAsync(key);
  })());
}

async function loadPreferences() {
  let previousPreferences: Buffer | null = null;
  try {
    previousPreferences = await readFile(preferenceFile());
    const saved = JSON.parse(previousPreferences.toString("utf8"));
    if (saved.shortcut !== undefined && (typeof saved.shortcut !== "string" || saved.shortcut.length > 100 || !/(Command|Control|Alt)/.test(saved.shortcut))) throw new Error("Invalid saved shortcut");
    const oldDefault = ["CommandOrControl+Alt+Control+M", "CommandOrControl+Alt+M"].includes(saved.shortcut);
    config = { ...config, ...validateModelConfig(saved), reasoningEffort: reasoningEffort(saved.reasoningEffort, "medium"), shortcut: typeof saved.shortcut === "string" && !oldDefault ? saved.shortcut : config.shortcut, captureConsent: saved.captureConsent === true, screenContextConsent: saved.screenContextConsent === true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") settingsWarnings.preferences = "Saved settings could not be read. Defaults are in use. Check the model and API URL before saving; your existing settings file is unchanged.";
  }
  if (Object.keys(settingsWarnings).length) pendingSettings = true;
  return previousPreferences;
}

async function loadCredential(previousPreferences: Buffer | null) {
  const epoch = credentialEpoch;
  let importBusy = false;
  try {
    try {
      const encrypted = await readFile(credentialFile());
      if (epoch !== credentialEpoch) return;
      hasSavedKey = true; notifySettings();
      const unlocked = await keychainTask(safeStorage.decryptStringAsync(encrypted));
      if (epoch !== credentialEpoch) return;
      credential = unlocked.result; hasSavedKey = !!credential;
    } catch (error) {
      if (epoch !== credentialEpoch) return;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") settingsWarnings.credential = "The saved API key could not be unlocked. Your encrypted key is unchanged. Unlock your macOS Keychain and restart, enter a replacement key, or remove it.";
    }
    if (epoch !== credentialEpoch) return;
    if (!previousPreferences && hasSavedKey) settingsWarnings.preferences = "The model settings are missing. Review and save the model and API URL before using the saved key.";
    // Explicit local migration for the owner. No .env file or credentials are packaged.
    if (process.env.METAFOR_IMPORT_MODEL === "1" && !credential && process.env.MODEL_API_KEY) {
      let importedConfig: typeof config | null = null;
      try {
        importedConfig = { ...config, ...validateModelConfig({ model: process.env.MODEL_API_MODEL || config.model, baseURL: process.env.MODEL_API_BASE_URL || config.baseURL }) };
      } catch { settingsWarnings.preferences = "The model settings could not be imported. Check the model and API URL in Settings."; }
      if (importedConfig) {
        let preferencesWritten = false;
        try {
          const key = process.env.MODEL_API_KEY.trim();
          if (!key || key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error();
          const encrypted = await encryptKey(key);
          if (epoch !== credentialEpoch) return;
          settingsBusy = true; importBusy = true;
          await atomicWrite(preferenceFile(), JSON.stringify(importedConfig)); preferencesWritten = true;
          await atomicWrite(credentialFile(), encrypted);
          config = importedConfig; credential = key; hasSavedKey = true;
          delete settingsWarnings.preferences; delete settingsWarnings.credential;
          if (!chatReady) pendingSettings = false;
        } catch {
          if (epoch !== credentialEpoch) return;
          settingsWarnings.credential = "The model connection could not be imported. Your previous key remains unchanged. Review the model details and API key in Settings.";
          if (preferencesWritten) {
            try {
              if (previousPreferences) await atomicWrite(preferenceFile(), previousPreferences);
              else await unlink(preferenceFile());
            } catch { settingsWarnings.preferences = "The prior settings file could not be restored. Previous model settings remain active; check available disk space and save Settings again."; }
          }
        }
      }
    }
  } finally {
    if (importBusy) settingsBusy = false;
    if (epoch === credentialEpoch) {
      credentialLoading = false; notifySettings();
      if (Object.keys(settingsWarnings).length) {
        if (chatReady) showSettings(); else pendingSettings = true;
      }
    }
  }
}

function secureWindow(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("metafor://app/")) { event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {}); } });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function createChat() {
  activeMode = "chat";
  if (captureAttempt) clearCapture(captureAttempt, false);
  closeGuidance(); help?.hide();
  if (chat && !chat.isDestroyed()) { chat.show(); chat.focus(); return chat; }
  chat = new BrowserWindow({ width: 1380, height: 900, minWidth: 820, minHeight: 620, backgroundColor: "#000000", title: "Metafor", titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 14 }, webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  secureWindow(chat);
  chat.on("show", () => { if (captureBusy || activeMode === "help") chat?.hide(); });
  const cancelChatRequests = () => { for (const controller of requests.values()) controller.abort(); requests.clear(); };
  chat.webContents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => { if (mainFrame) cancelChatRequests(); });
  chat.webContents.on("render-process-gone", cancelChatRequests);
  chat.webContents.on("destroyed", cancelChatRequests);
  chat.on("closed", () => { cancelChatRequests(); chat = null; });
  void chat.loadURL("metafor://app/index.html");
  return chat;
}

function createHelp() {
  if (help && !help.isDestroyed()) return help;
  const target = helpTargetDisplay();
  help = new BrowserWindow({ ...placeHelpLauncher(target.workArea, helpExpanded, helpHeight), title: "Metafor Help", type: "panel", frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  secureWindow(help);
  help.on("page-title-updated", (event) => event.preventDefault());
  help.on("show", () => { if (captureBusy) help?.hide(); });
  help.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  help.on("close", (event) => { if (!quitting) { event.preventDefault(); hideHelp(); } });
  void help.loadURL("metafor://app/index.html?surface=help");
  return help;
}

function helpTargetDisplay() {
  const display = (helpDisplayId === null ? null : screen.getAllDisplays().find((item) => item.id === helpDisplayId)) ?? targetDisplay(currentHelp.source);
  helpDisplayId = display.id;
  return display;
}
function layoutHelp(payload = guidancePayload) {
  if (!help || help.isDestroyed()) return;
  const area = helpTargetDisplay().workArea;
  const preferred = placeHelpLauncher(area, helpExpanded, helpHeight);
  const frame = payload?.source.screenBounds;
  const targets: Rect[] = frame ? payload!.marks.map((mark) => mark.kind === "rect"
    ? { x: frame.x + mark.x * frame.width, y: frame.y + mark.y * frame.height, width: mark.width * frame.width, height: mark.height * frame.height }
    : { x: frame.x + (mark.x + (mark.kind === "arrow" ? mark.width : 0)) * frame.width - 14,
      y: frame.y + (mark.y + (mark.kind === "arrow" ? mark.height : 0)) * frame.height - 14, width: 28, height: 28 }) : [];
  help.setBounds(placeHelpAvoidingTargets(area, preferred, targets));
  if (guidance && !guidance.isDestroyed() && guidancePayload) {
    guidancePayload = { ...guidancePayload, helpBounds: help.isVisible() ? help.getContentBounds() : undefined };
    guidance.webContents.send("metafor:guidance-layout-changed", guidancePayload);
  }
}
function setHelpLayout(input: { expanded: boolean; height?: number }) {
  if (!input || typeof input.expanded !== "boolean" || Object.keys(input).some((key) => key !== "expanded" && key !== "height")
    || (input.height !== undefined && (typeof input.height !== "number" || !Number.isFinite(input.height) || input.height <= 0))) throw new Error("Choose a valid Help layout.");
  helpExpanded = input.expanded;
  helpHeight = input.height;
  layoutHelp();
}
function showHelp() {
  activeMode = "help";
  if (chat && !chat.isDestroyed()) chat.hide();
  if (captureBusy || selection) return;
  const window = createHelp(); layoutHelp(); window.showInactive(); window.focus();
}
function hideHelp() {
  closeGuidance();
  // A screen refresh temporarily hides Help too. Invalidate its attempt rather
  // than letting a late capture or selection completion reopen dismissed UI.
  if (captureAttempt) clearCapture(captureAttempt, false);
  help?.hide();
}
async function toggleHelp() {
  if (captureAttempt || selection || guidance || (help && !help.isDestroyed() && help.isVisible())) { hideHelp(); return; }
  if (helpRequests.size) { showHelp(); return; }
  await beginCapture();
}
function reopenCurrentMode() {
  if (!windowsReady || captureBusy || captureAttempt || selection || quitting) return;
  if (activeMode === "help") showHelp();
  else if (!guidance) createChat();
}
function broadcastHelp() { help?.webContents.send("metafor:help-session", currentHelp); chat?.webContents.send("metafor:help-session", currentHelp); }
function showSettings() { pendingSettings = true; const win = createChat(); if (!win.webContents.isLoading()) { win.webContents.send("metafor:open-settings"); pendingSettings = false; } }
function showOnboarding() { pendingOnboarding = true; const win = createChat(); if (!win.webContents.isLoading()) { win.webContents.send("metafor:open-onboarding"); pendingOnboarding = false; } }
function nativeError(error: unknown) { const message = error instanceof Error ? error.message : "The operation could not be completed."; dialog.showErrorBox("Metafor", message); }

function registerShortcut(value: string) {
  if (typeof value !== "string" || value.length > 100 || !/(Command|Control|Alt)/.test(value)) throw new Error("Use a shortcut with Command, Control, or Alt.");
  if (globalShortcut.isRegistered(value)) return true;
  try { return globalShortcut.register(value, () => { void toggleHelp().catch(nativeError); }); }
  catch { return false; }
}

async function captureConsent(mode: "screen" | "region", attempt: CaptureAttempt) {
  if (mode === "screen" ? config.screenContextConsent : config.captureConsent) return true;
  const result = await dialog.showMessageBox({ type: "info", title: "Share screen context", message: mode === "screen" ? "Let Metafor Help see your current screen" : "Choose exactly what Metafor Help sees", detail: mode === "screen" ? "Metafor captures one still frame of this display when Help opens. Sending a normal Help question captures the display again and shares that frame with your configured AI provider. Annotations stay attached to their original image. You can narrow sharing to a region. Before drawing guidance, one local frame checks that the screen still matches; that check is not sent. There is no continuous recording or computer control." : "Metafor captures one still frame so you can choose a region. Only your selected region is sent when you ask a question. Before drawing guidance, one local frame checks that region still matches; that check is not sent. There is no continuous recording or computer control.", buttons: [mode === "screen" ? "Use this screen" : "Choose a region", "Cancel"], defaultId: 0, cancelId: 1 });
  if (captureAttempt !== attempt || result.response !== 0) return false;
  const proposed = { ...config, ...(mode === "screen" ? { screenContextConsent: true } : { captureConsent: true }) };
  await atomicWrite(preferenceFile(), JSON.stringify(proposed)); config = proposed;
  return true;
}

function targetDisplay(source?: HelpSource | null) {
  const previous = source?.screenBounds?.displayId;
  return (previous ? screen.getAllDisplays().find((display) => String(display.id) === previous) : null)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

async function captureFrame(attempt: CaptureAttempt, target: Electron.Display, dismissGuidance = true) {
  if (dismissGuidance) closeGuidance();
  // Only our own windows are hidden. Other applications are never controlled.
  attempt.restore = [chat, help].filter((window): window is BrowserWindow => !!window && !window.isDestroyed() && window.isVisible());
  for (const window of attempt.restore) window.hide();
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (captureAttempt !== attempt) return null;
  try {
    const helper = path.join(__dirname, "native", "source-info");
    const result = await run(helper, ["--exclude-pid", String(process.pid), "--display-id", String(target.id)], { timeout: 2000, maxBuffer: 8192 });
    const info = JSON.parse(result.stdout); sourceInfo = { appName: String(info.appName || "Screen").slice(0, 300), title: String(info.windowTitle || "Visible screen").slice(0, 500) };
  } catch { sourceInfo = { appName: "Screen", title: "Visible screen" }; }
  if (captureAttempt !== attempt) return null;
  let sources;
  try { sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.min(3200, Math.round(target.size.width * target.scaleFactor)), height: Math.min(2400, Math.round(target.size.height * target.scaleFactor)) } }); }
  catch { throw new Error("Allow Metafor in System Settings → Privacy & Security → Screen Recording, then quit and reopen Metafor. Your screen has not been sent."); }
  if (captureAttempt !== attempt) return null;
  const nativeSource = sources.find((source) => source.display_id === String(target.id));
  if (systemPreferences.getMediaAccessStatus("screen") !== "granted" || !nativeSource || nativeSource.thumbnail.isEmpty()) throw new Error("The display could not be captured. Allow Metafor in System Settings → Privacy & Security → Screen Recording, then quit and reopen Metafor. Your screen has not been sent.");
  const size = nativeSource.thumbnail.getSize();
  const source: HelpSource = { id: crypto.randomUUID(), image: nativeSource.thumbnail.toDataURL(), width: size.width, height: size.height, capturedAt: new Date().toISOString(), ...sourceInfo, screenBounds: { ...target.bounds, displayId: String(target.id) } };
  return { source, display: target };
}

async function beginCapture(mode: "screen" | "region" = "screen") {
  if (mode !== "screen" && mode !== "region") throw new Error("Choose screen or region sharing.");
  if (captureBusy || selection) return;
  if (settingsBusy) throw new Error("Wait for the current settings change before sharing screen context.");
  if (helpRequests.size) throw new Error("Stop the current Help answer before choosing another source.");
  const target = targetDisplay();
  const attempt: CaptureAttempt = { restore: [], overlay: null };
  captureAttempt = attempt; captureBusy = true;
  try {
    if (!await captureConsent(mode, attempt)) { clearCapture(attempt, true); return; }
    if (captureAttempt !== attempt) return;
    const frame = await captureFrame(attempt, target);
    if (!frame || captureAttempt !== attempt) return;
    if (mode === "screen") {
      const nextHelp = emptyHelp();
      nextHelp.source = frame.source; nextHelp.sources = [frame.source]; nextHelp.contextMode = "screen";
      nextHelp.title = `About ${frame.source.appName}`;
      helpDisplayId = target.id; helpExpanded = false;
      currentHelp = nextHelp; clearCapture(attempt, false); showHelp(); broadcastHelp();
      return;
    }
    captureDisplay = target; captureSource = frame.source;
    capture = { image: frame.source.image, width: frame.source.width, height: frame.source.height, displayId: String(target.id) };
    selection = new BrowserWindow({ ...target.bounds, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, backgroundColor: "#000", webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    attempt.overlay = selection;
    secureWindow(selection); selection.setAlwaysOnTop(true, "screen-saver");
    selection.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    selection.on("closed", () => clearCapture(attempt, true));
    selection.webContents.on("render-process-gone", () => {
      if (captureAttempt !== attempt) return;
      clearCapture(attempt, true);
      if (!quitting) nativeError(new Error("The screen selection stopped unexpectedly. Your screen was not sent. Try again."));
    });
    try { await selection.loadURL("metafor://app/index.html?surface=selection"); }
    catch (error) { throw new Error("The screen selection could not open. Your screen was not sent. Try again.", { cause: error }); }
    if (captureAttempt === attempt) attempt.overlay.focus();
  } catch (error) {
    if (captureAttempt !== attempt) return;
    clearCapture(attempt, true); throw error;
  } finally { if (captureAttempt === attempt) captureBusy = false; }
}

async function refreshHelpScreen(selectedSession: HelpSession, signal: AbortSignal) {
  if (captureBusy || selection || settingsBusy) throw new Error("Finish the current screen selection or settings change before asking.");
  const target = targetDisplay(selectedSession.source);
  const attempt: CaptureAttempt = { restore: [], overlay: null };
  captureAttempt = attempt; captureBusy = true;
  try {
    if (!await captureConsent("screen", attempt)) throw new Error("Screen sharing was canceled. Your question is kept.");
    signal.throwIfAborted();
    const frame = await captureFrame(attempt, target);
    signal.throwIfAborted();
    if (!frame) throw new Error("Screen sharing stopped. Your question is kept.");
    return frame.source;
  } finally { clearCapture(attempt, true); }
}

function useHelpSource(selectedSession: HelpSession, source: HelpSource) {
  const previous = selectedSession.source;
  if (previous) selectedSession.messages = selectedSession.messages.map((message) => message.sourceId ? message : { ...message, sourceId: previous.id });
  const sources = new Map((selectedSession.sources ?? []).map((entry) => [entry.id, entry]));
  if (previous) sources.set(previous.id, previous);
  const existing = [...sources.values()].find((entry) => entry.image === source.image && entry.width === source.width && entry.height === source.height && JSON.stringify(entry.screenBounds) === JSON.stringify(source.screenBounds));
  const next = existing ?? source;
  sources.set(next.id, next); selectedSession.sources = [...sources.values()]; selectedSession.source = next;
}

function clearCapture(attempt: CaptureAttempt, restore: boolean) {
  if (captureAttempt !== attempt) return;
  captureAttempt = null; captureBusy = false;
  selection = null; capture = null; captureDisplay = null; captureSource = null;
  if (attempt.overlay && !attempt.overlay.isDestroyed()) attempt.overlay.close();
  if (restore && !quitting) for (const window of attempt.restore) {
    if (!window.isDestroyed() && (window !== chat || activeMode !== "help")) window.showInactive();
  }
}

async function selectRegion(rect: CropRect) {
  if (!capture || !captureDisplay || !captureSource || !captureAttempt) throw new Error("The screen selection expired. Capture again.");
  const pixel = cropToPixels(rect, capture.width, capture.height);
  if (pixel.width < 8 || pixel.height < 8) throw new Error("Select a slightly larger area.");
  const image = nativeImage.createFromDataURL(capture.image).crop(pixel);
  const display = captureDisplay;
  const region = { x: display.bounds.x + pixel.x / capture.width * display.bounds.width, y: display.bounds.y + pixel.y / capture.height * display.bounds.height, width: pixel.width / capture.width * display.bounds.width, height: pixel.height / capture.height * display.bounds.height };
  const screenBounds = { x: Math.floor(region.x), y: Math.floor(region.y), width: Math.ceil(region.x + region.width) - Math.floor(region.x), height: Math.ceil(region.y + region.height) - Math.floor(region.y), displayId: String(display.id) };
  const nextHelp = emptyHelp();
  nextHelp.source = { id: crypto.randomUUID(), image: `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}`, width: pixel.width, height: pixel.height, appName: captureSource.appName, title: captureSource.title, capturedAt: captureSource.capturedAt, screenBounds };
  nextHelp.sources = [nextHelp.source]; nextHelp.contextMode = "source";
  nextHelp.title = `About ${sourceInfo.appName}`;
  helpDisplayId = display.id; helpExpanded = false;
  currentHelp = nextHelp;
  // Full-screen pixels are discarded after cropping. Unsent sources remain in memory only.
  clearCapture(captureAttempt, false);
  showHelp(); broadcastHelp();
}

function syncGuidanceBounds(window: BrowserWindow) {
  if (guidance !== window || window.isDestroyed() || !guidancePayload) return;
  const viewportBounds = window.getContentBounds();
  const helpBounds = help && !help.isDestroyed() && help.isVisible() ? help.getContentBounds() : undefined;
  if (JSON.stringify(viewportBounds) === JSON.stringify(guidancePayload.viewportBounds) && JSON.stringify(helpBounds) === JSON.stringify(guidancePayload.helpBounds)) return;
  guidancePayload = { ...guidancePayload, viewportBounds, helpBounds };
  window.webContents.send("metafor:guidance-layout-changed", guidancePayload);
}
function closeGuidance() {
  guidanceEpoch++;
  if (guidanceTimer) clearTimeout(guidanceTimer);
  guidanceTimer = null;
  const observer = guidanceObserver; guidanceObserver = null;
  observer?.stop();
  const previous = guidance; guidance = null; guidancePayload = null;
  if (previous && !previous.isDestroyed()) previous.close();
  if (previous && help && !help.isDestroyed()) help.webContents.send("metafor:guidance-changed", false);
}

async function verifyGuidanceSource(source: HelpSource, marks: VisualMark[], epoch: number) {
  const changed = "Screen changed. Ask again to place guidance.";
  if (captureBusy || selection || settingsBusy) throw new Error("Finish the current screen selection before showing guidance.");
  const bounds = source.screenBounds;
  const target = bounds ? screen.getAllDisplays().find((display) => String(display.id) === bounds.displayId) : null;
  if (!bounds || !target || bounds.x < target.bounds.x || bounds.y < target.bounds.y
    || bounds.x + bounds.width > target.bounds.x + target.bounds.width || bounds.y + bounds.height > target.bounds.y + target.bounds.height) throw new Error(changed);
  const attempt: CaptureAttempt = { restore: [], overlay: null };
  captureAttempt = attempt; captureBusy = true;
  let verified = false;
  try {
    // This one-shot comparison stays local. It is never added to history or sent.
    const frame = await captureFrame(attempt, target, false);
    if (!frame || guidanceEpoch !== epoch) return null;
    const known = (name: string) => !["Screen", "Unknown application"].includes(name);
    if (known(source.appName) && known(frame.source.appName) && (source.appName !== frame.source.appName || source.title !== frame.source.title)) throw new Error(changed);
    const crop = cropToPixels({ x: (bounds.x - target.bounds.x) / target.bounds.width, y: (bounds.y - target.bounds.y) / target.bounds.height, width: bounds.width / target.bounds.width, height: bounds.height / target.bounds.height }, frame.source.width, frame.source.height);
    const current = nativeImage.createFromDataURL(frame.source.image).crop(crop);
    const original = nativeImage.createFromDataURL(source.image);
    // Magnify native target crops before comparing, so small moved controls do
    // not disappear in a whole-display thumbnail. All targets must still match.
    for (const region of marks.flatMap((mark) => guidanceCheckRegions(mark, bounds))) {
      const before = original.crop(cropToPixels(region, source.width, source.height)).resize({ width: 128, height: 128 }).toBitmap();
      const after = current.crop(cropToPixels(region, crop.width, crop.height)).resize({ width: 128, height: 128 }).toBitmap();
      if (!sameVisibleRegion(before, after, 128, 128)) throw new Error(changed);
    }
    if (!sameGuidanceBackdrop(original.resize({ width: 128, height: 128 }).toBitmap(), current.resize({ width: 128, height: 128 }).toBitmap(), 128, 128)) throw new Error(changed);
    verified = true;
    return bounds;
  } finally {
    // Chat must not cover the source we just verified. Failures restore it.
    if (verified) attempt.restore = attempt.restore.filter((window) => window !== chat);
    clearCapture(attempt, true);
  }
}

async function showGuidance(input: { sessionId: string; messageId: string }) {
  if (!input || typeof input.sessionId !== "string" || typeof input.messageId !== "string") throw new Error("Choose an answer with visual guidance.");
  closeGuidance();
  const epoch = guidanceEpoch;
  const saved = currentHelp.id === input.sessionId ? currentHelp : await store.get(input.sessionId);
  if (guidanceEpoch !== epoch) return;
  const message = saved?.messages.find((entry) => entry.id === input.messageId && entry.role === "assistant");
  if (!saved || !message) throw new Error("This Help answer is no longer available.");
  const source = message.sourceId ? [saved.source, ...(saved.sources ?? [])].find((entry) => entry?.id === message.sourceId) : saved.source;
  if (!source) throw new Error("The source for this answer is no longer available.");
  const marks = validateMarks(message.marks ?? []);
  if (!marks.length) throw new Error("This answer has no visual guidance.");
  const frame = await verifyGuidanceSource(source, marks, epoch);
  if (!frame || guidanceEpoch !== epoch) return;
  layoutHelp({ source, marks, answer: message.text });
  // Full-display guidance must avoid macOS clamping the overlay below the menu bar.
  const window = new BrowserWindow({ x: frame.x, y: frame.y, width: frame.width, height: frame.height, title: "Metafor Guidance", type: "panel", frame: false, roundedCorners: false, enableLargerThanScreen: true, transparent: true, backgroundColor: "#00000000", hasShadow: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  guidance = window; guidancePayload = { source, marks, answer: message.text, viewportBounds: window.getContentBounds(), helpBounds: help && !help.isDestroyed() && help.isVisible() ? help.getContentBounds() : undefined };
  secureWindow(window); window.setAlwaysOnTop(true, "floating");
  window.on("page-title-updated", (event) => event.preventDefault());
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on("show", () => syncGuidanceBounds(window));
  window.on("move", () => syncGuidanceBounds(window));
  window.on("resize", () => syncGuidanceBounds(window));
  window.on("closed", () => { if (guidance === window) closeGuidance(); });
  window.webContents.on("render-process-gone", () => { if (guidance === window) closeGuidance(); });
  try {
    // spawn needs a real filesystem path; unlike execFile it cannot execute
    // through Electron's virtual ASAR path even when the binary is unpacked.
    const nativeRoot = __dirname.endsWith(".asar") ? `${__dirname}.unpacked` : __dirname;
    const observer = observeGuidance(path.join(nativeRoot, "native", "guidance-observer"), process.pid, () => { if (guidance === window) closeGuidance(); });
    guidanceObserver = observer;
    await observer.ready;
    if (guidance !== window || window.isDestroyed()) return;
    await window.loadURL("metafor://app/index.html?surface=guidance");
    if (guidance !== window || window.isDestroyed()) return;
    window.showInactive();
    syncGuidanceBounds(window);
    if (help && !help.isDestroyed()) help.webContents.send("metafor:guidance-changed", true);
    if (help && !help.isDestroyed() && help.isVisible()) help.moveTop();
    guidanceTimer = setTimeout(() => { if (guidance === window) closeGuidance(); }, 12000);
    guidanceTimer.unref?.();
  } catch { if (guidance === window) closeGuidance(); throw new Error("The visual explanation could not open safely. Your answer is still in Help."); }
}

function authorize(event: IpcMainInvokeEvent, surfaces: ("chat" | "help" | "selection" | "guidance")[]) {
  const windows = { chat, help, selection, guidance };
  if (event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith("metafor://app/") || !surfaces.some((name) => windows[name]?.webContents === event.sender)) throw new Error("This operation is only available inside Metafor.");
}

function handle(name: string, surfaces: ("chat" | "help" | "selection" | "guidance")[], action: (...args: any[]) => any) {
  ipcMain.handle(`metafor:${name}`, async (event, ...args) => { authorize(event, surfaces); return action(...args); });
}

function installIPC() {
  handle("onboarding-complete", ["chat"], async () => {
    try { return JSON.parse(await readFile(path.join(app.getPath("userData"), "onboarding.json"), "utf8"))?.completed === true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Metafor quick start state could not be read; the guide will be shown again.");
      return false;
    }
  });
  handle("complete-onboarding", ["chat"], async () => {
    try { await atomicWrite(path.join(app.getPath("userData"), "onboarding.json"), JSON.stringify({ completed: true })); }
    catch { throw new Error("Quick start could not be saved. Try again, or close it for now."); }
  });
  handle("settings", ["chat", "help"], settings);
  handle("list-models", ["chat", "help"], listModels);
  handle("select-model", ["chat", "help"], async (choiceId) => {
    if (typeof choiceId !== "string" || choiceId.length > 80) throw new Error("Choose a model from the list.");
    if (settingsBusy) throw new Error("Wait for the current settings change to finish.");
    if (requests.size || helpRequests.size) throw new Error("Finish or stop the current answer before changing models.");
    settingsBusy = true;
    try {
      const choice = (await listModels()).choices.find((item) => item.id === choiceId);
      if (!choice) throw new Error("That model is not available for this API key. Refresh the list and choose another.");
      const proposed = { ...config, model: choice.model, reasoningEffort: choice.reasoningEffort };
      try { await atomicWrite(preferenceFile(), JSON.stringify(proposed)); }
      catch { throw new Error("Your model choice could not be saved. The previous choice is still active."); }
      config = proposed; notifySettings(); return settings();
    } finally { settingsBusy = false; }
  });
  handle("save-settings", ["chat"], async (input) => {
    if (credentialLoading) throw new Error(loadingMessage);
    if (captureBusy || selection) throw new Error("Finish the screen capture before changing settings.");
    if (settingsBusy) throw new Error("Wait for the current settings change to finish.");
    const next = validateModelConfig(input);
    if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 4096 || /[\r\n\0]/.test(input.apiKey))) throw new Error("The API key is invalid.");
    if (!credential && !hasSavedKey && !input.apiKey?.trim()) throw new Error("Enter your API key to connect Metafor.");
    if (typeof input.shortcut !== "string") throw new Error("Choose a valid shortcut.");
    settingsBusy = true;
    const previous = config;
    const proposed = { ...config, ...next, reasoningEffort: next.model === config.model && next.baseURL === config.baseURL ? config.reasoningEffort : "medium" as ReasoningEffort, shortcut: input.shortcut };
    let previousPreferences: Buffer | null = null;
    let preferencesWritten = false;
    let shortcutReserved = false;
    try {
      const encrypted = input.apiKey?.trim() ? await encryptKey(input.apiKey.trim()) : null;
      if (!registerShortcut(input.shortcut)) throw new Error("This shortcut is unavailable. Choose another combination.");
      shortcutReserved = true;
      try { previousPreferences = await readFile(preferenceFile()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await atomicWrite(preferenceFile(), JSON.stringify(proposed)); preferencesWritten = true;
      if (encrypted) await atomicWrite(credentialFile(), encrypted);
      config = proposed; modelCatalog = null; delete settingsWarnings.preferences;
      if (encrypted) { credential = input.apiKey.trim(); hasSavedKey = true; delete settingsWarnings.credential; }
      if (previous.shortcut !== proposed.shortcut) globalShortcut.unregister(previous.shortcut);
      shortcutRegistered = true; notifySettings();
      return settings();
    } catch (error) {
      if (shortcutReserved && proposed.shortcut !== previous.shortcut) globalShortcut.unregister(proposed.shortcut);
      if (preferencesWritten) {
        try { if (previousPreferences) await atomicWrite(preferenceFile(), previousPreferences); else await unlink(preferenceFile()); }
        catch { throw new Error("Settings could not be saved or restored on disk. Your previous shortcut and key remain active; check available disk space and save again."); }
      }
      throw new Error("Settings could not be saved. Check your Keychain and shortcut; your previous key and settings remain active.", { cause: error });
    } finally { settingsBusy = false; }
  });
  handle("remove-key", ["chat"], async () => {
    if (settingsBusy) throw new Error("Wait for the current settings change to finish.");
    settingsBusy = true; credentialEpoch++;
    try {
      try { await unlink(credentialFile()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      credential = ""; hasSavedKey = false; modelCatalog = null; delete settingsWarnings.credential;
    } catch {
      settingsWarnings.credential = "The saved key could not be removed. Check local file access and try again.";
      throw new Error(settingsWarnings.credential);
    } finally { credentialLoading = false; settingsBusy = false; notifySettings(); }
    return settings();
  });
  handle("open-settings", ["chat", "help"], showSettings);
  handle("open-help", ["chat", "help"], showHelp);
  handle("hide-help", ["help"], hideHelp);
  handle("set-help-layout", ["help"], setHelpLayout);
  handle("capture", ["chat", "help"], beginCapture);
  handle("get-capture", ["selection"], () => capture);
  handle("select-capture", ["selection"], selectRegion);
  handle("cancel-capture", ["selection"], () => { if (captureAttempt) clearCapture(captureAttempt, true); });
  handle("show-guidance", ["chat", "help"], (input) => {
    // A reply may finish after dismissal and ask to show its marks. Keep the
    // saved reply, but do not put guidance back over the user's screen.
    if (activeMode === "help" && (!help || help.isDestroyed() || !help.isVisible())) return;
    return showGuidance(input);
  });
  handle("get-guidance", ["guidance"], () => {
    if (guidance) syncGuidanceBounds(guidance);
    return guidancePayload;
  });
  handle("close-guidance", ["chat", "help", "guidance"], closeGuidance);
  handle("help-session", ["help"], () => currentHelp);
  handle("list-help", ["chat", "help"], () => store.list());
  handle("get-help", ["chat", "help"], (id) => currentHelp.id === id ? currentHelp : typeof id === "string" && id.startsWith("help-") ? store.get(id) : null);
  handle("new-help", ["help"], () => { if (helpRequests.size) throw new Error("Stop the current answer first."); closeGuidance(); currentHelp = emptyHelp(); broadcastHelp(); return currentHelp; });
  handle("resume-help", ["chat", "help"], async (id) => { if (helpRequests.size) throw new Error("Stop the current answer first."); const saved = await store.get(id); if (!saved) throw new Error("This exchange no longer exists."); currentHelp = saved; broadcastHelp(); return saved; });
  handle("delete-help", ["help"], async (id) => { if (helpRequests.has(id)) throw new Error("Stop the answer before deleting this exchange."); await store.delete(id); if (currentHelp.id === id) { currentHelp = emptyHelp(); broadcastHelp(); } });
  handle("cancel-help", ["help"], (id) => helpRequests.get(id)?.abort());
  handle("ask-help", ["help"], async (input) => {
    if (credentialLoading) throw new Error(loadingMessage);
    if (settingsWarnings.preferences) throw new Error(recoveryMessage);
    if (settingsBusy) throw new Error("Wait for the model settings change to finish, then send your question.");
    if (!input || input.sessionId !== currentHelp.id || helpRequests.size) throw new Error("Wait for the current answer or select the source again.");
    if (input.refreshScreen !== undefined && typeof input.refreshScreen !== "boolean") throw new Error("Choose whether to use the current screen.");
    if (input.sourceId !== undefined && typeof input.sourceId !== "string") throw new Error("Choose a valid annotation source.");
    const selectedSession = structuredClone(currentHelp);
    const requestConfig = { ...config, apiKey: credential };
    let questionSource = selectedSession.source;
    const marks = validateMarks(input.marks);
    if (input.refreshScreen && (marks.length || input.sourceId)) throw new Error("Annotations stay attached to their original image. Ask about the annotation without refreshing the screen.");
    if (input.sourceId) {
      const pinned = [selectedSession.source, ...(selectedSession.sources ?? [])].find((source) => source?.id === input.sourceId);
      if (!pinned) throw new Error("The source for this annotation is no longer available.");
      questionSource = pinned;
    }
    if (!selectedSession.source && !input.refreshScreen) throw new Error("Use your current screen or select a source first.");
    const controller = new AbortController(); helpRequests.set(selectedSession.id, controller);
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      if (input.refreshScreen) {
        useHelpSource(selectedSession, await refreshHelpScreen(selectedSession, controller.signal));
        selectedSession.contextMode = "screen"; questionSource = selectedSession.source;
      }
      controller.signal.throwIfAborted();
      assertHelpAnswerCapacity(selectedSession);
      const result = await answerHelp({ ...selectedSession, source: questionSource }, input.question, marks, requestConfig, controller.signal);
      controller.signal.throwIfAborted();
      const now = new Date().toISOString();
      const sourceId = questionSource!.id;
      selectedSession.messages.push({ id: crypto.randomUUID(), role: "user", text: input.question.trim(), createdAt: now, marks, sourceId }, { id: crypto.randomUUID(), role: "assistant", text: result.text, createdAt: now, marks: result.marks, sourceId });
      if (!selectedSession.messages.slice(0, -2).length) selectedSession.title = input.question.trim().slice(0, 90);
      selectedSession.updatedAt = now;
      await store.save(selectedSession);
      if (currentHelp.id === selectedSession.id) { currentHelp = selectedSession; broadcastHelp(); }
      return selectedSession;
    } catch (error) { if (controller.signal.aborted) throw new Error("The answer stopped or timed out. Your question is kept."); throw error; }
    finally { clearTimeout(timer); helpRequests.delete(selectedSession.id); }
  });
  handle("help-in-chat", ["chat", "help"], async (id) => {
    const saved = id === currentHelp.id ? currentHelp : await store.get(id);
    if (!saved || !saved.messages.length) throw new Error("Ask about the selection before continuing in Chat.");
    await store.save(saved);
    pendingConversation = serializeSnapshot(snapshotFromHelp(saved));
    const window = createChat();
    if (!window.webContents.isLoading()) { window.webContents.send("metafor:open-conversation", pendingConversation); pendingConversation = null; }
  });
  handle("cancel-answer", ["chat"], (id) => requests.get(id)?.abort());
  handle("api", ["chat"], async (input) => {
    if (input?.path === "/api/status") return { status: 200, body: { ...getProviderStatus(environment()), credentialLoading } };
    if (input?.path !== "/api/answer") throw new Error("Unknown app request.");
    let id = "";
    let ownedController: AbortController | null = null;
    try {
      if (credentialLoading) throw new AnswerError("credential_loading", loadingMessage, 503, true);
      if (settingsWarnings.preferences) throw new AnswerError("settings_recovery", recoveryMessage, 503);
      if (settingsBusy) throw new AnswerError("settings_busy", "Wait for the model settings change to finish, then retry.", 503, true);
      const requestEnvironment = environment();
      const request = validateAnswerRequest(input.body); id = request.requestId;
      if (requests.size) throw new AnswerError("busy", "An answer is already running.", 429, true);
      const controller = new AbortController(); ownedController = controller; requests.set(id, controller);
      const sourceSession = request.conversation.id.startsWith("help-") ? await store.get(request.conversation.id) : null;
      const sourceContent = sourceSession ? chatSourceContent(sourceSession, request) : [];
      const fetchWithSource: typeof fetch = async (url, init) => {
        const data = JSON.parse(String(init?.body));
        if (sourceContent.length && data.response_format?.json_schema?.name === "metafor_answer") {
          const last = data.messages[data.messages.length - 1];
          last.content = [{ type: "text", text: last.content }, ...sourceContent];
        }
        return fetch(url, { ...init, body: JSON.stringify(data) });
      };
      const body = await generateAnswer(request, { env: requestEnvironment, fetch: fetchWithSource }, controller.signal);
      return { status: 200, body };
    } catch (error) {
      const safe = error instanceof AnswerError ? error : new AnswerError("desktop_error", "The answer could not finish. Your question is kept.", 500, true);
      return { status: safe.status, body: { error: safe.message, code: safe.code, retryable: safe.retryable } };
    } finally { if (id && ownedController && requests.get(id) === ownedController) requests.delete(id); }
  });
  ipcMain.handle("metafor:ready", (event) => {
    authorize(event, ["chat", "help", "selection", "guidance"]);
    if (event.sender === chat?.webContents) {
      chatReady = true;
      if (pendingConversation) { event.sender.send("metafor:open-conversation", pendingConversation); pendingConversation = null; }
      if (pendingOnboarding) { event.sender.send("metafor:open-onboarding"); pendingOnboarding = false; }
      if (pendingSettings) { event.sender.send("metafor:open-settings"); pendingSettings = false; }
    }
    if (event.sender === help?.webContents) broadcastHelp();
  });
}

async function importConversation() {
  const result = await dialog.showOpenDialog({ title: "Import a web conversation", properties: ["openFile"], filters: [{ name: "Metafor conversation", extensions: ["ingx", "json"] }] });
  if (result.canceled) return;
  const incoming = parseSnapshot(await readFile(result.filePaths[0], "utf8"));
  // External files cannot claim a local Help attachment by reusing its ID.
  incoming.conversation.id = `space-${crypto.randomUUID()}`;
  pendingConversation = serializeSnapshot(incoming);
  const window = createChat(); if (!window.webContents.isLoading()) { window.webContents.send("metafor:open-conversation", pendingConversation); pendingConversation = null; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", reopenCurrentMode);
  app.whenReady().then(async () => {
    const previousPreferences = await loadPreferences(); store = new HelpStore(path.join(app.getPath("userData"), "Help"));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle("metafor", async (request) => {
      const url = new URL(request.url);
      if (url.host !== "app" || request.method !== "GET") return new Response("Not found", { status: 404 });
      let pathname: string; try { pathname = decodeURIComponent(url.pathname); } catch { return new Response("Invalid path", { status: 400 }); }
      const file = path.resolve(rendererRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(`${rendererRoot}${path.sep}`)) return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
      return new Response(response.body, { status: response.status, headers });
    });
    installIPC();
    shortcutRegistered = registerShortcut(config.shortcut);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "Metafor", submenu: [{ role: "about" }, { label: "Quick start…", click: showOnboarding }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: showSettings }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
      { label: "File", submenu: [{ label: "Metafor Chat", accelerator: "CmdOrCtrl+1", click: () => createChat() }, { label: "Metafor Help", accelerator: "CmdOrCtrl+2", click: showHelp }, { label: "Use Current Screen…", click: () => void beginCapture().catch(nativeError) }, { label: "Select Screen Region…", click: () => void beginCapture("region").catch(nativeError) }, { type: "separator" }, { label: "Import Conversation…", accelerator: "CmdOrCtrl+O", click: () => void importConversation().catch(nativeError) }, { role: "close" }] },
      { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    ]));
    const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")); icon.setTemplateImage(true);
    tray = new Tray(icon); tray.setToolTip("Metafor Help"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Use current screen", click: () => void beginCapture().catch(nativeError) }, { label: "Select screen region", click: () => void beginCapture("region").catch(nativeError) }, { label: "Metafor Help", click: showHelp }, { label: "Metafor Chat", click: () => createChat() }, { type: "separator" }, { role: "quit" }]));
    windowsReady = true; createChat();
    void loadCredential(previousPreferences);
    app.on("activate", reopenCurrentMode);
  }).catch((error) => { nativeError(error); app.quit(); });
}
app.on("window-all-closed", () => { /* The menu-bar Help companion stays available. */ });
app.on("before-quit", () => { quitting = true; closeGuidance(); if (captureAttempt) clearCapture(captureAttempt, false); for (const controller of [...requests.values(), ...helpRequests.values()]) controller.abort(); globalShortcut.unregisterAll(); });

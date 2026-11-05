import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./shared";

const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`metafor:${name}`, ...args);
const subscribe = (name: string, callback: (data: any) => void) => {
  const listener = (_event: unknown, data: unknown) => callback(data);
  ipcRenderer.on(`metafor:${name}`, listener);
  return () => { ipcRenderer.removeListener(`metafor:${name}`, listener); };
};
const bridge: DesktopBridge = {
  api: (request) => invoke("api", request), cancelAnswer: (id) => invoke("cancel-answer", id),
  getSettings: () => invoke("settings"), saveSettings: (settings) => invoke("save-settings", settings), removeKey: () => invoke("remove-key"),
  openSettings: () => invoke("open-settings"), openHelp: () => invoke("open-help"), hideHelp: () => invoke("hide-help"),
  captureScreen: () => invoke("capture"), getCapture: () => invoke("get-capture"), selectCapture: (rect) => invoke("select-capture", rect), cancelCapture: () => invoke("cancel-capture"),
  getHelpSession: () => invoke("help-session"), listHelp: () => invoke("list-help"), getHelp: (id) => invoke("get-help", id),
  askHelp: (request) => invoke("ask-help", request), cancelHelp: (id) => invoke("cancel-help", id), newHelp: () => invoke("new-help"), resumeHelp: (id) => invoke("resume-help", id), deleteHelp: (id) => invoke("delete-help", id),
  openHelpInChat: (id) => invoke("help-in-chat", id), ready: () => invoke("ready"),
  onSettingsChanged: (cb) => subscribe("settings-changed", cb),
  onOpenConversation: (cb) => subscribe("open-conversation", cb), onHelpSession: (cb) => subscribe("help-session", cb), onCapture: (cb) => subscribe("capture", cb), onOpenSettings: (cb) => subscribe("open-settings", cb),
};
contextBridge.exposeInMainWorld("metaforDesktop", bridge);

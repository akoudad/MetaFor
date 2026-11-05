export type VisualMark = {
  id: string;
  kind: "rect" | "arrow" | "point";
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type HelpSource = {
  id: string;
  image: string;
  capturedAt: string;
  appName: string;
  title: string;
  width: number;
  height: number;
};

export type HelpMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  marks?: VisualMark[];
};

export type HelpSession = {
  id: string;
  title: string;
  source: HelpSource | null;
  messages: HelpMessage[];
  createdAt: string;
  updatedAt: string;
};

export type CapturePayload = { image: string; width: number; height: number; displayId: string };
export type CropRect = { x: number; y: number; width: number; height: number };
export type DesktopSettings = {
  configured: boolean;
  hasSavedKey?: boolean;
  credentialLoading?: boolean;
  model: string;
  baseURL: string;
  shortcut: string;
  shortcutRegistered: boolean;
  screenPermission: string;
  storagePath: string;
  warnings?: { preferences?: string; credential?: string };
};

export interface DesktopBridge {
  api(request: { path: "/api/status" | "/api/answer"; body?: unknown; requestId?: string }): Promise<{ status: number; body: unknown }>;
  cancelAnswer(requestId: string): Promise<void>;
  getSettings(): Promise<DesktopSettings>;
  saveSettings(settings: { apiKey?: string; model: string; baseURL: string; shortcut: string }): Promise<DesktopSettings>;
  removeKey(): Promise<DesktopSettings>;
  openSettings(): Promise<void>;
  openHelp(): Promise<void>;
  hideHelp(): Promise<void>;
  captureScreen(): Promise<void>;
  getCapture(): Promise<CapturePayload | null>;
  selectCapture(rect: CropRect): Promise<void>;
  cancelCapture(): Promise<void>;
  getHelpSession(): Promise<HelpSession>;
  listHelp(): Promise<{ id: string; title: string; updatedAt: string }[]>;
  getHelp(id: string): Promise<HelpSession | null>;
  askHelp(request: { sessionId: string; question: string; marks: VisualMark[] }): Promise<HelpSession>;
  cancelHelp(sessionId: string): Promise<void>;
  newHelp(): Promise<HelpSession>;
  resumeHelp(id: string): Promise<HelpSession>;
  deleteHelp(id: string): Promise<void>;
  openHelpInChat(sessionId: string): Promise<void>;
  onOpenConversation(callback: (snapshot: string) => void): () => void;
  onHelpSession(callback: (session: HelpSession) => void): () => void;
  onCapture(callback: (capture: CapturePayload) => void): () => void;
  onSettingsChanged?(callback: (settings: DesktopSettings) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  ready(): Promise<void>;
}

declare global {
  interface Window { metaforDesktop: DesktopBridge }
}

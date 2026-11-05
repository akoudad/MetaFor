import type { ReasoningEffort } from "../src/lib/reasoning";

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
  screenBounds?: { x: number; y: number; width: number; height: number; displayId: string };
};

export type HelpMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  marks?: VisualMark[];
  sourceId?: string;
};

export type HelpSession = {
  id: string;
  title: string;
  source: HelpSource | null;
  sources?: HelpSource[];
  contextMode?: "screen" | "source";
  messages: HelpMessage[];
  createdAt: string;
  updatedAt: string;
};

export type HelpHistoryItem = {
  id: string;
  title: string;
  updatedAt: string | null;
  status?: "unreadable";
};

export type CapturePayload = { image: string; width: number; height: number; displayId: string };
export type GuidancePayload = {
  source: HelpSource;
  marks: VisualMark[];
  answer: string;
  /** Actual native content bounds; macOS can move a requested window below the menu bar. */
  viewportBounds?: { x: number; y: number; width: number; height: number };
  /** Visible Help window in screen points; labels must leave its controls clear. */
  helpBounds?: { x: number; y: number; width: number; height: number };
};
export type CropRect = { x: number; y: number; width: number; height: number };
export type ModelChoice = {
  id: string;
  model: string;
  name: string;
  mode: "Fast" | "Balanced" | "Deep";
  reasoningEffort: ReasoningEffort;
  description: string;
};
export type ModelCatalog = { choices: ModelChoice[]; message?: string };
export type DesktopSettings = {
  configured: boolean;
  hasSavedKey?: boolean;
  credentialLoading?: boolean;
  model: string;
  reasoningEffort?: ReasoningEffort;
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
  listModels(): Promise<ModelCatalog>;
  selectModel(choiceId: string): Promise<DesktopSettings>;
  saveSettings(settings: { apiKey?: string; model: string; baseURL: string; shortcut: string }): Promise<DesktopSettings>;
  removeKey(): Promise<DesktopSettings>;
  openSettings(): Promise<void>;
  onboardingComplete(): Promise<boolean>;
  completeOnboarding(): Promise<void>;
  onOpenOnboarding(callback: () => void): () => void;
  openHelp(): Promise<void>;
  hideHelp(): Promise<void>;
  setHelpLayout(layout: { expanded: boolean; height?: number }): Promise<void>;
  captureScreen(mode?: "screen" | "region"): Promise<void>;
  getCapture(): Promise<CapturePayload | null>;
  selectCapture(rect: CropRect): Promise<void>;
  cancelCapture(): Promise<void>;
  getHelpSession(): Promise<HelpSession>;
  listHelp(): Promise<HelpHistoryItem[]>;
  getHelp(id: string): Promise<HelpSession | null>;
  askHelp(request: { sessionId: string; question: string; marks: VisualMark[]; refreshScreen?: boolean; sourceId?: string }): Promise<HelpSession>;
  showGuidance(request: { sessionId: string; messageId: string }): Promise<void>;
  getGuidance(): Promise<GuidancePayload | null>;
  closeGuidance(): Promise<void>;
  onGuidanceChanged?(callback: (visible: boolean) => void): () => void;
  onGuidanceLayoutChanged?(callback: (payload: GuidancePayload) => void): () => void;
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

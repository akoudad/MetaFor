import type { Conversation, SourceReference } from "./model";
import { CONVERSATION_LIMITS, validateConversation, validateSourceReference } from "./model";
import type { AnnotationRequest } from "./contracts";
import { selectedText } from "./ai";

type Point = { x: number; y: number; z: number };

export type PendingQuestion = {
  requestId: string;
  activeId: string;
  question: string;
  selection: SourceReference | null;
  includeIds: string[];
  annotations?: AnnotationRequest[];
};

export type Snapshot = {
  format: "ingx";
  version: 1;
  savedAt: string;
  conversation: Conversation;
  view: {
    activeId: string;
    view: Point;
    overview: boolean;
    started: boolean;
    places: Record<string, { view: Point; draft: string; selection: SourceReference | null; scrollTop: number; annotations?: AnnotationRequest[] }>;
    history: string[];
    positions?: Record<string, Point>;
    pending?: PendingQuestion;
    annotationPair?: { sourceId: string; replyId: string };
  };
};

export type SavedSpace = { id: string; title: string; savedAt: string };

export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
// Keep the original storage identifiers so the rebrand preserves saved chats.
const DATABASE = "metaphore-spaces";
const SNAPSHOTS = "snapshots";
const LIBRARY = "library";
const FALLBACK_PREFIX = "metaphore.ingx.v1:";
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const pendingSaves = new Map<string, Promise<void>>();
const fallbackWrites = new Map<string, { serialized: string; sequence: number }>();
let writeSequence = 0;

class InvalidSavedData extends Error {}

function record(value: unknown, label: string, allowed?: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must contain plain data.`);
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key) || (allowed && !allowed.includes(key))) throw new Error(`${label} contains an unsupported property: ${key}.`);
  }
  return value as Record<string, unknown>;
}

function validDate(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("The saved timestamp is invalid.");
  }
}

function point(value: unknown, label: string) {
  const data = record(value, label, ["x", "y", "z"]);
  for (const axis of ["x", "y", "z"]) {
    if (typeof data[axis] !== "number" || !Number.isFinite(data[axis]) || Math.abs(data[axis]) > CONVERSATION_LIMITS.coordinate) {
      throw new Error(`${label} must have bounded finite coordinates.`);
    }
  }
}

function annotations(value: unknown, conversation: Conversation, allowBlank: boolean): asserts value is AnnotationRequest[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error("Annotations must contain at most six items.");
  const ids = new Set<string>();
  let questions = 0;
  let passages = 0;
  for (const item of value) {
    const annotation = record(item, "Annotation", ["id", "source", "question"]);
    if (typeof annotation.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(annotation.id) || unsafeKeys.has(annotation.id)) throw new Error("An annotation has an invalid ID.");
    if (ids.has(annotation.id)) throw new Error("Annotations must have unique IDs.");
    ids.add(annotation.id);
    if (typeof annotation.question !== "string" || annotation.question.length > 8000 || (!allowBlank && !annotation.question.trim())) throw new Error(allowBlank ? "An annotation draft must contain at most 8,000 characters." : "An unfinished annotation question must contain 1–8,000 characters.");
    validateSourceReference(conversation, annotation.source);
    questions += annotation.question.length;
    passages += selectedText(conversation, annotation.source).length;
  }
  if (!allowBlank && questions > 24_000) throw new Error("Annotation questions must contain at most 24,000 characters in total.");
  if (!allowBlank && passages > 24_000) throw new Error("Annotated passages must contain at most 24,000 characters in total.");
}

function validateSnapshot(value: unknown): asserts value is Snapshot {
  const snapshot = record(value, "File", ["format", "version", "savedAt", "conversation", "view"]);
  if (snapshot.format !== "ingx") throw new Error("This is not an .ingx conversation file.");
  if (snapshot.version !== 1) throw new Error("This .ingx version is not supported. Expected version 1.");
  validDate(snapshot.savedAt);
  validateConversation(snapshot.conversation);
  const conversation = snapshot.conversation;
  const view = record(snapshot.view, "Saved view", ["activeId", "view", "overview", "started", "places", "history", "positions", "pending", "annotationPair"]);
  const known = (id: unknown, label: string): id is string => {
    if (typeof id !== "string" || !Object.hasOwn(conversation.explorations, id)) throw new Error(`${label} refers to a missing exploration.`);
    return true;
  };
  known(view.activeId, "Active topic");
  if (view.annotationPair !== undefined) {
    const pair = record(view.annotationPair, "Annotation view", ["sourceId", "replyId"]);
    if (known(pair.sourceId, "Annotation source") && known(pair.replyId, "Annotation reply")) {
      if (pair.replyId !== view.activeId || conversation.explorations[pair.replyId].source?.explorationId !== pair.sourceId) throw new Error("The annotation view must pair the active reply with its original source.");
    }
  }
  point(view.view, "Camera");
  if (typeof view.overview !== "boolean" || typeof view.started !== "boolean") throw new Error("View flags must be true or false.");
  if (!Array.isArray(view.history) || view.history.length > 1000) throw new Error("Navigation history must contain at most 1000 entries.");
  for (const id of view.history) known(id, "Navigation history");
  const places = record(view.places, "Saved places");
  for (const [id, value] of Object.entries(places)) {
    known(id, "Saved place");
    const place = record(value, "Saved place", ["view", "draft", "selection", "scrollTop", "annotations"]);
    point(place.view, "Saved camera");
    if (typeof place.draft !== "string" || place.draft.length > 16_000) throw new Error("A saved draft must contain at most 16,000 characters.");
    if (typeof place.scrollTop !== "number" || !Number.isFinite(place.scrollTop) || place.scrollTop < 0 || place.scrollTop > CONVERSATION_LIMITS.coordinate) {
      throw new Error("A saved reading position must be a bounded positive number.");
    }
    if (place.selection !== null) {
      validateSourceReference(conversation, place.selection);
    }
    if (place.annotations !== undefined) {
      annotations(place.annotations, conversation, true);
    }
  }
  if (view.positions !== undefined) {
    for (const [id, position] of Object.entries(record(view.positions, "Topic positions"))) {
      known(id, "Topic position");
      point(position, "Topic position");
    }
  }
  if (view.pending !== undefined) {
    const pending = record(view.pending, "Unfinished question", ["requestId", "activeId", "question", "selection", "includeIds", "annotations"]);
    if (typeof pending.requestId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(pending.requestId) || unsafeKeys.has(pending.requestId)) throw new Error("The unfinished question has an invalid request ID.");
    known(pending.activeId, "Unfinished question");
    if (typeof pending.question !== "string" || !pending.question.trim() || pending.question.length > 8000) throw new Error("An unfinished question must contain 1–8,000 characters.");
    if (pending.selection !== null) {
      validateSourceReference(conversation, pending.selection);
      if (pending.selection.explorationId !== pending.activeId) throw new Error("The unfinished question's selection belongs to a different topic.");
    }
    if (pending.annotations !== undefined) {
      annotations(pending.annotations, conversation, false);
      if (pending.selection !== null && pending.annotations.length) throw new Error("Use annotations or a single unfinished selection, not both.");
    }
    if (!Array.isArray(pending.includeIds) || pending.includeIds.length > 8) throw new Error("An unfinished question can include at most eight topics.");
    for (const id of pending.includeIds) known(id, "Unfinished question context");
    if (new Set(pending.includeIds).size !== pending.includeIds.length) throw new Error("The unfinished question has duplicate context topics.");
    if (Object.values(conversation.explorations).some((item) => item.messages.some((message) => message.role === "assistant" && message.requestId === pending.requestId))) throw new Error("The unfinished question already has an answer.");
    if (!view.started) throw new Error("An unfinished question must belong to a started chat.");
  }
}

export function serializeSnapshot(snapshot: Snapshot): string {
  validateSnapshot(snapshot);
  const result = JSON.stringify(snapshot, null, 2);
  if (new TextEncoder().encode(result).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("This space exceeds the 2 MiB .ingx file limit.");
  return result;
}

export function parseSnapshot(value: string): Snapshot {
  if (typeof value !== "string") throw new Error("Choose a text .ingx conversation file.");
  if (new TextEncoder().encode(value).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("This file exceeds the 2 MiB .ingx file limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("This file is not valid JSON. Choose an intact .ingx export.");
  }
  validateSnapshot(parsed);
  return parsed;
}

function metadata(value: unknown): SavedSpace {
  const data = record(value, "Saved space", ["id", "title", "savedAt"]);
  if (typeof data.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(data.id) || unsafeKeys.has(data.id)) throw new Error("Saved space has an invalid ID.");
  if (typeof data.title !== "string" || data.title.length > 500) throw new Error("Saved space has an invalid title.");
  validDate(data.savedAt);
  return { id: data.id, title: data.title, savedAt: data.savedAt };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable.")); return; }
    let done = false;
    const timeout = setTimeout(() => {
      done = true;
      reject(new Error("Local storage did not respond. Close another metafor tab and retry."));
    }, 4000);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DATABASE, 1); }
    catch { clearTimeout(timeout); reject(new Error("Could not open IndexedDB.")); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS);
      if (!db.objectStoreNames.contains(LIBRARY)) db.createObjectStore(LIBRARY);
    };
    request.onerror = () => { clearTimeout(timeout); done = true; reject(new Error("Could not open IndexedDB.")); };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (done) { request.result.close(); return; }
      done = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not read the saved space."));
  });
}

function fallbackStorage(): Storage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch { /* Browser settings can block access to the storage property. */ }
  throw new Error("Browser local storage is unavailable.");
}

function writeFallback(serialized: string, entry: SavedSpace, sequence: number) {
  const storage = fallbackStorage();
  const key = `${FALLBACK_PREFIX}${entry.id}`;
  const previous = storage.getItem(key);
  if (previous) {
    const known = fallbackWrites.get(entry.id);
    if (known?.serialized === previous && known.sequence > sequence) return;
    const saved = parseSaved(previous)!;
    if (saved.conversation.id !== entry.id) throw new InvalidSavedData("The saved-space record has a mismatched ID.");
    if (Date.parse(saved.savedAt) > Date.parse(entry.savedAt)) return;
  }
  storage.setItem(key, serialized);
  fallbackWrites.set(entry.id, { serialized, sequence });
}

function cleanFallback(serialized: string, entry: SavedSpace, sequence: number) {
  const storage = fallbackStorage();
  const key = `${FALLBACK_PREFIX}${entry.id}`;
  const current = storage.getItem(key);
  if (!current) return;
  const known = fallbackWrites.get(entry.id);
  if (known?.serialized === current && known.sequence > sequence) return;
  const saved = parseSnapshot(current);
  if (saved.conversation.id !== entry.id) return;
  const savedAt = Date.parse(saved.savedAt);
  if (current === serialized || savedAt < Date.parse(entry.savedAt) || (savedAt === Date.parse(entry.savedAt) && known?.serialized === current && known.sequence <= sequence)) {
    storage.removeItem(key);
    if (fallbackWrites.get(entry.id)?.serialized === current) fallbackWrites.delete(entry.id);
  }
}

function parseSaved(value: unknown): Snapshot | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value !== "string") throw new Error("The saved record is not text.");
    return parseSnapshot(value);
  } catch (error) {
    throw new InvalidSavedData(`A saved space could not be read: ${error instanceof Error ? error.message : "Invalid data."}`);
  }
}

type LibraryResult = { items: SavedSpace[]; damaged: number };

async function indexedLibrary(): Promise<LibraryResult> {
  const db = await openDatabase();
  try {
    const store = db.transaction(LIBRARY, "readonly").objectStore(LIBRARY);
    const [values, keys] = await Promise.all([requestResult(store.getAll()), requestResult(store.getAllKeys())]);
    const result: LibraryResult = { items: [], damaged: 0 };
    for (const [index, value] of values.entries()) {
      try {
        const saved = metadata(value);
        if (saved.id !== keys[index]) throw new Error("Mismatched saved-space ID.");
        result.items.push(saved);
      } catch { result.damaged += 1; }
    }
    return result;
  } finally { db.close(); }
}

function fallbackLibrary(): LibraryResult {
  const storage = fallbackStorage();
  const result: LibraryResult = { items: [], damaged: 0 };
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(FALLBACK_PREFIX)) continue;
    const value = storage.getItem(key);
    try {
      const snapshot = parseSaved(value);
      if (!snapshot) continue;
      if (key !== `${FALLBACK_PREFIX}${snapshot.conversation.id}`) throw new Error("Mismatched saved-space ID.");
      result.items.push({ id: snapshot.conversation.id, title: snapshot.conversation.title, savedAt: snapshot.savedAt });
    } catch { result.damaged += 1; }
  }
  return result;
}

export async function listSnapshots(onWarning?: (message: string) => void): Promise<SavedSpace[]> {
  const results = await Promise.allSettled([indexedLibrary(), Promise.resolve().then(fallbackLibrary)]);
  const merged = new Map<string, SavedSpace>();
  let available = false;
  let damaged = 0;
  for (const result of results) {
    if (result.status === "rejected") continue;
    available = true;
    damaged += result.value.damaged;
    for (const saved of result.value.items) {
      const previous = merged.get(saved.id);
      if (!previous || Date.parse(saved.savedAt) >= Date.parse(previous.savedAt)) merged.set(saved.id, saved);
    }
  }
  if (!available) throw new Error("Local storage is unavailable. You can keep working and export an .ingx copy.");
  if (damaged) {
    const message = "Some saved copies could not be read. Their data has been kept; intact chats are still available.";
    if (!merged.size) throw new InvalidSavedData("Saved chats could not be read. Their data has been kept; you can import an .ingx backup.");
    onWarning?.(message);
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export async function loadSnapshot(id?: string, onWarning?: (message: string) => void): Promise<Snapshot | null> {
  const selected = id ?? (await listSnapshots(onWarning))[0]?.id;
  if (!selected) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(selected) || unsafeKeys.has(selected)) throw new Error("The saved-space ID is invalid.");
  const fromIndexed = async () => {
    const db = await openDatabase();
    try {
      const value = await requestResult(db.transaction(SNAPSHOTS, "readonly").objectStore(SNAPSHOTS).get(selected));
      return parseSaved(value);
    } finally { db.close(); }
  };
  const results = await Promise.allSettled([
    fromIndexed(),
    Promise.resolve().then(() => parseSaved(fallbackStorage().getItem(`${FALLBACK_PREFIX}${selected}`))),
  ]);
  const candidates: Snapshot[] = [];
  let available = false;
  let invalid: Error | null = null;
  for (const result of results) {
    if (result.status === "rejected") {
      if (result.reason instanceof InvalidSavedData) invalid = result.reason;
      continue;
    }
    available = true;
    if (result.value) {
      if (result.value.conversation.id !== selected) {
        invalid = new InvalidSavedData("The saved-space record has a mismatched ID.");
        continue;
      }
      candidates.push(result.value);
    }
  }
  // Prefer the emergency copy on an equal timestamp; it may be newer than an
  // IndexedDB write that was already in flight when the page was hidden.
  if (candidates.length) {
    if (invalid) onWarning?.("One saved copy could not be read. An intact copy was restored; the damaged data has been kept.");
    return candidates.reverse().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0];
  }
  if (invalid) throw invalid;
  if (!available) throw new Error("Could not open local storage. Your exported .ingx files can still be imported.");
  return null;
}

async function writeSnapshot(serialized: string, entry: SavedSpace, sequence: number): Promise<void> {
  try {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS, LIBRARY], "readwrite");
        const store = transaction.objectStore(SNAPSHOTS);
        const existing = store.get(entry.id);
        existing.onsuccess = () => {
          // Compare and write in one transaction so another tab cannot insert
          // a newer snapshot between the check and these two related writes.
          try {
            const previous = parseSaved(existing.result);
            if (previous && previous.conversation.id !== entry.id) throw new InvalidSavedData("The saved-space record has a mismatched ID.");
            if (previous && Date.parse(previous.savedAt) > Date.parse(entry.savedAt)) return;
          } catch (error) {
            // Retain damaged data for recovery; the validated new copy can
            // still be saved in the other storage backend.
            reject(error); transaction.abort(); return;
          }
          store.put(serialized, entry.id);
          transaction.objectStore(LIBRARY).put(entry, entry.id);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error("Could not save the space."));
        transaction.onabort = () => reject(new Error("Saving the space was interrupted."));
      });
    } finally { db.close(); }
    try { cleanFallback(serialized, entry, sequence); } catch { /* IndexedDB already holds the saved copy. */ }
    return;
  } catch {
    try {
      writeFallback(serialized, entry, sequence);
    } catch {
      throw new Error("Could not save this space locally. Browser storage may be full or blocked; export an .ingx copy before closing.");
    }
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const serialized = serializeSnapshot(snapshot);
  const entry: SavedSpace = { id: snapshot.conversation.id, title: snapshot.conversation.title, savedAt: snapshot.savedAt };
  const sequence = ++writeSequence;
  const previous = pendingSaves.get(entry.id) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => writeSnapshot(serialized, entry, sequence));
  pendingSaves.set(entry.id, pending);
  try { await pending; }
  finally {
    if (pendingSaves.get(entry.id) === pending) pendingSaves.delete(entry.id);
  }
}

export function backupSnapshot(snapshot: Snapshot): void {
  const serialized = serializeSnapshot(snapshot);
  const entry: SavedSpace = { id: snapshot.conversation.id, title: snapshot.conversation.title, savedAt: snapshot.savedAt };
  try {
    writeFallback(serialized, entry, ++writeSequence);
  } catch {
    throw new Error("Could not back up this space before leaving. Browser storage may be full or blocked; export an .ingx copy.");
  }
}

import { mkdir, open, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { HelpHistoryItem, HelpSession } from "./shared";
import { helpSources, sourceForMessage, validateMarks } from "./help-model";

const MAXIMUM_BYTES = 16 * 1024 * 1024;
// Covers an 8,000-character question, a 20,000-character answer, both sets of
// marks and metadata, even when every text character needs JSON escaping.
const ANSWER_RESERVE_BYTES = 256 * 1024;

export function safeId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) throw new Error("The saved item ID is invalid.");
  return value;
}

export async function atomicWrite(file: string, text: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temp, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) throw new Error("This Help exchange contains invalid text.");
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error("This Help exchange contains an invalid date.");
  return result;
}

function validateSession(value: unknown): HelpSession {
  if (!value || typeof value !== "object") throw new Error("This Help exchange could not be read.");
  const session = value as HelpSession;
  if (!Array.isArray(session.messages) || session.messages.length > 1000) throw new Error("This Help exchange has too many messages.");
  const sources = helpSources(session);
  if (session.contextMode !== undefined && !["screen", "source"].includes(session.contextMode)) throw new Error("This Help exchange has an invalid context mode.");
  const ids = new Set<string>();
  const messages = session.messages.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) throw new Error("This Help exchange contains an invalid message.");
    const id = safeId(message.id);
    if (ids.has(id)) throw new Error("This Help exchange contains duplicate message IDs.");
    ids.add(id);
    const source = sourceForMessage({ ...session, sources }, message.sourceId);
    if (!source && message.marks?.length) throw new Error("A visual annotation is missing its saved source.");
    return { id, role: message.role, text: text(message.text, 20000), createdAt: timestamp(message.createdAt),
      ...(message.marks !== undefined ? { marks: validateMarks(message.marks) } : {}),
      ...(message.sourceId !== undefined ? { sourceId: safeId(message.sourceId) } : {}) };
  });
  const source = session.source ? sources.find((item) => item.id === session.source!.id)! : null;
  return { id: safeId(session.id), title: text(session.title, 500), source, messages,
    ...(session.sources !== undefined ? { sources } : {}),
    ...(session.contextMode !== undefined ? { contextMode: session.contextMode } : {}),
    createdAt: timestamp(session.createdAt), updatedAt: timestamp(session.updatedAt) };
}

function serializeSession(session: HelpSession): string {
  if (session.sources === undefined) return JSON.stringify(session);
  const { source, ...rest } = session;
  // The current frame already lives in the source archive. Keep its identity,
  // not a second copy of the image, in the private on-disk representation.
  return JSON.stringify({ ...rest, storageVersion: 1, currentSourceId: source?.id ?? null });
}

function readSession(value: unknown): HelpSession {
  if (!value || typeof value !== "object" || !("storageVersion" in value)) return validateSession(value);
  const stored = value as Record<string, unknown>;
  if (stored.storageVersion !== 1) throw new Error("This Help exchange uses an unsupported storage version.");
  if ("source" in stored || !Array.isArray(stored.sources)) throw new Error("This Help exchange could not be read.");
  const sourceId = stored.currentSourceId === null ? null : safeId(stored.currentSourceId);
  const source = sourceId === null ? null : stored.sources.find((item) => item && item.id === sourceId);
  if (sourceId !== null && !source) throw new Error("The current screen is missing from this Help exchange.");
  return validateSession({ ...stored, source });
}

export function assertHelpAnswerCapacity(session: HelpSession) {
  const validated = validateSession(session);
  if (validated.messages.length > 998 || Buffer.byteLength(serializeSession(validated)) + ANSWER_RESERVE_BYTES > MAXIMUM_BYTES) {
    throw new Error("This Help exchange is full. Start a new Help exchange to ask another question. Your saved answers are unchanged.");
  }
}

export class HelpStore {
  private pending = new Map<string, Promise<void>>();
  constructor(private directory: string) {}

  private enqueue(id: string, action: () => Promise<void>) {
    const previous = this.pending.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.pending.set(id, next);
    const clear = () => { if (this.pending.get(id) === next) this.pending.delete(id); };
    void next.then(clear, clear);
    return next;
  }

  async save(session: HelpSession) {
    const validated = validateSession(session);
    const raw = serializeSession(validated);
    if (Buffer.byteLength(raw) > MAXIMUM_BYTES) throw new Error("This saved Help exchange is too large.");
    await this.enqueue(validated.id, () => atomicWrite(path.join(this.directory, `${validated.id}.json`), raw));
  }

  async get(id: string): Promise<HelpSession | null> {
    safeId(id);
    await this.pending.get(id);
    let file;
    try {
      file = await open(path.join(this.directory, `${id}.json`), "r");
      if ((await file.stat()).size > MAXIMUM_BYTES) throw new Error("This saved Help exchange is too large.");
      let raw = ""; let bytes = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        bytes += chunk.byteLength;
        if (bytes > MAXIMUM_BYTES) throw new Error("This saved Help exchange is too large.");
        raw += decoder.decode(chunk, { stream: true });
      }
      raw += decoder.decode();
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error("This Help exchange could not be read."); }
      const result = readSession(parsed);
      if (result.id !== id) throw new Error("This Help exchange has a mismatched ID.");
      return result;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    finally { await file?.close(); }
  }

  async list() {
    await Promise.allSettled(this.pending.values());
    let names: string[];
    try { names = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const items: HelpHistoryItem[] = [];
    // Source images can be large. Reading one file at a time bounds memory even with a long history.
    for (const name of names.filter((name) => name.endsWith(".json"))) {
      let id: string;
      try { id = safeId(name.slice(0, -5)); } catch { continue; }
      try {
        const session = await this.get(id);
        if (session) items.push({ id: session.id, title: session.title, updatedAt: session.updatedAt });
      } catch {
        // Keep healthy exchanges accessible without hiding or overwriting unreadable files.
        items.push({ id, title: "Unreadable saved exchange", updatedAt: null, status: "unreadable" });
      }
    }
    return items.sort((a, b) => a.updatedAt === null ? b.updatedAt === null ? a.id.localeCompare(b.id) : 1 : b.updatedAt === null ? -1 : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async delete(id: string) {
    safeId(id);
    await this.enqueue(id, async () => {
      try { await unlink(path.join(this.directory, `${id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    });
  }
}

export function emptyHelp(): HelpSession {
  const now = new Date().toISOString();
  return { id: `help-${crypto.randomUUID()}`, title: "New Help exchange", source: null, messages: [], createdAt: now, updatedAt: now };
}

import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createSampleConversation } from "../src/lib/sample";
import { backupSnapshot, listSnapshots, loadSnapshot, MAX_SNAPSHOT_BYTES, parseSnapshot, saveSnapshot, serializeSnapshot } from "../src/lib/storage";
import type { Snapshot } from "../src/lib/storage";

function fixture(): Snapshot {
  const conversation = createSampleConversation();
  return {
    format: "ingx", version: 1, savedAt: "2026-11-04T20:00:00.000Z", conversation,
    view: {
      activeId: "compensation", view: { x: 40, y: -20, z: 1800 }, overview: false, started: true,
      places: {
        "job-search": { view: { x: 0, y: 0, z: 1500 }, draft: "Which path suits me?", selection: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", quote: "Start with a small shortlist" }, scrollTop: 320 },
      },
      history: ["job-search"], positions: { compensation: { x: 420, y: 40, z: -300 } },
    },
  };
}

test(".ingx roundtrip preserves content, draft, selection, camera, and dragged positions", () => {
  const snapshot = fixture();
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot);
});

test("malformed imports reject unknown structures without leaking TypeErrors", () => {
  const values: unknown[] = [null, [], {}, { ...fixture(), conversation: null }, { ...fixture(), view: { places: null } }];
  for (const value of values) {
    assert.throws(() => parseSnapshot(JSON.stringify(value)), (error) => error instanceof Error && !(error instanceof TypeError));
  }
  assert.throws(() => parseSnapshot("{"), /not valid JSON/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...fixture(), version: 2 })), /version is not supported/);
});

test("missing topic references, invalid sources, and parent cycles are rejected", () => {
  const active = fixture();
  active.view.activeId = "missing";
  assert.throws(() => serializeSnapshot(active), /missing exploration/);
  const source = fixture();
  source.view.places["job-search"].selection!.messageId = "missing";
  assert.throws(() => serializeSnapshot(source), /invalid source reference/);
  const cyclic = fixture();
  cyclic.conversation.explorations.compensation.parentId = "equity";
  assert.throws(() => serializeSnapshot(cyclic), /parent cycle/);
});

test("prototype properties, unexpected credentials, oversized files, and invalid coordinates are rejected", () => {
  const serialized = serializeSnapshot(fixture());
  assert.throws(() => parseSnapshot(serialized.replace('"format": "ingx",', '"format": "ingx", "__proto__": {},')), /unsupported property/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...fixture(), apiKey: "not-a-real-key" })), /unsupported property/);
  assert.throws(() => parseSnapshot(" ".repeat(MAX_SNAPSHOT_BYTES + 1)), /2 MiB/);
  const invalid = fixture();
  invalid.view.view.x = Number.POSITIVE_INFINITY;
  assert.throws(() => serializeSnapshot(invalid), /finite coordinates/);
});

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test("localStorage fallback retains separate spaces and loads the most recent", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    assert.equal(await loadSnapshot(), null);
    const first = fixture();
    const second = fixture();
    second.conversation.id = "another-space";
    second.conversation.title = "Another discussion";
    second.savedAt = "2026-11-04T20:05:00.000Z";
    await saveSnapshot(first);
    await saveSnapshot(second);
    assert.deepEqual((await listSnapshots()).map((entry) => entry.id), ["another-space", first.conversation.id]);
    assert.deepEqual(await loadSnapshot(first.conversation.id), first);
    assert.deepEqual(await loadSnapshot(), second);
    first.savedAt = "2026-11-04T20:10:00.000Z";
    first.view.places["job-search"].draft = "Updated draft";
    await saveSnapshot(first);
    assert.equal((await listSnapshots()).length, 2);
    assert.deepEqual(await loadSnapshot(), first);
    const next = structuredClone(first);
    next.savedAt = "2026-11-04T20:11:00.000Z";
    next.view.places["job-search"].draft = "Latest draft";
    await Promise.all([saveSnapshot(first), saveSnapshot(next)]);
    assert.deepEqual(await loadSnapshot(first.conversation.id), next);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("unavailable storage reports a recoverable error", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    await assert.rejects(() => saveSnapshot(fixture()), /export an .ingx copy/);
    await assert.rejects(() => listSnapshots(), /Local storage is unavailable/);
    assert.throws(() => backupSnapshot(fixture()), /Could not back up/);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("a page-hide backup survives an older IndexedDB autosave and remains the latest space", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const older = fixture();
    const newer = structuredClone(older);
    newer.savedAt = "2026-11-04T20:05:00.000Z";
    newer.conversation.title = "Saved before leaving";
    newer.view.places["job-search"].draft = "The latest unsent question";
    const inFlight = saveSnapshot(older);
    backupSnapshot(newer);
    await inFlight;
    assert.deepEqual(await loadSnapshot(), newer);
    assert.equal((await listSnapshots())[0].title, newer.conversation.title);

    const other = fixture();
    other.conversation.id = "separate-space";
    other.savedAt = "2026-11-04T20:03:00.000Z";
    await saveSnapshot(other);
    assert.deepEqual((await listSnapshots()).map((entry) => entry.id), [newer.conversation.id, "separate-space"]);

    const resumed = structuredClone(newer);
    resumed.savedAt = "2026-11-04T20:06:00.000Z";
    resumed.view.places["job-search"].draft = "Continued after reopening";
    await saveSnapshot(resumed);
    assert.deepEqual(await loadSnapshot(), resumed);
    assert.deepEqual(await loadSnapshot("separate-space"), other);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("same-millisecond emergency copies are not overwritten by pending writes", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const older = fixture();
    const emergency = structuredClone(older);
    emergency.view.places["job-search"].draft = "Emergency update";
    const inFlight = saveSnapshot(older);
    backupSnapshot(emergency);
    await inFlight;
    assert.deepEqual(await loadSnapshot(older.conversation.id), emergency);

    const resumed = structuredClone(emergency);
    resumed.view.places["job-search"].draft = "Later regular save";
    await saveSnapshot(resumed);
    assert.deepEqual(await loadSnapshot(older.conversation.id), resumed);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("a failed IndexedDB save cannot overwrite a newer emergency fallback", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    const older = fixture();
    const emergency = structuredClone(older);
    emergency.view.places["job-search"].draft = "Keep this emergency fallback";
    const inFlight = saveSnapshot(older);
    backupSnapshot(emergency);
    await inFlight;
    assert.deepEqual(await loadSnapshot(), emergency);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test(".ingx preserves an unfinished question separately from the next draft", () => {
  const snapshot = fixture();
  snapshot.view.pending = { requestId: "pending-roof", activeId: "job-search", question: "Explain this shortlist", selection: snapshot.view.places["job-search"].selection, includeIds: ["compensation"] };
  snapshot.view.places["job-search"].draft = "My next question is different";
  const restored = parseSnapshot(serializeSnapshot(snapshot));
  assert.deepEqual(restored.view.pending, snapshot.view.pending);
  assert.equal(restored.view.places["job-search"].draft, "My next question is different");
});

test("unfinished-question imports reject malformed references, completed requests, and extra secrets", () => {
  const snapshot = fixture();
  snapshot.view.pending = { requestId: "pending-roof", activeId: "job-search", question: "Explain this shortlist", selection: snapshot.view.places["job-search"].selection, includeIds: ["compensation"] };
  const invalid: unknown[] = [
    null, {},
    { ...snapshot.view.pending, requestId: "__proto__" },
    { ...snapshot.view.pending, activeId: "missing" },
    { ...snapshot.view.pending, activeId: "compensation" },
    { ...snapshot.view.pending, question: " " },
    { ...snapshot.view.pending, question: "x".repeat(8001) },
    { ...snapshot.view.pending, selection: { ...snapshot.view.pending.selection, quote: "invented quote" } },
    { ...snapshot.view.pending, includeIds: ["missing"] },
    { ...snapshot.view.pending, includeIds: ["compensation", "compensation"] },
    { ...snapshot.view.pending, accessCode: "do-not-save" },
    { ...snapshot.view.pending, conversation: snapshot.conversation },
  ];
  for (const pending of invalid) {
    assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, view: { ...snapshot.view, pending } })), (error) => error instanceof Error && !(error instanceof TypeError));
  }
  const completed = structuredClone(snapshot);
  completed.conversation.explorations["job-search"].messages.find((message) => message.role === "assistant")!.requestId = "pending-roof";
  assert.throws(() => serializeSnapshot(completed), /already has an answer/);
});

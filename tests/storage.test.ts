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

function annotationFixture(): Snapshot {
  const snapshot = fixture();
  const place = snapshot.view.places["job-search"];
  const source = structuredClone(place.selection!);
  place.selection = null;
  place.annotations = [
    { id: "note-shortlist", source, question: "" },
    { id: "note-equity", source: { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity" }, question: "How should I compare this?" },
  ];
  return snapshot;
}

test(".ingx roundtrip preserves content, draft, selection, camera, and dragged positions", () => {
  const snapshot = fixture();
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot);
});

test(".ingx preserves annotation drafts, exact cross-topic sources, and blank unfinished edits", () => {
  const snapshot = annotationFixture();
  const restored = parseSnapshot(serializeSnapshot(snapshot));
  assert.deepEqual(restored, snapshot);
  assert.equal(restored.view.places["job-search"].annotations![0].question, "");
  assert.equal(restored.view.places["job-search"].annotations![1].source.explorationId, "compensation");
  snapshot.view.places["job-search"].selection = snapshot.view.places["job-search"].annotations![1].source;
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot, "the next selected passage may belong to another topic when building a batch");
  snapshot.view.places["job-search"].annotations = [];
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot, "removing the final queued annotation keeps a selected passage from the paired source card recoverable");
  const legacy = fixture();
  assert.equal(parseSnapshot(serializeSnapshot(legacy)).view.places["job-search"].annotations, undefined);
});

test("paired annotation views preserve their camera and require the active reply's genuine source", () => {
  const snapshot = fixture();
  snapshot.view.annotationPair = { sourceId: "job-search", replyId: "compensation" };
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot);
  for (const pair of [null, {}, { sourceId: "missing", replyId: "compensation" }, { sourceId: "equity", replyId: "compensation" }, { sourceId: "compensation", replyId: "equity" }, { sourceId: "job-search", replyId: "compensation", extra: true }]) {
    assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, view: { ...snapshot.view, annotationPair: pair } })), (error) => error instanceof Error && !(error instanceof TypeError));
  }
});

test("annotation imports reject malformed, oversized, duplicate, and forged items without TypeErrors", () => {
  const snapshot = annotationFixture();
  const item = snapshot.view.places["job-search"].annotations![0];
  const invalid: unknown[] = [
    null, {}, [null], [{}],
    [{ ...item, id: "__proto__" }],
    [{ ...item, id: "x".repeat(101) }],
    [{ ...item, question: 7 }],
    [{ ...item, question: "q".repeat(8001) }],
    [{ ...item, apiKey: "never-store-this" }],
    [{ ...item, source: { ...item.source, quote: "invented passage" } }],
    [{ ...item, source: { ...item.source, messageId: "missing" } }],
    [{ ...item, source: { ...item.source, endSectionId: "compensation-equity" } }],
    [item, item],
    Array.from({ length: 7 }, (_, index) => ({ ...item, id: `note-${index}` })),
  ];
  for (const annotations of invalid) {
    const view = { ...snapshot.view, places: { ...snapshot.view.places, "job-search": { ...snapshot.view.places["job-search"], annotations } } };
    assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, view })), (error) => error instanceof Error && !(error instanceof TypeError));
  }
  snapshot.view.places["job-search"].selection = item.source;
  assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot)), snapshot, "queued annotations coexist with the next selected draft passage");
});

test("pending annotation budgets are strict while oversized unfinished edits remain recoverable", () => {
  const snapshot = annotationFixture();
  const source = { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", quote: "x".repeat(8000) };
  snapshot.conversation.explorations["job-search"].messages.find((message) => message.id === source.messageId)!.sections.find((section) => section.id === source.sectionId)!.body = "x".repeat(12000);
  const place = snapshot.view.places["job-search"];
  place.annotations = Array.from({ length: 3 }, (_, index) => ({ id: `note-${index}`, source, question: "q".repeat(8000) }));
  snapshot.view.pending = { requestId: "bounded-annotations", activeId: "job-search", question: "Answer these annotations", selection: null, includeIds: [], annotations: structuredClone(place.annotations) };
  assert.doesNotThrow(() => serializeSnapshot(snapshot), "24,000 characters in each aggregate are allowed");
  place.annotations.push({ id: "note-3", source: { ...source, quote: "x" }, question: "q" });
  assert.doesNotThrow(() => serializeSnapshot(snapshot), "draft edits may exceed submission budgets without losing save capability");
  snapshot.view.pending.annotations = structuredClone(place.annotations);
  assert.throws(() => serializeSnapshot(snapshot), /Annotation questions.*24,000/);
  place.annotations[3].question = "";
  snapshot.view.pending.annotations = [...structuredClone(place.annotations.slice(0, 3)), { ...place.annotations[3], question: "q" }];
  snapshot.view.pending.annotations[0].question = "q";
  assert.throws(() => serializeSnapshot(snapshot), /Annotated passages.*24,000/);
  place.annotations = [0, 1].map((index) => ({ id: `whole-section-${index}`, source: { explorationId: source.explorationId, messageId: source.messageId, sectionId: source.sectionId }, question: "" }));
  snapshot.view.pending.annotations = place.annotations.map((item) => ({ ...item, question: "Explain this" }));
  assert.throws(() => serializeSnapshot(snapshot), /Annotated passages.*24,000/, "whole-section references count their resolved titles and bodies too");
  delete snapshot.view.pending;
  assert.doesNotThrow(() => serializeSnapshot(snapshot), "large selected sections can still be saved while the user narrows their annotations");
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

async function putIndexed(store: string, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("metaphore-spaces", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      transaction.objectStore(store).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

test("annotation drafts reload from IndexedDB and localStorage without changing captured text", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  try {
    for (const database of [new IDBFactory(), undefined]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: database });
      const snapshot = annotationFixture();
      await saveSnapshot(snapshot);
      const restored = (await loadSnapshot(snapshot.conversation.id))!;
      assert.deepEqual(restored, snapshot);
      snapshot.view.places["job-search"].annotations![0].question = "Edited after saving";
      assert.equal((await loadSnapshot(snapshot.conversation.id))!.view.places["job-search"].annotations![0].question, "", "saved annotation drafts are snapshots rather than live references");
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

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

test("late saves cannot replace a newer persisted conversation or its library entry", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  try {
    for (const database of [new IDBFactory(), undefined]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: database });
      const older = fixture();
      const newer = structuredClone(older);
      newer.savedAt = "2026-11-04T20:05:00.000Z";
      newer.conversation.title = "Keep the newer conversation";
      newer.view.places["job-search"].draft = "Keep my latest unsent question";
      await saveSnapshot(newer);
      await saveSnapshot(older);
      assert.deepEqual(await loadSnapshot(older.conversation.id), newer);
      assert.equal((await listSnapshots())[0].title, newer.conversation.title);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("a mismatched recovery record does not hide a valid saved conversation", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const snapshot = fixture();
    await saveSnapshot(snapshot);
    const wrong = structuredClone(snapshot);
    wrong.conversation.id = "another-conversation";
    wrong.savedAt = "2026-11-04T20:05:00.000Z";
    const key = `metaphore.ingx.v1:${snapshot.conversation.id}`;
    storage.setItem(key, serializeSnapshot(wrong));
    assert.deepEqual(await loadSnapshot(snapshot.conversation.id), snapshot);
    assert.equal(storage.getItem(key), serializeSnapshot(wrong), "recovery never silently deletes the damaged record");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    await assert.rejects(() => loadSnapshot(snapshot.conversation.id), /mismatched ID/);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("damaged saved entries are isolated while intact chats remain available with a warning", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const snapshot = fixture();
    await saveSnapshot(snapshot);
    storage.setItem("metaphore.ingx.v1:damaged", "{ unfinished data");
    const wrong = structuredClone(snapshot);
    wrong.conversation.id = "invented-entry";
    storage.setItem("metaphore.ingx.v1:wrong-key", serializeSnapshot(wrong));
    await putIndexed("library", "invalid-metadata", { id: "invalid-metadata", title: 42, savedAt: snapshot.savedAt });
    await putIndexed("library", "wrong-index-key", { id: "another-invented-entry", title: "Wrong key", savedAt: snapshot.savedAt });
    const warnings: string[] = [];
    assert.deepEqual(await listSnapshots((message) => warnings.push(message)), [{ id: snapshot.conversation.id, title: snapshot.conversation.title, savedAt: snapshot.savedAt }]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /data has been kept/);
    assert.deepEqual(await loadSnapshot(), snapshot);
    assert.equal(storage.getItem("metaphore.ingx.v1:damaged"), "{ unfinished data");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    await assert.rejects(() => listSnapshots(), /Saved chats could not be read/);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    if (indexed) Object.defineProperty(globalThis, "indexedDB", indexed); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("saving retains damaged data and uses the intact storage backend when possible", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexed = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const snapshot = fixture();
    await saveSnapshot(snapshot);
    await putIndexed("snapshots", snapshot.conversation.id, "{ damaged original");
    snapshot.savedAt = "2026-11-04T20:05:00.000Z";
    snapshot.view.places["job-search"].draft = "Recoverable new work";
    await saveSnapshot(snapshot);
    const warnings: string[] = [];
    assert.deepEqual(await loadSnapshot(snapshot.conversation.id, (message) => warnings.push(message)), snapshot);
    assert.equal(warnings.length, 1, "the damaged IndexedDB record remains available for recovery");

    const key = `metaphore.ingx.v1:${snapshot.conversation.id}`;
    storage.setItem(key, "{ damaged fallback");
    await assert.rejects(() => saveSnapshot(snapshot), /export an .ingx copy/);
    assert.equal(storage.getItem(key), "{ damaged fallback", "failed saves never destroy damaged raw data");
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

test("unfinished annotation questions stay separate from the next editable annotation drafts", () => {
  const snapshot = annotationFixture();
  const submitted = structuredClone(snapshot.view.places["job-search"].annotations!);
  submitted[0].question = "Explain this shortlist";
  snapshot.view.pending = { requestId: "annotation-pending", activeId: "job-search", question: "Answer both annotations", selection: null, includeIds: [], annotations: submitted };
  snapshot.view.places["job-search"].annotations![1].question = "A different question for later";
  const restored = parseSnapshot(serializeSnapshot(snapshot));
  assert.deepEqual(restored.view.pending?.annotations, submitted);
  assert.equal(restored.view.places["job-search"].annotations![0].question, "");
  assert.equal(restored.view.places["job-search"].annotations![1].question, "A different question for later");
  const invalid = structuredClone(snapshot);
  invalid.view.pending!.annotations![0].question = " ";
  assert.throws(() => serializeSnapshot(invalid), /unfinished annotation question must contain 1/);
  invalid.view.pending!.annotations![0].question = submitted[0].question;
  invalid.view.pending!.selection = submitted[0].source;
  assert.throws(() => serializeSnapshot(invalid), /annotations or a single unfinished selection/);
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

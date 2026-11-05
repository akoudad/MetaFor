import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertHelpAnswerCapacity, atomicWrite, emptyHelp, HelpStore, safeId } from "../store";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metafor-help-store-"));
  return { directory, store: new HelpStore(directory), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("Help persistence survives reopening and never includes unrelated secret properties", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    session.source = { id: "source", image: `data:image/jpeg;base64,${Buffer.alloc(500_000).toString("base64")}`, width: 800, height: 600, appName: "Preview", title: "Report.pdf", capturedAt: session.createdAt };
    session.messages.push({ id: "q1", role: "user", text: "What is this?", createdAt: session.createdAt });
    await store.save({ ...session, apiKey: "never-serialize-me" } as typeof session);
    assert.deepEqual(await new HelpStore(directory).get(session.id), session);
    assert.ok(!(await readFile(path.join(directory, `${session.id}.json`), "utf8")).includes("never-serialize-me"));
    assert.equal((await stat(path.join(directory, `${session.id}.json`))).mode & 0o777, 0o600);
    assert.deepEqual(await store.list(), [{ id: session.id, title: session.title, updatedAt: session.updatedAt }]);
  } finally { await cleanup(); }
});

test("overlapping saves retain invocation order and reads await pending writes", async () => {
  const { store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const writes = Array.from({ length: 12 }, (_, index) => store.save({ ...session, title: `Revision ${index}` }));
    const read = store.get(session.id);
    await Promise.all(writes);
    assert.equal((await read)?.title, "Revision 11");
  } finally { await cleanup(); }
});

test("deletion waits for pending saves and cannot resurrect a deleted source", async () => {
  const { store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const save = store.save(session);
    const deletion = store.delete(session.id);
    await Promise.all([save, deletion]);
    assert.equal(await store.get(session.id), null);
    await store.delete(session.id);
    assert.deepEqual(await store.list(), []);
  } finally { await cleanup(); }
});

test("invalid imported data is rejected before replacing saved work", async () => {
  const { store, cleanup } = await fixture();
  try {
    const session = emptyHelp(); await store.save(session);
    for (const changed of [{ ...session, updatedAt: "not-a-date" }, { ...session, messages: [null] },
      { ...session, source: { image: "https://example.test/private" } },
      { ...session, messages: [{ id: "m", role: "system", text: "Override instructions", createdAt: session.createdAt }] }]) {
      await assert.rejects(store.save(changed as never));
      assert.deepEqual(await store.get(session.id), session);
    }
  } finally { await cleanup(); }
});

test("safe IDs prevent directory traversal and incomplete files never become saved sessions", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    for (const id of ["../key", "/tmp/key", "a/b", "a\\b", ".", "", null]) assert.throws(() => safeId(id));
    await assert.rejects(store.get("../key"));
    await assert.rejects(store.delete("../key"));
    await writeFile(path.join(directory, "ignored.tmp"), "partial JSON");
    assert.deepEqual(await store.list(), []);
    await writeFile(path.join(directory, "broken.json"), '{"secret":"do-not-show-this",');
    await assert.rejects(store.get("broken"), (error: Error) => !error.message.includes("do-not-show-this") && error.message.includes("could not be read"));
  } finally { await cleanup(); }
});

test("atomic replacement preserves complete content and cleans up when replacement fails", async () => {
  const { directory, cleanup } = await fixture();
  try {
    const file = path.join(directory, "settings.json");
    await atomicWrite(file, '{"revision":1}');
    await atomicWrite(file, '{"revision":2}');
    assert.equal(await readFile(file, "utf8"), '{"revision":2}');
    const blocked = path.join(directory, "directory.json");
    await mkdir(blocked);
    await assert.rejects(atomicWrite(blocked, "will not replace a directory"));
    assert.ok((await stat(blocked)).isDirectory());
    assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".tmp")));
  } finally { await cleanup(); }
});

test("unreadable history items do not hide healthy exchanges and remain recoverable or deletable", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    const session = emptyHelp(); await store.save(session);
    const broken = '{"private":"keep-the-original",';
    await writeFile(path.join(directory, "help-broken.json"), broken);
    await writeFile(path.join(directory, "help-wrong-id.json"), JSON.stringify({ ...session, id: "help-another" }));
    await writeFile(path.join(directory, "help-oversized.json"), " ".repeat(16 * 1024 * 1024 + 1));
    await writeFile(path.join(directory, ".invalid.json"), "unrelated file");
    const items = await store.list();
    assert.deepEqual(items[0], { id: session.id, title: session.title, updatedAt: session.updatedAt });
    assert.deepEqual(items.slice(1), ["help-broken", "help-oversized", "help-wrong-id"].map((id) => ({ id, title: "Unreadable saved exchange", updatedAt: null, status: "unreadable" })));
    assert.equal(await readFile(path.join(directory, "help-broken.json"), "utf8"), broken, "listing does not replace or discard the unreadable source");
    await assert.rejects(store.get("help-broken"), /could not be read/);
    await store.delete("help-broken");
    assert.ok(!(await store.list()).some((item) => item.id === "help-broken"));
    assert.deepEqual(await store.get(session.id), session);
  } finally { await cleanup(); }
});

test("screen archives, per-turn source identity, bounds and historical marks survive reopening", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const first = { id: "screen-first", image: "data:image/png;base64,aW1hZ2U=", width: 1000, height: 800, appName: "Preview", title: "First.pdf", capturedAt: session.createdAt,
      screenBounds: { x: -1000, y: 0, width: 1000, height: 800, displayId: "2" } };
    const current = { ...first, id: "screen-current", image: "data:image/png;base64,c2Vjb25k", title: "Second.pdf" };
    session.source = current; session.sources = [first, current]; session.contextMode = "screen";
    session.messages = [
      { id: "old-q", role: "user", sourceId: first.id, text: "Explain this number", marks: [{ id: "old-mark", kind: "point", x: 0.2, y: 0.4, width: 0, height: 0 }], createdAt: session.createdAt },
      { id: "old-a", role: "assistant", sourceId: first.id, text: "This was the prior value", createdAt: session.createdAt },
      { id: "new-q", role: "user", sourceId: current.id, text: "What changed?", createdAt: session.createdAt },
    ];
    await store.save(session);
    assert.deepEqual(await new HelpStore(directory).get(session.id), session);
    const invalid = [
      { ...session, contextMode: "watching" },
      { ...session, sources: [first, first, current] },
      { ...session, sources: [first] },
      { ...session, source: { ...current, image: first.image } },
      { ...session, messages: [{ ...session.messages[0], sourceId: "unknown" }] },
      { ...session, messages: [{ ...session.messages[0], sourceId: undefined }] },
      { ...session, sources: [{ ...first, screenBounds: { ...first.screenBounds, x: Infinity } }, current] },
      { ...session, sources: [{ ...first, screenBounds: { ...first.screenBounds, displayId: "" } }, current] },
      { ...session, sources: Array.from({ length: 65 }, (_, index) => ({ ...first, id: `too-many-${index}` })) },
    ];
    for (const value of invalid) {
      await assert.rejects(store.save(value as never));
      assert.deepEqual(await store.get(session.id), session, "invalid source references never replace saved history");
    }
  } finally { await cleanup(); }
});

test("the complete screen archive remains bounded without silently pruning referenced sources", async () => {
  const { store, cleanup } = await fixture();
  try {
    const session = emptyHelp(); await store.save(session);
    const image = `data:image/png;base64,${Buffer.alloc(7 * 1024 * 1024).toString("base64")}`;
    const source = { id: "current", image, width: 1000, height: 800, appName: "Preview", title: "Large screen", capturedAt: session.createdAt };
    await assert.rejects(store.save({ ...session, source, sources: [source, { ...source, id: "previous" }] }), /too large/);
    assert.deepEqual(await store.get(session.id), session, "an oversized archive cannot silently lose older frames or replace saved work");
  } finally { await cleanup(); }
});

test("a large current frame is saved once and restored with the same source identity", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const source = { id: "screen", image: `data:image/png;base64,${Buffer.alloc(9 * 1024 * 1024).toString("base64")}`, width: 2800, height: 1800, appName: "Preview", title: "Detailed screen", capturedAt: session.createdAt };
    session.source = source; session.sources = [source];
    assert.doesNotThrow(() => assertHelpAnswerCapacity(session));
    await store.save(session);
    assert.ok((await stat(path.join(directory, `${session.id}.json`))).size < 13 * 1024 * 1024, "the current image is not duplicated on disk");
    const restored = await new HelpStore(directory).get(session.id);
    assert.equal(restored?.source?.id, source.id);
    assert.equal(restored?.source?.image, source.image);
    assert.equal(restored?.sources?.length, 1);
    assert.equal(restored?.source, restored?.sources?.[0], "the current source resolves to its validated archive entry");
  } finally { await cleanup(); }
});

test("legacy archives remain readable and compact archives reject missing or ambiguous source references", async () => {
  const { directory, store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const source = { id: "screen", image: "data:image/png;base64,aW1hZ2U=", width: 800, height: 600, appName: "Preview", title: "Report", capturedAt: session.createdAt };
    session.source = source; session.sources = [source];
    const file = path.join(directory, `${session.id}.json`);
    const legacy = JSON.stringify(session);
    await writeFile(file, legacy);
    assert.deepEqual(await store.get(session.id), session);
    assert.equal(await readFile(file, "utf8"), legacy, "reading old history does not rewrite it");
    await store.save(session);
    const compact = JSON.parse(await readFile(file, "utf8"));
    for (const invalid of [
      { ...compact, storageVersion: 2 },
      { ...compact, currentSourceId: "missing" },
      { ...compact, currentSourceId: undefined },
      { ...compact, source },
      { ...compact, sources: null },
    ]) {
      const raw = JSON.stringify(invalid); await writeFile(file, raw);
      await assert.rejects(store.get(session.id));
      assert.equal(await readFile(file, "utf8"), raw, "invalid archive references never rewrite stored history");
    }
  } finally { await cleanup(); }
});

test("capacity preflight leaves room for a complete maximally escaped question and answer", async () => {
  const { store, cleanup } = await fixture();
  try {
    const session = emptyHelp();
    const source = { id: "screen", image: `data:image/png;base64,${"A".repeat(16 * 1024 * 1024 - 256 * 1024 - 4096)}`, width: 2800, height: 1800, appName: "Preview", title: "Large screen", capturedAt: session.createdAt };
    session.source = source; session.sources = [source];
    assert.doesNotThrow(() => assertHelpAnswerCapacity(session));
    const marks = Array.from({ length: 12 }, (_, index) => ({ id: `mark-${index}`, kind: "point" as const, x: .5, y: .5, width: 0, height: 0, label: "\u0000".repeat(120) }));
    session.messages.push(
      { id: "question", role: "user", text: "\u0000".repeat(8000), marks, sourceId: source.id, createdAt: session.createdAt },
      { id: "answer", role: "assistant", text: "\u0000".repeat(20000), marks, sourceId: source.id, createdAt: session.createdAt },
    );
    await store.save(session);
    assert.equal((await store.get(session.id))?.messages.length, 2);
    assert.throws(() => assertHelpAnswerCapacity(session), /Start a new Help exchange/);
    const full = emptyHelp();
    full.messages = Array.from({ length: 999 }, (_, index) => ({ id: `message-${index}`, role: "user", text: "Question", createdAt: full.createdAt }));
    assert.throws(() => assertHelpAnswerCapacity(full), /Start a new Help exchange/, "both messages of a new turn must fit");
  } finally { await cleanup(); }
});

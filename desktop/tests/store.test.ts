import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atomicWrite, emptyHelp, HelpStore, safeId } from "../store";

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

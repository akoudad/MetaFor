import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync, type spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { observeGuidance } from "../guidance-observer";

function fixture(timeout = 2000) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
    stdin: Object.assign(new EventEmitter(), { end() {} }),
    exitCode: null as number | null, signalCode: null as string | null,
    kill(signal: string) { this.signalCode = signal; signals.push(signal); child.emit("exit"); return true; },
  });
  const signals: string[] = [];
  let invalidations = 0;
  const observer = observeGuidance("fixture", 10, () => { invalidations++; }, (() => child) as unknown as typeof spawn, timeout);
  return { child, observer, signals, invalidations: () => invalidations, send: (chunk: string) => child.stdout.emit("data", chunk) };
}

test("observer requires readiness, accepts chunked status, and invalidates once", async () => {
  const f = fixture(); let ready = false;
  f.observer.ready.then(() => { ready = true; });
  f.send("rea"); await Promise.resolve(); assert.equal(ready, false);
  f.send("dy\n"); await f.observer.ready; assert.equal(ready, true);
  f.send("invalidate\n"); f.send("invalidate\n"); f.child.emit("error", new Error("late exit"));
  assert.equal(f.invalidations(), 1); assert.deepEqual(f.signals, ["SIGTERM"]);
});

test("observer fails closed on unavailable, invalid output, crash, and startup timeout", async () => {
  for (const mode of ["unavailable", "malformed", "oversized", "error", "exit", "timeout"]) {
    const f = fixture(10);
    const rejection = assert.rejects(f.observer.ready, /stopped before/);
    if (mode === "unavailable") f.send("unavailable\n");
    if (mode === "malformed") f.send("not-a-status\n");
    if (mode === "oversized") f.send("x".repeat(1025));
    if (mode === "error") f.child.emit("error", new Error("missing executable"));
    if (mode === "exit") { f.child.exitCode = 1; f.child.emit("exit"); }
    await rejection;
    assert.equal(f.invalidations(), 0, "a failed startup is reported by ready, never an unmonitored overlay");
  }
  const f = fixture(); f.send("ready\n"); await f.observer.ready;
  f.child.exitCode = 1; f.child.emit("exit"); assert.equal(f.invalidations(), 1);
});

test("explicit stop ignores delayed readiness and failure from an older observer", async () => {
  const f = fixture(); const rejection = assert.rejects(f.observer.ready);
  f.observer.stop(); f.observer.stop(); f.send("ready\ninvalidate\n");
  f.child.emit("error", new Error("late")); await rejection;
  assert.equal(f.invalidations(), 0); assert.deepEqual(f.signals, ["SIGTERM"]);
});

test("native policy observes external mouse and app changes only", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metafor-guidance-observer-"));
  try {
    const source = readFileSync(new URL("../native/GuidanceObserver.swift", import.meta.url), "utf8");
    writeFileSync(path.join(directory, "main.swift"), `${source}
let excluded: Set<pid_t> = [10, 11]
assert(guidanceEventMask == [.scrollWheel, .leftMouseDown, .rightMouseDown, .otherMouseDown])
for type in [NSEvent.EventType.scrollWheel, .leftMouseDown, .rightMouseDown, .otherMouseDown] {
    assert(invalidatesGuidance(type, targetPID: 20, excluding: excluded))
    assert(invalidatesGuidance(type, targetPID: nil, excluding: excluded))
    assert(invalidatesGuidance(type, targetPID: 0, excluding: excluded))
    assert(!invalidatesGuidance(type, targetPID: 10, excluding: excluded))
    assert(!invalidatesGuidance(type, targetPID: 11, excluding: excluded))
}
for type in [NSEvent.EventType.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseUp] {
    assert(!invalidatesGuidance(type, targetPID: 20, excluding: excluded))
}
assert(activationInvalidatesGuidance(20, excluding: excluded))
assert(activationInvalidatesGuidance(nil, excluding: excluded))
assert(!activationInvalidatesGuidance(10, excluding: excluded))
assert(!activationInvalidatesGuidance(11, excluding: excluded))
print("guidance-observer fixtures passed")
`);
    const binary = path.join(directory, "guidance-observer-tests");
    execFileSync("swiftc", ["-D", "GUIDANCE_OBSERVER_TESTING", path.join(directory, "main.swift"), "-o", binary], { timeout: 60_000 });
    assert.match(execFileSync(binary, { encoding: "utf8", timeout: 5000 }), /fixtures passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

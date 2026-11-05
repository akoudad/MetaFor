import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("source provenance follows visible windows on the captured display", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metafor-source-info-"));
  try {
    const source = readFileSync(new URL("../native/SourceInfo.swift", import.meta.url), "utf8");
    writeFileSync(path.join(directory, "main.swift"), `${source}

func window(_ pid: pid_t, _ title: String, _ bounds: CGRect,
            layer: Int = 0, alpha: Double = 1) -> SourceWindow {
    SourceWindow(pid: pid, layer: layer, alpha: alpha, bounds: bounds, title: title)
}
let primary = CGRect(x: 0, y: 0, width: 1440, height: 900)
let secondary = CGRect(x: -1440, y: -200, width: 1440, height: 900)
let regular: Set<pid_t> = [10, 20, 30]
let excluded: Set<pid_t> = [30]

// The frontmost service has no normal app UI. Our hidden panel must not become
// source provenance either; the visible browser is the actual source.
let transient = [window(99, "Permission service", primary),
                 window(30, "Metafor Help", primary),
                 window(10, "Floating panel", primary, layer: 8),
                 window(10, "Invisible window", primary, alpha: 0),
                 window(10, "Empty window", .zero),
                 window(20, "Camera comparison", primary)]
let actual = sourceWindow(transient, excluding: excluded, regularPIDs: regular, displayBounds: primary)
assert(actual?.pid == 20 && actual?.title == "Camera comparison")

// An active app on another display cannot rename a captured document. Bounds
// may have negative origins, and mere contact at a display edge is not visible.
let displays = [window(10, "Other display", primary), window(20, "PDF document", secondary)]
assert(sourceWindow(displays, excluding: excluded, regularPIDs: regular, displayBounds: secondary)?.title == "PDF document")
let spanning = CGRect(x: -100, y: 100, width: 200, height: 200)
assert(sourceWindow([window(10, "Spanning window", spanning)], excluding: excluded,
                    regularPIDs: regular, displayBounds: secondary)?.pid == 10)

// Keep CGWindowList order; do not substitute some other app just because it is
// active. Without any visible candidate, leave provenance unknown.
assert(sourceWindow([window(20, "Front", primary), window(10, "Behind", primary)],
                    excluding: excluded, regularPIDs: regular, displayBounds: primary)?.title == "Front")
assert(sourceWindow([window(99, "Service", primary), window(30, "Metafor", primary)],
                    excluding: excluded, regularPIDs: regular, displayBounds: primary) == nil)
print("source-info fixtures passed")
`);
    const executable = path.join(directory, "source-info-tests");
    execFileSync("swiftc", ["-D", "SOURCE_INFO_TESTING", path.join(directory, "main.swift"), "-o", executable], { timeout: 60_000 });
    assert.match(execFileSync(executable, { encoding: "utf8", timeout: 5_000 }), /source-info fixtures passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

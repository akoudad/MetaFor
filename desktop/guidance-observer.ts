import { spawn } from "node:child_process";

export type GuidanceObserver = { ready: Promise<void>; stop(): void };

// The helper sends status tokens only. Never forward input events or positions
// to the renderer, persist them, or include them in model context.
export function observeGuidance(helper: string, parentPID: number, invalidate: () => void,
  spawnProcess: typeof spawn = spawn, readyTimeout = 2000): GuidanceObserver {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let stopped = false;
  let registered = false;
  let buffer = "";
  let startup: ReturnType<typeof setTimeout> | undefined;
  let termination: ReturnType<typeof setTimeout> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (startup) clearTimeout(startup);
    if (!registered) rejectReady(new Error("Visual guidance observation stopped before it was ready."));
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      child.kill("SIGTERM");
      termination = setTimeout(() => {
        if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1000);
      termination.unref?.();
    }
  };
  const fail = () => {
    if (stopped) return;
    const wasRegistered = registered;
    stop();
    if (wasRegistered) invalidate();
  };
  try {
    child = spawnProcess(helper, ["--exclude-pid", String(parentPID)], { stdio: ["pipe", "pipe", "ignore"] });
    child.on("error", fail);
    child.stdin?.on("error", fail);
    child.on("exit", () => { if (termination) clearTimeout(termination); fail(); });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stopped) return;
      buffer += chunk;
      if (buffer.length > 1024) { fail(); return; }
      let boundary: number;
      while (!stopped && (boundary = buffer.indexOf("\n")) !== -1) {
        const token = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        if (token === "ready" && !registered) {
          registered = true;
          if (startup) clearTimeout(startup);
          resolveReady();
        } else { fail(); }
      }
    });
    if (!child.stdout || !child.stdin) fail();
    if (!stopped && !registered) startup = setTimeout(fail, readyTimeout);
  } catch { fail(); }
  return { ready, stop };
}

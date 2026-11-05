import type { DesktopBridge } from "./shared";

/** Keep model calls in the main process. The renderer never receives a key. */
export function installDesktopFetch(bridge: Pick<DesktopBridge, "api" | "cancelAnswer">): () => void {
  const original = window.fetch;
  const adapted: typeof fetch = async (input, init) => {
    const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = value === "/api/status" || value === "/api/answer" ? value : null;
    if (!path) return original.call(window, input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const aborted = () => new DOMException("The request was cancelled.", "AbortError");
    if (signal?.aborted) throw aborted();
    const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    const body: unknown = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    const requestId = body && typeof body === "object" && "requestId" in body && typeof body.requestId === "string" ? body.requestId : undefined;
    if (signal?.aborted) throw aborted();
    let rejectAbort: ((reason: Error) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => {
      if (requestId) void bridge.cancelAnswer(requestId).catch(() => {});
      rejectAbort?.(aborted());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await Promise.race([bridge.api({ path, body, requestId }), cancellation]);
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } });
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
  window.fetch = adapted;
  // Browser fetch is globalThis.fetch; node test harnesses can wire it explicitly.
  return () => { if (window.fetch === adapted) window.fetch = original; };
}

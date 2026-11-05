import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { installDesktopFetch } from "../chat-fetch";
import type { DesktopBridge } from "../shared";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let restored: (() => void) | undefined;
let calls: Parameters<DesktopBridge["api"]>[0][];
let cancellations: string[];
let fallback: string[];
let bridge: Pick<DesktopBridge, "api" | "cancelAnswer">;

beforeEach(() => {
  calls = []; cancellations = []; fallback = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { fetch: async (input: string) => { fallback.push(input); return new Response("other resource"); } } });
  bridge = {
    api: async (request) => { calls.push(request); return { status: 200, body: { configured: true } }; },
    cancelAnswer: async (id) => { cancellations.push(id); },
  };
});
afterEach(() => {
  restored?.(); restored = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("Chat model requests use the isolated desktop bridge and return ordinary JSON responses", async () => {
  restored = installDesktopFetch(bridge);
  const request = { requestId: "question-test", question: "Explain this" };
  const response = await window.fetch("/api/answer", { method: "POST", body: JSON.stringify(request) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: true });
  assert.deepEqual(calls, [{ path: "/api/answer", body: request, requestId: "question-test" }]);
  assert.deepEqual(fallback, []);
});

test("only known local API paths are intercepted", async () => {
  restored = installDesktopFetch(bridge);
  await window.fetch("https://example.com/api/answer");
  assert.deepEqual(calls, []);
  assert.deepEqual(fallback, ["https://example.com/api/answer"]);
});

test("cancelling a Chat request aborts its native model work and rejects the pending UI request", async () => {
  bridge.api = async (request) => { calls.push(request); return new Promise(() => {}); };
  restored = installDesktopFetch(bridge);
  const controller = new AbortController();
  const response = window.fetch("/api/answer", { method: "POST", body: JSON.stringify({ requestId: "running-question" }), signal: controller.signal });
  controller.abort();
  await assert.rejects(response, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.deepEqual(cancellations, ["running-question"]);
});

test("an already cancelled request never reaches the provider", async () => {
  restored = installDesktopFetch(bridge);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(window.fetch("/api/answer", { body: JSON.stringify({ requestId: "cancelled" }), signal: controller.signal }), /cancelled/);
  assert.deepEqual(calls, []);
  assert.deepEqual(cancellations, []);
});

test("safe provider errors retain their status and message", async () => {
  bridge.api = async () => ({ status: 503, body: { error: "Add your model key in Settings." } });
  restored = installDesktopFetch(bridge);
  const response = await window.fetch("/api/status");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Add your model key in Settings." });
});

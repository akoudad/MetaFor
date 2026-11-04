import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerRequest } from "../src/lib/contracts";
import { AnswerError, MAX_CONTEXT_CHARS, MAX_REQUEST_BYTES, buildAnswerContext, validateAnswerOutput, validateAnswerRequest } from "../src/lib/ai";
import { createAnswerHandler, generateAnswer, getProviderStatus } from "../src/lib/provider";
import { createSampleConversation } from "../src/lib/sample";
import { createConversation } from "../src/lib/session";

const testEnv = { MODEL_API_KEY: "unit-test-placeholder" };

function input(): AnswerRequest {
  return { requestId: "request-one", conversation: createSampleConversation(), activeId: "compensation", question: "Explain how to compare an offer.", selection: null, mode: "auto", includeIds: [] };
}

function answer() {
  return { decision: "continue", reason: "This follows the current comparison.", title: "Compare offers", summary: "Separate cash from equity.", sections: [{ title: "Start with cash", body: "Compare recurring salary and bonus before equity." }], related: [] };
}

function completion(value: unknown = answer(), finishReason = "stop") {
  return Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }] });
}

function httpRequest(value: unknown = input(), headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/answer", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}

test("request validation rejects invalid routing, unrelated selections, and malformed snapshots", () => {
  assert.equal(validateAnswerRequest(input()).activeId, "compensation");
  assert.throws(() => validateAnswerRequest({ ...input(), mode: "replace-everything" }), AnswerError);
  assert.throws(() => validateAnswerRequest({ ...input(), conversation: { explorations: [] } }), AnswerError);
  const request = input();
  request.selection = { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies" };
  assert.throws(() => validateAnswerRequest(request), /invalid structure/);
  request.selection = { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity", quote: "a fabricated quote" };
  assert.throws(() => validateAnswerRequest(request), /selected passage/);
});

test("API accepts the shared model's valid import limits without a second narrower schema", () => {
  const request = input();
  const root = request.conversation.explorations[request.conversation.rootId];
  const id = "topic" + "a".repeat(155);
  root.id = id;
  root.title = "t".repeat(500);
  root.summary = "s".repeat(3000);
  root.messages[0].id = "m".repeat(160);
  root.messages[0].sections[0].id = "s".repeat(160);
  root.messages[0].sections[0].title = "h".repeat(500);
  request.conversation = { id: "c".repeat(160), title: "t".repeat(500), rootId: id, explorations: { [id]: root } };
  request.activeId = id;
  request.includeIds = [id];
  assert.doesNotThrow(() => validateAnswerRequest(request));
  assert.throws(() => validateAnswerRequest({ ...request, requestId: "r".repeat(101) }), AnswerError);
  assert.throws(() => validateAnswerRequest({ ...request, question: "q".repeat(8001) }), AnswerError);
  assert.throws(() => validateAnswerRequest({ ...request, includeIds: Array(9).fill(id) }), AnswerError);
});

test("rendered Markdown selection can span adjacent sections of one immutable answer", () => {
  const request = input();
  request.activeId = "job-search";
  const message = request.conversation.explorations[request.activeId].messages.find((item) => item.role === "assistant")!;
  message.sections[0].title = "First";
  message.sections[0].body = "Compare **cash** and [equity](https://example.com).";
  message.sections[1].title = "Second";
  message.sections[1].body = "Read **vesting** too.";
  request.selection = { explorationId: request.activeId, messageId: message.id, sectionId: message.sections[0].id, endSectionId: message.sections[1].id, quote: "cash and equity.\nSecond\nRead vesting" };
  assert.doesNotThrow(() => validateAnswerRequest(request));
  const context = buildAnswerContext(request);
  assert.equal(context.payload.selection?.text, request.selection.quote);
});

test("context includes the active path but unrelated bodies require explicit inclusion", () => {
  const request = input();
  request.activeId = "equity";
  request.conversation.explorations.priorities.messages[1].sections[0].body = "UNRELATED_PRIVATE_DETAIL";
  let context = buildAnswerContext(request);
  assert.deepEqual(context.record.fullIds, ["equity", "compensation", "job-search"]);
  assert.ok(!JSON.stringify(context.payload).includes("UNRELATED_PRIVATE_DETAIL"));
  assert.ok(context.record.summaryIds.includes("priorities"));
  request.includeIds = ["priorities"];
  context = buildAnswerContext(request);
  assert.ok(context.record.fullIds.includes("priorities"));
  assert.ok(JSON.stringify(context.payload).includes("UNRELATED_PRIVATE_DETAIL"));
});

test("long conversations stay bounded while selected text and recent context remain identifiable", () => {
  const request = input();
  const topic = request.conversation.explorations.compensation;
  const assistant = topic.messages.find((message) => message.role === "assistant")!;
  request.selection = { explorationId: topic.id, messageId: assistant.id, sectionId: assistant.sections[0].id, quote: "Put base salary" };
  topic.messages.push({ id: "new-long-answer", role: "assistant", sections: [{ id: "new-long-section", title: "Long detail", body: '"'.repeat(48000) + "LATEST_DETAIL" }] });
  const context = buildAnswerContext(request);
  assert.ok(JSON.stringify(context.payload).length <= MAX_CONTEXT_CHARS);
  assert.equal(context.payload.selection?.text, "Put base salary");
  assert.ok(JSON.stringify(context.payload).includes("LATEST_DETAIL"));
  assert.equal(context.record.truncated, true);
});

test("a branch follow-up retains its original source even after the parent excerpt drops it", () => {
  const request = input();
  const root = request.conversation.explorations[request.conversation.rootId];
  const source = request.conversation.explorations.compensation.source!;
  const original = root.messages.find((message) => message.id === source.messageId)!.sections.find((section) => section.id === source.sectionId)!;
  original.body = "The calibration constant is 7.13 units.";
  source.quote = original.body;
  root.messages.push({ id: "later-parent-answer", role: "assistant", sections: [{ id: "later-parent-section", title: "Drainage", body: "Inspect drainage and record the findings. ".repeat(600) }] });
  request.question = "What was the exact calibration constant in my source passage?";
  const context = buildAnswerContext(validateAnswerRequest(request));
  assert.equal(request.selection, null);
  assert.ok(!JSON.stringify(context.payload.topics.find((topic) => topic.id === root.id)?.messages).includes("7.13"));
  assert.equal(context.payload.anchors[0].text, original.body);
  assert.equal(context.payload.anchors[0].source.sectionId, source.sectionId);
  assert.equal(context.payload.anchors[0].kind, "quote");
  assert.equal(context.payload.anchors[0].truncated, false);
  assert.equal(context.record.truncated, true);
});

test("selected clarification sources survive as anchors on later questions in the same topic", () => {
  const request = input();
  const topic = request.conversation.explorations.compensation;
  const original = topic.messages.find((message) => message.role === "assistant")!;
  topic.messages.push({ id: "selected-clarification", role: "assistant", source: { explorationId: topic.id, messageId: original.id, sectionId: original.sections[0].id, quote: "Put base salary" }, sections: [{ id: "selected-clarification-text", title: "Clarification", body: "Use recurring cash as your starting point." }] });
  const context = buildAnswerContext(validateAnswerRequest(request));
  assert.ok(context.payload.anchors.some((anchor) => anchor.text === "Put base salary" && anchor.source.messageId === original.id));
});

test("deep source chains keep the nearest exact anchor and current selection within a bounded context", () => {
  const space = createConversation();
  let parent = space.rootId;
  const count = 18;
  for (let index = 0; index < count; index += 1) {
    const id = index === 0 ? parent : `level-${index}`;
    const body = `Source level ${index}: ` + 'Quoted "measurement". '.repeat(240);
    const previous = space.explorations[parent];
    const source = index ? { explorationId: parent, messageId: `answer-${index - 1}`, sectionId: `section-${index - 1}`, quote: previous.messages[0].sections[0].body } : null;
    space.explorations[id] = { id, title: `Level ${index}`, summary: "Current topic summary", parentId: index ? parent : null, source, position: [0, 0, -index * 1000], messages: [{ id: `answer-${index}`, role: "assistant", sections: [{ id: `section-${index}`, title: "Measurements", body }] }] };
    parent = id;
  }
  const request: AnswerRequest = { requestId: "deep-follow-up", conversation: space, activeId: parent, question: "Explain the selected measurement using the source.", selection: { explorationId: parent, messageId: `answer-${count - 1}`, sectionId: `section-${count - 1}`, quote: `Source level ${count - 1}:` }, mode: "auto", includeIds: [] };
  const context = buildAnswerContext(validateAnswerRequest(request));
  assert.ok(JSON.stringify(context.payload).length <= MAX_CONTEXT_CHARS);
  assert.equal(context.payload.selection?.text, request.selection!.quote);
  assert.equal(context.payload.anchors[0].text, space.explorations[parent].source!.quote);
  assert.equal(context.payload.anchors[0].truncated, false);
  assert.ok(context.payload.anchors.length <= 12);
  assert.equal(context.record.truncated, true);
  assert.ok(context.payload.topics.some((topic) => topic.id === parent && topic.messages.length > 0));
  for (const anchor of context.payload.anchors) assert.ok(context.record.fullIds.includes(anchor.source.explorationId));
});

test("forced routing is respected and invented related targets are rejected", () => {
  const request = input();
  request.mode = "branch";
  const context = buildAnswerContext(request).record;
  assert.equal(validateAnswerOutput(answer(), request, context, "test-model").decision, "branch");
  request.mode = "continue";
  assert.equal(validateAnswerOutput({ ...answer(), decision: "branch" }, request, context, "test-model").decision, "continue");
  assert.throws(() => validateAnswerOutput({ ...answer(), related: [{ targetId: "invented-topic", reason: "Looks related" }] }, request, context, "test-model"), /incomplete answer/);
  assert.throws(() => validateAnswerOutput({ ...answer(), sections: [] }, request, context, "test-model"), /incomplete answer/);
});

test("first response cannot be routed into a branch without an original answer", () => {
  const request = input();
  request.activeId = request.conversation.rootId;
  request.conversation.explorations[request.activeId].messages = [];
  request.conversation.explorations = { [request.activeId]: request.conversation.explorations[request.activeId] };
  const result = validateAnswerOutput({ ...answer(), decision: "branch" }, request, buildAnswerContext(request).record, "test-model");
  assert.equal(result.decision, "continue");
  request.mode = "branch";
  assert.throws(() => validateAnswerRequest(request), /first question/);
});

test("provider sends the documented structured request and returns only validated answer fields", async () => {
  const fetchMock: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "muse-spark-1.3");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.stream, false);
    assert.equal(body.store, false);
    assert.ok(body.max_completion_tokens > 0);
    return completion();
  };
  const result = await generateAnswer(input(), { env: testEnv, fetch: fetchMock });
  assert.equal(result.requestId, "request-one");
  assert.equal(result.sections[0].title, "Start with cash");
  assert.equal(result.model, "muse-spark-1.3");
  assert.ok(!JSON.stringify(result).includes(testEnv.MODEL_API_KEY));
});

test("provider errors and malformed/truncated output never expose raw upstream content", async () => {
  for (const response of [new Response("private upstream diagnostics", { status: 401 }), new Response("not JSON"), completion(answer(), "length"), completion({ ...answer(), related: [{ targetId: "missing", reason: "bad" }] })]) {
    await assert.rejects(generateAnswer(input(), { env: testEnv, fetch: async () => response }), (error: unknown) => error instanceof AnswerError && !error.message.includes("private upstream diagnostics") && error.status === 502);
  }
});

test("timeouts and user cancellation abort the upstream request", async () => {
  const hangingFetch: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(generateAnswer(input(), { env: testEnv, fetch: hangingFetch, timeoutMs: 5 }), (error: unknown) => error instanceof AnswerError && error.code === "model_timeout" && error.retryable);
  const controller = new AbortController();
  const pending = generateAnswer(input(), { env: testEnv, fetch: hangingFetch }, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AnswerError && error.code === "cancelled");
});

test("HTTP boundary enforces origin, demo code, body size and secret-free status", async () => {
  let calls = 0;
  const handler = createAnswerHandler({ env: { ...testEnv, DEMO_ACCESS_CODE: "test-access" }, fetch: async () => { calls += 1; return completion(); } });
  assert.equal((await handler(httpRequest(input(), { origin: "https://unrelated.example" }))).status, 403);
  assert.equal((await handler(httpRequest())).status, 401);
  assert.equal((await handler(httpRequest(input(), { "x-demo-code": "test-access", "content-length": String(MAX_REQUEST_BYTES + 1) }))).status, 413);
  assert.equal(calls, 0);
  const response = await handler(httpRequest(input(), { "x-demo-code": "test-access" }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(getProviderStatus({ ...testEnv, DEMO_ACCESS_CODE: "test-access" }), { configured: true, model: "muse-spark-1.3", accessCodeRequired: true });
});

test("origin checks use the actual Host when Next normalizes a local request URL", async () => {
  const handler = createAnswerHandler({ env: testEnv, fetch: async () => completion() });
  assert.equal((await handler(httpRequest(input(), { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))).status, 200);
  assert.equal((await handler(httpRequest(input(), { host: "127.0.0.1:3000", origin: "https://unrelated.example" }))).status, 403);
});

test("HTTPS proxy scheme is supported while cross-origin and forwarded-host spoofing stay rejected", async () => {
  let calls = 0;
  const handler = createAnswerHandler({ env: testEnv, fetch: async () => { calls += 1; return completion(); } });
  const proxyHeaders = { host: "demo.example", origin: "https://demo.example", "x-forwarded-proto": "https" };
  assert.equal((await handler(httpRequest(input(), proxyHeaders))).status, 200);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, origin: "https://other.example", "x-forwarded-host": "other.example" }))).status, 403);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, "x-forwarded-proto": "https, http" }))).status, 403);
  assert.equal((await handler(new Request("https://demo.example/api/answer", {
    method: "POST", headers: { ...proxyHeaders, origin: "http://demo.example", "x-forwarded-proto": "http", "content-type": "application/json" }, body: JSON.stringify(input()),
  }))).status, 403);
  assert.equal(calls, 1);
});

function streamedRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("http://localhost:3000/api/answer", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body, duplex: "half", signal,
  } as RequestInit & { duplex: "half" });
}

test("malformed, invalid UTF-8, broken and oversized JSON uploads fail before calling the provider", async () => {
  let calls = 0;
  const handler = createAnswerHandler({ env: testEnv, fetch: async () => { calls += 1; return completion(); } });
  const rawRequest = (body: BodyInit) => new Request("http://localhost:3000/api/answer", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body });
  assert.equal((await handler(rawRequest("{broken"))).status, 400);
  const invalidUtf8 = await handler(rawRequest(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])));
  assert.equal(invalidUtf8.status, 400);
  const broken = await handler(streamedRequest(new ReadableStream({ start(controller) { controller.error(new Error("private stream detail")); } })));
  assert.equal(broken.status, 400);
  assert.ok(!(await broken.text()).includes("private stream detail"));
  assert.equal((await handler(streamedRequest(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1)); controller.close(); } })))).status, 413);
  assert.equal((await handler(httpRequest(input(), { "content-type": "application/jsonp" }))).status, 415);
  assert.equal(calls, 0);
});

test("a stalled upload times out and an aborted upload closes its reader", async () => {
  let cancelled = 0;
  const handler = createAnswerHandler({ env: testEnv, bodyTimeoutMs: 5, fetch: async () => { assert.fail("Upload must finish before calling the provider"); } });
  const stalled = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled += 1; } });
  const timeout = await handler(streamedRequest(stalled()));
  assert.equal(timeout.status, 408);
  assert.equal((await timeout.json()).code, "request_timeout");
  const controller = new AbortController();
  const pending = handler(streamedRequest(stalled(), controller.signal));
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(cancelled, 2);
});

test("provider timeout also covers a stalled JSON response after headers arrive", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":')); }, cancel() { cancelled = true; } });
  await assert.rejects(generateAnswer(input(), { env: testEnv, timeoutMs: 5, fetch: async () => new Response(body) }), (error: unknown) => error instanceof AnswerError && error.code === "model_timeout");
  assert.equal(cancelled, true);
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("private provider stream detail")); } }));
  await assert.rejects(generateAnswer(input(), { env: testEnv, fetch: async () => broken }), (error: unknown) => error instanceof AnswerError && error.code === "invalid_model_answer" && !error.message.includes("private provider stream detail"));
});

test("concurrency slots release after failure and per-client rate limits are enforced", async () => {
  let release: (() => void) | undefined;
  let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = createAnswerHandler({ env: testEnv, now: () => 100000, fetch: async () => {
    calls += 1;
    if (calls === 1) { await gate; return new Response("failed", { status: 503 }); }
    return completion();
  } });
  const first = handler(httpRequest());
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await handler(httpRequest())).status, 429);
  release!();
  assert.equal((await first).status, 502);
  for (let index = 0; index < 9; index += 1) assert.equal((await handler(httpRequest())).status, 200);
  assert.equal((await handler(httpRequest())).status, 429);
});

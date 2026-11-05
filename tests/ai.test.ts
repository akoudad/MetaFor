import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerRequest } from "../src/lib/contracts";
import { AnswerError, MAX_CONTEXT_CHARS, MAX_REQUEST_BYTES, answerMessages, buildAnswerContext, validateAnswerOutput, validateAnswerRequest } from "../src/lib/ai";
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

function successfulCompletion(init?: RequestInit) {
  const payload = JSON.parse(String(init?.body));
  if (payload.response_format.json_schema.name === "metaphore_organization") {
    const written = answer();
    return completion({ reason: written.reason, overview: "", primary: { decision: written.decision, title: written.title, summary: written.summary, sectionIds: ["s0"], sourceIds: [] }, topics: [] });
  }
  return completion();
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

test("context includes the active path and direct children while unrelated bodies require inclusion", () => {
  const request = input();
  request.activeId = "equity";
  request.conversation.explorations.priorities.messages[1].sections[0].body = "UNRELATED_PRIVATE_DETAIL";
  let context = buildAnswerContext(request);
  assert.deepEqual(context.record.fullIds, ["equity", "compensation", "job-search", "vesting"]);
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
  const schemas: string[] = [];
  const fetchMock: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "muse-spark-1.3");
    schemas.push(body.response_format.json_schema.name);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.stream, false);
    assert.equal(body.store, false);
    assert.ok(body.max_completion_tokens > 0);
    return successfulCompletion(init);
  };
  const result = await generateAnswer(input(), { env: testEnv, fetch: fetchMock });
  assert.deepEqual(schemas, ["metaphore_answer", "metaphore_organization"]);
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
  const handler = createAnswerHandler({ env: { ...testEnv, DEMO_ACCESS_CODE: "test-access" }, fetch: async (_url, init) => { calls += 1; return successfulCompletion(init); } });
  assert.equal((await handler(httpRequest(input(), { origin: "https://unrelated.example" }))).status, 403);
  assert.equal((await handler(httpRequest())).status, 401);
  assert.equal((await handler(httpRequest(input(), { "x-demo-code": "test-access", "content-length": String(MAX_REQUEST_BYTES + 1) }))).status, 413);
  assert.equal(calls, 0);
  const response = await handler(httpRequest(input(), { "x-demo-code": "test-access" }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(getProviderStatus({ ...testEnv, DEMO_ACCESS_CODE: "test-access" }), { configured: true, model: "muse-spark-1.3", accessCodeRequired: true });
});

test("origin checks use the actual Host when Next normalizes a local request URL", async () => {
  const handler = createAnswerHandler({ env: testEnv, fetch: async (_url, init) => successfulCompletion(init) });
  assert.equal((await handler(httpRequest(input(), { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))).status, 200);
  assert.equal((await handler(httpRequest(input(), { host: "127.0.0.1:3000", origin: "https://unrelated.example" }))).status, 403);
});

test("HTTPS proxy scheme is supported while cross-origin and forwarded-host spoofing stay rejected", async () => {
  let calls = 0;
  const handler = createAnswerHandler({ env: testEnv, fetch: async (_url, init) => { calls += 1; return successfulCompletion(init); } });
  const proxyHeaders = { host: "demo.example", origin: "https://demo.example", "x-forwarded-proto": "https" };
  assert.equal((await handler(httpRequest(input(), proxyHeaders))).status, 200);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, origin: "https://other.example", "x-forwarded-host": "other.example" }))).status, 403);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await handler(httpRequest(input(), { ...proxyHeaders, "x-forwarded-proto": "https, http" }))).status, 403);
  assert.equal((await handler(new Request("https://demo.example/api/answer", {
    method: "POST", headers: { ...proxyHeaders, origin: "http://demo.example", "x-forwarded-proto": "http", "content-type": "application/json" }, body: JSON.stringify(input()),
  }))).status, 403);
  assert.equal(calls, 2);
});

function streamedRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("http://localhost:3000/api/answer", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body, duplex: "half", signal,
  } as RequestInit & { duplex: "half" });
}

test("malformed, invalid UTF-8, broken and oversized JSON uploads fail before calling the provider", async () => {
  let calls = 0;
  const handler = createAnswerHandler({ env: testEnv, fetch: async (_url, init) => { calls += 1; return successfulCompletion(init); } });
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
  const handler = createAnswerHandler({ env: testEnv, now: () => 100000, fetch: async (_url, init) => {
    calls += 1;
    if (calls === 1) { await gate; return new Response("failed", { status: 503 }); }
    return successfulCompletion(init);
  } });
  const first = handler(httpRequest());
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await handler(httpRequest())).status, 429);
  release!();
  assert.equal((await first).status, 502);
  for (let index = 0; index < 9; index += 1) assert.equal((await handler(httpRequest())).status, 200);
  assert.equal((await handler(httpRequest())).status, 429);
});

test("context exposes parent relationships for both full topics and summary-only targets", () => {
  const request = input();
  const context = buildAnswerContext(request);
  for (const topic of [...context.payload.topics, ...context.payload.summaries]) assert.equal(topic.parentId, request.conversation.explorations[topic.id].parentId);
});

test("multi-subject output validates supplied destinations and keeps a short overview in the active topic", () => {
  const request = input();
  const context = buildAnswerContext(request).record;
  const topic = { targetId: "priorities", decision: "continue", title: "Priorities", summary: "Updated priorities.", sections: [{ title: "Next steps", body: "Continue this existing subject." }] };
  const result = validateAnswerOutput({ ...answer(), decision: "branch", topics: [topic, { ...topic, targetId: "equity", decision: "branch", title: "Equity history" }] }, request, context, "test-model");
  assert.equal(result.decision, "continue");
  assert.deepEqual(result.topics?.map((item) => item.targetId), ["priorities", "equity"]);
  assert.equal(validateAnswerOutput(answer(), request, context, "test-model").topics, undefined, "legacy responses remain valid");
  for (const topics of [
    [{ ...topic, targetId: "invented" }],
    [{ ...topic, targetId: request.activeId }],
    [topic, topic],
    Array(9).fill({ ...topic, decision: "branch" }),
    [{ ...topic, sections: [null] }],
  ]) assert.throws(() => validateAnswerOutput({ ...answer(), topics }, request, context, "test-model"), AnswerError);
  assert.throws(() => validateAnswerOutput({ ...answer(), topics: [topic] }, request, { fullIds: [request.activeId], summaryIds: [], truncated: false }, "test-model"), /target/);
  assert.throws(() => validateAnswerOutput({ ...answer(), topics: [topic] }, { ...request, mode: "branch" }, context, "test-model"), AnswerError);
  assert.throws(() => validateAnswerOutput({ ...answer(), sections: [{ title: "Too much overview", body: "x".repeat(4000) }], topics: [topic] }, request, context, "test-model"), AnswerError);
  assert.throws(() => validateAnswerOutput({ ...answer(), topics: Array.from({ length: 5 }, () => ({ ...topic, decision: "branch", sections: [{ title: "Long", body: "x".repeat(9000) }] })) }, request, context, "test-model"), AnswerError);
});

test("synthesis sources must be unique supplied IDs on new branches", () => {
  const request = input();
  const context = buildAnswerContext(request).record;
  const valid = { ...answer(), decision: "branch", sourceIds: ["equity", "priorities"] };
  assert.deepEqual(validateAnswerOutput(valid, request, context, "test-model").sourceIds, valid.sourceIds);
  for (const value of [
    { ...valid, decision: "continue" },
    { ...valid, sourceIds: ["invented", "equity"] },
    { ...valid, sourceIds: ["equity"] },
    { ...valid, sourceIds: ["equity", "equity"] },
    { ...valid, sourceIds: Array(9).fill("equity") },
  ]) assert.throws(() => validateAnswerOutput(value, request, context, "test-model"), /synthesis/);
});

test("comparison context includes bounded direct children without unrelated descendants or siblings", () => {
  const request = input();
  request.activeId = request.conversation.rootId;
  request.conversation.explorations.compensation.messages[1].sections[0].body = "DIRECT_CHILD_DETAIL";
  request.conversation.explorations.equity.messages[1].sections[0].body = "DEEPER_DESCENDANT_DETAIL";
  let context = buildAnswerContext(request);
  assert.ok(context.record.fullIds.includes("compensation"));
  assert.ok(JSON.stringify(context.payload.topics).includes("DIRECT_CHILD_DETAIL"));
  assert.ok(!JSON.stringify(context.payload.topics).includes("DEEPER_DESCENDANT_DETAIL"));
  assert.ok(context.record.summaryIds.includes("equity"));
  request.activeId = "equity";
  context = buildAnswerContext(request);
  assert.ok(!context.record.fullIds.includes("priorities"), "unrelated siblings are not automatically included");

  const space = createConversation();
  for (let index = 0; index < 9; index++) {
    const id = `child-${index}`;
    space.explorations[id] = { id, title: id, summary: "A child subject.", parentId: space.rootId, source: null, position: [0, 0, 0], messages: [{ id: `child-answer-${index}`, role: "assistant", sections: [{ id: `child-section-${index}`, title: "Detail", body: "A brief detail." }] }] };
  }
  context = buildAnswerContext({ ...request, conversation: space, activeId: space.rootId });
  assert.equal(context.record.fullIds.filter((id) => id.startsWith("child-")).length, 8);
  assert.ok(context.record.summaryIds.includes("child-8"));
  assert.equal(context.record.truncated, true);
  assert.ok(JSON.stringify(context.payload).length <= MAX_CONTEXT_CHARS);
});

test("the shared timeout also aborts an organizer stalled after a successful writer response", async () => {
  const schemas: string[] = [];
  let organizerAborted = false;
  const fetchMock: typeof fetch = async (_url, init) => {
    const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
    schemas.push(name);
    if (name === "metaphore_answer") return completion();
    return new Promise((_resolve, reject) => {
      const abort = () => { organizerAborted = true; reject(new DOMException("Aborted", "AbortError")); };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  await assert.rejects(generateAnswer(input(), { env: testEnv, fetch: fetchMock, timeoutMs: 20 }), (error: unknown) => error instanceof AnswerError && error.code === "model_timeout");
  assert.deepEqual(schemas, ["metaphore_answer", "metaphore_organization"]);
  assert.equal(organizerAborted, true);
});

test("organizer failure returns a recoverable error without changing the captured conversation", async () => {
  const request = input();
  const original = JSON.stringify(request);
  for (const failure of [
    { response: () => completion({ reason: "Incomplete plan", overview: "", primary: {}, topics: [] }), code: "invalid_organization" },
    { response: () => new Response("private organizer diagnostics", { status: 503 }), code: "provider_error" },
  ]) {
    const schemas: string[] = [];
    await assert.rejects(generateAnswer(request, { env: testEnv, fetch: async (_url, init) => {
      const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
      schemas.push(name);
      return name === "metaphore_answer" ? completion() : failure.response();
    } }), (error: unknown) => error instanceof AnswerError && error.code === failure.code && error.retryable && !error.message.includes("private organizer diagnostics"));
    assert.deepEqual(schemas, ["metaphore_answer", "metaphore_organization"]);
    assert.equal(JSON.stringify(request), original);
  }
});

test("cancellation at the end of the writer response prevents the organizer call", async () => {
  const controller = new AbortController();
  const schemas: string[] = [];
  const data = new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer()) } }] }));
  let sent = false;
  const body = new ReadableStream<Uint8Array>({ pull(stream) {
    if (!sent) { sent = true; stream.enqueue(data); }
    else { stream.close(); controller.abort(); }
  } });
  await assert.rejects(generateAnswer(input(), { env: testEnv, fetch: async (_url, init) => {
    schemas.push(JSON.parse(String(init?.body)).response_format.json_schema.name);
    return new Response(body);
  } }, controller.signal), (error: unknown) => error instanceof AnswerError && error.code === "cancelled");
  assert.deepEqual(schemas, ["metaphore_answer"]);
});

test("user cancellation aborts an organizer already running after the writer", async () => {
  const controller = new AbortController();
  let organizerStarted!: () => void;
  const started = new Promise<void>((resolve) => { organizerStarted = resolve; });
  let organizerAborted = false;
  const pending = generateAnswer(input(), { env: testEnv, fetch: async (_url, init) => {
    const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
    if (name === "metaphore_answer") return completion();
    organizerStarted();
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { organizerAborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  } }, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AnswerError && error.code === "cancelled");
  assert.equal(organizerAborted, true);
});

function annotatedInput(): AnswerRequest {
  const request = input();
  request.activeId = "job-search";
  request.question = "Answer each annotated question separately.";
  request.annotations = [
    { id: "companies-note", source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", quote: "Compensation is one part of that comparison." }, question: "How should I compare these?" },
    { id: "equity-note", source: { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity" }, question: "What can change this value?" },
  ];
  return request;
}

function annotatedOutput(request: AnswerRequest) {
  return { ...answer(), topics: request.annotations!.map((annotation) => ({ annotationId: annotation.id, targetId: annotation.source.explorationId, decision: "branch", title: annotation.id, summary: "A focused answer.", sections: [{ title: "Answer", body: `Reply to: ${annotation.question}` }], sourceIds: [] })) };
}

test("annotation requests preserve each exact question and prioritize sources from different topics", () => {
  const request = annotatedInput();
  const validated = validateAnswerRequest(request);
  assert.deepEqual(validated.annotations, request.annotations);
  assert.notEqual(validated.annotations![0].source, request.annotations![0].source);
  const context = buildAnswerContext(validated);
  assert.deepEqual(context.payload.annotations.map((item) => item.id), ["companies-note", "equity-note"]);
  assert.equal(context.payload.annotations[0].text, request.annotations![0].source.quote);
  assert.match(context.payload.annotations[1].text, /equity/i);
  assert.ok(context.record.fullIds.includes("job-search"));
  assert.ok(context.record.fullIds.includes("compensation"));
  assert.ok(JSON.stringify(context.payload).length <= MAX_CONTEXT_CHARS);
  const result = validateAnswerOutput(annotatedOutput(request), request, context.record, "test");
  assert.deepEqual(result.topics!.map((topic) => topic.annotationId), request.annotations!.map((item) => item.id));
});

test("malformed, ambiguous, oversized and stale annotations are rejected before model calls", () => {
  const request = annotatedInput();
  for (const annotations of [
    null,
    [null],
    [request.annotations![0], request.annotations![0]],
    Array.from({ length: 7 }, (_, index) => ({ ...request.annotations![0], id: `note-${index}` })),
    [{ ...request.annotations![0], question: " " }],
    [{ ...request.annotations![0], question: "x".repeat(8001) }],
    [{ ...request.annotations![0], source: { ...request.annotations![0].source, quote: "made up" } }],
    [{ ...request.annotations![0], source: { ...request.annotations![0].source, explorationId: "missing" } }],
    [{ ...request.annotations![0], secret: "must-not-persist" }],
    Array.from({ length: 4 }, (_, index) => ({ ...request.annotations![0], id: `note-${index}`, question: "x".repeat(7000) })),
  ]) assert.throws(() => validateAnswerRequest({ ...request, annotations }), (error) => error instanceof AnswerError);
  assert.throws(() => validateAnswerRequest({ ...request, selection: request.annotations![0].source }), /invalid structure/);
  assert.throws(() => validateAnswerRequest({ ...request, mode: "continue" }), /invalid structure/);
});

test("every annotation must map once to its own source, with no missing or crossed targets", () => {
  const request = annotatedInput();
  const context = buildAnswerContext(request).record;
  const output = annotatedOutput(request);
  for (const topics of [
    [],
    output.topics.slice(0, 1),
    [output.topics[0], { ...output.topics[1], annotationId: output.topics[0].annotationId }],
    [output.topics[0], { ...output.topics[1], annotationId: "invented" }],
    [output.topics[0], { ...output.topics[1], annotationId: undefined }],
    [output.topics[0], { ...output.topics[1], targetId: "job-search" }],
    [output.topics[0], { ...output.topics[1], decision: "continue" }],
  ]) assert.throws(() => validateAnswerOutput({ ...output, topics }, request, context, "test"), /annotation/);
  assert.throws(() => validateAnswerOutput(output, { ...request, annotations: undefined }, context, "test"), /annotation/);
});

test("a selected club status follow-up carries the selected subject before broad historical context", () => {
  const conversation = createConversation();
  conversation.explorations.root.title = "Football clubs";
  conversation.explorations.root.messages = [
    { id: "clubs-question", role: "user", sections: [{ id: "clubs-prompt", title: "", body: "Tell me about football clubs." }] },
    { id: "clubs-answer", role: "assistant", sections: [{ id: "clubs-list", title: "Clubs", body: "Wydad and Raja are two subjects from this sample list." }] },
  ];
  const request: AnswerRequest = { ...input(), conversation, activeId: "root", question: "wat their current status", selection: { explorationId: "root", messageId: "clubs-answer", sectionId: "clubs-list", quote: "Wydad" } };
  const context = buildAnswerContext(validateAnswerRequest(request));
  const messages = answerMessages(request, context);
  const data = JSON.parse(messages[1].content);
  assert.equal(data.context.selection.text, "Wydad");
  assert.equal(data.question, request.question);
  assert.match(messages[0].content, /selected passage overrides the broader historical question/);
  assert.match(messages[0].content, /no browsing tool/);
  assert.match(messages[0].content, /one independently explorable subject per section/);
});

test("two-call annotation generation carries immutable ownership through both structured schemas", async () => {
  const request = validateAnswerRequest(annotatedInput());
  const written = annotatedOutput(request);
  const calls: string[] = [];
  const result = await generateAnswer(request, { env: testEnv, fetch: async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    const name = payload.response_format.json_schema.name;
    calls.push(name);
    const data = JSON.parse(payload.messages[1].content);
    if (name === "metaphore_answer") {
      assert.deepEqual(data.context.annotations.map((item: { id: string }) => item.id), ["companies-note", "equity-note"]);
      assert.ok(payload.response_format.json_schema.schema.properties.topics.items.required.includes("annotationId"));
      return completion(written);
    }
    assert.deepEqual(data.sections.map((section: { annotationId: string | null }) => section.annotationId), [null, "companies-note", "equity-note"]);
    assert.equal(data.annotations[0].text, request.annotations![0].source.quote);
    return completion({ reason: "Each question keeps its selected passage.", overview: "", primary: { decision: "continue", title: written.title, summary: written.summary, sectionIds: ["s0"], sourceIds: [] }, topics: written.topics.map(({ sections: _sections, ...topic }, index) => ({ ...topic, sectionIds: [`s${index + 1}`] })) });
  } });
  assert.deepEqual(calls, ["metaphore_answer", "metaphore_organization"]);
  assert.deepEqual(result.topics!.map((topic) => topic.annotationId), ["companies-note", "equity-note"]);
  assert.deepEqual(result.topics!.flatMap((topic) => topic.sections), written.topics.flatMap((topic) => topic.sections));
});

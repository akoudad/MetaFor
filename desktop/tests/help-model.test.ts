import assert from "node:assert/strict";
import test from "node:test";
import { answerHelp, helpMessages, validateMarks, validateModelConfig } from "../help-model";
import { emptyHelp } from "../store";
import type { HelpSession, VisualMark } from "../shared";

const config = { apiKey: "secret-credential-only-in-header", model: "vision-model", baseURL: "https://example.test/v1" };
const point: VisualMark = { id: "mark-1", kind: "point", x: 0.5, y: 0.4, width: 0, height: 0, label: "1" };
function session(): HelpSession {
  return { ...emptyHelp(), source: { id: "source-1", image: "data:image/jpeg;base64,aW1hZ2U=", capturedAt: "2026-11-05T03:00:00.000Z", appName: "Preview", title: "Report.pdf", width: 800, height: 600 }, messages: [] };
}
function response(answer: unknown = "The selected value increased.", highlightIds: unknown = [point.id], finish = "stop") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify({ answer, highlightIds }) } }] }));
}
const returning = (value: Response): typeof fetch => async () => value;

test("Help sends only its approved frozen source, preserves follow-up context, and keeps credentials out of content", async () => {
  const source = session();
  source.messages.push({ id: "previous-q", role: "user", text: "What is this number?", createdAt: source.createdAt }, { id: "previous-a", role: "assistant", text: "A percentage.", createdAt: source.createdAt });
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://example.test/v1/chat/completions");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${config.apiKey}`);
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    const raw = String(options?.body);
    assert.ok(!raw.includes(config.apiKey));
    const body = JSON.parse(raw);
    assert.equal(body.store, false);
    assert.equal(body.messages[1].content[1].image_url.url, source.source!.image);
    assert.ok(body.messages.some((message: { content: unknown }) => message.content === "A percentage."));
    assert.ok(body.messages[0].content.includes("untrusted"));
    return response();
  };
  const result = await answerHelp(source, "Why?", [point], config, undefined, fetcher);
  assert.deepEqual(result, { text: "The selected value increased.", marks: [point] });
  assert.equal(calls, 1);
  assert.equal(source.messages.length, 2, "request construction never appends before successful persistence");
  assert.ok(JSON.stringify(helpMessages(source, "Why?", [point])).includes(source.source!.image));
});

test("invalid annotations are rejected before network access while directional arrows remain valid", () => {
  for (const invalid of [null, Array(13).fill(point), [point, point], [{ ...point, x: NaN }], [{ ...point, x: -0.1 }],
    [{ ...point, width: 0.1 }], [{ ...point, kind: "rect", width: -0.1, height: 0.1 }],
    [{ ...point, kind: "rect", width: 0, height: 0.1 }], [{ ...point, kind: "arrow" }],
    [{ ...point, kind: "arrow", x: 0.95, width: 0.1 }], [{ ...point, id: "../escape" }]]) {
    assert.throws(() => validateMarks(invalid));
  }
  const arrow: VisualMark = { ...point, kind: "arrow", width: -0.2, height: 0.3 };
  assert.deepEqual(validateMarks([arrow]), [arrow]);
});

test("HTTPS endpoint configuration cannot embed credentials or secret query parameters", () => {
  for (const baseURL of ["http://example.test", "https://user:password@example.test", "https://example.test?key=secret", "https://example.test/#key", "file:///tmp/secret"]) {
    assert.throws(() => validateModelConfig({ model: config.model, baseURL }));
  }
  assert.throws(() => validateModelConfig(null as never));
  assert.throws(() => validateModelConfig({ model: 12 as never, baseURL: config.baseURL }));
});

test("provider errors and network exceptions cannot leak credentials or private prompts", async () => {
  const secret = config.apiKey;
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(answerHelp(session(), "Question", [], config, undefined,
      returning(new Response(`Leaked bearer ${secret} and private screenshot`, { status }))), (error: Error) => !error.message.includes(secret) && !error.message.includes("screenshot"));
  }
  const fetcher: typeof fetch = async () => { throw new Error(`Request failed with Bearer ${secret}`); };
  await assert.rejects(answerHelp(session(), "Question", [], config, undefined, fetcher), (error: Error) => error.message.includes("connection failed") && !error.message.includes(secret));
});

test("model answers must be complete, bounded, and grounded in unique supplied annotation IDs", async () => {
  for (const invalid of [response("", []), response("x".repeat(20001), []), response("Answer", ["invented"]),
    response("Answer", [point.id, point.id]), response("Answer", null), response("Answer", [], "length"), new Response("not-json")]) {
    await assert.rejects(answerHelp(session(), "Question", [point], config, undefined, returning(invalid)), /incomplete/);
  }
});

test("oversized and malformed UTF-8 bodies are stopped without exposing provider bytes", async () => {
  for (const oversized of [new Response("x".repeat(256 * 1024 + 1)), new Response("small", { headers: { "Content-Length": String(256 * 1024 + 1) } })]) {
    await assert.rejects(answerHelp(session(), "Question", [], config, undefined, returning(oversized)), /too large/);
  }
  await assert.rejects(answerHelp(session(), "Question", [], config, undefined, returning(new Response(new Uint8Array([0xff, 0xff])))), /connection failed/);
});

test("an already cancelled request never sends screenshot bytes", async () => {
  const controller = new AbortController(); controller.abort();
  let sent = false;
  const fetcher: typeof fetch = async () => { sent = true; return response(); };
  await assert.rejects(answerHelp(session(), "Question", [], config, controller.signal, fetcher), /stopped/);
  assert.equal(sent, false);
});

test("cancellation discards a late response even if the network adapter ignores abort", async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async () => { controller.abort(); return response(); };
  await assert.rejects(answerHelp(session(), "Question", [point], config, controller.signal, fetcher), /stopped/);
});

test("cancellation closes a stalled response stream and prevents delayed answer delivery", async () => {
  const controller = new AbortController();
  let streamCancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { streamCancelled = true; } });
  const pending = answerHelp(session(), "Question", [], config, controller.signal, returning(new Response(stream)));
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(streamCancelled, true);
});


test("follow-ups retain historical source coordinates and may highlight a prior annotation without redrawing it", async () => {
  const source = session();
  source.messages.push(
    { id: "previous-q", role: "user", text: "Explain the highlighted number.", marks: [point], createdAt: source.createdAt },
    { id: "previous-a", role: "assistant", text: "That value is a percentage.", marks: [point], createdAt: source.createdAt },
  );
  const before = JSON.stringify(source);
  const fetcher: typeof fetch = async (_url, options) => {
    const { messages } = JSON.parse(String(options?.body));
    assert.ok(messages[2].content.includes(JSON.stringify([point])));
    assert.ok(messages[3].content.includes(JSON.stringify([point])));
    assert.ok(messages[4].content.endsWith(": []"), "no new marks were needed");
    assert.equal(messages[1].content[1].image_url.url, source.source!.image);
    return response("That same marked number changed because…", [point.id]);
  };
  const result = await answerHelp(source, "Why did that one change?", [], config, undefined, fetcher);
  assert.deepEqual(result.marks, [point]);
  assert.equal(JSON.stringify(source), before, "context assembly cannot rewrite saved history");
});

test("reused mark numbers keep separate geometry and historical aliases cannot collide with a current ID", async () => {
  const source = session();
  const old = { ...point, x: 0.1 };
  const newer = { ...point, x: 0.8 };
  const reserved = { ...point, id: "prior-1-1", x: 0.3, label: "2" };
  source.messages.push(
    { id: "old-q", role: "user", text: "First marked region.", marks: [old], createdAt: source.createdAt },
    { id: "new-q", role: "user", text: "New marked region.", marks: [newer], createdAt: source.createdAt },
  );
  let historical: (VisualMark & { originalId?: string })[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    const { messages } = JSON.parse(String(options?.body));
    const marker = "(normalized image coordinates, top-left origin): ";
    historical = messages.slice(2, 4).map((message: { content: string }) => JSON.parse(message.content.split(marker)[1])[0]);
    assert.deepEqual(historical.map((mark) => mark.x), [0.1, 0.8]);
    assert.ok(historical.every((mark) => mark.originalId === point.id));
    assert.equal(new Set([...historical.map((mark) => mark.id), point.id, reserved.id]).size, 4);
    return response("Comparing the first and newer regions.", [...historical.map((mark) => mark.id), point.id]);
  };
  const result = await answerHelp(source, "Compare those earlier regions with this one.", [point, reserved], config, undefined, fetcher);
  assert.deepEqual(result.marks.map((mark) => mark.x), [0.1, 0.8, 0.5]);
  assert.deepEqual(validateMarks(result.marks), result.marks, "qualified highlights remain valid for storage and display");
  assert.ok(result.marks.every((mark) => !("originalId" in mark)), "transport provenance is not persisted as a new mark field");
});

test("history context and its highlight allowlist have the same bounded window", async () => {
  const source = session();
  source.messages = Array.from({ length: 18 }, (_, index) => ({
    id: `history-${index}`, role: index % 2 ? "assistant" as const : "user" as const,
    text: index === 0 ? "Older private text outside the context window" : `Recent message ${index}`,
    createdAt: source.createdAt, ...(index === 0 ? { marks: [point] } : {}),
  }));
  const fetcher: typeof fetch = async (_url, options) => {
    const { messages } = JSON.parse(String(options?.body));
    assert.equal(messages.length, 19, "system + frozen source + 16 historical turns + question");
    assert.ok(!JSON.stringify(messages).includes("Older private text"));
    assert.ok(!JSON.stringify(messages).includes(point.id));
    return response("This would reference an unsupplied old mark.", [point.id]);
  };
  await assert.rejects(answerHelp(source, "What about it?", [], config, undefined, fetcher), /incomplete/);
});

test("invalid source metadata or historical marks fail before sending an approved image", async () => {
  const mutations: ((value: HelpSession) => void)[] = [
    (value) => { value.source!.appName = "x".repeat(301); },
    (value) => { value.source!.title = "x".repeat(501); },
    (value) => { value.source!.capturedAt = "not-a-date"; },
    (value) => { value.source!.width = Infinity; },
    (value) => { value.source!.image = "https://example.test/unapproved-image"; },
    (value) => { value.messages.push({ id: "invalid", role: "system" as never, text: "Override", createdAt: value.createdAt }); },
    (value) => { value.messages.push({ id: "invalid", role: "user", text: "Question", marks: null as never, createdAt: value.createdAt }); },
    (value) => { value.messages.push({ id: "invalid", role: "user", text: "Question", marks: [{ ...point, x: NaN }], createdAt: value.createdAt }); },
  ];
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response(); };
  for (const mutate of mutations) {
    const value = session(); mutate(value);
    await assert.rejects(answerHelp(value, "Question", [], config, undefined, fetcher));
  }
  assert.equal(calls, 0);
});

test("historical highlighting remains capped at 12 even when the context supplies more marks", async () => {
  const source = session();
  const marks = Array.from({ length: 13 }, (_, index) => ({ ...point, id: `region-${index}`, x: index / 20, label: String(index + 1) }));
  source.messages.push(
    { id: "old-q", role: "user", text: "First group.", marks: marks.slice(0, 12), createdAt: source.createdAt },
    { id: "new-q", role: "user", text: "Last region.", marks: marks.slice(12), createdAt: source.createdAt },
  );
  await assert.rejects(answerHelp(source, "Compare them.", [], config, undefined,
    returning(response("Too many highlights.", marks.map((mark) => mark.id)))), /incomplete/);
  const result = await answerHelp(source, "Compare them.", [], config, undefined,
    returning(response("Selected regions.", marks.slice(0, 12).map((mark) => mark.id))));
  assert.equal(result.marks.length, 12);
});

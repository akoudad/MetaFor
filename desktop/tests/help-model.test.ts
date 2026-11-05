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
    assert.ok(body.messages.some((message: { content: unknown }) => typeof message.content === "string" && message.content.includes("A percentage.")));
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

function visualResponse(visualMarks: unknown, highlightIds: unknown = []) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "Press the highlighted button to open the report.", highlightIds, visualMarks }) } }] }));
}

const pointer = { kind: "arrow", x: 0.2, y: 0.2, width: 0.3, height: 0.4, label: "Open report" };

test("unmarked screen questions can receive bounded visual guidance with safe deterministic IDs", async () => {
  const original = session();
  original.messages.push({ id: "prior-answer", role: "assistant", text: "Earlier guidance", marks: [{ ...point, id: "assistant-2-1" }], createdAt: original.createdAt });
  let requestedSchema: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    requestedSchema = body.response_format.json_schema.schema;
    assert.ok(body.messages[0].content.includes("even when the user has drawn no annotations"));
    assert.ok(body.messages[0].content.includes("never execute actions"));
    assert.ok(body.messages.at(-1).content.endsWith(": []"));
    return visualResponse([pointer]);
  };
  const first = await answerHelp(original, "How do I open the report?", [], config, undefined, fetcher);
  const second = await answerHelp(original, "How do I open the report?", [], config, undefined, fetcher);
  assert.deepEqual(requestedSchema.required, ["answer", "highlightIds", "visualMarks"]);
  assert.deepEqual(first, second, "retries produce the same anchor IDs");
  assert.equal(first.marks[0].id, "assistant-2-1-1", "generated anchors cannot replace an earlier mark ID");
  assert.deepEqual(first.marks[0], { ...pointer, id: "assistant-2-1-1" });
  assert.deepEqual(validateMarks(first.marks), first.marks);
});

test("invalid generated geometry, labels, extra fields, counts and combined limits are rejected", async () => {
  const invalid = [null, [null], Array(7).fill(pointer), [{ ...pointer, x: 0.9 }], [{ ...pointer, kind: "rect", width: -0.1 }],
    [{ ...pointer, kind: "point" }], [{ ...pointer, kind: "click" }], [{ ...pointer, x: "0.2" }],
    [{ ...pointer, label: "" }], [{ ...pointer, label: "x".repeat(121) }], [{ ...pointer, sourceId: "old-source" }],
    [{ ...pointer, id: "model-decided-id" }], [{ kind: "point", x: 0.5, y: 0.5, label: "Missing dimensions" }]];
  for (const marks of invalid) await assert.rejects(answerHelp(session(), "Show me", [], config, undefined, returning(visualResponse(marks))), /incomplete/);
  const current = Array.from({ length: 12 }, (_, index) => ({ ...point, id: `current-${index}`, x: index / 20 }));
  await assert.rejects(answerHelp(session(), "Compare", current, config, undefined, returning(visualResponse([pointer], current.map((mark) => mark.id)))), /incomplete/);
  const valid = await answerHelp(session(), "Compare", current.slice(0, 6), config, undefined, returning(visualResponse(Array(6).fill(pointer), current.slice(0, 6).map((mark) => mark.id))));
  assert.equal(valid.marks.length, 12);
});

test("screen refresh keeps old marks on their own frames and never highlights them on the current screen", async () => {
  const original = session();
  const first = original.source!;
  const current = { ...first, id: "source-2", image: "data:image/jpeg;base64,bmV3LWltYWdl", title: "Second report.pdf" };
  original.sources = [first, current]; original.source = current; original.contextMode = "screen";
  original.messages = [{ id: "old-q", role: "user", text: "Explain this old number", sourceId: first.id, marks: [point], createdAt: original.createdAt }];
  let oldMarkId = "";
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.messages[1].content[1].image_url.url, current.image);
    assert.equal(body.messages[2].content[1].image_url.url, first.image);
    assert.ok(body.messages[2].content[0].text.includes("Earlier source"));
    assert.ok(body.messages[3].content.includes(`Source ID: ${first.id} (historical; image included`));
    const manifest = JSON.parse(body.messages[3].content.split("(normalized image coordinates, top-left origin): ")[1]);
    oldMarkId = manifest[0].id;
    assert.notEqual(oldMarkId, point.id);
    return response("This would put the old mark on a new screenshot", [oldMarkId]);
  };
  await assert.rejects(answerHelp(original, "What changed?", [], config, undefined, fetcher), /incomplete/);
  const valid = await answerHelp(original, "What is this current number?", [point], config, undefined, returning(response("The new number", [point.id])));
  assert.deepEqual(valid.marks, [point]);
  const historical = { ...original, source: first };
  const priorReply = await answerHelp(historical, "Explain the old number again", [], config, undefined, returning(response("That old number", [point.id])));
  assert.deepEqual(priorReply.marks, [point], "explicitly selecting the old source restores its own highlight allowlist");
});

test("only two recent referenced prior frames are sent and omitted frames remain explicit", () => {
  const original = session();
  original.sources = Array.from({ length: 5 }, (_, index) => ({ ...original.source!, id: `frame-${index}`, image: `data:image/png;base64,${Buffer.from(`private-frame-${index}`).toString("base64")}` }));
  original.source = original.sources[4];
  original.messages = original.sources.slice(0, 4).map((source, index) => ({ id: `question-${index}`, role: "user", text: `Earlier question ${index}`, sourceId: source.id, createdAt: original.createdAt }));
  const messages = helpMessages(original, "What changed on screen?", []);
  const raw = JSON.stringify(messages);
  assert.equal(messages.filter((message) => Array.isArray(message.content)).length, 3);
  for (const index of [4, 3, 2]) assert.ok(raw.includes(original.sources[index].image));
  for (const index of [0, 1]) assert.ok(!raw.includes(original.sources[index].image));
  assert.ok(raw.includes("frame-0 (historical; image omitted"));
  const unreferenced = { ...original.source, id: "never-discussed", image: "data:image/png;base64,bmV2ZXItc2VudA==" };
  original.sources.push(unreferenced);
  assert.ok(!JSON.stringify(helpMessages(original, "Explain", [])).includes(unreferenced.image));
});

test("unchanged screens send their image once while retaining separate history and mark ownership", async () => {
  const original = session();
  original.sources = Array.from({ length: 3 }, (_, index) => ({ ...original.source!, id: `unchanged-${index}`,
    title: `Document capture ${index}`, capturedAt: `2026-11-05T03:0${index}:00.000Z` }));
  original.source = original.sources[2];
  original.messages = original.sources.slice(0, 2).map((source, index) => ({ id: `question-${index}`, role: "user", text: `Earlier question ${index}`,
    sourceId: source.id, marks: [{ ...point, id: `old-mark-${index}` }], createdAt: original.createdAt }));
  const before = JSON.stringify(original);
  const messages = helpMessages(original, "Explain the current screen", [point]);
  const images = messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url") : []);
  assert.equal(images.length, 1);
  const raw = JSON.stringify(messages);
  for (const source of original.sources) {
    assert.ok(raw.includes(source.id)); assert.ok(raw.includes(source.title)); assert.ok(raw.includes(source.capturedAt));
  }
  for (const index of [2, 3]) {
    const content = messages[index].content as { text: string }[];
    assert.equal(content.length, 1);
    assert.ok(content[0].text.includes("identical to source unchanged-2"));
    assert.ok(content[0].text.includes("separate historical source"));
  }
  const historical = messages[4].content as string;
  const oldMark = JSON.parse(historical.split("(normalized image coordinates, top-left origin): ")[1])[0];
  await assert.rejects(answerHelp(original, "Explain", [point], config, undefined, returning(response("Old mark", [oldMark.id]))), /incomplete/);
  const result = await answerHelp(original, "Explain", [point], config, undefined, returning(response("Current mark", [point.id])));
  assert.deepEqual(result.marks, [point]);
  assert.equal(JSON.stringify(original), before);
});

test("identical historical frames share pixels but changed dimensions keep a separate image", () => {
  const original = session();
  const first = { ...original.source!, id: "old-1" };
  const second = { ...first, id: "old-2" };
  original.source = { ...first, id: "current", image: "data:image/png;base64,bmV3LWltYWdl" };
  original.sources = [first, second, original.source];
  original.messages = [first, second].map((source, index) => ({ id: `question-${index}`, role: "user", text: "Earlier question", sourceId: source.id, createdAt: original.createdAt }));
  const countImages = () => helpMessages(original, "What changed?", []).flatMap((message) =>
    Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url") : []).length;
  assert.equal(countImages(), 2);
  const raw = JSON.stringify(helpMessages(original, "What changed?", []));
  assert.ok(raw.includes("identical to source old-2"));
  second.width += 1;
  assert.equal(countImages(), 3, "dimension changes cannot alias coordinate spaces");
});

test("unresolved source references and invalid screen bounds fail before sending any image", async () => {
  const original = session();
  original.sources = [original.source!, { ...original.source!, id: "second" }];
  original.messages = [{ id: "ambiguous", role: "user", text: "Old question", createdAt: original.createdAt }];
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response("Answer", []); };
  await assert.rejects(answerHelp(original, "Explain", [], config, undefined, fetcher), /missing its screen reference/);
  original.messages[0].sourceId = "not-saved";
  await assert.rejects(answerHelp(original, "Explain", [], config, undefined, fetcher), /missing source/);
  original.messages = [];
  original.source!.screenBounds = { x: 0, y: 0, width: 0, height: 400, displayId: "1" };
  await assert.rejects(answerHelp(original, "Explain", [], config, undefined, fetcher), /screen bounds/);
  assert.equal(calls, 0);
});


test("generated anchor IDs remain unique even against marks outside the model history window", async () => {
  const original = session();
  original.messages = Array.from({ length: 18 }, (_, index) => ({ id: `message-${index}`, role: "user", text: "Earlier question", createdAt: original.createdAt,
    ...(index === 0 ? { marks: [{ ...point, id: "assistant-19-1" }] } : {}) }));
  const result = await answerHelp(original, "Show the button", [], config, undefined, returning(visualResponse([pointer])));
  assert.equal(result.marks[0].id, "assistant-19-1-1");
});

test("oversized prior frames are omitted instead of exceeding the historical image budget", () => {
  const original = session();
  const previous = { ...original.source!, id: "large-previous", image: `data:image/png;base64,${Buffer.alloc(7 * 1024 * 1024).toString("base64")}` };
  original.sources = [previous, original.source!];
  original.messages = [{ id: "previous-question", role: "user", text: "Earlier question", sourceId: previous.id, createdAt: original.createdAt }];
  const messages = helpMessages(original, "What changed?", []);
  assert.equal(messages.filter((message) => Array.isArray(message.content)).length, 1);
  assert.ok(JSON.stringify(messages).includes("large-previous (historical; image omitted"));
});

test("screen translations preserve useful localized labels at separate source anchors without user marks", async () => {
  const translations = [
    { kind: "rect", x: .1, y: .2, width: .25, height: .08, label: "Enregistrer les modifications" },
    { kind: "rect", x: .6, y: .2, width: .25, height: .08, label: "Annuler" },
  ];
  const text = "Les deux commandes permettent d’enregistrer les modifications ou de les annuler.";
  const fetcher: typeof fetch = async (_url, options) => {
    const { messages } = JSON.parse(String(options?.body));
    const instruction = messages[0].content as string;
    assert.ok(instruction.includes("actual translation in the requested language"));
    assert.ok(instruction.includes("Do not guess coordinates or translated words for unreadable text"));
    assert.ok(instruction.includes("Do not require opening a screenshot viewer"));
    assert.ok(messages.at(-1).content.endsWith(": []"), "the model can locate visible text without manual cropping or annotations");
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: text, highlightIds: [], visualMarks: translations }) } }] }));
  };
  const result = await answerHelp(session(), "Traduis les deux boutons en français.", [], config, undefined, fetcher);
  assert.equal(result.text, text);
  assert.deepEqual(result.marks.map(({ id: _id, ...mark }) => mark), translations, "each useful translation retains its own source geometry");
  assert.equal(new Set(result.marks.map((mark) => mark.id)).size, 2);
});

test("a brief conceptual answer needs no invented visual location", async () => {
  const text = "A cache reuses a previously computed result so the same work does not need to run again.";
  const fetcher: typeof fetch = async (_url, options) => {
    const instruction = JSON.parse(String(options?.body)).messages[0].content as string;
    assert.ok(instruction.includes("Use general knowledge to explain concepts"));
    assert.ok(instruction.includes("brief direct answer for a general explanation"));
    assert.ok(instruction.includes("Return [] if no visual pointer is useful"));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: text, highlightIds: [], visualMarks: [] }) } }] }));
  };
  assert.deepEqual(await answerHelp(session(), "What does caching mean here?", [], config, undefined, fetcher), { text, marks: [] });
});

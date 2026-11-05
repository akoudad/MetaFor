import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import type { Conversation, Exploration, Section, SourceReference } from "../src/lib/model";
import { applyAnswer } from "../src/lib/session";
import { fitOverview, focusView, layoutSpace } from "../src/lib/spatial";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";

// A deterministic, authored navigation fixture, not a recorded model response.
// --fixture makes no network calls. A live run makes at most six app requests /
// twelve paid model calls against an already configured local server.
const areas = [
  ["scope", "Scope and user promises", "The product is a small local-first field-notes application used by a two-person research team. Researchers write observations without reliable connectivity and synchronize when the connection returns. The first release supports one workspace, typed notes, tags, and a readable export. It does not need live collaboration or automatic summarization. Keep the contract small enough that a researcher can explain what happened after reconnecting.", "A note that was accepted locally must remain visible after a restart. Sync status should describe the individual note, not make a vague promise that everything is safe. A shared workspace can contain a mixture of synchronized and pending changes. When a user opens an older note, distinguish the last server version from edits made on this device. Avoid a single global spinner that hides which action needs attention.", "For example, a researcher records ten observations in a basement, closes the app, and later reconnects on a train. The app should show all ten immediately from local storage. Nine may synchronize while the tenth fails validation because its workspace permission changed. The successful notes should remain usable; the failed note needs an editable local copy and an explanation. Do not remove all ten because one operation failed."],
  ["storage", "Durable local storage", "Write the note and the outgoing operation in the same local transaction. A separate success notification is only appropriate once that transaction commits. The database record needs a stable identifier, the current text, creation and update timestamps, and the server version on which the edit was based. The operation queue should refer to the same stable note identifier rather than its current position in a list.", "Local storage is not equivalent to a permanent backup. Users can clear browser data, run out of disk space, or move to another device. Show an export action that works without a network connection. The exported file should include both the latest readable note and enough metadata to recognize pending operations during a later import. If a write fails, preserve the editor contents in memory and show a clear recovery path.", "Consider a note edited while its previous revision is being synchronized. The response for the older revision must not overwrite the newer local text. Match the response to the operation and base version that produced it. Then mark only that operation acknowledged. If the user typed more during the request, the newer operation stays pending and the editor continues to display the newer version."],
  ["retry", "Retry delivery and idempotency", "Each outgoing operation has a stable operation ID that survives retries. A server acknowledgement records that ID together with the committed effect. Retrying the same operation should return the existing result instead of performing the effect twice. The queue worker should distinguish a temporary connection failure from a permanent validation failure. A lost acknowledgement is a normal event, not proof that the server rejected the write.", "A retry needs a bounded delay with jitter, a visible state, and a way for the user to retry deliberately. Do not retry a permission error every second. Authentication renewal and an unavailable network are separate states. Workers should stop when their workspace is closed and resume from durable operations on the next open. Concurrent workers must not invent new operation IDs for a previously queued write.", "Suppose the server saves operation op-17 and the connection closes before the browser receives the response. On the next attempt, the browser sends op-17 again. The server finds the committed result and returns it. If a genuinely new edit follows, it receives a different ID. This distinction matters for counters, notifications, and attachment records as well as note text; merely overwriting identical text does not prove all side effects are safe."],
  ["cache", "Read cache and invalidation", "A read cache can make reopening a workspace immediate, but it must retain a clear relationship to the authoritative data. Store the version and retrieval time with a cached workspace. When a pending local edit exists, render the local draft over the cached server version. A response that was requested before a newer edit must not silently replace that draft. Treat fresh data and locally modified data as different concerns.", "Invalidation should happen after a confirmed change or after a server version indicates that the data is outdated. A short time-to-live alone does not establish correctness. The user may work offline longer than the time-to-live, so an expired record remains useful if it is clearly represented as the latest available local copy. Deleting useful content because it is old makes the application less reliable when the network is poor.", "For example, a researcher opens a workspace at 09:00, edits a note at 09:05, and receives an older workspace response at 09:06. Compare the response generation and record versions before applying it. A local edit remains the foreground value until acknowledged or deliberately resolved. On reconnect, fetch the smallest version summary needed to identify changed records before downloading every attachment."],
  ["conflict", "Conflicts and understandable recovery", "Conflicts are a user interaction, not just a database error. Preserve both the local edit and the remote value when neither can safely replace the other. For a plain text note, a comparison view can show the differences and allow the researcher to choose one version or compose a combined version. The choice becomes a new operation with an explicit base version. Keep the original conflict versions available until that operation commits.", "Not every mismatch needs a full conflict dialog. Independent tag additions may be combined if the product has defined that behavior. A deleted note with a local edit is more serious: restoring the edit may be the right action, but it should be explicit. Explain who changed the note only when that information is actually known. Do not turn missing attribution into a confident claim that another researcher caused the problem.", "A useful recovery task starts from a concrete case. Device A changes the observation location while Device B edits the description offline. After reconnecting, the app should retain both fields if the update semantics support independent changes. If both devices changed the description, show both text versions without discarding either. Test the complete recovery, including closing the browser while the conflict remains unresolved."],
  ["access", "Access and workspace boundaries", "A workspace boundary applies to cached records, pending operations, exports, and server requests. A device may still hold a readable local copy after server access is revoked; the product must explain that local behavior without claiming the old session can continue to synchronize. Authenticate every server operation using the current session. The presence of a familiar workspace identifier is not permission to read or modify it.", "The first release can keep permission rules simple: owners manage the workspace, researchers edit notes, and readers inspect synchronized content. A role change should affect later operations consistently. If the user has pending edits when access changes, preserve an exportable copy rather than showing a generic failure and clearing the editor. An operation should fail for its actual reason, with no leak of another workspace's private content.", "Consider a researcher who signs out and another person signs in on the same browser. The app should not send the first person's queued writes under the second person's identity. Separate local workspace records by account and require an explicit choice about any retained offline data. Verify this with two accounts and a pending queue; a successful login test alone does not cover the boundary."],
  ["release", "Release gates and gradual rollout", "Release a narrow workflow that can recover from interruption before adding convenience features. The first gate is durable local editing, followed by retry correctness, conflict recovery, and an offline export. A feature is not finished just because its happy path returns HTTP 200. The researcher should be able to recognize what is saved, what is waiting, and what needs a decision without reading technical logs.", "Start with a small internal workspace and exercise ordinary work for several days. Keep the old export reader compatible with files produced by the new writer, or document and test a migration. A deployment rollback should not leave stored records in a shape the older code cannot read. Record schema versions explicitly and use a copy of realistic local data when rehearsing upgrades and rollbacks.", "A release checklist should include opening a large workspace, editing while offline, reconnecting with one failed operation, restarting during synchronization, resolving a conflict, exporting without network, and importing the export into a new browser profile. Record the observed result and remaining uncertainty for each task. A green unit test suite supports these checks but does not replace the experience."],
  ["support", "Support without invasive analytics", "Support should work from a small, understandable diagnostic report that a researcher chooses to export. The report can include application version, database version, counts of pending operations, and redacted error categories. It does not need note text, researcher names, or a stream of behavioral events. A report should be inspectable before sharing so the user knows what information it contains.", "Use local error categories that distinguish storage failure, invalid data, expired authentication, rejected permission, and temporary connectivity. Avoid recording secrets or raw server responses in a general log. The UI should explain the next useful action: free storage, correct a field, sign in again, export a local copy, or retry later. Do not replace every distinct error with an unhelpful request to refresh.", "For example, a researcher reports that three notes remain pending. A diagnostic report can show three operation IDs, their retry counts, and a redacted validation category. Support can explain the likely recovery without receiving the note bodies. The researcher can then correct the affected local fields and retry those operations while the rest of the workspace remains available."],
  ["evaluation", "Evaluating the complete workflow", "Evaluate the product with tasks rather than invented usability scores. Ask a person to capture observations offline, locate an earlier note, inspect its synchronization state, resolve a conflicting description, and export their work. Observe where they hesitate, which terms they misunderstand, and whether they can recover after a deliberate interruption. Record concrete outcomes and the device used.", "Use a realistic workspace with long descriptions, many tags, and enough history to make finding information meaningful. A five-note sample can hide slow rendering, awkward scrolling, and stale selection problems. Include keyboard-only use and a narrow viewport. Measure latency only when the environment and task are specified, and distinguish time waiting for a server from time spent figuring out the interface.", "Compare the same sequence before and after a change. If a researcher previously lost an unsent edit when switching workspaces, repeat that exact switch with a realistic draft and an in-flight request. Confirm the draft remains in its original workspace, the reply attaches there, and reopening the app restores the same state. Screenshots are useful for composition, but an interaction must be tested through its completion."],
] as const;

function longSections(): Section[] {
  return areas.map(([id, title, overview, detail, example]) => ({ id, title, body: `${overview}\n\n${detail}\n\n${example}\n\n**Acceptance checks**\n\n- Try the normal ${title.toLowerCase()} workflow with several realistic notes and a long description.\n- Repeat after closing and reopening the application; compare the saved version with the last visible edit.\n- Interrupt the network or request at the boundary being tested and verify that unrelated notes remain usable.\n- Inspect the error message and recovery action without assuming that the user knows implementation details.\n- Keep a record of the observed behavior, including anything the current environment cannot verify.\n\n**Decision to retain:** prefer a small, explicit behavior that a researcher can understand and recover from. A later enhancement must preserve the working offline and export paths.\n\n**Return point:** This paragraph marks the end of the ${title.toLowerCase()} section. Explore a connected topic and return here to check that your reading position is retained.` }));
}

function fixture(): Conversation {
  const sections = longSections();
  assert.ok(sections.reduce((sum, item) => sum + item.body.length, 0) > 12_000);
  const source = (sectionId: string): SourceReference => ({ explorationId: "root", messageId: "design", sectionId });
  const topic = (id: string, title: string, parentId: string, anchor: SourceReference, body: string): Exploration => ({ id, title, summary: body.slice(0, 280), parentId, source: anchor, position: [0, 0, 0], messages: [{ id: `${id}-answer`, role: "assistant", sections: [{ id: `${id}-details`, title, body }] }] });
  return {
    id: "journey-lab-v1", title: "Local-first field notes", rootId: "root", kind: "live",
    explorations: {
      root: { id: "root", title: "Local-first field notes", summary: "A local-first research notes app: offline editing, durable queues, read caching, conflict recovery, and a careful release.", parentId: null, source: null, position: [0, 0, 0], messages: [
        { id: "initial-question", role: "user", sections: [{ id: "initial-question-text", title: "", body: "Help me design a small local-first field-notes app for a two-person research team." }] },
        { id: "initial-overview", role: "assistant", sections: [{ id: "initial-overview-text", title: "Working areas", body: "We should consider local storage, retry delivery, cached reads, conflicts, access, release gates, and support." }] },
        { id: "constraints", role: "user", sections: [{ id: "constraints-text", title: "", body: "Requirements for every part of this project: monthly hosting must stay below $60, no third-party analytics, and offline export must remain available even when sync fails. We have two engineers and four weeks. Do not quietly remove these constraints in deeper discussions." }] },
        { id: "design", role: "assistant", sections },
      ] },
      delivery: topic("delivery", "Retry delivery", "root", source("retry"), `${sections[2].body}\n\nA bounded worker keeps the operation ID stable across retries and checks that the acknowledgement belongs to the sent operation. Continue discussing retry timing and duplicate prevention here.`),
      cache: topic("cache", "Read cache", "root", source("cache"), `${sections[3].body}\n\nCache contents are a readable local copy, not permission to discard unsynchronized edits. Continue discussing invalidation and stale responses here.`),
      idempotency: topic("idempotency", "Atomic acknowledgement", "delivery", { explorationId: "delivery", messageId: "delivery-answer", sectionId: "delivery-details", quote: "The queue worker should distinguish a temporary connection failure from a permanent validation failure." }, "The server transaction writes the note change and its operation acknowledgement together. A retried operation returns the committed result. An acknowledgement should identify the operation and version it actually committed, so a later local edit is not overwritten.\n\nTest a connection loss before the commit, after the commit but before the response, and after a successful response. Only the committed case may return an existing success. Permission and validation failures must remain actionable rather than becoming infinite retries.\n\nReturning to Retry delivery should restore the paragraph you were reading, and returning again should preserve this explanation's own position."),
      synthesis: topic("synthesis", "Reconnect sequence", "root", source("release"), "Combine the retry queue and read cache into one reconnect sequence. Start by preserving the current local view. Send stable queued operations, apply acknowledgements only to their matching revisions, and then fetch a version summary for remote changes. Keep conflicted notes editable while unaffected notes continue.\n\nIf a connection fails again, keep the local view and the queue. Offline export remains available. The implementation must fit the two-engineer, four-week plan, stay below $60 per month, and use no third-party analytics. This synthesis links its input topics without replacing them."),
    },
    connections: [
      { id: "delivery-synthesis", from: "delivery", to: "synthesis", type: "synthesis", status: "accepted", reason: "Reconnect order uses the stable retry queue." },
      { id: "cache-synthesis", from: "cache", to: "synthesis", type: "synthesis", status: "accepted", reason: "Reconnect order preserves the readable local cache." },
    ],
  };
}

function snapshot(conversation: Conversation, activeId = "root", overview = false) {
  const nodes = layoutSpace(conversation);
  const camera = overview ? fitOverview(nodes, 1440, 900) : focusView(nodes.find((node) => node.id === activeId)!.position, 1440, 900);
  return serializeSnapshot({ format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation, view: { activeId, view: camera, overview, started: true, places: {}, history: [] } });
}

async function main() {
  const onlyFixture = process.argv.includes("--fixture");
  const origin = new URL(process.argv.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:3000").origin;
  const output = resolve("artifacts/journey-check");
  await mkdir(output, { recursive: true });
  let conversation = fixture();
  const encoded = snapshot(conversation);
  assert.deepEqual(parseSnapshot(encoded).conversation, conversation);
  await writeFile(join(output, "navigation-baseline.ingx"), encoded);
  console.log(JSON.stringify({ fixture: join(output, "navigation-baseline.ingx"), rootCharacters: conversation.explorations.root.messages.at(-1)!.sections.reduce((sum, section) => sum + section.body.length, 0) }));
  if (onlyFixture) return;

  const records: { label: string; milliseconds: number; answer: AnswerResult; destinations: string[] }[] = [];
  if (process.argv.includes("--resume")) {
    conversation = parseSnapshot(await readFile(join(output, "live-journey.ingx"), "utf8")).conversation;
    const saved = JSON.parse(await readFile(join(output, "results.json"), "utf8"));
    records.push(...saved.records);
    console.log(JSON.stringify({ resumed: records.map((record) => record.label) }));
  }
  const checkpoint = async () => {
    await writeFile(join(output, "live-journey.ingx"), snapshot(conversation, "root", true));
    await writeFile(join(output, "results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), records }, null, 2));
  };
  const send = async (label: string, activeId: string, question: string, extra: Partial<AnswerRequest> = {}) => {
    const completed = records.find((record) => record.label === label);
    if (completed) return { answer: completed.answer, conversation, destinationId: completed.destinations[0], topicIds: completed.destinations.slice(1) };
    assert.ok(records.length < 6, "This check permits at most six paid app requests.");
    const request: AnswerRequest = { requestId: crypto.randomUUID(), conversation, activeId, question, selection: null, mode: "auto", includeIds: [], ...extra };
    await writeFile(join(output, "last-request.json"), JSON.stringify({ label, request }, null, 2));
    const start = performance.now();
    const response = await fetch(`${origin}/api/answer`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(request), signal: AbortSignal.timeout(65000) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { code?: string };
      throw new Error(`${label}: HTTP ${response.status} ${failure.code ?? "request_failed"}`);
    }
    const answer = await response.json() as AnswerResult;
    const applied = applyAnswer(conversation, request, answer);
    conversation = applied.conversation;
    assert.strictEqual(applyAnswer(conversation, request, answer).conversation, conversation);
    const destinations = [...new Set([applied.destinationId, ...applied.topicIds])];
    records.push({ label, milliseconds: Math.round(performance.now() - start), answer, destinations });
    await checkpoint();
    console.log(JSON.stringify({ label, decision: answer.decision, destinations: destinations.map((id) => ({ id, title: conversation.explorations[id].title })), milliseconds: Math.round(performance.now() - start) }));
    return { request, answer, ...applied };
  };
  const first = await send("coherent clarification", "delivery", "Briefly clarify the distinction between a temporary connection failure and a permanent validation failure in the retry process we are discussing. Keep this to two short paragraphs.");
  assert.equal(first.destinationId, "delivery"); assert.equal(first.topicIds.length, 0);
  const second = await send("related follow-up", "delivery", "For that same retry process, add a short rule for when the user should see a Retry button. Respect our original project requirements and mention the relevant budget, analytics, and export constraints.");
  assert.equal(second.destinationId, "delivery"); assert.equal(second.topicIds.length, 0);
  const constraints = second.answer.sections.map((section) => section.body).join("\n");
  assert.match(constraints, /60/); assert.match(constraints, /analytics/i); assert.match(constraints, /offline[\s\S]*export|export[\s\S]*offline/i);
  const independent = await send("different subject", "root", "A new concern for this app: design accessible onboarding for a researcher using a screen reader. Explain the important interaction choices and a focused testing procedure in enough detail to explore this on its own.");
  assert.ok([independent.destinationId, ...independent.topicIds].some((id) => id !== "root"), "An independent substantial concern should be separately explorable.");
  const selected = await send("exact passage reuse", "root", "Explain how this prevents an older server response from overwriting my latest draft. Keep it focused on our existing read-cache design.", { selection: { explorationId: "root", messageId: "design", sectionId: "cache", quote: "A response that was requested before a newer edit must not silently replace that draft." } });
  assert.ok([selected.destinationId, ...selected.topicIds].includes("cache"), "The existing cache topic should be reused.");
  if (!process.argv.includes("--defer-synthesis")) {
    const originalDelivery = structuredClone(conversation.explorations.delivery.messages);
    const originalCache = structuredClone(conversation.explorations.cache.messages);
    const combined = await send("comparison and synthesis", "root", "Compare our Retry delivery and Read cache explorations and combine them into a concise implementation checklist for reconnecting. Show how their responsibilities fit together and retain the project constraints.", { includeIds: ["delivery", "cache"] });
    const synthesisIds = new Set([combined.destinationId, ...combined.topicIds]);
    const inputs = new Set((conversation.connections ?? []).filter((edge) => edge.type === "synthesis" && synthesisIds.has(edge.to)).map((edge) => edge.from));
    assert.ok(inputs.has("delivery") && inputs.has("cache"), "A combined answer must retain links to both contributing topics.");
    assert.deepEqual(conversation.explorations.delivery.messages, originalDelivery);
    assert.deepEqual(conversation.explorations.cache.messages, originalCache);
  }
  const annotations = [
    { id: "storage-question", source: { explorationId: "root", messageId: "design", sectionId: "storage", quote: "Write the note and the outgoing operation in the same local transaction." }, question: "Why must these two writes be atomic? Give a short failure example." },
    { id: "support-question", source: { explorationId: "root", messageId: "design", sectionId: "support", quote: "The report can include application version, database version, counts of pending operations, and redacted error categories." }, question: "What should this diagnostic report exclude and why?" },
  ];
  const batch = await send("multiple annotations", "root", "Answer each annotated question separately.", { annotations });
  assert.equal(batch.answer.topics?.length, annotations.length);
  for (const annotation of annotations) {
    const topic = Object.values(conversation.explorations).find((item) => item.messages.some((message) => message.role === "user" && message.source?.quote === annotation.source.quote && message.sections.some((section) => section.body === annotation.question)));
    assert.ok(topic, "Each annotation must retain its exact passage and question.");
  }
  assert.deepEqual(parseSnapshot(await readFile(join(output, "live-journey.ingx"), "utf8")).conversation, conversation);
  console.log(JSON.stringify({ passed: records.length === 6, completedScenarios: records.length, synthesisDeferred: process.argv.includes("--defer-synthesis"), output }));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Journey verification failed."); process.exitCode = 1; });

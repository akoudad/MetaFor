import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnswerRequest, AnswerResult, ModelStatus } from "../src/lib/contracts";
import type { SourceReference } from "../src/lib/model";
import { validateConversation, validateSourceReference } from "../src/lib/model";
import { markdownToText } from "../src/lib/markdown";
import { applyAnswer, createConversation } from "../src/lib/session";
import { focusView, layoutSpace } from "../src/lib/spatial";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";

// Uses the running app's configured provider. Never loads or prints credentials.
// Makes at most three app requests (six paid model calls) and writes artifacts outside the repo.
async function main() {
  const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000").origin;
  const statusResponse = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(15000) });
  if (!statusResponse.ok) throw new Error(`Status endpoint returned HTTP ${statusResponse.status}.`);
  const status = await statusResponse.json() as ModelStatus;
  if (!status.configured) throw new Error("The app has no configured model provider.");
  if (status.accessCodeRequired) throw new Error("This smoke script requires a local app without a demo access gate.");

  const output = await mkdtemp(join(tmpdir(), "metafor-live-smoke-"));
  let conversation = createConversation();
  const rootId = conversation.rootId;
  const steps: { label: string; milliseconds: number; request: AnswerRequest; answer: AnswerResult; destinationId: string }[] = [];
  const send = async (label: string, activeId: string, question: string, selection: SourceReference | null, mode: AnswerRequest["mode"]) => {
    assert.ok(steps.length < 3, "Live smoke is limited to three requests.");
    const request: AnswerRequest = { requestId: `smoke-${crypto.randomUUID()}`, conversation, activeId, question, selection, mode, includeIds: [] };
    const start = performance.now();
    const response = await fetch(`${origin}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(70000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { code?: unknown } | null;
      const code = typeof failure?.code === "string" && /^[a-z_]+$/.test(failure.code) ? failure.code : "request_failed";
      await writeFile(join(output, "failure.json"), JSON.stringify({ label, status: response.status, code, completedSteps: steps.length }, null, 2));
      throw new Error(`${label}: HTTP ${response.status} (${code}). Artifacts: ${output}`);
    }
    const answer = await response.json() as AnswerResult;
    assert.equal(answer.requestId, request.requestId);
    const applied = applyAnswer(conversation, request, answer);
    conversation = applied.conversation;
    validateConversation(conversation);
    const step = { label, milliseconds: Math.round(performance.now() - start), request, answer, destinationId: applied.destinationId };
    steps.push(step);
    console.log(JSON.stringify({ label, milliseconds: step.milliseconds, decision: answer.decision, sections: answer.sections.length, model: answer.model, context: answer.context }));
    return step;
  };

  const first = await send("first answer", rootId, "Explain how a browser decides whether to use a cached HTTP response. Cover freshness, Cache-Control, ETag revalidation, and one small example.", null, "auto");
  const firstMessage = conversation.explorations[rootId].messages.find((message) => message.role === "assistant")!;
  const firstMessageCopy = JSON.stringify(firstMessage);
  const section = firstMessage.sections.find((item) => /etag/i.test(item.body)) ?? firstMessage.sections[0];
  const plain = markdownToText(section.body);
  const quote = (plain.match(/[^.!?\n]*etag[^.!?\n]*[.!?]?/i)?.[0] ?? plain.split("\n").find((line) => line.trim()) ?? plain).trim().slice(0, 600);
  const source: SourceReference = { explorationId: rootId, messageId: firstMessage.id, sectionId: section.id, quote };
  validateSourceReference(conversation, source);
  const branch = await send("selected deeper exploration", rootId, "Walk me through ETag validation in depth: 304 responses, what happens when the resource changes, and a complete request/response example.", source, "auto");
  const clarification = await send("same-topic clarification", branch.destinationId, "Quick clarification: does a 304 response normally include the full representation body? Answer in one short section.", null, "auto");

  const destination = conversation.explorations[branch.destinationId];
  const checks = {
    firstContinuesRoot: first.answer.decision === "continue" && first.destinationId === rootId,
    generatedRelevantContent: /etag|cache-control/i.test(first.answer.sections.map((item) => item.body).join("\n")),
    autoCreatesChild: branch.answer.decision === "branch" && destination.parentId === rootId,
    exactSourcePreserved: JSON.stringify(destination.source) === JSON.stringify(source),
    autoClarificationStays: clarification.answer.decision === "continue" && clarification.destinationId === branch.destinationId,
    branchUsesRootContext: branch.answer.context.fullIds.includes(rootId),
    clarificationUsesOwnAndRootContext: clarification.answer.context.fullIds.includes(branch.destinationId) && clarification.answer.context.fullIds.includes(rootId),
    originalAnswerUnchanged: JSON.stringify(conversation.explorations[rootId].messages.find((message) => message.id === firstMessage.id)) === firstMessageCopy,
    retryDoesNotDuplicate: applyAnswer(conversation, clarification.request, clarification.answer).conversation === conversation,
  };
  const nodes = layoutSpace(conversation);
  const activePoint = nodes.find((node) => node.id === clarification.destinationId)!.position;
  const camera = focusView(activePoint, 1280, 700);
  const snapshot = serializeSnapshot({ format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation, view: { activeId: clarification.destinationId, view: camera, overview: false, started: true, places: {}, history: [rootId] } });
  assert.deepEqual(parseSnapshot(snapshot).conversation, conversation);
  await writeFile(join(output, "live-demo.ingx"), snapshot);
  await writeFile(join(output, "results.json"), JSON.stringify({ date: new Date().toISOString(), origin, model: status.model, requests: steps.length, checks, selectedQuote: source.quote, steps }, null, 2));
  console.log(JSON.stringify({ passed: Object.values(checks).every(Boolean), requests: steps.length, checks, output, snapshot: join(output, "live-demo.ingx") }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Live smoke failed.");
  process.exitCode = 1;
});

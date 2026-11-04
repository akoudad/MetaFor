import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import { applyAnswer, createConversation } from "../src/lib/session";
import { fitOverview, layoutSpace } from "../src/lib/spatial";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";

// Four app requests, each with one writer and one organizer call. No credentials
// are read or printed; this uses the already configured local server.
async function main() {
  const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000").origin;
  const output = process.argv[3] ?? await mkdtemp(join(tmpdir(), "metaphore-graph-smoke-"));
  console.log(`Artifacts: ${output}`);
  let conversation = createConversation();
  const steps: { label: string; milliseconds: number; answer: AnswerResult; topicIds: string[]; destinationId: string }[] = [];
  if (process.argv[3]) {
    conversation = parseSnapshot(await readFile(join(output, "graph.ingx"), "utf8")).conversation;
    const prior = JSON.parse(await readFile(join(output, "results.json"), "utf8"));
    steps.push(...prior.steps);
  }
  const send = async (label: string, question: string) => {
    assert.ok(steps.length < 4);
    const request: AnswerRequest = { requestId: `graph-${crypto.randomUUID()}`, conversation, activeId: conversation.rootId, question, selection: null, mode: "auto", includeIds: [] };
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
    const step = { label, milliseconds: Math.round(performance.now() - start), answer, topicIds: applied.topicIds, destinationId: applied.destinationId };
    steps.push(step);
    const nodes = layoutSpace(conversation);
    const snapshot = serializeSnapshot({ format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation, view: { activeId: conversation.rootId, view: fitOverview(nodes, 1440, 900), overview: true, started: true, places: {}, history: [] } });
    assert.deepEqual(parseSnapshot(snapshot).conversation, conversation);
    await writeFile(join(output, "graph.ingx"), snapshot);
    await writeFile(join(output, "results.json"), JSON.stringify({ date: new Date().toISOString(), steps }, null, 2));
    console.log(JSON.stringify({ label, milliseconds: step.milliseconds, decision: answer.decision, topics: applied.topicIds.map((id) => ({ title: conversation.explorations[id].title, parent: conversation.explorations[conversation.explorations[id].parentId!]?.title })), synthesisEdges: (conversation.connections ?? []).filter((edge) => edge.type === "synthesis").length }));
    return step;
  };
  const first = steps[0] ?? await send("brief overview", "What are the best 4 cities to visit in Morocco? Give me a short recommendation.");
  assert.equal(first.answer.decision, "continue");
  const places = steps[1] ?? await send("independent city details", "ok give me for each city 7 best places ?");
  assert.equal(places.topicIds.length, 4, "Four city guides should have independent destinations.");
  const cityIds = [...places.topicIds];
  const city = (pattern: RegExp) => cityIds.find((id) => pattern.test(conversation.explorations[id].title));
  assert.ok(city(/marrak/i) && city(/f[eè]s|fez/i) && city(/chefchaouen/i));
  const histories = steps[2] ?? await send("focused histories", "ok tell me about jamaa el fnaa history also fes el bali medina whre exact location also about chefchaouen a briefing of history and present");
  assert.equal(histories.topicIds.length, 3, "Three independent histories should not share one long card.");
  const historyCities = histories.topicIds.map((id) => cityIds.includes(id) ? id : conversation.explorations[id].parentId!);
  assert.equal(new Set(historyCities).size, 3);
  for (const id of historyCities) assert.ok(cityIds.includes(id), "Each history must sit in or under its relevant existing city.");
  const combined = steps[3] ?? await send("synthesis", "Compare all four cities for a seven-day trip and combine what we discussed into one practical itinerary with trade-offs.");
  const outputs = [combined.destinationId, ...combined.topicIds];
  const edges = (conversation.connections ?? []).filter((edge) => edge.type === "synthesis" && outputs.includes(edge.to));
  assert.ok(edges.length >= 4, "The combined answer should link its four contributing cities.");
  assert.ok(cityIds.every((id) => conversation.explorations[id]), "Synthesis must retain the original city paths.");
  console.log(JSON.stringify({ passed: true, appRequests: steps.length, modelCalls: steps.length * 2, output }));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Graph smoke failed."); process.exitCode = 1; });

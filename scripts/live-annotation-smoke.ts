import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnswerRequest, AnswerResult } from "../src/lib/contracts";
import { applyAnswer, createConversation } from "../src/lib/session";
import { annotationView, fitOverview, layoutSpace } from "../src/lib/spatial";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";

// Three app requests / six paid calls against an already configured local app.
// Historical text below is a reproduction fixture, not verified current information.
async function main() {
  const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000").origin;
  const output = await mkdtemp(join(tmpdir(), "metaphore-annotations-"));
  console.log(`Artifacts: ${output}`);
  const fixture = (title: string, body: string) => {
    const conversation = createConversation();
    conversation.title = title;
    Object.assign(conversation.explorations.root, { title, summary: title, messages: [{ id: "original", role: "assistant", sections: [{ id: "overview", title: "Overview", body }] }] });
    return conversation;
  };
  const clubs = fixture("Moroccan football teams", "### The Big Three\n\n**Wydad Athletic Club (Wydad AC) - Casablanca**\nFounded 1937. Known for passionate supporters and home at Stade Mohammed V.\n\n**Raja Club Athletic (Raja CA) - Casablanca**\nFounded 1949. Wydad's rival in the Casablanca Derby. Famous for attacking, technical football and its fanbase.\n\n**AS FAR - Rabat**\nFounded 1958. Known for discipline and youth development.\n\n### Other contenders\nRS Berkane, FUS Rabat, MAS Fes, Hassania Agadir, Olympique Safi and Difaa El Jadida.\n\nThe league is Botola Pro Inwi. Current verification needed for exact title counts and standings.");
  const source = (quote: string) => ({ explorationId: "root", messageId: "original", sectionId: "overview", quote });
  const send = async (label: string, request: AnswerRequest) => {
    const started = performance.now();
    const response = await fetch(`${origin}/api/answer`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(request), signal: AbortSignal.timeout(65000) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { code?: string };
      throw new Error(`${label}: HTTP ${response.status} ${failure.code ?? "request_failed"}; artifacts ${output}`);
    }
    const answer = await response.json() as AnswerResult;
    const applied = applyAnswer(request.conversation, request, answer);
    assert.strictEqual(applyAnswer(applied.conversation, request, answer).conversation, applied.conversation);
    const nodes = layoutSpace(applied.conversation);
    const snapshot = serializeSnapshot({ format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation: applied.conversation, view: { activeId: "root", view: fitOverview(nodes, 1440, 900), overview: true, started: true, places: {}, history: [] } });
    assert.deepEqual(parseSnapshot(snapshot).conversation, applied.conversation);
    await writeFile(join(output, `${label}.ingx`), snapshot);
    await writeFile(join(output, `${label}.json`), JSON.stringify({ request, answer, milliseconds: Math.round(performance.now() - started) }, null, 2));
    console.log(JSON.stringify({ label, milliseconds: Math.round(performance.now() - started), primary: answer.decision, topics: [applied.destinationId, ...applied.topicIds].map((id) => applied.conversation.explorations[id].title) }));
    return { answer, ...applied };
  };
  const request = (conversation: AnswerRequest["conversation"], question: string): AnswerRequest => ({ requestId: crypto.randomUUID(), conversation, activeId: "root", question, selection: null, mode: "auto", includeIds: [] });
  const selected = await send("selected-club", { ...request(clubs, "wat their current status"), selection: source("Wydad Athletic Club (Wydad AC) - Casablanca") });
  const selectedIds = [...new Set([selected.destinationId, ...selected.topicIds])].filter((id) => id !== "root");
  assert.equal(selectedIds.length, 1, "A selected club needs its own focused destination.");
  const focused = selected.conversation.explorations[selectedIds[0]];
  assert.match(focused.title, /wydad/i);
  assert.equal(focused.source?.quote, "Wydad Athletic Club (Wydad AC) - Casablanca");
  assert.ok(!focused.messages.filter((message) => message.role === "assistant").some((message) => message.sections.some((section) => /^(Raja|AS FAR|Other contenders)/i.test(section.title))), "Do not repeat profiles of unselected clubs.");
  const pair = annotationView(layoutSpace(selected.conversation), "root", focused.id, 1440, 800);
  assert.equal(pair?.paired, true);
  const annotations = [
    { id: "annotation-wydad", source: source("Wydad Athletic Club (Wydad AC) - Casablanca"), question: "Explain the origin of their name and founding story." },
    { id: "annotation-raja", source: source("Raja Club Athletic (Raja CA) - Casablanca"), question: "Explain their supporters and the Casablanca derby." },
  ];
  const batch = await send("two-annotations", { ...request(clubs, "Answer each annotated question separately."), annotations });
  assert.equal(batch.topicIds.length, 2);
  for (const annotation of annotations) {
    const reply = batch.topicIds.map((id) => batch.conversation.explorations[id]).find((topic) => topic.source?.quote === annotation.source.quote);
    assert.ok(reply, "Each answer must preserve its own passage.");
    assert.ok(reply.messages.some((message) => message.role === "user" && message.sections.some((section) => section.body === annotation.question)));
  }
  const countries = fixture("Western Sahara: countries involved", "The conflict is centered on Western Sahara. Morocco and the Polisario Front/SADR are the main parties. Neighboring states involved include Algeria and Mauritania. Spain is the former colonial power. Other diplomatic actors include the United States, France and Israel. The African Union and United Nations have institutional roles. Current diplomatic positions require verification.");
  const distributed = await send("country-details", request(countries, "ok for each country tell me whats their contribution and historical relation"));
  assert.ok(distributed.topicIds.length >= 5, "Detailed country profiles should have multiple independent destinations.");
  const titles = distributed.topicIds.map((id) => distributed.conversation.explorations[id].title).join("\n");
  assert.match(titles, /morocco/i); assert.match(titles, /algeria/i); assert.match(titles, /united states|\bu\.?s\.?\b/i);
  console.log(JSON.stringify({ passed: true, appRequests: 3, modelCalls: 6, output }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Annotation smoke failed."); process.exitCode = 1; });

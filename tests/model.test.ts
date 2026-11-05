import assert from "node:assert/strict";
import test from "node:test";
import {
  getChildren,
  getDepth,
  getPath,
  getSectionChildren,
  validateConversation,
} from "../src/lib/model";
import { createSampleConversation } from "../src/lib/sample";

test("the sample is valid and preserves a three-level exploration path", () => {
  const space = createSampleConversation();
  assert.doesNotThrow(() => validateConversation(space));
  assert.deepEqual(
    getPath(space, "vesting").map((exploration) => exploration.id),
    ["job-search", "compensation", "equity", "vesting"],
  );
  assert.equal(getDepth(space, "vesting"), 3);
  assert.equal(getDepth(space, space.rootId), 0);
});

test("section navigation opens only explorations anchored to that section", () => {
  const space = createSampleConversation();
  assert.deepEqual(
    getSectionChildren(space, "companies").map((exploration) => exploration.id),
    ["compensation"],
  );
  assert.deepEqual(
    getSectionChildren(space, "equity-vesting").map((exploration) => exploration.id),
    ["vesting"],
  );
  assert.deepEqual(getSectionChildren(space, "unexplored-section"), []);
  assert.deepEqual(
    getChildren(space, "job-search").map((exploration) => exploration.id),
    ["compensation", "priorities", "interviews", "weekly-plan"],
  );
});

test("a new passage discovers reused replies across their complete source range without duplicate or self links", () => {
  const space = createSampleConversation();
  const source = { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies", endSectionId: "interviews" };
  const topic = space.explorations.equity;
  const originalParent = topic.parentId;
  const originalSource = structuredClone(topic.source);
  topic.messages.push(
    { id: "reuse-question", role: "user", source, sections: [{ id: "reuse-question-text", title: "", body: "How does this change our earlier comparison?" }] },
    { id: "reuse-answer", role: "assistant", source, sections: [{ id: "reuse-answer-text", title: "Comparison", body: "The existing topic contains this new reply." }] },
  );
  space.explorations[space.rootId].messages.push({ id: "same-topic-answer", role: "assistant", source, sections: [{ id: "same-topic-answer-text", title: "Clarification", body: "This continues in the source itself." }] });
  assert.doesNotThrow(() => validateConversation(space));
  for (const sectionId of ["companies", "priorities", "interviews"]) {
    const ids = getSectionChildren(space, sectionId).map((item) => item.id);
    assert.equal(ids.filter((id) => id === topic.id).length, 1, "Both message references resolve to one destination.");
    assert.ok(!ids.includes(space.rootId), "A clarification does not create a link to itself.");
  }
  assert.ok(!getSectionChildren(space, "weekly-plan").some((item) => item.id === topic.id));
  assert.ok(getSectionChildren(space, "compensation-equity").some((item) => item.id === topic.id), "The original source remains discoverable too.");
  assert.equal(topic.parentId, originalParent);
  assert.deepEqual(topic.source, originalSource);
});

test("starting another sample does not share mutable content", () => {
  const first = createSampleConversation();
  const second = createSampleConversation();
  first.explorations.compensation.messages[1].sections[0].body = "Changed";
  assert.notEqual(
    second.explorations.compensation.messages[1].sections[0].body,
    "Changed",
  );
});

test("a missing root or parent is rejected with a useful error", () => {
  const missingRoot = createSampleConversation();
  delete missingRoot.explorations[missingRoot.rootId];
  assert.throws(() => validateConversation(missingRoot), /root .* does not exist/);

  const missingParent = createSampleConversation();
  missingParent.explorations.equity.parentId = "missing";
  assert.throws(() => validateConversation(missingParent), /missing parent "missing"/);
});

test("a source must identify a section within the specified message", () => {
  const space = createSampleConversation();
  space.explorations.compensation.source!.sectionId = "priorities-work";
  assert.throws(() => validateConversation(space), /invalid source reference/);
});

test("duplicate message and section IDs are rejected", () => {
  const duplicateMessage = createSampleConversation();
  duplicateMessage.explorations.equity.messages[0].id = "compensation-question";
  assert.throws(() => validateConversation(duplicateMessage), /Duplicate or empty message ID/);

  const duplicateSection = createSampleConversation();
  duplicateSection.explorations.equity.messages[1].sections[0].id = "companies";
  assert.throws(() => validateConversation(duplicateSection), /Duplicate or empty section ID/);
});

test("parent cycles cannot trap path traversal", () => {
  const space = createSampleConversation();
  space.explorations.compensation.parentId = "equity";
  assert.throws(() => getPath(space, "vesting"), /parent cycle/);
  assert.throws(() => validateConversation(space), /parent cycle/);
});

test("message provenance rejects self references, future answers, and circular source chains", () => {
  const reference = (explorationId: string, messageId: string, sectionId: string) => ({ explorationId, messageId, sectionId });
  const self = createSampleConversation();
  self.explorations.compensation.messages[1].source = reference("compensation", "compensation-answer", "compensation-package");
  assert.throws(() => validateConversation(self), /earlier answer/);
  const future = createSampleConversation();
  future.explorations.compensation.messages[0].source = reference("compensation", "compensation-answer", "compensation-package");
  assert.throws(() => validateConversation(future), /earlier answer/);
  const cycle = createSampleConversation();
  cycle.explorations.compensation.messages[1].source = reference("equity", "equity-answer", "equity-instrument");
  cycle.explorations.equity.messages[1].source = reference("compensation", "compensation-answer", "compensation-package");
  assert.throws(() => validateConversation(cycle), /source cycle/);
});

test("later messages can revisit a topic without creating circular provenance", () => {
  const space = createSampleConversation();
  space.explorations.equity.messages[1].source = { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-package" };
  space.explorations.compensation.messages.push({
    id: "compensation-revisited", role: "assistant",
    source: { explorationId: "equity", messageId: "equity-answer", sectionId: "equity-instrument" },
    sections: [{ id: "compensation-new-comparison", title: "Comparison", body: "A later comparison draws on the existing equity answer." }],
  });
  assert.doesNotThrow(() => validateConversation(space));
});

test("invalid IDs and detached roots do not produce misleading paths", () => {
  const space = createSampleConversation();
  assert.throws(() => getPath(space, "missing"), /does not exist/);
  space.explorations.priorities.parentId = null;
  assert.throws(() => getPath(space, "priorities"), /not connected/);
  assert.throws(() => validateConversation(space), /missing its navigation parent/);
});

test("directed synthesis links coexist with related links without changing navigation ancestry", () => {
  const space = createSampleConversation();
  const before = getPath(space, "equity").map((item) => item.id);
  space.connections = [
    { id: "synthesis-a", from: "priorities", to: "equity", type: "synthesis", status: "accepted", reason: "Uses career priorities in this comparison." },
    { id: "synthesis-b", from: "interviews", to: "equity", type: "synthesis", status: "accepted", reason: "Uses interview preparation in this comparison." },
    { id: "related-a", from: "priorities", to: "equity", type: "related", status: "suggested", reason: "These topics may also be compared." },
    { id: "related-b", from: "equity", to: "interviews", type: "related", status: "accepted", reason: "An existing accepted relationship." },
  ];
  const serialized = JSON.stringify(space);
  assert.doesNotThrow(() => validateConversation(space));
  assert.deepEqual(getPath(space, "equity").map((item) => item.id), before);
  assert.equal(JSON.stringify(space), serialized, "validation preserves link direction and all original content");
  assert.doesNotThrow(() => validateConversation(JSON.parse(serialized)), "synthesis links survive the existing JSON conversation representation");
});

test("connection cycles are valid while parent cycles remain invalid", () => {
  const space = createSampleConversation();
  space.connections = [
    { id: "synthesis-forward", from: "priorities", to: "equity", type: "synthesis", status: "accepted", reason: "An earlier synthesis input." },
    { id: "synthesis-return", from: "equity", to: "priorities", type: "synthesis", status: "accepted", reason: "A later synthesis builds on the resulting topic." },
  ];
  assert.doesNotThrow(() => validateConversation(space));
  assert.equal(getDepth(space, "equity"), 2);
  space.explorations.compensation.parentId = "equity";
  assert.throws(() => validateConversation(space), /parent cycle/);
});

test("synthesis links require accepted status, distinct existing endpoints, and unique IDs", () => {
  const base = { id: "synthesis", from: "priorities", to: "equity", type: "synthesis", status: "accepted", reason: "Combines both subjects." };
  const invalid = [
    { link: { ...base, status: "suggested" }, error: /synthesis connection must be accepted/ },
    { link: { ...base, from: "missing" }, error: /missing exploration/ },
    { link: { ...base, to: "missing" }, error: /missing exploration/ },
    { link: { ...base, to: base.from }, error: /different explorations/ },
    { link: { ...base, type: "causes" }, error: /Unsupported connection type/ },
  ];
  for (const { link, error } of invalid) {
    const space = { ...createSampleConversation(), connections: [link] };
    assert.throws(() => validateConversation(space), error);
  }
  assert.throws(() => validateConversation({ ...createSampleConversation(), connections: [base, { ...base, to: "interviews" }] }), /Duplicate connection ID/);
});

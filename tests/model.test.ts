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

test("invalid IDs and detached roots do not produce misleading paths", () => {
  const space = createSampleConversation();
  assert.throws(() => getPath(space, "missing"), /does not exist/);
  space.explorations.priorities.parentId = null;
  assert.throws(() => getPath(space, "priorities"), /not connected/);
  assert.throws(() => validateConversation(space), /missing its navigation parent/);
});

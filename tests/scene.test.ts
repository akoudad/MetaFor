import assert from "node:assert/strict";
import test from "node:test";
import { BRANCH_TRANSITION_MS, createBranchScene, sampleBranchScene } from "../src/lib/scene";
import { CARD_HEIGHT, CARD_WIDTH, FIELD_OF_VIEW, focusView } from "../src/lib/spatial";

test("a new branch emerges from its source and finishes at its real position and view", () => {
  const source = { x: 0, y: 0, z: 0 };
  const destination = { x: 880, y: -1280, z: -1050 };
  const start = focusView(source, 1440, 900);
  const end = focusView(destination, 1440, 900);
  const scene = createBranchScene(source, destination, start, end, 1440, 900);
  const first = sampleBranchScene(scene, 0);
  assert.deepEqual(first.position, source);
  assert.deepEqual(first.view, start);
  assert.equal(first.opacity, 0);
  assert.ok(first.scale < 0.2);
  const final = sampleBranchScene(scene, BRANCH_TRANSITION_MS);
  assert.deepEqual(final.position, destination);
  assert.deepEqual(final.view, end);
  assert.equal(final.scale, 1);
  assert.equal(final.opacity, 1);
  assert.equal(final.edgeProgress, 1);
  assert.equal(final.done, true);
  assert.deepEqual(sampleBranchScene(scene, BRANCH_TRANSITION_MS * 2), final);
});

test("the relationship pause keeps both complete cards in view before the final dive", () => {
  const source = { x: -1760, y: -1280, z: -1050 };
  const destination = { x: 1760, y: -2560, z: -2100 };
  const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
  for (const [width, height] of [[1440, 900], [390, 700]]) {
    const scene = createBranchScene(source, destination, focusView(source, width, height), focusView(destination, width, height), width, height);
    const reveal = sampleBranchScene(scene, 520);
    assert.deepEqual(reveal.view, sampleBranchScene(scene, 620).view);
    assert.deepEqual(reveal.position, destination);
    assert.equal(reveal.opacity, 1);
    assert.equal(reveal.edgeProgress, 1);
    for (const position of [source, destination]) {
      const distance = reveal.view.z - position.z;
      assert.ok((Math.abs(position.x - reveal.view.x) + CARD_WIDTH / 2) / distance < tangent * width / height);
      assert.ok((Math.abs(position.y - reveal.view.y) + CARD_HEIGHT / 2) / distance < tangent);
    }
  }
});

test("emergence stays between its endpoints and never mutates saved layout positions", () => {
  const source = { x: 40, y: -1280, z: -1050 };
  const destination = { x: -880, y: -2560, z: -2100 };
  const scene = createBranchScene(source, destination, focusView(source, 1000, 700), focusView(destination, 1000, 700), 1000, 700);
  const original = structuredClone({ source, destination, scene });
  let previousProgress = 0;
  for (let elapsed = 0; elapsed <= BRANCH_TRANSITION_MS; elapsed += 16) {
    const sample = sampleBranchScene(scene, elapsed);
    for (const axis of ["x", "y", "z"] as const) {
      assert.ok(sample.position[axis] >= Math.min(source[axis], destination[axis]));
      assert.ok(sample.position[axis] <= Math.max(source[axis], destination[axis]));
    }
    assert.ok(sample.edgeProgress >= previousProgress);
    previousProgress = sample.edgeProgress;
  }
  assert.deepEqual({ source, destination, scene }, original);
});

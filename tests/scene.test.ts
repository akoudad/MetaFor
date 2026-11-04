import assert from "node:assert/strict";
import test from "node:test";
import { BATCH_TRANSITION_MS, BRANCH_TRANSITION_MS, createBatchScene, createBranchScene, sampleBatchScene, sampleBranchScene } from "../src/lib/scene";
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

test("a batch fans out from individual origins and settles on the whole group", () => {
  const topics = [
    { id: "paris", source: { x: 0, y: 0, z: 0 }, destination: { x: -380, y: -840, z: -420 } },
    { id: "berlin", source: { x: 0, y: 0, z: 0 }, destination: { x: 380, y: -840, z: -420 } },
    { id: "rome", source: { x: 760, y: -840, z: -420 }, destination: { x: 380, y: -1680, z: -840 } },
    { id: "madrid", source: { x: 760, y: -840, z: -420 }, destination: { x: 1140, y: -1680, z: -840 } },
  ];
  const startView = { x: 0, y: 0, z: 650 };
  const endView = { x: 380, y: -840, z: 3000 };
  const scene = createBatchScene(topics, startView, endView);
  const original = structuredClone({ topics, startView, endView, scene });
  const first = sampleBatchScene(scene, 0);
  assert.deepEqual(first.view, startView);
  for (const node of first.nodes) {
    assert.deepEqual(node.position, topics.find((topic) => topic.id === node.id)!.source);
    assert.equal(node.opacity, 0);
    assert.equal(node.edgeProgress, 0);
  }
  let previousEdge = 0;
  for (let elapsed = 0; elapsed < BATCH_TRANSITION_MS; elapsed += 16) {
    const sample = sampleBatchScene(scene, elapsed);
    for (const axis of ["x", "y", "z"] as const) {
      assert.ok(sample.view[axis] >= Math.min(startView[axis], endView[axis]));
      assert.ok(sample.view[axis] <= Math.max(startView[axis], endView[axis]), "batch camera must not dive beyond the group view");
    }
    for (const node of sample.nodes) {
      const topic = topics.find((value) => value.id === node.id)!;
      for (const axis of ["x", "y", "z"] as const) {
        assert.ok(node.position[axis] >= Math.min(topic.source[axis], topic.destination[axis]));
        assert.ok(node.position[axis] <= Math.max(topic.source[axis], topic.destination[axis]));
      }
    }
    assert.ok(sample.nodes[0].edgeProgress >= previousEdge);
    previousEdge = sample.nodes[0].edgeProgress;
  }
  const final = sampleBatchScene(scene, BATCH_TRANSITION_MS);
  assert.deepEqual(final.view, endView);
  assert.equal(final.done, true);
  for (const node of final.nodes) {
    assert.deepEqual(node.position, topics.find((topic) => topic.id === node.id)!.destination);
    assert.equal(node.scale, 1);
    assert.equal(node.opacity, 1);
    assert.equal(node.edgeProgress, 1);
  }
  assert.deepEqual(sampleBatchScene(scene, BATCH_TRANSITION_MS * 2), final);
  assert.deepEqual({ topics, startView, endView, scene }, original);
});

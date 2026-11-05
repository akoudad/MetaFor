import assert from "node:assert/strict";
import test from "node:test";
import { advanceSpatialScroll } from "../src/lib/spatial-scroll";
import type { SpatialScrollOwner, SpatialScrollState } from "../src/lib/spatial-scroll";

function gesture() {
  let state: SpatialScrollState | null = null;
  let time = 0;
  return (delta: number, owner: SpatialScrollOwner = "space", scope = "root", gap = 16) => {
    time += gap;
    const result = advanceSpatialScroll(state, { time, delta, owner, scope });
    state = result.state;
    return result.direction;
  };
}

test("a burst that starts inside a topic never becomes space navigation", () => {
  const step = gesture();
  assert.equal(step(120, "topic"), 0);
  assert.equal(step(400, "space"), 0);
  assert.equal(step(-400, "space"), 0);
});

test("entering a topic cancels a space gesture even after crossing back out", () => {
  const step = gesture();
  assert.equal(step(40), 0);
  assert.equal(step(40, "topic"), 0);
  assert.equal(step(120), 0);
  assert.equal(step(-120), 0);
});

test("tiny noise and opposing deltas do not cross the deliberate threshold", () => {
  const step = gesture();
  for (let index = 0; index < 20; index++) assert.equal(step(index % 2 ? -2 : 2), 0);
  assert.equal(step(69), 0);
  assert.equal(step(-69), 0);
  assert.equal(step(-70), -1);
});

test("one action consumes sustained momentum and reversal in the same burst", () => {
  const step = gesture();
  assert.equal(step(35), 0);
  assert.equal(step(35), 1);
  for (const delta of [160, 80, 40, 20, 5, -80, -500]) assert.equal(step(delta), 0);
});

test("a fresh burst after a pause can navigate again", () => {
  const step = gesture();
  assert.equal(step(100), 1);
  assert.equal(step(-100, "space", "root", 199), 0);
  assert.equal(step(-100, "space", "root", 200), -1);
  assert.equal(step(100, "topic", "root", 200), 0);
  assert.equal(step(100, "space", "root", 200), 1);
});

test("huge deltas and resulting scope changes still produce just one action", () => {
  const step = gesture();
  assert.equal(step(100_000), 1);
  assert.equal(step(100_000, "space", "child"), 0);
  assert.equal(step(-100_000, "space", "grandchild"), 0);
  assert.equal(step(-100, "space", "grandchild", 200), -1);
});

test("a scope change before the threshold cancels the burst until a pause", () => {
  const step = gesture();
  assert.equal(step(30), 0);
  assert.equal(step(40, "space", "child"), 0);
  assert.equal(step(100, "space", "root"), 0);
  assert.equal(step(70, "space", "child", 200), 1);
});

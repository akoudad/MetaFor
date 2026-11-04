import assert from "node:assert/strict";
import test from "node:test";
import { consumeScrollGesture, SCROLL_GESTURE_GAP, stepSemanticScroll } from "../src/lib/semantic-scroll";
import type { ScrollGesture } from "../src/lib/semantic-scroll";

function gesture() {
  let state: ScrollGesture | null = null;
  return (delta: number, now: number, remaining = 0, scope = "topic:a") => {
    const result = stepSemanticScroll(state, { scope, delta, now, remaining });
    state = result.state;
    return result.action;
  };
}

test("a fresh gesture at an existing boundary crosses once after deliberate movement", () => {
  const step = gesture();
  assert.equal(step(25, 0), "wait");
  assert.equal(step(35, 20), "cross");
  assert.equal(step(100, 50), "wait");
  assert.equal(step(60, 50 + SCROLL_GESTURE_GAP), "cross");
});

test("reading to an edge consumes the burst even when its momentum reverses", () => {
  const step = gesture();
  assert.equal(step(120, 0, 80), "read");
  assert.equal(step(120, 40), "wait");
  assert.equal(step(-120, 80), "wait");
  assert.equal(step(120, 100), "wait");
  assert.equal(step(60, 310), "cross");
});

test("level changes swallow all residual momentum, including scrollable child text", () => {
  const step = gesture();
  assert.equal(step(100, 0), "cross");
  assert.equal(step(100, 250), "cross");
  assert.equal(step(100, 280, 900, "topic:child"), "wait");
  assert.equal(step(100, 330, 900, "topic:child"), "wait");
  assert.equal(step(100, 540, 900, "topic:child"), "read");
});

test("reversing away from an edge reads immediately but does not unlock navigation", () => {
  const step = gesture();
  step(20, 0);
  assert.equal(step(-100, 40, 500), "read");
  assert.equal(step(100, 60), "wait");
  assert.equal(step(100, 280), "cross");
});

test("overview and fork gestures need no hidden reader, but still consume momentum", () => {
  const step = gesture();
  assert.equal(step(60, 0, 0, "overview"), "cross");
  assert.equal(step(100, 30, 1000, "topic:a"), "wait");
  assert.equal(step(100, 250, 1000, "topic:a"), "read");
});

test("leaf and physical zoom no-ops cannot catch a later child in the same burst", () => {
  const state = consumeScrollGesture("topic:a", 100, 100);
  const result = stepSemanticScroll(state, { scope: "topic:a", delta: 100, now: 140, remaining: 0 });
  assert.equal(result.action, "wait");
  assert.equal(stepSemanticScroll(result.state, { scope: "topic:a", delta: 100, now: 400, remaining: 0 }).action, "cross", "a fresh gesture can navigate after physical navigation");
});

test("zero and invalid wheel input cannot advance or corrupt the gate", () => {
  const state = consumeScrollGesture("topic:a", 1, 10);
  for (const delta of [0, NaN, Infinity]) assert.deepEqual(stepSemanticScroll(state, { scope: "topic:a", delta, now: 20, remaining: 0 }), { state, action: "wait" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { getDepth } from "../src/lib/model";
import type { Conversation } from "../src/lib/model";
import { createSampleConversation } from "../src/lib/sample";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  FIELD_OF_VIEW,
  MAX_DISTANCE,
  MIN_DISTANCE,
  applyPositionOverrides,
  connectionEndpoints,
  detailForScale,
  fitOverview,
  focusView,
  layoutSpace,
  normalizeWheel,
  zoomView,
} from "../src/lib/spatial";
import type { SpatialNode, SpatialPoint } from "../src/lib/spatial";

function graph(count: number, parentIndex: (index: number) => number): Conversation {
  const space: Conversation = { id: "layout-test", title: "Layout test", rootId: "topic-0", explorations: {} };
  for (let index = 0; index < count; index++) {
    const id = `topic-${index}`;
    const parentId = index ? `topic-${parentIndex(index)}` : null;
    space.explorations[id] = {
      id, title: `Topic ${index}`, summary: "", parentId,
      source: parentId ? { explorationId: parentId, messageId: `${parentId}-answer`, sectionId: `${parentId}-section` } : null,
      position: [0, 0, 0],
      messages: [{ id: `${id}-answer`, role: "assistant", sections: [{ id: `${id}-section`, title: "Section", body: "A topic to explore." }] }],
    };
  }
  return space;
}

function projectedCards(nodes: SpatialNode[], view: SpatialPoint, width: number, height: number) {
  const focal = height / (2 * Math.tan(FIELD_OF_VIEW * Math.PI / 360));
  return nodes.map((node) => {
    const scale = focal / (view.z - node.position.z);
    return { id: node.id, x: width / 2 + (node.position.x - view.x) * scale, y: height / 2 - (node.position.y - view.y) * scale, scale };
  });
}

function assertSeparatedOverview(nodes: SpatialNode[], width: number, height: number, view = fitOverview(nodes, width, height)) {
  const cards = projectedCards(nodes, view, width, height);
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    assert.ok(card.scale > 0);
    assert.ok(card.x - CARD_WIDTH * card.scale / 2 >= 0 && card.x + CARD_WIDTH * card.scale / 2 <= width);
    assert.ok(card.y - CARD_HEIGHT * card.scale / 2 >= 0 && card.y + CARD_HEIGHT * card.scale / 2 <= height);
    for (const other of cards.slice(index + 1)) {
      const halfWidths = CARD_WIDTH * (card.scale + other.scale) / 2;
      const halfHeights = CARD_HEIGHT * (card.scale + other.scale) / 2;
      assert.ok(Math.abs(card.x - other.x) >= halfWidths || Math.abs(card.y - other.y) >= halfHeights,
        `${card.id} overlaps ${other.id} at ${width}×${height}`);
    }
  }
}

test("layout keeps semantic depth and reserves distinct lanes around each parent", () => {
  const space = createSampleConversation();
  const nodes = layoutSpace(space);
  assert.deepEqual(nodes, layoutSpace(space));
  assert.equal(new Set(nodes.map((node) => node.id)).size, Object.keys(space.explorations).length);
  assert.equal(new Set(nodes.map((node) => JSON.stringify(node.position))).size, nodes.length);
  assert.deepEqual(nodes.find((node) => node.id === space.rootId)!.position, { x: 0, y: 0, z: 0 });
  for (const node of nodes) {
    assert.equal(node.position.z || 0, -1050 * getDepth(space, node.id) || 0);
    const peers = nodes.filter((peer) => peer.id !== node.id && peer.position.z === node.position.z);
    for (const peer of peers) assert.ok(Math.abs(peer.position.x - node.position.x) >= CARD_WIDTH || Math.abs(peer.position.y - node.position.y) >= CARD_HEIGHT);
    const parentId = space.explorations[node.id].parentId;
    if (parentId) {
      const parent = nodes.find((peer) => peer.id === parentId)!;
      assert.ok(node.position.y < parent.position.y);
      assert.ok(parent.position.y - node.position.y > CARD_HEIGHT + 1050 * Math.tan(FIELD_OF_VIEW * Math.PI / 360));
    }
  }
  const firstLevel = nodes.filter((node) => space.explorations[node.id].parentId === space.rootId);
  assert.equal(new Set(firstLevel.map((node) => node.position.x)).size, firstLevel.length);
  const compensation = nodes.find((node) => node.id === "compensation")!.position;
  const equity = nodes.find((node) => node.id === "equity")!.position;
  const vesting = nodes.find((node) => node.id === "vesting")!.position;
  assert.equal(equity.x, compensation.x);
  assert.equal(vesting.x, equity.x);
  assert.ok(vesting.y < equity.y && equity.y < compensation.y);
});

test("fitted overviews separate projected cards across broad, mixed, and 200-level graphs", () => {
  const spaces = [
    createSampleConversation(),
    graph(200, () => 0),
    graph(80, (index) => Math.floor((index - 1) / 3)),
    graph(200, (index) => Math.floor((index - 1) / 2)),
    graph(200, (index) => index - 1),
  ];
  for (const space of spaces) {
    const nodes = layoutSpace(space);
    assert.ok(nodes.every((node) => Object.values(node.position).every((value) => Number.isFinite(value) && Math.abs(value) < 1e6)));
    for (const [width, height] of [[1440, 900], [390, 700], [700, 390], [2560, 1080]]) assertSeparatedOverview(nodes, width, height);
  }
});

test("adding root siblings or deeper branches leaves existing default positions unchanged", () => {
  const space = createSampleConversation();
  const before = new Map(layoutSpace(space).map((node) => [node.id, node.position]));
  for (const [id, template] of [["another-company", "compensation"], ["another-package", "equity"]]) {
    const added = structuredClone(space.explorations[template]);
    added.id = id;
    added.messages = added.messages.map((message) => ({
      ...message,
      id: `${id}-${message.id}`,
      sections: message.sections.map((section) => ({ ...section, id: `${id}-${section.id}` })),
    }));
    space.explorations[id] = added;
    for (const node of layoutSpace(space)) {
      if (before.has(node.id)) assert.deepEqual(node.position, before.get(node.id));
    }
  }
});

test("incrementally appending a mixed tree preserves all earlier world positions", () => {
  const complete = graph(80, (index) => Math.floor((index - 1) / 3));
  const growing = structuredClone(complete);
  growing.explorations = {};
  const remembered = new Map<string, SpatialPoint>();
  for (const exploration of Object.values(complete.explorations)) {
    growing.explorations[exploration.id] = exploration;
    for (const node of layoutSpace(growing)) {
      if (remembered.has(node.id)) assert.deepEqual(node.position, remembered.get(node.id));
      else remembered.set(node.id, node.position);
    }
  }
});

test("position overrides move only requested nodes and leave the conversation unchanged", () => {
  const space = createSampleConversation();
  const original = structuredClone(space);
  const defaults = layoutSpace(space);
  const moved = { x: 4500, y: -2200, z: -1400 };
  const nodes = layoutSpace(space, { compensation: moved });
  assert.deepEqual(nodes, applyPositionOverrides(defaults, { compensation: moved }));
  assert.deepEqual(nodes.find((node) => node.id === "compensation")!.position, moved);
  for (const node of nodes.filter((node) => node.id !== "compensation")) {
    assert.deepEqual(node.position, defaults.find((value) => value.id === node.id)!.position);
  }
  assert.deepEqual(space, original);
  assert.deepEqual(layoutSpace(space, { compensation: { x: NaN, y: 3, z: 2 } }), defaults);
  assert.deepEqual(applyPositionOverrides(defaults, {}), defaults, "clearing overrides restores the automatic layout");
});

test("manual placement stays literal while remaining automatic rows stay separated", () => {
  const base = layoutSpace(graph(80, (index) => Math.floor((index - 1) / 3)));
  const manual = { x: -18_000, y: 15_000, z: -3000 };
  const nodes = applyPositionOverrides(base, { "topic-4": manual, "topic-5": manual });
  assert.deepEqual(nodes.find((node) => node.id === "topic-4")!.position, manual);
  assert.deepEqual(nodes.find((node) => node.id === "topic-5")!.position, manual, "intentional manual overlap must not silently rearrange cards");
  const automatic = nodes.filter((node) => !["topic-4", "topic-5"].includes(node.id));
  for (const [width, height] of [[1440, 900], [390, 700]]) {
    assertSeparatedOverview(automatic, width, height, fitOverview(nodes, width, height));
  }
});

test("origin endpoints stop outside card edges and retain parent-to-child direction", () => {
  const parent = { x: 0, y: 0, scale: 1 };
  const child = { x: 1000, y: 0, scale: 1 };
  const endpoints = connectionEndpoints(parent, child)!;
  assert.deepEqual(endpoints, { start: { x: 307, y: 0 }, end: { x: 693, y: 0 } });
  assert.ok(endpoints.end.x > endpoints.start.x);
  assert.deepEqual(connectionEndpoints(child, parent), { start: endpoints.end, end: endpoints.start });

  const vertical = connectionEndpoints(parent, { x: 0, y: -1400, scale: 0.5 })!;
  assert.deepEqual(vertical, { start: { x: 0, y: -267 }, end: { x: 0, y: -1263 } });
  const diagonal = connectionEndpoints(parent, { x: 1000, y: 1000, scale: 1 })!;
  assert.ok(diagonal.start.y > CARD_HEIGHT / 2);
  assert.ok(diagonal.end.y < 1000 - CARD_HEIGHT / 2);
  assert.ok(diagonal.end.x > diagonal.start.x && diagonal.end.y > diagonal.start.y);
});

test("overlapping and invalid card projections never create reversed or invalid arrows", () => {
  const card = { x: 100, y: 100, scale: 1 };
  assert.equal(connectionEndpoints(card, card), null);
  assert.equal(connectionEndpoints(card, { x: 500, y: 100, scale: 1 }), null);
  assert.equal(connectionEndpoints(card, { x: NaN, y: 100, scale: 1 }), null);
  assert.equal(connectionEndpoints(card, { x: 1000, y: 100, scale: 0 }), null);
});

test("overview fits every full card inside landscape and portrait viewports", () => {
  const nodes = layoutSpace(createSampleConversation());
  const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
  for (const [width, height] of [[1440, 900], [390, 700]]) {
    const camera = fitOverview(nodes, width, height);
    for (const node of nodes) {
      const distance = camera.z - node.position.z;
      assert.ok(distance > 0);
      for (const sign of [-1, 1]) {
        const x = node.position.x + sign * CARD_WIDTH / 2 - camera.x;
        const y = node.position.y + sign * CARD_HEIGHT / 2 - camera.y;
        assert.ok(Math.abs(x / (distance * tangent * width / height)) < 1);
        assert.ok(Math.abs(y / (distance * tangent)) < 1);
      }
    }
  }
});

test("focus fits a complete card and preserves its world center", () => {
  const anchor = { x: -400, y: -760, z: -1050 };
  const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
  for (const [width, height] of [[1440, 700], [320, 600]]) {
    const camera = focusView(anchor, width, height);
    assert.equal(camera.x, anchor.x);
    assert.equal(camera.y, anchor.y);
    const distance = camera.z - anchor.z;
    assert.ok(CARD_WIDTH / 2 < distance * tangent * width / height);
    assert.ok(CARD_HEIGHT / 2 < distance * tangent);
  }
});

test("zoom keeps the chosen anchor in place on screen and reverses before reaching limits", () => {
  const anchor = { x: 800, y: -700, z: -1050 };
  const camera = { x: 300, y: -200, z: 1200 };
  const out = zoomView(camera, anchor, 90);
  assert.ok(out.z > camera.z);
  for (const axis of ["x", "y"] as const) {
    const before = (camera[axis] - anchor[axis]) / (camera.z - anchor.z);
    const after = (out[axis] - anchor[axis]) / (out.z - anchor.z);
    assert.ok(Math.abs(before - after) < 1e-12);
  }
  const back = zoomView(out, anchor, -90);
  for (const axis of ["x", "y", "z"] as const) assert.ok(Math.abs(back[axis] - camera[axis]) < 1e-9);
  assert.deepEqual(anchor, { x: 800, y: -700, z: -1050 });
});

test("zoom cannot cross the target or grow beyond its distance limit", () => {
  const anchor = { x: 40, y: 90, z: -3000 };
  let view = focusView(anchor, 1200, 800);
  for (let index = 0; index < 100; index += 1) view = zoomView(view, anchor, -120);
  assert.equal(view.z - anchor.z, MIN_DISTANCE);
  for (let index = 0; index < 100; index += 1) view = zoomView(view, anchor, 120);
  assert.equal(view.z - anchor.z, MAX_DISTANCE);
});

test("zooming into a large fitted overview does not jump to the ordinary wheel limit", () => {
  const nodes = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    position: { x: index * 900, y: (index % 3) * 900, z: -1050 },
  }));
  const camera = fitOverview(nodes, 390, 700);
  const anchor = nodes[15].position;
  const distance = camera.z - anchor.z;
  assert.ok(distance > MAX_DISTANCE);
  const closer = zoomView(camera, anchor, -10);
  const closerDistance = closer.z - anchor.z;
  assert.ok(closerDistance < distance && closerDistance > distance * 0.95);
  assert.ok(closerDistance > MAX_DISTANCE);
});

test("wheel units are normalized and invalid inputs do not poison camera coordinates", () => {
  assert.equal(normalizeWheel(2, 1), 32);
  assert.equal(normalizeWheel(-1, 2), -120);
  assert.equal(normalizeWheel(10000), 120);
  assert.equal(normalizeWheel(Number.NaN), 0);
  const invalid = { x: Infinity, y: Number.NaN, z: -Infinity };
  for (const camera of [focusView(invalid, 0, Number.NaN), fitOverview([], Infinity, -100), zoomView(invalid, invalid, Infinity)]) {
    assert.ok(Object.values(camera).every(Number.isFinite));
  }
});

test("detail changes only at the defined scale thresholds", () => {
  assert.equal(detailForScale(0.319), "title");
  assert.equal(detailForScale(0.32), "summary");
  assert.equal(detailForScale(0.719), "summary");
  assert.equal(detailForScale(0.72), "full");
  assert.equal(detailForScale(Number.NaN), "title");
});

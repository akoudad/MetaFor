import assert from "node:assert/strict";
import test from "node:test";
import { MAP_PADDING, mapDestination, projectMapPoint, projectSpaceMap } from "../src/lib/minimap";

test("the map fits every point of wide and deep graphs with finite coordinates", () => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({ id: `topic-${index}`, position: { x: (index % 9 - 4) * 15000, y: -index * 1280, z: -index * 1050 } }));
  for (const [width, height] of [[180, 130], [130, 180], [300, 100]]) {
    const map = projectSpaceMap(nodes, width, height);
    assert.equal(map.nodes.length, nodes.length);
    for (const node of map.nodes) {
      assert.ok(node.x >= MAP_PADDING - 1e-8 && node.x <= width - MAP_PADDING + 1e-8);
      assert.ok(node.y >= MAP_PADDING - 1e-8 && node.y <= height - MAP_PADDING + 1e-8);
      assert.ok(Number.isFinite(node.depth));
    }
  }
});

test("fixed isometric axes preserve actual X, Y and Z direction", () => {
  const map = projectSpaceMap([{ id: "origin", position: { x: 0, y: 0, z: 0 } }]);
  const origin = projectMapPoint({ x: 0, y: 0, z: 0 }, map)!;
  const x = projectMapPoint({ x: 100, y: 0, z: 0 }, map)!;
  const y = projectMapPoint({ x: 0, y: 100, z: 0 }, map)!;
  const z = projectMapPoint({ x: 0, y: 0, z: 100 }, map)!;
  assert.ok(x.x > origin.x && x.y > origin.y);
  assert.equal(y.x, origin.x);
  assert.ok(y.y < origin.y);
  assert.ok(z.x < origin.x && z.y > origin.y);
  assert.ok(Math.abs(x.y - z.y) < 1e-10);
  assert.deepEqual(map.nodes[0], { id: "origin", x: 90, y: 65, depth: 0 });
});

test("the map uses dragged coordinates without mutating or inventing node positions", () => {
  const nodes = [{ id: "root", position: { x: 0, y: 0, z: 0 } }, { id: "child", position: { x: 1500, y: -1280, z: -1050 } }];
  const original = structuredClone(nodes);
  const first = projectSpaceMap(nodes);
  assert.deepEqual(projectSpaceMap(nodes), first);
  assert.deepEqual(nodes, original);
  const moved = projectSpaceMap([nodes[0], { ...nodes[1], position: { ...nodes[1].position, x: -1500 } }]);
  assert.notDeepEqual(moved.nodes, first.nodes);
  for (const node of moved.nodes) assert.deepEqual(projectMapPoint(node.id === "root" ? nodes[0].position : { ...nodes[1].position, x: -1500 }, moved), { x: node.x, y: node.y });
});

test("destination indicators show their true position or point outward from an edge", () => {
  const map = projectSpaceMap([{ id: "root", position: { x: 0, y: 0, z: 0 } }]);
  assert.deepEqual(mapDestination({ x: 0, y: 0, z: 0 }, map), { x: 90, y: 65, outside: false, angle: 0 });
  const destination = mapDestination({ x: 100000, y: 0, z: 0 }, map)!;
  assert.equal(destination.outside, true);
  assert.equal(destination.x, map.width - 7);
  assert.equal(destination.y, map.height - 7);
  assert.ok(destination.angle > 0 && destination.angle < 90);
  assert.equal(mapDestination({ x: Infinity, y: 0, z: 0 }, map), null);
  assert.equal(mapDestination({ x: 0, y: 0, z: 0 }, projectSpaceMap([])), null);
});

test("empty, duplicate, invalid and extreme inputs remain bounded", () => {
  const empty = projectSpaceMap([], NaN, Infinity);
  assert.deepEqual(empty.nodes, []);
  assert.ok(Number.isFinite(empty.scale) && empty.scale > 0);
  const map = projectSpaceMap([
    { id: "valid", position: { x: 0, y: 0, z: 0 } },
    { id: "invalid", position: { x: NaN, y: 0, z: 0 } },
    { id: "valid", position: { x: 2000, y: 0, z: 0 } },
    { id: "extreme", position: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: Number.MAX_VALUE } },
  ], 0, -100);
  assert.deepEqual(map.nodes.map((node) => node.id), ["valid", "extreme"]);
  assert.ok(map.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

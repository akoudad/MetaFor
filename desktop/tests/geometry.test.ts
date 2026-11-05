import assert from "node:assert/strict";
import test from "node:test";
import { cropToPixels, normalizeCrop, placeHelpPanel, type Rect } from "../geometry";

function overlaps(first: Rect, second: Rect) {
  return first.x < second.x + second.width && first.x + first.width > second.x
    && first.y < second.y + second.height && first.y + first.height > second.y;
}

function inside(frame: Rect, workArea: Rect) {
  assert.ok(frame.x >= workArea.x && frame.y >= workArea.y);
  assert.ok(frame.x + frame.width <= workArea.x + workArea.width);
  assert.ok(frame.y + frame.height <= workArea.y + workArea.height);
  assert.ok(Object.values(frame).every(Number.isInteger));
  assert.ok(frame.width > 0 && frame.height > 0);
}

test("capture selection validates untrusted renderer values before native crop", () => {
  for (const input of [null, [], "full", {}, { x: "0", y: 0, width: 1, height: 1 },
    { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: Infinity, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 }, { x: 1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: -1, height: 1 }, { x: -3, y: 0, width: 1, height: 1 },
    { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }]) {
    assert.throws(() => normalizeCrop(input));
  }
});

test("capture selection clips edges without expanding the selected region", () => {
  assert.deepEqual(normalizeCrop({ x: -0.25, y: -0.5, width: 0.5, height: 0.75 }),
    { x: 0, y: 0, width: 0.25, height: 0.25 });
  assert.deepEqual(normalizeCrop({ x: 0.5, y: 0.75, width: 1, height: 1 }),
    { x: 0.5, y: 0.75, width: 0.5, height: 0.25 });
  assert.deepEqual(normalizeCrop({ x: -1, y: -1, width: 3, height: 3 }),
    { x: 0, y: 0, width: 1, height: 1 });
});

test("Retina crops use actual image pixels rather than screen point dimensions", () => {
  assert.deepEqual(cropToPixels({ x: 0.25, y: 0.125, width: 0.5, height: 0.25 }, 2880, 1800),
    { x: 720, y: 225, width: 1440, height: 450 });
  assert.deepEqual(cropToPixels({ x: 0.001, y: 0.001, width: 0.001, height: 0.001 }, 2880, 1800),
    { x: 2, y: 1, width: 4, height: 3 });
});

test("subpixel selections at every edge remain positive and inside the image", () => {
  for (const [width, height] of [[1, 1], [1280, 720], [3456, 2234], [5120, 2880]]) {
    for (const point of [0, 0.5, 1 - Number.EPSILON]) {
      const pixel = cropToPixels({ x: point, y: point, width: Number.EPSILON, height: Number.EPSILON }, width, height);
      inside(pixel, { x: 0, y: 0, width, height });
    }
    assert.deepEqual(cropToPixels({ x: 0, y: 0, width: 1, height: 1 }, width, height),
      { x: 0, y: 0, width, height });
  }
});

test("native crop rejects invalid image dimensions", () => {
  const rect = { x: 0, y: 0, width: 1, height: 1 };
  for (const invalid of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => cropToPixels(rect, invalid, 800));
    assert.throws(() => cropToPixels(rect, 800, invalid));
  }
});

test("Help appears beside its source and moves left near the right display edge", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 850 };
  const source = { x: 200, y: 250, width: 300, height: 200 };
  const frame = placeHelpPanel(source, workArea, { width: 380, height: 500 });
  assert.ok(frame.x >= source.x + source.width);
  assert.ok(!overlaps(frame, source));
  inside(frame, workArea);
  const rightSource = { ...source, x: 1050 };
  const leftFrame = placeHelpPanel(rightSource, workArea, { width: 380, height: 500 });
  assert.ok(leftFrame.x + leftFrame.width <= rightSource.x);
  inside(leftFrame, workArea);
});

test("Help uses vertical space when no horizontal space remains", () => {
  const workArea = { x: 0, y: 30, width: 1000, height: 900 };
  const source = { x: 100, y: 100, width: 800, height: 200 };
  const frame = placeHelpPanel(source, workArea, { width: 380, height: 400 });
  assert.ok(frame.y >= source.y + source.height);
  assert.ok(!overlaps(frame, source));
  inside(frame, workArea);
});

test("secondary displays and fractional scale preserve on-screen panel placement", () => {
  for (const area of [
    { x: -1920, y: 30, width: 1920, height: 1050 },
    { x: -900, y: -1440, width: 2560, height: 1440 },
    { x: -1599.5, y: 24.5, width: 1599.5, height: 875.25 },
  ]) {
    for (const x of [0, 0.25, 0.5, 0.95]) {
      for (const y of [0, 0.5, 0.95]) {
        const source = { x: area.x + x * area.width, y: area.y + y * area.height, width: 100, height: 100 };
        const frame = placeHelpPanel(source, area, { width: 440.25, height: 600.5 });
        inside(frame, area);
      }
    }
  }
});

test("oversized Help panels fit small screens and full-screen source fallback stays usable", () => {
  for (const workArea of [
    { x: 0, y: 25, width: 640, height: 455 },
    { x: -320, y: -200, width: 320, height: 200 },
  ]) {
    const frame = placeHelpPanel(workArea, workArea, { width: 800, height: 1000 });
    inside(frame, workArea);
    assert.equal(frame.width, workArea.width - 24);
    assert.equal(frame.height, workArea.height - 24);
  }
});

test("Help placement rejects invalid or unusable screen geometry", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  assert.throws(() => placeHelpPanel({ ...rect, width: -1 }, rect, { width: 400, height: 400 }));
  assert.throws(() => placeHelpPanel(rect, { ...rect, x: NaN }, { width: 400, height: 400 }));
  assert.throws(() => placeHelpPanel(rect, rect, { width: Infinity, height: 400 }));
  assert.throws(() => placeHelpPanel(rect, { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, { width: 400, height: 400 }));
});

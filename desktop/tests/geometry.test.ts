import assert from "node:assert/strict";
import test from "node:test";
import { cropToPixels, guidanceCheckRegions, normalizeCrop, placeHelpAvoidingTargets, placeHelpPanel, placeHelpLauncher, sameGuidanceBackdrop, sameVisibleRegion, type Rect } from "../geometry";

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

test("the compact Help launcher grows upward with a stable bottom edge", () => {
  for (const area of [{ x: 0, y: 25, width: 1440, height: 850 }, { x: -1920, y: -1080, width: 1920, height: 1050 }, { x: 0, y: 0, width: 320, height: 200 }]) {
    const collapsed = placeHelpLauncher(area, false), expanded = placeHelpLauncher(area, true);
    inside(collapsed, area); inside(expanded, area);
    assert.equal(collapsed.y + collapsed.height, expanded.y + expanded.height);
    assert.equal(collapsed.x, expanded.x); assert.equal(collapsed.width, expanded.width);
    assert.ok(expanded.y <= collapsed.y);
    assert.ok(collapsed.width <= 620); assert.ok(collapsed.height <= 110); assert.ok(expanded.height <= 450);
  }
  assert.throws(() => placeHelpLauncher({ x: 0, y: 0, width: 0, height: 200 }, false));
});

test("Help accepts content height with a readable minimum and bounded expansion", () => {
  const area = { x: 0, y: 25, width: 1440, height: 850 };
  const compact = placeHelpLauncher(area, true, 230.5);
  const expanded = placeHelpLauncher(area, true, 900);
  assert.equal(compact.height, 231);
  assert.equal(expanded.height, 580);
  assert.equal(compact.y + compact.height, expanded.y + expanded.height);
  assert.equal(placeHelpLauncher(area, true, 1).height, 110);
  assert.equal(placeHelpLauncher(area, false, 400).height, 110);
  assert.equal(placeHelpLauncher(area, true).height, 450, "existing callers keep their default");
  for (const invalid of [0, -1, NaN, Infinity, "300", null]) {
    assert.throws(() => placeHelpLauncher(area, true, invalid as number));
  }
});

test("Help keeps its launcher position when targets leave it clear", () => {
  const area = { x: 0, y: 25, width: 1920, height: 1050 };
  const preferred = placeHelpLauncher(area, true, 280);
  const targets = [{ x: 20, y: 100, width: 500, height: 850 }, { x: 1400, y: 100, width: 500, height: 850 }];
  assert.deepEqual(placeHelpAvoidingTargets(area, preferred, targets), preferred, "the gap between targets is usable");
  assert.deepEqual(placeHelpAvoidingTargets(area, preferred, []), preferred);
  assert.deepEqual(placeHelpAvoidingTargets(area, preferred, [{ x: 2200, y: 100, width: 100, height: 300 }]), preferred);
});

test("Help moves sideways to uncover a tall central target without shrinking", () => {
  const area = { x: 0, y: 25, width: 1920, height: 1050 };
  const preferred = placeHelpLauncher(area, true, 300);
  const target = { x: 800, y: 180, width: 320, height: 895 };
  assert.ok(overlaps(preferred, target));
  const frame = placeHelpAvoidingTargets(area, preferred, [target]);
  assert.ok(!overlaps(frame, { x: target.x - 16, y: target.y - 16, width: target.width + 32, height: target.height + 32 }));
  assert.equal(frame.y, preferred.y, "a free side position keeps the composer on its original row");
  assert.equal(frame.width, preferred.width); assert.equal(frame.height, preferred.height);
  inside(frame, area);
});

test("Help can use a gap between multiple targets instead of their bounding union", () => {
  const area = { x: 0, y: 25, width: 1920, height: 1050 };
  const preferred = { x: 1280, y: 740, width: 620, height: 300 };
  const targets = [{ x: -300, y: 0, width: 800, height: 1300 }, { x: 1400, y: 0, width: 700, height: 1300 }];
  const frame = placeHelpAvoidingTargets(area, preferred, targets);
  assert.ok(targets.every((target) => !overlaps(frame, target)));
  assert.ok(frame.x >= 516 && frame.x + frame.width <= 1384);
  assert.equal(frame.y, preferred.y);
  inside(frame, area);
});

test("Help can move above a wide low target and respects fractional clearance", () => {
  const area = { x: -1440, y: -900, width: 1440, height: 850 };
  const preferred = placeHelpLauncher(area, true, 250);
  const target = { x: -1440, y: -350.25, width: 1440, height: 300.25 };
  const frame = placeHelpAvoidingTargets(area, preferred, [target]);
  assert.ok(frame.y + frame.height <= target.y - 16);
  assert.equal(frame.x, preferred.x);
  assert.equal(frame.width, preferred.width); assert.equal(frame.height, preferred.height);
  inside(frame, area);
});

test("crowded and small screens keep a deterministic readable Help frame", () => {
  for (const area of [{ x: -1920, y: 25, width: 1920, height: 1050 }, { x: 0, y: 25, width: 320, height: 200 }]) {
    const preferred = placeHelpLauncher(area, true, 330);
    const frame = placeHelpAvoidingTargets(area, preferred, [area]);
    assert.deepEqual(frame, preferred, "equally covered positions do not cause pointless movement");
    assert.deepEqual(placeHelpAvoidingTargets(area, preferred, [area]), frame);
    inside(frame, area);
  }
  const area = { x: 0, y: 25, width: 1000, height: 800 };
  const preferred = placeHelpLauncher(area, true, 280);
  const targets = [{ ...area, width: 950 }];
  const frame = placeHelpAvoidingTargets(area, preferred, targets);
  assert.ok(frame.x > preferred.x, "when overlap is unavoidable, use the least covered position");
  assert.equal(frame.width, preferred.width); assert.equal(frame.height, preferred.height);
});

test("target avoidance rejects invalid screen, panel, and target geometry", () => {
  const area = { x: 0, y: 25, width: 1440, height: 850 };
  const preferred = placeHelpLauncher(area, true, 280);
  assert.throws(() => placeHelpAvoidingTargets({ ...area, x: NaN }, preferred, []));
  assert.throws(() => placeHelpAvoidingTargets(area, { ...preferred, width: 2000 }, []));
  assert.throws(() => placeHelpAvoidingTargets(area, preferred, null as unknown as Rect[]));
  for (const target of [{ ...area, width: 0 }, { ...area, height: -1 }, { ...area, x: Infinity }]) {
    assert.throws(() => placeHelpAvoidingTargets(area, preferred, [target]));
  }
});

test("live guidance comparison tolerates small clock/cursor changes but rejects scrolling and another screen", () => {
  const width = 128, height = 128;
  const blank = new Uint8Array(width * height * 4).fill(220);
  assert.equal(sameVisibleRegion(blank, blank.slice(), width, height), true);
  const minor = blank.slice();
  for (let y = 3; y < 7; y++) for (let x = 100; x < 118; x++) for (let channel = 0; channel < 3; channel++) minor[(y * width + x) * 4 + channel] = 30;
  assert.equal(sameVisibleRegion(blank, minor, width, height), true);
  assert.equal(sameVisibleRegion(blank, new Uint8Array(blank.length).fill(210), width, height), true, "small uniform rendering variations are tolerated");
  const scrolling = blank.slice();
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) for (let channel = 0; channel < 3; channel++) {
    scrolling[(y * width + x) * 4 + channel] = 0;
    scrolling[(y * width + x + 1) * 4 + channel] = 0;
  }
  assert.equal(sameVisibleRegion(blank, scrolling, width, height), false, "small changes spread across the page indicate scrolling");
  assert.equal(sameVisibleRegion(blank, new Uint8Array(blank.length).fill(30), width, height), false);
  assert.equal(sameVisibleRegion(blank, new Uint8Array(4), width, height), false);
});

test("guidance validation surrounds the exact target and arrow endpoint, including clipped edges", () => {
  const source = { width: 1000, height: 800 };
  const point = guidanceCheckRegions({ kind: "point", x: .7, y: .3, width: 0, height: 0 }, source);
  const arrow = guidanceCheckRegions({ kind: "arrow", x: .9, y: .6, width: -.2, height: -.3 }, source);
  assert.deepEqual(point, arrow, "the arrow shaft must not broaden the validation area");
  assert.ok(Math.abs(point[0].width * source.width - 40) < .001);
  assert.ok(Math.abs(point[1].width * source.width - 88) < .001);
  for (const mark of [{ kind: "point" as const, x: 0, y: 1, width: 0, height: 0 }, { kind: "rect" as const, x: .2, y: .3, width: .4, height: .1 }]) {
    for (const region of guidanceCheckRegions(mark, source)) {
      assert.ok(region.x >= 0 && region.y >= 0 && region.x + region.width <= 1 && region.y + region.height <= 1);
      assert.ok(region.width > 0 && region.height > 0);
    }
  }
  assert.throws(() => guidanceCheckRegions({ kind: "point", x: 2, y: .2, width: 0, height: 0 }, source));
  assert.throws(() => guidanceCheckRegions({ kind: "point", x: .2, y: .2, width: 0, height: 0 }, { width: 0, height: 800 }));
});

test("the guidance backdrop allows compact remote motion but rejects distributed or near-full-page change", () => {
  const width = 128, height = 128, original = new Uint8Array(width * height * 4).fill(220);
  const paint = (bitmap: Uint8Array, left: number, top: number, right: number, bottom: number) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) for (let channel = 0; channel < 3; channel++) bitmap[(y * width + x) * 4 + channel] = 30;
  };
  const animation = original.slice(); paint(animation, 24, 40, 96, 96);
  assert.equal(sameVisibleRegion(original, animation, width, height), false);
  assert.equal(sameGuidanceBackdrop(original, animation, width, height), true);
  paint(animation, 112, 2, 120, 6);
  assert.equal(sameGuidanceBackdrop(original, animation, width, height), true, "one small clock change is tolerated alongside local animation");
  const distributed = original.slice();
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) paint(distributed, x, y, x + 2, y + 1);
  assert.equal(sameGuidanceBackdrop(original, distributed, width, height), false);
  const page = original.slice(); paint(page, 8, 8, 120, 120);
  assert.equal(sameGuidanceBackdrop(original, page, width, height), false);
  const separate = original.slice(); paint(separate, 8, 8, 40, 40); paint(separate, 88, 88, 120, 120);
  assert.equal(sameGuidanceBackdrop(original, separate, width, height), false, "multiple substantial changed regions are ambiguous");
  assert.equal(sameGuidanceBackdrop(original, new Uint8Array(4), width, height), false);
});

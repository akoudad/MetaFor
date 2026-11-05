export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return [rect.x, rect.y, rect.width, rect.height].every((part) => typeof part === "number" && Number.isFinite(part));
}

function validRect(value: unknown, name: string): Rect {
  if (!isRect(value) || value.width <= 0 || value.height <= 0
    || !Number.isFinite(value.x + value.width) || !Number.isFinite(value.y + value.height)) {
    throw new Error(`${name} must have finite coordinates and a positive size.`);
  }
  return value;
}

/** Normalized top-left coordinates; only the intersection with the captured image is allowed. */
export function normalizeCrop(value: unknown): Rect {
  const rect = validRect(value, "Selection");
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(1, rect.x + rect.width);
  const bottom = Math.min(1, rect.y + rect.height);
  if (right <= x || bottom <= y) throw new Error("Select an area inside the captured screen.");
  return { x, y, width: right - x, height: bottom - y };
}

/** Round outward to retain every selected pixel, including a subpixel selection on Retina screens. */
export function cropToPixels(value: unknown, width: number, height: number): Rect {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The captured image dimensions are invalid.");
  }
  const crop = normalizeCrop(value);
  const x = Math.min(width - 1, Math.floor(crop.x * width));
  const y = Math.min(height - 1, Math.floor(crop.y * height));
  const right = Math.min(width, Math.ceil((crop.x + crop.width) * width));
  const bottom = Math.min(height, Math.ceil((crop.y + crop.height) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function overlapArea(first: Rect, second: Rect): number {
  return Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x))
    * Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
}

/** Screen-global top-left DIP coordinates. The returned integer frame always fits the work area. */
export function placeHelpPanel(sourceValue: Rect, workAreaValue: Rect, size: Size): Rect {
  const source = validRect(sourceValue, "Source region");
  const area = validRect(workAreaValue, "Display work area");
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error("The Help panel dimensions are invalid.");
  }

  const paddingX = Math.min(12, Math.max(0, (area.width - 2) / 2));
  const paddingY = Math.min(12, Math.max(0, (area.height - 2) / 2));
  const left = Math.ceil(area.x + paddingX);
  const top = Math.ceil(area.y + paddingY);
  const right = Math.floor(area.x + area.width - paddingX);
  const bottom = Math.floor(area.y + area.height - paddingY);
  if (right <= left || bottom <= top) throw new Error("The display work area is too small.");
  const width = Math.min(Math.ceil(size.width), right - left);
  const height = Math.min(Math.ceil(size.height), bottom - top);
  const gap = 20;
  const candidates = [
    { x: source.x + source.width + gap, y: source.y + (source.height - height) / 2 },
    { x: source.x - width - gap, y: source.y + (source.height - height) / 2 },
    { x: source.x + (source.width - width) / 2, y: source.y + source.height + gap },
    { x: source.x + (source.width - width) / 2, y: source.y - height - gap },
  ].map((origin): Rect => ({
    x: Math.min(Math.max(Math.round(origin.x), left), right - width),
    y: Math.min(Math.max(Math.round(origin.y), top), bottom - height),
    width, height,
  }));

  const clear = candidates.find((candidate) => overlapArea(candidate, source) === 0);
  if (clear) return clear;
  return candidates.reduce((best, candidate) => overlapArea(candidate, source) < overlapArea(best, source) ? candidate : best);
}

/** A content-sized launcher grows upward while its bottom edge stays above the Dock. */
export function placeHelpLauncher(workAreaValue: Rect, expanded: boolean, requestedHeight?: number): Rect {
  const area = validRect(workAreaValue, "Display work area");
  if (typeof expanded !== "boolean") throw new Error("Choose a valid Help layout.");
  if (requestedHeight !== undefined && (!Number.isFinite(requestedHeight) || requestedHeight <= 0)) throw new Error("The Help panel height is invalid.");
  const left = Math.ceil(area.x), top = Math.ceil(area.y);
  const right = Math.floor(area.x + area.width), bottom = Math.floor(area.y + area.height);
  if (right <= left || bottom <= top) throw new Error("The display work area is too small.");
  const availableWidth = right - left, availableHeight = bottom - top;
  const sideGap = Math.min(24, Math.floor((availableWidth - 1) / 2));
  const bottomGap = Math.min(24, Math.floor((availableHeight - 1) / 2));
  const width = Math.min(620, availableWidth - sideGap * 2);
  const expandedHeight = requestedHeight === undefined ? 450 : Math.max(110, Math.min(580, Math.ceil(requestedHeight)));
  const height = Math.min(expanded ? expandedHeight : 110, availableHeight - bottomGap * 2);
  return { x: Math.round(left + (availableWidth - width) / 2), y: bottom - bottomGap - height, width, height };
}

/** Keep Help readable and near its launcher, moving only to uncover guidance targets.
 * All rectangles use screen-global top-left DIPs. Targets are kept separate so
 * usable gaps between them remain available; crowded screens use least overlap.
 */
export function placeHelpAvoidingTargets(workAreaValue: Rect, preferredValue: Rect, targetValues: Rect[]): Rect {
  const area = validRect(workAreaValue, "Display work area");
  const preferred = validRect(preferredValue, "Preferred Help frame");
  if (!Array.isArray(targetValues)) throw new Error("Choose valid guidance targets.");
  const left = Math.ceil(area.x), top = Math.ceil(area.y);
  const right = Math.floor(area.x + area.width), bottom = Math.floor(area.y + area.height);
  const width = Math.ceil(preferred.width), height = Math.ceil(preferred.height);
  if (width > right - left || height > bottom - top) throw new Error("The Help panel does not fit the display work area.");
  const insetX = Math.min(16, Math.floor((right - left - width) / 2));
  const insetY = Math.min(16, Math.floor((bottom - top - height) / 2));
  const frameAt = (x: number, y: number): Rect => ({
    x: Math.min(Math.max(Math.round(x), left + insetX), right - insetX - width),
    y: Math.min(Math.max(Math.round(y), top + insetY), bottom - insetY - height),
    width, height,
  });
  const origin = frameAt(preferred.x, preferred.y);
  const targets = targetValues.flatMap((value) => {
    const target = validRect(value, "Guidance target");
    const x = Math.max(left, target.x), y = Math.max(top, target.y);
    const endX = Math.min(right, target.x + target.width), endY = Math.min(bottom, target.y + target.height);
    if (endX <= x || endY <= y) return [];
    return [{ x: x - 16, y: y - 16, width: endX - x + 32, height: endY - y + 32 }];
  });
  const overlap = (frame: Rect) => targets.reduce((total, target) => total + overlapArea(frame, target), 0);
  let best = origin, bestOverlap = overlap(origin), bestDistance = 0;
  if (bestOverlap === 0) return origin;
  const xs = [origin.x, left + insetX, right - insetX - width, ...targets.flatMap((target) => [Math.floor(target.x - width), Math.ceil(target.x + target.width)])];
  const ys = [origin.y, bottom - insetY - height, top + insetY, ...targets.flatMap((target) => [Math.floor(target.y - height), Math.ceil(target.y + target.height)])];
  for (const x of xs) for (const y of ys) {
    const frame = frameAt(x, y);
    const covered = overlap(frame);
    const distance = Math.abs(frame.x - origin.x) + Math.abs(frame.y - origin.y) * 1.25;
    if (covered < bestOverlap || (covered === bestOverlap && distance < bestDistance)) {
      best = frame; bestOverlap = covered; bestDistance = distance;
    }
  }
  return best;
}

/** Compare a target at its original position, plus its immediate surroundings. */
export function guidanceCheckRegions(mark: Rect & { kind: "rect" | "arrow" | "point" }, source: Size): Rect[] {
  if (!mark || !["rect", "arrow", "point"].includes(mark.kind) || !isRect(mark)
    || !source || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0
    || mark.x < 0 || mark.y < 0 || mark.x > 1 || mark.y > 1 || mark.x + mark.width < 0 || mark.y + mark.height < 0
    || mark.x + mark.width > 1 || mark.y + mark.height > 1
    || (mark.kind === "rect" && (mark.width <= 0 || mark.height <= 0))) throw new Error("The guidance target is invalid.");
  // An arrow identifies its endpoint, not the empty space along its shaft.
  const x = mark.x + (mark.kind === "arrow" ? mark.width : mark.kind === "rect" ? mark.width / 2 : 0);
  const y = mark.y + (mark.kind === "arrow" ? mark.height : mark.kind === "rect" ? mark.height / 2 : 0);
  const width = Math.max(mark.kind === "rect" ? mark.width : 0, 32 / source.width);
  const height = Math.max(mark.kind === "rect" ? mark.height : 0, 32 / source.height);
  return [4, 28].map((padding) => normalizeCrop({ x: x - width / 2 - padding / source.width, y: y - height / 2 - padding / source.height, width: width + padding * 2 / source.width, height: height + padding * 2 / source.height }));
}

function frameDifference(first: Uint8Array, second: Uint8Array, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 256 || height > 256
    || first.length !== width * height * 4 || second.length !== first.length) return null;
  let delta = 0, changed = 0;
  const tileChanges = new Uint16Array(64), tilePixels = new Uint16Array(64);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    const difference = (Math.abs(first[offset] - second[offset]) + Math.abs(first[offset + 1] - second[offset + 1]) + Math.abs(first[offset + 2] - second[offset + 2])) / 3;
    delta += difference;
    const tile = Math.min(7, Math.floor((pixel % width) * 8 / width)) + Math.min(7, Math.floor(Math.floor(pixel / width) * 8 / height)) * 8;
    tilePixels[tile]++;
    if (difference > 32) { changed++; tileChanges[tile]++; }
  }
  const changedTiles = tileChanges.filter((count, index) => count > tilePixels[index] * .025).length;
  return { mean: delta / (width * height), changed, total: width * height, changedTiles, tileChanges, tilePixels };
}

/** Conservative local comparison of equally sized BGRA thumbnails; alpha is ignored. */
export function sameVisibleRegion(first: Uint8Array, second: Uint8Array, width: number, height: number): boolean {
  const difference = frameDifference(first, second, width, height);
  // Distributed changes catch scrolling even on mostly blank document pages.
  return !!difference && difference.mean <= 10 && difference.changed / difference.total <= .06 && difference.changedTiles <= 16;
}

/**
 * Global guard used ONLY after every target and its neighborhood pass the strict
 * comparison. A single compact change elsewhere may be animation. Distributed
 * or near-full-page changes reject. This cannot prove semantic identity: a
 * localized replacement can resemble animation; no tracking occurs after show.
 */
export function sameGuidanceBackdrop(first: Uint8Array, second: Uint8Array, width: number, height: number): boolean {
  if (sameVisibleRegion(first, second, width, height)) return true;
  const difference = frameDifference(first, second, width, height);
  if (!difference || difference.changed / difference.total > .45) return false;
  const pending = new Set<number>();
  difference.tileChanges.forEach((count, index) => { if (count > difference.tilePixels[index] * .025) pending.add(index); });
  const components: number[][] = [];
  while (pending.size) {
    const queue = [pending.values().next().value!], component: number[] = [];
    pending.delete(queue[0]);
    while (queue.length) {
      const tile = queue.pop()!; component.push(tile);
      for (const neighbor of [tile % 8 > 0 ? tile - 1 : -1, tile % 8 < 7 ? tile + 1 : -1, tile - 8, tile + 8]) {
        if (pending.delete(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }
  const largest = components.sort((a, b) => b.length - a.length)[0];
  if (!largest) return false;
  const xs = largest.map((tile) => tile % 8), ys = largest.map((tile) => Math.floor(tile / 8));
  const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
  const outside = difference.changed - largest.reduce((sum, tile) => sum + difference.tileChanges[tile], 0);
  return area <= 36 && difference.changedTiles - largest.length <= 2 && outside / difference.total <= .01;
}

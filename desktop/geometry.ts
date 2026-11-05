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

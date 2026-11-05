import type { Conversation } from "./model";
import { validateConversation } from "./model";

export type SpatialPoint = { x: number; y: number; z: number };
export type SpatialNode = { id: string; position: SpatialPoint };
export type DetailLevel = "title" | "summary" | "full";
export type ProjectedCard = { x: number; y: number; scale: number; width?: number; height?: number };
export type ConnectionEndpoints = {
  start: { x: number; y: number };
  end: { x: number; y: number };
};
export type AnnotationFrame = {
  view: SpatialPoint;
  visibleIds: string[];
  positions: Record<string, SpatialPoint>;
  paired: boolean;
};

export const CARD_WIDTH = 600;
export const CARD_HEIGHT = 520;
export const FIELD_OF_VIEW = 50;
export const MIN_DISTANCE = 600;
export const MAX_DISTANCE = 12000;

const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
const framing = 0.86;
const depthStep = 420;
const laneStep = CARD_WIDTH + 160;
const rowStep = CARD_HEIGHT + 140;
const childOffset = 840;
const layoutGap = 96;
const overviewAspect = 2.5;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function point(value: SpatialPoint): SpatialPoint {
  const coordinate = (number: number) => Math.max(-1e6, Math.min(1e6, finite(number, 0)));
  return { x: coordinate(value.x), y: coordinate(value.y), z: coordinate(value.z) };
}

function aspect(width: number, height: number) {
  const bounded = (value: number, fallback: number) => Math.max(160, Math.min(8192, finite(value, fallback)));
  return bounded(width, 1280) / bounded(height, 800);
}

/** Reserve compact slots near each parent without moving earlier topics. */
export function layoutSpace(
  space: Conversation,
  overrides: Record<string, SpatialPoint> = {},
): SpatialNode[] {
  validateConversation(space);
  const nodes: SpatialNode[] = [];
  const placed = new Map<string, { position: SpatialPoint; depth: number }>();
  const placing = new Set<string>();
  const synthesisSources = new Map<string, string[]>();
  for (const connection of space.connections ?? []) {
    if (connection.type !== "synthesis" || connection.status !== "accepted") continue;
    const sources = synthesisSources.get(connection.to) ?? [];
    sources.push(connection.from);
    synthesisSources.set(connection.to, sources);
  }

  const place = (id: string): { position: SpatialPoint; depth: number } => {
    const existing = placed.get(id);
    if (existing) return existing;
    const exploration = space.explorations[id];
    placing.add(id);

    if (exploration.parentId === null) {
      const root = { position: { x: 0, y: 0, z: 0 }, depth: 0 };
      placed.set(id, root);
      nodes.push({ id, position: root.position });
      placing.delete(id);
      return root;
    }

    const parent = place(exploration.parentId);
    const depth = parent.depth + 1;
    const sources = (synthesisSources.get(id) ?? []).flatMap((sourceId) => {
      // Navigation is a tree; imported cross-links need not be. A cycle must
      // not recursively place the same topic while resolving source anchors.
      let cursor: string | null = sourceId;
      while (cursor && !placing.has(cursor)) cursor = space.explorations[cursor].parentId;
      const source = placed.get(sourceId) ?? (cursor === null ? place(sourceId) : undefined);
      return source ? [source.position] : [];
    });
    const anchor = sources.length ? {
      x: sources.reduce((sum, source) => sum + source.x, 0) / sources.length,
      y: Math.min(parent.position.y, ...sources.map((source) => source.y)),
      z: Math.min(parent.position.z, ...sources.map((source) => source.z)),
    } : parent.position;
    let position: SpatialPoint | undefined;
    // Fixed slot order gives four siblings a 2×2 group, then extends it
    // outward. Alternating the first side keeps single-child chains centered.
    for (let ring = 0; !position; ring++) {
      const slots: { x: number; y: number }[] = [];
      if (sources.length && ring === 0) slots.push({ x: 0, y: -childOffset });
      for (let row = 0; row <= ring; row++) {
        for (let column = 0; column <= ring; column++) {
          if (Math.max(row, column) !== ring) continue;
          const side = depth % 2 ? -1 : 1;
          for (const sign of [side, -side]) slots.push({ x: sign * (column + 0.5) * laneStep, y: -childOffset - row * rowStep });
        }
      }
      slots.sort((a, b) => (a.x * 1.35) ** 2 + a.y ** 2 - ((b.x * 1.35) ** 2 + b.y ** 2));
      for (const slot of slots) {
        const candidate = { x: anchor.x + slot.x, y: anchor.y + slot.y, z: anchor.z - depthStep };
        const clear = nodes.every((node) => {
          // Account for parallax between Z planes, not only world rectangles.
          // fitOverview bounds both rays by these same viewing angles.
          const perspective = Math.abs(candidate.z - node.position.z) * tangent;
          return Math.abs(candidate.x - node.position.x) >= CARD_WIDTH + perspective * overviewAspect + layoutGap ||
            Math.abs(candidate.y - node.position.y) >= CARD_HEIGHT + perspective + layoutGap;
        });
        if (clear) { position = candidate; break; }
      }
    }
    const result = { position, depth };
    placed.set(id, result);
    nodes.push({ id, position });
    placing.delete(id);
    return result;
  };

  place(space.rootId);
  for (const id of Object.keys(space.explorations)) place(id);
  return applyPositionOverrides(nodes, overrides);
}

/** Apply manual placements without revalidating conversation text on every drag. */
export function applyPositionOverrides(
  nodes: SpatialNode[],
  overrides: Record<string, SpatialPoint>,
): SpatialNode[] {
  return nodes.map((node) => {
    const override = overrides[node.id];
    return override && [override.x, override.y, override.z].every(Number.isFinite)
      ? { ...node, position: point(override) }
      : node;
  });
}

/** Compact painted bounds mirror the title/summary CSS without layout reads. */
export function connectionBounds(card: ProjectedCard, detail: DetailLevel): ProjectedCard {
  if (detail === "full") return card;
  const scale = card.scale;
  const textScale = Math.max(0.1, scale);
  const top = (detail === "title" ? 210 : 200) * scale;
  const headingHeight = Math.min(60, 15 / textScale) * 1.25 * 2 * scale;
  const bottom = detail === "title"
    ? top + headingHeight + 12 * scale
    : Math.max(top + headingHeight, 295 * scale + 45 / textScale * scale);
  return {
    ...card, y: card.y - CARD_HEIGHT * scale / 2 + (top + bottom) / 2,
    width: CARD_WIDTH * scale, height: bottom - top,
  };
}

/** Clip a directed center-to-center segment to projected bounds, in pixels. */
export function connectionEndpoints(
  from: ProjectedCard,
  to: ProjectedCard,
  gap = 7,
): ConnectionEndpoints | null {
  if (![from.x, from.y, from.scale, to.x, to.y, to.scale].every(Number.isFinite)) return null;
  if (from.scale <= 0 || to.scale <= 0) return null;
  const fromWidth = from.width ?? CARD_WIDTH * from.scale;
  const fromHeight = from.height ?? CARD_HEIGHT * from.scale;
  const toWidth = to.width ?? CARD_WIDTH * to.scale;
  const toHeight = to.height ?? CARD_HEIGHT * to.scale;
  if (![fromWidth, fromHeight, toWidth, toHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const unitX = dx / length;
  const unitY = dy / length;
  const boundary = (width: number, height: number) => Math.min(
    Math.abs(unitX) > 1e-9 ? width / (2 * Math.abs(unitX)) : Infinity,
    Math.abs(unitY) > 1e-9 ? height / (2 * Math.abs(unitY)) : Infinity,
  );
  const padding = Math.max(0, finite(gap, 7));
  const sourceDistance = boundary(fromWidth, fromHeight) + padding;
  const targetDistance = boundary(toWidth, toHeight) + padding;
  if (sourceDistance + targetDistance >= length) return null;
  return {
    start: { x: from.x + unitX * sourceDistance, y: from.y + unitY * sourceDistance },
    end: { x: to.x - unitX * targetDistance, y: to.y - unitY * targetDistance },
  };
}

/** Camera looks down -Z. Fit every card corner, including different Z planes. */
export function fitOverview(nodes: SpatialNode[], width: number, height: number): SpatialPoint {
  if (!nodes.length) return focusView({ x: 0, y: 0, z: 0 }, width, height);
  const positions = nodes.map((node) => point(node.position));
  const x = (Math.min(...positions.map((value) => value.x)) + Math.max(...positions.map((value) => value.x))) / 2;
  const y = (Math.min(...positions.map((value) => value.y)) + Math.max(...positions.map((value) => value.y))) / 2;
  // Wider screens leave breathing room at the sides instead of violating the
  // cross-depth collision bounds used by automatic placement.
  const horizontalTangent = tangent * Math.min(overviewAspect, aspect(width, height));
  const z = Math.max(...positions.map((value) => value.z + Math.max(
    MIN_DISTANCE,
    (Math.abs(value.x - x) + CARD_WIDTH / 2) / (horizontalTangent * framing),
    (Math.abs(value.y - y) + CARD_HEIGHT / 2) / (tangent * framing),
  )));
  return { x, y, z };
}

export function focusView(target: SpatialPoint, width: number, height: number): SpatialPoint {
  const anchor = point(target);
  const distance = Math.max(
    MIN_DISTANCE,
    CARD_WIDTH / (2 * tangent * aspect(width, height) * framing),
    CARD_HEIGHT / (2 * tangent * framing),
  );
  return { x: anchor.x, y: anchor.y, z: anchor.z + distance };
}

/** A temporary reading arrangement; never write these positions to the graph. */
export function annotationView(
  nodes: SpatialNode[],
  sourceId: string,
  replyId: string,
  width: number,
  height: number,
): AnnotationFrame | null {
  const source = nodes.find((node) => node.id === sourceId);
  const reply = nodes.find((node) => node.id === replyId);
  if (!source || !reply) return null;
  const fallback = (): AnnotationFrame => ({
    view: focusView(reply.position, width, height), visibleIds: [replyId], positions: {}, paired: false,
  });
  if (sourceId === replyId || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback();

  const anchor = point(source.position);
  const separation = CARD_WIDTH + 60;
  // At the coordinate limit, use the other side instead of overlapping cards.
  const offset = anchor.x - separation >= -1e6 ? -separation : separation;
  const destination = { x: anchor.x + offset, y: anchor.y, z: anchor.z };
  const margin = 0.94;
  const distance = Math.max(
    MIN_DISTANCE,
    (CARD_WIDTH + separation) / (2 * tangent * aspect(width, height) * margin),
    CARD_HEIGHT / (2 * tangent * margin),
  );
  const scale = height / (2 * tangent * distance);
  if (scale < 0.8) return fallback();
  return {
    view: { x: anchor.x + offset / 2, y: anchor.y, z: anchor.z + distance },
    visibleIds: [sourceId, replyId], positions: { [replyId]: destination }, paired: true,
  };
}

/** Positive delta moves away. Keep the anchor's screen position unchanged. */
export function zoomView(view: SpatialPoint, target: SpatialPoint, delta: number): SpatialPoint {
  const camera = point(view);
  const anchor = point(target);
  const currentDistance = Math.max(1, camera.z - anchor.z);
  const safeDelta = Math.max(-240, Math.min(240, finite(delta, 0)));
  // A fitted overview can sit beyond the normal wheel limit for a large graph.
  // Allow a gradual return from there instead of snapping to MAX_DISTANCE.
  const upperDistance = Math.max(MAX_DISTANCE, currentDistance);
  const distance = Math.max(MIN_DISTANCE, Math.min(upperDistance, currentDistance * Math.exp(safeDelta * 0.002)));
  const ratio = distance / currentDistance;
  return {
    x: anchor.x + (camera.x - anchor.x) * ratio,
    y: anchor.y + (camera.y - anchor.y) * ratio,
    z: anchor.z + distance,
  };
}

export function normalizeWheel(deltaY: number, deltaMode = 0): number {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
  return Math.max(-120, Math.min(120, finite(deltaY, 0) * multiplier));
}

export function detailForScale(scale: number): DetailLevel {
  const safeScale = finite(scale, 0);
  return safeScale >= 0.72 ? "full" : safeScale >= 0.32 ? "summary" : "title";
}

import type { Conversation } from "./model";
import { validateConversation } from "./model";

export type SpatialPoint = { x: number; y: number; z: number };
export type SpatialNode = { id: string; position: SpatialPoint };
export type DetailLevel = "title" | "summary" | "full";
export type ProjectedCard = { x: number; y: number; scale: number };
export type ConnectionEndpoints = {
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export const CARD_WIDTH = 600;
export const CARD_HEIGHT = 520;
export const FIELD_OF_VIEW = 50;
export const MIN_DISTANCE = 600;
export const MAX_DISTANCE = 12000;

const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
const framing = 0.86;
const depthStep = 1050;
const laneStep = CARD_WIDTH + 280;
// A depth row must clear the card height plus the perspective shift caused by
// moving one Z plane. This remains separated anywhere in a fitted viewport.
const rowStep = Math.ceil((CARD_HEIGHT + depthStep * tangent + 240) / 40) * 40;

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

/** Reserve the nearest free lane in each depth row, preserving earlier nodes. */
export function layoutSpace(
  space: Conversation,
  overrides: Record<string, SpatialPoint> = {},
): SpatialNode[] {
  validateConversation(space);
  const nodes: SpatialNode[] = [];
  const levels = new Map<number, Set<number>>();
  const placed = new Map<string, { position: SpatialPoint; depth: number; lane: number }>();

  const place = (id: string): { position: SpatialPoint; depth: number; lane: number } => {
    const existing = placed.get(id);
    if (existing) return existing;
    const exploration = space.explorations[id];

    if (exploration.parentId === null) {
      const root = { position: { x: 0, y: 0, z: 0 }, depth: 0, lane: 0 };
      placed.set(id, root);
      nodes.push({ id, position: root.position });
      return root;
    }

    const parent = place(exploration.parentId);
    const depth = parent.depth + 1;
    const occupied = levels.get(depth) ?? new Set<number>();
    levels.set(depth, occupied);
    let lane = parent.lane;
    let attempt = 0;
    while (occupied.has(lane)) {
      attempt += 1;
      lane = parent.lane + (attempt % 2 ? -(attempt + 1) / 2 : attempt / 2);
    }
    const position = { x: lane * laneStep, y: -depth * rowStep, z: -depth * depthStep };
    occupied.add(lane);
    const result = { position, depth, lane };
    placed.set(id, result);
    nodes.push({ id, position });
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

/** Clip a directed center-to-center segment to both projected card boundaries. */
export function connectionEndpoints(
  from: ProjectedCard,
  to: ProjectedCard,
  gap = 7,
): ConnectionEndpoints | null {
  if (![from.x, from.y, from.scale, to.x, to.y, to.scale].every(Number.isFinite)) return null;
  if (from.scale <= 0 || to.scale <= 0) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const unitX = dx / length;
  const unitY = dy / length;
  const boundary = (scale: number) => Math.min(
    Math.abs(unitX) > 1e-9 ? CARD_WIDTH * scale / (2 * Math.abs(unitX)) : Infinity,
    Math.abs(unitY) > 1e-9 ? CARD_HEIGHT * scale / (2 * Math.abs(unitY)) : Infinity,
  );
  const padding = Math.max(0, finite(gap, 7));
  const sourceDistance = boundary(from.scale) + padding;
  const targetDistance = boundary(to.scale) + padding;
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
  const horizontalTangent = tangent * aspect(width, height);
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

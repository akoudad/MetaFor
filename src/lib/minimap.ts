import type { SpatialNode, SpatialPoint } from "./spatial";

export const MAP_WIDTH = 180;
export const MAP_HEIGHT = 130;
export const MAP_PADDING = 14;

type MapPoint = { x: number; y: number };
export type MapNode = MapPoint & { id: string; depth: number };
export type MapProjection = {
  width: number;
  height: number;
  scale: number;
  center: MapPoint;
  nodes: MapNode[];
};

/** Fixed orthographic axes: +Y is up; X and Z occupy opposite diagonals. */
function isometric(point: SpatialPoint): (MapPoint & { depth: number }) | null {
  if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
  const bound = (value: number) => Math.max(-10_000_000, Math.min(10_000_000, value));
  const x = bound(point.x);
  const y = bound(point.y);
  const z = bound(point.z);
  return { x: (x - z) / Math.SQRT2, y: (x + z - 2 * y) / Math.sqrt(6), depth: (x + y + z) / Math.sqrt(3) };
}

export function projectMapPoint(point: SpatialPoint, projection: MapProjection): MapPoint | null {
  const projected = isometric(point);
  return projected ? {
    x: projection.width / 2 + (projected.x - projection.center.x) * projection.scale,
    y: projection.height / 2 + (projected.y - projection.center.y) * projection.scale,
  } : null;
}

/** Overlapping hit areas must select the closest dot, not the last painted SVG group. */
export function nearestMapNode(point: MapPoint, projection: MapProjection, radius = 8): MapNode | null {
  if (![point.x, point.y, radius].every(Number.isFinite) || radius < 0) return null;
  let nearest: MapNode | null = null;
  let distance = radius * radius;
  for (const node of projection.nodes) {
    const candidate = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
    if (candidate <= distance) { nearest = node; distance = candidate; }
  }
  return nearest;
}

/** Fit actual topic centers, independent of the main camera's zoom or position. */
export function projectSpaceMap(nodes: SpatialNode[], width = MAP_WIDTH, height = MAP_HEIGHT): MapProjection {
  const dimension = (value: number, fallback: number) => Number.isFinite(value) ? Math.max(80, Math.min(2048, value)) : fallback;
  width = dimension(width, MAP_WIDTH);
  height = dimension(height, MAP_HEIGHT);
  const seen = new Set<string>();
  const points = nodes.flatMap((node) => {
    const projected = isometric(node.position);
    if (!projected || seen.has(node.id)) return [];
    seen.add(node.id);
    return [{ ...projected, id: node.id }];
  });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = points.length ? Math.min(...xs) : 0;
  const maxX = points.length ? Math.max(...xs) : 0;
  const minY = points.length ? Math.min(...ys) : 0;
  const maxY = points.length ? Math.max(...ys) : 0;
  // A single topic still has a useful neighborhood for the camera indicator.
  const scale = Math.min((width - MAP_PADDING * 2) / Math.max(1000, maxX - minX), (height - MAP_PADDING * 2) / Math.max(1000, maxY - minY));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return {
    width, height, scale, center,
    nodes: points.map((point) => ({ id: point.id, depth: point.depth, x: width / 2 + (point.x - center.x) * scale, y: height / 2 + (point.y - center.y) * scale })),
  };
}

/** Off-map camera destinations are shown as outward-pointing edge indicators. */
export function mapDestination(view: SpatialPoint, projection: MapProjection): (MapPoint & { outside: boolean; angle: number }) | null {
  if (!projection.nodes.length) return null;
  const point = projectMapPoint(view, projection);
  if (!point) return null;
  const x = Math.max(7, Math.min(projection.width - 7, point.x));
  const y = Math.max(7, Math.min(projection.height - 7, point.y));
  const outside = x !== point.x || y !== point.y;
  return { x, y, outside, angle: outside ? Math.atan2(point.y - y, point.x - x) * 180 / Math.PI : 0 };
}

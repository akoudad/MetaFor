import { fitOverview } from "./spatial";
import type { SpatialPoint } from "./spatial";

export const BRANCH_TRANSITION_MS = 1200;

export type BranchScene = {
  source: SpatialPoint;
  destination: SpatialPoint;
  startView: SpatialPoint;
  overviewView: SpatialPoint;
  endView: SpatialPoint;
};

function smooth(value: number) {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return bounded * bounded * (3 - 2 * bounded);
}

function mix(from: SpatialPoint, to: SpatialPoint, progress: number): SpatialPoint {
  if (progress <= 0) return { ...from };
  if (progress >= 1) return { ...to };
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress,
  };
}

export function createBranchScene(
  source: SpatialPoint,
  destination: SpatialPoint,
  startView: SpatialPoint,
  endView: SpatialPoint,
  width: number,
  height: number,
): BranchScene {
  return {
    source: { ...source }, destination: { ...destination },
    startView: { ...startView }, endView: { ...endView },
    overviewView: fitOverview([{ id: "source", position: source }, { id: "destination", position: destination }], width, height),
  };
}

/** Reveal the relationship before entering its detail; no overshoot or rotation. */
export function sampleBranchScene(scene: BranchScene, elapsedMs: number) {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const emergence = smooth((elapsed - 40) / 390);
  const view = elapsed < 430
    ? mix(scene.startView, scene.overviewView, smooth(elapsed / 430))
    : elapsed < 650
      ? { ...scene.overviewView }
      : mix(scene.overviewView, scene.endView, smooth((elapsed - 650) / 550));
  return {
    view,
    position: mix(scene.source, scene.destination, emergence),
    scale: 0.12 + emergence * 0.88,
    opacity: smooth(elapsed / 210),
    edgeProgress: smooth((elapsed - 110) / 320),
    done: elapsed >= BRANCH_TRANSITION_MS,
  };
}

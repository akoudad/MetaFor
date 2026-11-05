export type SpatialScrollOwner = "topic" | "space";
export type SpatialScrollState = {
  owner: SpatialScrollOwner;
  scope: string;
  lastTime: number;
  total: number;
  consumed: boolean;
};
export type SpatialScrollInput = {
  time: number;
  delta: number;
  owner: SpatialScrollOwner;
  scope: string;
};

/** Topic reading stays native. A space gesture can navigate once, then rests. */
export function advanceSpatialScroll(
  state: SpatialScrollState | null,
  input: SpatialScrollInput,
): { state: SpatialScrollState; direction: -1 | 0 | 1 } {
  const time = Number.isFinite(input.time) ? input.time : state?.lastTime ?? 0;
  const delta = Number.isFinite(input.delta) ? input.delta : 0;
  const fresh = !state || time - state.lastTime >= 200;
  const next: SpatialScrollState = fresh
    ? { owner: input.owner, scope: input.scope, lastTime: time, total: 0, consumed: input.owner === "topic" }
    : { ...state, lastTime: time };

  // Crossing into text or changing views consumes the remaining gesture;
  // crossing back out must never convert reading momentum into navigation.
  if (input.owner === "topic" || input.scope !== next.scope) next.consumed = true;
  if (next.owner === "topic" || next.consumed) return { state: next, direction: 0 };

  next.total += delta;
  if (Math.abs(next.total) < 70) return { state: next, direction: 0 };
  next.consumed = true;
  return { state: next, direction: next.total > 0 ? 1 : -1 };
}

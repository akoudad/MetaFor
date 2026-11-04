export const SCROLL_GESTURE_GAP = 200;
export const SCROLL_EDGE_DISTANCE = 60;
const EDGE_EPSILON = 1;

type Direction = -1 | 1;
export type ScrollGesture = {
  scope: string;
  direction: Direction;
  lastAt: number;
  read: boolean;
  consumed: boolean;
  eligible: boolean;
  distance: number;
};

export type ScrollStep = {
  scope: string;
  delta: number;
  now: number;
  /** Remaining native scroll distance in this direction; zero means an edge. */
  remaining: number;
};

/** A reading burst and its momentum can never become a topic transition. */
export function stepSemanticScroll(previous: ScrollGesture | null, input: ScrollStep): {
  state: ScrollGesture | null;
  action: "read" | "wait" | "cross";
} {
  if (!Number.isFinite(input.delta) || !input.delta || !Number.isFinite(input.now)) return { state: previous, action: "wait" };
  const direction: Direction = input.delta > 0 ? 1 : -1;
  const sameScope = previous?.scope === input.scope;
  const sameDirection = previous?.direction === direction;
  const fresh = !previous || input.now - previous.lastAt >= SCROLL_GESTURE_GAP || input.now < previous.lastAt;
  const state: ScrollGesture = {
    scope: input.scope, direction, lastAt: input.now,
    read: fresh || !sameScope ? false : previous!.read,
    consumed: fresh ? false : !sameScope || previous!.consumed,
    eligible: fresh || Boolean(sameScope && sameDirection && previous!.eligible),
    distance: fresh || !sameScope || !sameDirection ? 0 : previous!.distance,
  };
  if (state.consumed) return { state, action: "wait" };
  const remaining = Number.isFinite(input.remaining) ? Math.max(0, input.remaining) : 0;
  if (remaining > EDGE_EPSILON) {
    state.read = true; state.eligible = false; state.distance = 0;
    return { state, action: "read" };
  }
  if (state.read || !state.eligible) return { state, action: "wait" };
  state.distance += Math.min(240, Math.abs(input.delta));
  if (state.distance < SCROLL_EDGE_DISTANCE) return { state, action: "wait" };
  state.consumed = true;
  return { state, action: "cross" };
}

/** Physical zoom or a direct navigation action also consumes its wheel burst. */
export function consumeScrollGesture(scope: string, delta: number, now: number): ScrollGesture {
  return { scope, direction: delta < 0 ? -1 : 1, lastAt: now, read: false, consumed: true, eligible: false, distance: 0 };
}

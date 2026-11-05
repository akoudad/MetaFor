export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export function reasoningEffort(value: unknown, fallback: ReasoningEffort = "low"): ReasoningEffort {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !REASONING_EFFORTS.includes(value as ReasoningEffort)) throw new Error("Choose a supported reasoning effort.");
  return value as ReasoningEffort;
}

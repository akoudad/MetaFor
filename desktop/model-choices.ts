import type { ModelChoice } from "./shared";

// These are model + effort pairs, not three different models. Contributor models
// have different data terms and are never selected as an automatic alternative.
export const MODEL_CHOICES: readonly ModelChoice[] = [
  { id: "spark-fast", model: "muse-spark-1.3", name: "Muse Spark 1.3", mode: "Fast", reasoningEffort: "minimal", description: "Quick questions and everyday screen help." },
  { id: "spark-balanced", model: "muse-spark-1.3", name: "Muse Spark 1.3", mode: "Balanced", reasoningEffort: "medium", description: "Everyday work with moderate reasoning." },
  { id: "wonder-deep", model: "muse-wonder-1.0", name: "Muse Wonder 1.0", mode: "Deep", reasoningEffort: "high", description: "Complex problems and deeper analysis. Takes longer." },
];

export function selectedModelChoice(model: string, effort: string) {
  return MODEL_CHOICES.find((choice) => choice.model === model && choice.reasoningEffort === effort);
}


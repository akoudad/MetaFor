import { validateModelConfig } from "./help-model";
import type { ModelCatalog } from "./shared";

import { MODEL_CHOICES } from "./model-choices";
export { MODEL_CHOICES, selectedModelChoice } from "./model-choices";

class ModelCatalogError extends Error {}

export async function availableModels(config: { model: string; baseURL: string; apiKey: string }, fetcher: typeof fetch = fetch): Promise<ModelCatalog> {
  const endpoint = validateModelConfig(config);
  if (endpoint.baseURL !== "https://api.meta.ai/v1") return { choices: [], message: "Quick choices are available for Meta. Change a custom provider's model in Settings." };
  if (!config.apiKey.trim()) throw new ModelCatalogError("Add your API key in Settings to choose a model.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(`${endpoint.baseURL}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw new ModelCatalogError("The API key could not list models. Check it in Settings.");
      throw new ModelCatalogError("Available models could not be loaded. Your current choice is unchanged; try again.");
    }
    if (!response.body || Number(response.headers.get("content-length")) > 65536) { void response.body?.cancel().catch(() => {}); throw new ModelCatalogError("The provider returned an invalid model list."); }
    reader = response.body.getReader();
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    let text = ""; let bytes = 0;
    try {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 65536) { cancel(); throw new ModelCatalogError("The provider returned an invalid model list."); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { controller.signal.removeEventListener("abort", cancel); }
    if (controller.signal.aborted) throw new ModelCatalogError("Loading models timed out. Your current choice is unchanged; try again.");
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || !Array.isArray((data as { data?: unknown }).data)) throw new ModelCatalogError("The provider returned an invalid model list.");
    const ids = new Set((data as { data: { id?: unknown }[] }).data.filter((item) => item && typeof item.id === "string").map((item) => item.id));
    const choices = MODEL_CHOICES.filter((choice) => ids.has(choice.model));
    return { choices, ...(!choices.length ? { message: "No supported quick choices are enabled for this API key. Your current model remains selected." } : {}) };
  } catch (error) {
    if (controller.signal.aborted) throw new ModelCatalogError("Loading models timed out. Your current choice is unchanged; try again.");
    if (error instanceof ModelCatalogError) throw error;
    throw new ModelCatalogError("Available models could not be loaded. Your current choice is unchanged; try again.");
  } finally { clearTimeout(timer); reader?.releaseLock(); }
}

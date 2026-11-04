// Server module: Node-only imports prevent accidental use in a client bundle.
import { timingSafeEqual } from "node:crypto";
import type { AnswerRequest, ModelStatus } from "./contracts";
import { ANSWER_SCHEMA, AnswerError, MAX_REQUEST_BYTES, answerMessages, buildAnswerContext, validateAnswerOutput, validateAnswerRequest } from "./ai";

type Environment = Record<string, string | undefined>;
type ProviderOptions = {
  env?: Environment;
  fetch?: typeof fetch;
  timeoutMs?: number;
  bodyTimeoutMs?: number;
  now?: () => number;
};

const DEFAULT_MODEL = "muse-spark-1.3";
const RESPONSE_BYTES = 512 * 1024;

function modelName(env: Environment) {
  const model = env.MODEL_API_MODEL?.trim() || DEFAULT_MODEL;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model) ? model : DEFAULT_MODEL;
}

export function getProviderStatus(env: Environment = process.env): ModelStatus {
  return { configured: Boolean(env.MODEL_API_KEY?.trim()), model: modelName(env), accessCodeRequired: Boolean(env.DEMO_ACCESS_CODE?.trim()) };
}

function configuration(env: Environment) {
  const apiKey = env.MODEL_API_KEY?.trim();
  if (!apiKey) throw new AnswerError("not_configured", "Live AI is not configured yet. Add the model key on the server, then retry.", 503);
  let url: URL;
  try { url = new URL(env.MODEL_API_BASE_URL?.trim() || "https://api.meta.ai/v1"); } catch {
    throw new AnswerError("invalid_configuration", "The model endpoint is not configured correctly.", 503);
  }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw new AnswerError("invalid_configuration", "The model endpoint is not configured correctly.", 503);
  }
  return { apiKey, endpoint: `${url.toString().replace(/\/+$/, "")}/chat/completions`, model: modelName(env) };
}

async function limitedJson(message: Request | Response, maximum: number, tooLarge: AnswerError, invalid: AnswerError, signal?: AbortSignal) {
  const declared = Number(message.headers.get("content-length"));
  if (declared > maximum) throw tooLarge;
  if (!message.body || signal?.aborted) throw invalid;
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { cancel(); throw tooLarge; }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } catch (error) {
    if (error instanceof AnswerError) throw error;
    throw invalid;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (signal?.aborted) throw invalid;
  try { return JSON.parse(result) as unknown; } catch { throw invalid; }
}

export async function generateAnswer(request: AnswerRequest, options: ProviderOptions = {}, signal?: AbortSignal) {
  const env = options.env ?? process.env;
  const config = configuration(env);
  const context = buildAnswerContext(request);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new AnswerError("cancelled", "The request was cancelled. Your question is kept.", 499, true);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 55000);
  try {
    const response = await (options.fetch ?? fetch)(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: answerMessages(request, context),
        response_format: { type: "json_schema", json_schema: { name: "metaphore_answer", strict: true, schema: ANSWER_SCHEMA } },
        max_completion_tokens: 6000,
        reasoning_effort: "low",
        store: false,
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      // Never return provider bodies: they may contain credentials or request text.
      if (response.status === 429) throw new AnswerError("provider_rate_limit", "The model is busy or its allowance has been reached. Wait a moment before retrying.", 429, true);
      if ([401, 403].includes(response.status)) throw new AnswerError("provider_credentials", "The model credentials were rejected. Check the server configuration.", 502);
      throw new AnswerError("provider_error", "The model could not complete this request. Your question is kept.", 502, response.status >= 500);
    }
    const invalid = new AnswerError("invalid_model_answer", "The model returned an incomplete answer. Your question is kept; please retry.", 502, true);
    const raw = await limitedJson(response, RESPONSE_BYTES, invalid, invalid, controller.signal) as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[] };
    const choice = raw && typeof raw === "object" && Array.isArray(raw.choices) ? raw.choices[0] : undefined;
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new AnswerError("model_refusal", "The model could not answer that request. Try rephrasing it.", 422);
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string" || choice.message.content.length > 50000) throw invalid;
    let answer: unknown;
    try { answer = JSON.parse(choice.message.content); } catch { throw invalid; }
    return validateAnswerOutput(answer, request, context.record, config.model);
  } catch (error) {
    if (timedOut) throw new AnswerError("model_timeout", "The model took too long. Your question is kept; please retry.", 504, true);
    if (signal?.aborted) throw new AnswerError("cancelled", "The request was cancelled. Your question is kept.", 499, true);
    if (error instanceof AnswerError) throw error;
    throw new AnswerError("provider_unavailable", "The model could not be reached. Check the connection and retry.", 502, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

function sameSecret(expected: string, supplied: string | null) {
  if (!supplied || supplied.length > 1024) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function checkOrigin(request: Request) {
  const invalid = () => new AnswerError("invalid_origin", "Open this request from the Metaphore app.", 403);
  try {
    const requestURL = new URL(request.url);
    const forwarded = request.headers.get("x-forwarded-proto")?.trim().toLowerCase();
    if (forwarded && forwarded !== "http" && forwarded !== "https") throw invalid();
    // A TLS-terminating reverse proxy must overwrite this header. Only an HTTPS
    // upgrade is accepted; an untrusted forwarded host never chooses the origin.
    if (requestURL.protocol === "https:" && forwarded === "http") throw invalid();
    const protocol = forwarded === "https" ? "https:" : requestURL.protocol;
    const host = request.headers.get("host") || requestURL.host;
    if (!host || /[\s/\\?#@]/.test(host) || !["http:", "https:"].includes(protocol)) throw invalid();
    const destination = new URL(`${protocol}//${host}`).origin;
    if (request.headers.get("origin") !== destination || request.headers.get("sec-fetch-site") === "cross-site") throw invalid();
  } catch { throw invalid(); }
}

async function readRequest(request: Request, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await limitedJson(request, MAX_REQUEST_BYTES,
      new AnswerError("request_too_large", "This space is too large for one request. Export it and start a smaller space.", 413),
      new AnswerError("invalid_json", "The answer request could not be read. Please retry.", 400), controller.signal);
  } catch (error) {
    if (timedOut) throw new AnswerError("request_timeout", "The request upload took too long. Your question is kept; please retry.", 408, true);
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
  }
}

function responseError(error: unknown) {
  const safe = error instanceof AnswerError ? error : new AnswerError("internal_error", "The answer could not be completed. Your question is kept; please retry.", 500, true);
  if (safe.status >= 500) console.warn("[Metaphore] answer request failed:", safe.code);
  return Response.json({ error: safe.message, code: safe.code, retryable: safe.retryable }, {
    status: safe.status,
    headers: { "Cache-Control": "no-store", ...(safe.status === 429 ? { "Retry-After": "10" } : {}) },
  });
}

/** Best-effort limits per running server instance, not a billing hard cap. */
export function createAnswerHandler(options: ProviderOptions = {}) {
  const rates = new Map<string, { start: number; count: number }>();
  const activeIPs = new Set<string>();
  let active = 0;
  let globalRate = { start: 0, count: 0 };
  return async function handle(request: Request): Promise<Response> {
    let acquiredIP: string | null = null;
    try {
      checkOrigin(request);
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AnswerError("invalid_content_type", "The answer request must use JSON.", 415);
      const env = options.env ?? process.env;
      const code = env.DEMO_ACCESS_CODE?.trim();
      if (code && !sameSecret(code, request.headers.get("x-demo-code"))) throw new AnswerError("access_code_required", "Enter the demo access code to use live AI.", 401);
      configuration(env);
      const input = await readRequest(request, options.bodyTimeoutMs ?? 10000);
      const answerRequest = validateAnswerRequest(input);
      const now = (options.now ?? Date.now)();
      for (const [key, bucket] of rates) if (now - bucket.start >= 60000) rates.delete(key);
      const ip = (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "local").slice(0, 128);
      const bucket = rates.get(ip) ?? { start: now, count: 0 };
      if (now - globalRate.start >= 60000) globalRate = { start: now, count: 0 };
      if (active >= 3 || activeIPs.has(ip)) throw new AnswerError("busy", "An answer is already running. Wait for it to finish before retrying.", 429, true);
      if (bucket.count >= 10 || globalRate.count >= 30 || (rates.size >= 512 && !rates.has(ip))) throw new AnswerError("rate_limit", "Too many questions in a short time. Wait a minute before trying again.", 429, true);
      rates.set(ip, { ...bucket, count: bucket.count + 1 });
      globalRate.count += 1;
      active += 1;
      activeIPs.add(ip);
      acquiredIP = ip;
      const answer = await generateAnswer(answerRequest, options, request.signal);
      return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (request.signal.aborted) return responseError(new AnswerError("cancelled", "The request was cancelled. Your question is kept.", 499, true));
      return responseError(error);
    } finally {
      if (acquiredIP !== null) { active -= 1; activeIPs.delete(acquiredIP); }
    }
  };
}

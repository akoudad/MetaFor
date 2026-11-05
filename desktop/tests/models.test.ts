import assert from "node:assert/strict";
import test from "node:test";
import { availableModels, MODEL_CHOICES } from "../models";
import { reasoningEffort } from "../../src/lib/reasoning";

const config = { model: "muse-spark-1.3", baseURL: "https://api.meta.ai/v1", apiKey: "fixture-secret" };

test("model choices use account-enabled text and vision models, never contributor or image-only substitutes", async () => {
  const catalog = await availableModels(config, async (url, init) => {
    assert.equal(url, "https://api.meta.ai/v1/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-secret");
    assert.equal(init?.redirect, "error");
    return Response.json({ data: ["muse-spark-1.3", "muse-wonder-1.0", "muse-image-1.0", "muse-spark-1.3-contributor"].map((id) => ({ id })) });
  });
  assert.deepEqual(catalog.choices, MODEL_CHOICES);
  assert.equal(catalog.choices[0].model, catalog.choices[1].model);
  assert.notEqual(catalog.choices[0].reasoningEffort, catalog.choices[1].reasoningEffort);
  const limited = await availableModels(config, async () => Response.json({ data: [{ id: "muse-spark-1.3" }] }));
  assert.deepEqual(limited.choices.map((choice) => choice.id), ["spark-fast", "spark-balanced"]);
});

test("unsupported provider choices and unavailable models never silently select a different model", async () => {
  const custom = await availableModels({ ...config, baseURL: "https://custom.test/v1" }, async () => { assert.fail("no guessed model requests for custom providers"); });
  assert.equal(custom.choices.length, 0); assert.match(custom.message!, /Settings/);
  const empty = await availableModels(config, async () => Response.json({ data: [] }));
  assert.equal(empty.choices.length, 0); assert.match(empty.message!, /current model remains/);
});

test("catalog failures remain bounded and never expose credentials from provider bodies or thrown errors", async () => {
  for (const response of [new Response(config.apiKey, { status: 403 }), Response.json({ bad: true }), new Response("x".repeat(65537))]) {
    await assert.rejects(availableModels(config, async () => response), (error: Error) => !error.message.includes(config.apiKey));
  }
  await assert.rejects(availableModels(config, async () => { throw new Error(`Network error ${config.apiKey}`); }), (error: Error) => !error.message.includes(config.apiKey));
  assert.throws(() => reasoningEffort("none"));
  assert.equal(reasoningEffort(undefined, "medium"), "medium");
});

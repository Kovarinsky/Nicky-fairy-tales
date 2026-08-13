import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_USD_PER_IMAGE_4K,
  COST_USD_PER_MTOK_INPUT,
  COST_USD_PER_MTOK_OUTPUT,
  COST_USD_PER_1K_VOICE_CHARS,
  actualStoryCostCredits,
} from "../lib/pricing.ts";

test("official 2026-08-13 provider rates stay pinned", () => {
  assert.equal(COST_USD_PER_IMAGE_4K, 0.151);
  assert.equal(COST_USD_PER_1K_VOICE_CHARS, 0.05);
  assert.equal(COST_USD_PER_MTOK_INPUT, 2);
  assert.equal(COST_USD_PER_MTOK_OUTPUT, 10);
});

test("one hero plus one sheet uses both image price buckets", () => {
  const credits = actualStoryCostCredits(
    { images1k: 1, images4k: 1, voiceChars: 1_000 },
    { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  );
  // ($0.067 + $0.151 + $0.05) × 23 CZK/USD × 1.5 margin = 9.246 → 10.
  assert.equal(credits, 10);
});

import { test, assert } from '../test-config.js';
// Note: retrieveWithSpecBias is deprecated - using Python sidecar now
// import { retrieveWithSpecBias } from "../../src/services/enhanced-chat.service.js";
import { filterSpecLike } from "../../src/utils/specFilter.js";
import { rerankChunks } from "../../src/services/rerank.service.js";
import { skipIfNoServices } from '../helpers/ci-skip.js';

test('Spec-biased retrieval functionality', async (t) => {
  await t.test('filterSpecLike identifies spec-like content', async (t) => {
    const chunks = [
      { content: "The operating pressure is 15 psi" },
      { content: "This is just regular text" },
      { content: "Voltage: 24V, Current: 2.5A" },
      { content: "Temperature range: 0°C to 50°C" }
    ];

    const filtered = await filterSpecLike(chunks);
    assert.strictEqual(filtered.length, 3, "should filter 3 spec-like chunks");
    assert(filtered.some(c => c.content.includes("15 psi")), "should include pressure spec");
    assert(filtered.some(c => c.content.includes("24V")), "should include voltage spec");
    assert(filtered.some(c => c.content.includes("°C")), "should include temperature spec");
  });

  await t.test('filterSpecLike handles different chunk structures', async () => {
    const chunks = [
      { chunk: { content: "Pressure: 10 bar" } },
      { metadata: { content: "Current: 5A" } },
      { content: "Regular text without specs" }
    ];

    const filtered = await filterSpecLike(chunks);
    assert.strictEqual(filtered.length, 2, "should handle different chunk structures");
  });

  await t.test('rerankChunks handles empty or single chunk arrays', async () => {
    const empty = await rerankChunks("test question", []);
    assert.strictEqual(empty.length, 0, "should return empty array for empty input");
    
    const single = await rerankChunks("test question", [{ content: "single chunk" }]);
    assert.strictEqual(single.length, 1, "should return single chunk");
    assert(single[0]._rankScore !== undefined, "should add rank score");
  });

  await t.test('rerankChunks adds rank scores to chunks', async () => {
    const chunks = [
      { content: "First chunk" },
      { content: "Second chunk" },
      { content: "Third chunk" }
    ];
    
    const reranked = await rerankChunks("test question", chunks);
    assert.strictEqual(reranked.length, 3, "should return all chunks");
    assert(reranked.every(c => c._rankScore !== undefined), "should add rank scores to all chunks");
  });

  // Skip deprecated tests - retrieveWithSpecBias is replaced by Python sidecar
  await t.test('retrieveWithSpecBias returns structured response with metadata', async (t) => {
    t.skip('DEPRECATED: enhanced-chat.service replaced by Python sidecar');
  });

  await t.test('retrieveWithSpecBias handles errors gracefully', async (t) => {
    t.skip('DEPRECATED: enhanced-chat.service replaced by Python sidecar');
  });
});

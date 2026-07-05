/**
 * @jest-environment node
 *
 * Chunk-boundary pin for processWithConcurrency (pages/api/evaluate-multi-perspective.js) —
 * site 17 of docs/CHUNK_CONSOLIDATION_PLAN.md, the one pages/api mechanical swap.
 * The function was previously module-local; exported (no behavior change) so this
 * batching is directly testable ahead of the scaffold swap onto lib/utils/chunk.js.
 */
const { processWithConcurrency } = require('../../pages/api/evaluate-multi-perspective');

describe('processWithConcurrency (chunk boundary)', () => {
  test('limit=2 over 3 items: two batches, first gets items 0-1 in order, second gets item 2', async () => {
    const order = [];
    const processorFn = async (item) => {
      order.push(item);
      return item * 10;
    };

    const results = await processWithConcurrency([1, 2, 3], processorFn, 2);

    expect(results).toEqual([10, 20, 30]);
    // Batch call order: items 0-1 dispatched together (round 1), item 2 alone (round 2).
    expect(order).toEqual([1, 2, 3]);
  });

  test('results preserve input order even when a later item in a batch resolves first', async () => {
    const processorFn = async (item) => {
      // Reverse-order resolution within the batch to prove result order comes
      // from Promise.all's positional mapping, not resolution order.
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 10 : 0));
      return item * 10;
    };

    const results = await processWithConcurrency([1, 2], processorFn, 2);
    expect(results).toEqual([10, 20]);
  });
});

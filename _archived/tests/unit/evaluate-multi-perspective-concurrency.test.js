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
  test('limit=2 over 3 items: two rounds of sizes [2, 1] — item 3 cannot start until items 1 and 2 resolve', async () => {
    // Deferred-promise harness: proves ROUND separation, not just dispatch order.
    // A single Promise.all over all 3, or three singleton rounds, fails this test.
    const started = [];
    const deferreds = new Map();
    const processorFn = (item) => {
      started.push(item);
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      deferreds.set(item, () => resolve(item * 10));
      return p;
    };

    const resultsPromise = processWithConcurrency([1, 2, 3], processorFn, 2);

    await Promise.resolve(); // flush microtasks so round 1 dispatches
    expect(started).toEqual([1, 2]); // round 1 is exactly items 1-2; item 3 not started

    deferreds.get(1)(); // resolving only ONE of round 1 must not release round 2
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    deferreds.get(2)(); // completing round 1 releases round 2: exactly item 3
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3]);

    deferreds.get(3)();
    await expect(resultsPromise).resolves.toEqual([10, 20, 30]);
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

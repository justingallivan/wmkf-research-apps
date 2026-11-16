/** @jest-environment node */
import { mapBounded } from '../../lib/utils/chunk.js';

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

test('keeps input order and never has more than `limit` calls in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  const gates = Array.from({ length: 7 }, gate);
  const run = mapBounded([0, 1, 2, 3, 4, 5, 6], async (item) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await gates[item].promise;
    inFlight -= 1;
    return `r${item}`;
  }, 3);
  // Finish out of order: later items first.
  for (const index of [2, 1, 6, 5, 4, 3, 0]) { gates[index].open(); await Promise.resolve(); }
  await expect(run).resolves.toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
  expect(peak).toBe(3);
});

test('the default limit is the sequential loop', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapBounded([1, 2, 3], async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
  });
  expect(peak).toBe(1);
});

test('a rejection stops new calls and is thrown', async () => {
  const fn = jest.fn(async (item) => { if (item === 1) throw new Error('boom'); return item; });
  await expect(mapBounded([0, 1, 2, 3, 4], fn, 1)).rejects.toThrow('boom');
  expect(fn).toHaveBeenCalledTimes(2);
});

test('an empty list makes no calls; bad arguments throw', async () => {
  const fn = jest.fn();
  await expect(mapBounded([], fn, 4)).resolves.toEqual([]);
  expect(fn).not.toHaveBeenCalled();
  await expect(mapBounded('x', fn)).rejects.toThrow(TypeError);
  await expect(mapBounded([1], fn, 0)).rejects.toThrow(RangeError);
});

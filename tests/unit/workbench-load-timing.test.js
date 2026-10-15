/** @jest-environment node */
import { collectWorkbenchLoadTimings, measureWorkbenchLoad, workbenchServerTiming } from '../../lib/services/workbench/load-timing';

test('concurrent requests retain separate timing scopes and return values', async () => {
  const [first, second] = await Promise.all([
    collectWorkbenchLoadTimings(() => measureWorkbenchLoad('documents', async () => { await new Promise(setImmediate); return { first: true }; })),
    collectWorkbenchLoadTimings(() => measureWorkbenchLoad('schedules', async () => ({ second: true }))),
  ]);
  expect(first.value).toEqual({ first: true });
  expect(second.value).toEqual({ second: true });
  expect(first.steps.map((step) => step.name)).toEqual(['documents']);
  expect(second.steps.map((step) => step.name)).toEqual(['schedules']);
  expect(await measureWorkbenchLoad('outside', async () => 3)).toBe(3);
});

test('timing preserves rejection and validates header fields', async () => {
  const failure = new Error('original');
  await expect(collectWorkbenchLoadTimings(() => measureWorkbenchLoad('failed', () => { throw failure; }))).rejects.toBe(failure);
  expect(workbenchServerTiming({ milliseconds: 5, steps: [
    { name: 'safe', milliseconds: 2.123 },
    { name: 'unsafe\r\nheader', milliseconds: 10 },
    { name: 'invalid', milliseconds: Infinity },
  ] })).toBe('service_total;dur=5.0, safe;dur=2.1');
});

/** Request-local Workbench read timings; labels/durations only, never record data. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const storage = new AsyncLocalStorage();

export async function collectWorkbenchLoadTimings(operation) {
  const steps = [];
  const started = performance.now();
  const value = await storage.run(steps, operation);
  return { value, milliseconds: performance.now() - started, steps };
}

export async function measureWorkbenchLoad(name, operation) {
  const steps = storage.getStore();
  if (!steps) return operation();
  const started = performance.now();
  try {
    return await operation();
  } finally {
    steps.push({ name, milliseconds: performance.now() - started });
  }
}

/** Fixed operation labels only; no data or caller-supplied header values. */
export function workbenchServerTiming(timing) {
  return [{ name: 'service_total', milliseconds: timing.milliseconds }, ...timing.steps]
    .filter(({ name, milliseconds }) => /^[a-z_]+$/.test(name) && Number.isFinite(milliseconds) && milliseconds >= 0)
    .map(({ name, milliseconds }) => `${name};dur=${milliseconds.toFixed(1)}`)
    .join(', ');
}

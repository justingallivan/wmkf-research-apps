/**
 * Correlation/ALS mechanics for lib/observability/request-correlation.js.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  withRequestCorrelation,
  getRequestCorrelation,
  mintCorrelationId,
} from '../../lib/observability/request-correlation.js';

describe('withRequestCorrelation / getRequestCorrelation', () => {
  test('carries correlationId/routeName into a sync fn', () => {
    const seen = withRequestCorrelation(
      { correlationId: 'corr-1', routeName: 'route-1' },
      () => getRequestCorrelation(),
    );
    expect(seen).toEqual({ correlationId: 'corr-1', routeName: 'route-1' });
  });

  test('carries correlationId/routeName into an async fn and returns its resolved value', async () => {
    const result = await withRequestCorrelation(
      { correlationId: 'corr-async', routeName: 'route-async' },
      async () => {
        await Promise.resolve();
        return getRequestCorrelation();
      },
    );
    expect(result).toEqual({ correlationId: 'corr-async', routeName: 'route-async' });
  });

  test('returns fn\'s return value verbatim (sync)', () => {
    const out = withRequestCorrelation({ correlationId: 'x' }, () => 42);
    expect(out).toBe(42);
  });

  test('getRequestCorrelation() outside any scope is undefined', () => {
    expect(getRequestCorrelation()).toBeUndefined();
  });

  test('two concurrent interleaved async scopes never see each other\'s correlationId', async () => {
    const observed = {};

    async function scope(name, delayMs) {
      return withRequestCorrelation({ correlationId: name, routeName: `route-${name}` }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        observed[`${name}-mid`] = getRequestCorrelation()?.correlationId;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        observed[`${name}-end`] = getRequestCorrelation()?.correlationId;
      });
    }

    await Promise.all([scope('A', 5), scope('B', 15)]);

    expect(observed['A-mid']).toBe('A');
    expect(observed['A-end']).toBe('A');
    expect(observed['B-mid']).toBe('B');
    expect(observed['B-end']).toBe('B');
  });

  test('nesting inside a second, independent AsyncLocalStorage scope does not disturb correlation', () => {
    const asyncHooks = require('node:async_hooks');
    const otherAls = new asyncHooks.AsyncLocalStorage();

    const seen = otherAls.run({ restriction: 'dal-simulated' }, () => {
      return withRequestCorrelation({ correlationId: 'nested-corr' }, () => {
        return {
          ours: getRequestCorrelation(),
          theirs: otherAls.getStore(),
        };
      });
    });

    expect(seen.ours).toEqual({ correlationId: 'nested-corr' });
    expect(seen.theirs).toEqual({ restriction: 'dal-simulated' });
  });

  test('correlation scope entered inside the other ALS scope does not leak into it', () => {
    const asyncHooks = require('node:async_hooks');
    const otherAls = new asyncHooks.AsyncLocalStorage();

    withRequestCorrelation({ correlationId: 'corr-outer' }, () => {
      const seenInsideOther = otherAls.run({ restriction: 'inner' }, () => {
        return { ours: getRequestCorrelation(), theirs: otherAls.getStore() };
      });
      expect(seenInsideOther.ours).toEqual({ correlationId: 'corr-outer' });
      expect(seenInsideOther.theirs).toEqual({ restriction: 'inner' });
    });
    // Outside the run, the other ALS store must not be visible.
    expect(otherAls.getStore()).toBeUndefined();
  });

  test('non-empty-string filtering: numbers/objects/empty strings are omitted from the store', () => {
    const seen = withRequestCorrelation(
      { correlationId: 12345, routeName: {} },
      () => getRequestCorrelation(),
    );
    expect(seen).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(seen, 'correlationId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(seen, 'routeName')).toBe(false);

    const seenEmpty = withRequestCorrelation(
      { correlationId: '', routeName: '' },
      () => getRequestCorrelation(),
    );
    expect(seenEmpty).toEqual({});

    const seenPartial = withRequestCorrelation(
      { correlationId: 'good-id', routeName: undefined },
      () => getRequestCorrelation(),
    );
    expect(seenPartial).toEqual({ correlationId: 'good-id' });
    expect(Object.prototype.hasOwnProperty.call(seenPartial, 'routeName')).toBe(false);
  });
});

describe('mintCorrelationId', () => {
  test('returns a UUID-shaped string, different across calls', () => {
    const a = mintCorrelationId();
    const b = mintCorrelationId();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(a).toMatch(uuidRe);
    expect(b).toMatch(uuidRe);
    expect(a).not.toBe(b);
  });
});

describe('lazy async_hooks — static require guard', () => {
  test('module source contains no top-level literal require("node:async_hooks")', () => {
    const modulePath = path.join(__dirname, '..', '..', 'lib', 'observability', 'request-correlation.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    expect(source).not.toMatch(/require\(\s*['"]node:async_hooks['"]\s*\)/);
  });

  test('when node:async_hooks is unavailable, withRequestCorrelation degrades to calling fn directly', () => {
    jest.isolateModules(() => {
      jest.doMock('node:async_hooks', () => {
        throw new Error('simulated unavailable');
      });
      const mod = require('../../lib/observability/request-correlation.js');
      const out = mod.withRequestCorrelation({ correlationId: 'ignored' }, () => 'fn-ran');
      expect(out).toBe('fn-ran');
      expect(mod.getRequestCorrelation()).toBeUndefined();
    });
  });
});

/**
 * Characterization of the DynamicsService schema-cache seam (Checkpoint B,
 * Stage 4). Pins the cache lifecycle that moved from the facade's module-level
 * `schemaCache` into ./dynamics/schema.js:
 *   - TTL reuse: a second call within FIELD_CACHE_TTL serves from cache (no
 *     second outbound Attributes fetch).
 *   - In-flight dedupe: two concurrent calls for the same table share ONE
 *     outbound fetch via the `fieldPromises` map.
 *   - Invalidation: `clearCaches()` (now delegating to `resetSchemaCache`)
 *     empties the cache so the next call refetches.
 *
 * These pin the delicate module-singleton behavior across the extraction — a
 * cache that lost warmth or stopped deduping after the move would be a
 * regression the byte-identity check alone would not catch.
 */

import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

const ATTRS_MARKER = '/Attributes?';

function makeAttrsResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({
      value: [
        { LogicalName: 'fullname', DisplayName: null, AttributeType: 'String', IsValidForRead: true, RequiredLevel: { Value: 'None' } },
      ],
    }),
  };
}

describe('DynamicsService schema cache seam (Stage 4)', () => {
  beforeAll(() => {
    process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
    process.env.DYNAMICS_TENANT_ID = 't';
    process.env.DYNAMICS_CLIENT_ID = 'c';
    process.env.DYNAMICS_CLIENT_SECRET = 's';
  });

  beforeEach(() => {
    fetch.mockReset();
    DynamicsService.clearCaches();
  });

  function countAttrsFetches() {
    return fetch.mock.calls.filter((c) => String(c[0]).includes(ATTRS_MARKER)).length;
  }

  test('TTL reuse — second sequential call serves from cache (one Attributes fetch)', async () => {
    fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
      }
      if (u.includes(ATTRS_MARKER)) return Promise.resolve(makeAttrsResponse());
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
    });

    await bypassDynamicsRestrictions('schema-cache-ttl', async () => {
      const first = await DynamicsService.getEntityAttributes('contact');
      const second = await DynamicsService.getEntityAttributes('contact');
      expect(second).toEqual(first);
    });

    expect(countAttrsFetches()).toBe(1);
  });

  test('in-flight dedupe — two concurrent calls share one Attributes fetch', async () => {
    let releaseAttrs;
    const attrsGate = new Promise((resolve) => { releaseAttrs = resolve; });

    fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
      }
      if (u.includes(ATTRS_MARKER)) {
        return attrsGate.then(() => makeAttrsResponse());
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
    });

    await bypassDynamicsRestrictions('schema-cache-dedupe', async () => {
      const p1 = DynamicsService.getEntityAttributes('contact');
      const p2 = DynamicsService.getEntityAttributes('contact');
      // Let both calls register before the outbound fetch resolves.
      await Promise.resolve();
      releaseAttrs();
      const [a, b] = await Promise.all([p1, p2]);
      expect(a).toEqual(b);
    });

    expect(countAttrsFetches()).toBe(1);
  });

  test('clearCaches invalidates — the next call refetches', async () => {
    fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
      }
      if (u.includes(ATTRS_MARKER)) return Promise.resolve(makeAttrsResponse());
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
    });

    await bypassDynamicsRestrictions('schema-cache-clear', async () => {
      await DynamicsService.getEntityAttributes('contact');
      expect(countAttrsFetches()).toBe(1);
      DynamicsService.clearCaches();
      await DynamicsService.getEntityAttributes('contact');
      expect(countAttrsFetches()).toBe(2);
    });
  });
});

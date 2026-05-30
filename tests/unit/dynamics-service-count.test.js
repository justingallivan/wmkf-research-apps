/**
 * A3 — robust counts. DynamicsService.countRecords must NOT use the unreliable
 * `/{entitySet}/$count` endpoint (caps at 5000 unfiltered, throws Edm.Int32 on
 * a filter — probe scripts/probe-akoya-folio-casing.js 2026-05-30). It uses
 * `$apply=filter(...)/aggregate(<primary key> with countdistinct as value)`,
 * which returns the true count (distinct PK == row count).
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { withDynamicsContext } from '../../lib/services/dynamics-context.js';

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

// Default fetch stub: token, EntityDefinitions (carrying PrimaryIdAttribute),
// and an $apply count response. `countValue` is what aggregate returns.
function stubFetch({
  countValue = 9120,
  primaryIdAttribute = 'akoya_requestid',
  logicalName = 'akoya_request',
  entitySetName = 'akoya_requests',
  noPk = false,
  entityOk = true,
} = {}) {
  const pk = noPk ? undefined : primaryIdAttribute;
  fetch.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('login.microsoftonline.com')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
    }
    if (u.includes('EntityDefinitions')) {
      return Promise.resolve({
        ok: entityOk,
        status: entityOk ? 200 : 500,
        json: () => Promise.resolve({
          value: [
            { LogicalName: logicalName, EntitySetName: entitySetName, PrimaryIdAttribute: pk, IsActivity: false },
          ],
        }),
        text: () => Promise.resolve(''),
      });
    }
    // $apply count
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: countValue === null ? [] : [{ value: countValue }] }),
      text: () => Promise.resolve(''),
    });
  });
}

function lastApplyUrl() {
  const calls = fetch.mock.calls.filter(([u]) => String(u).includes('$apply'));
  return calls.length ? String(calls[calls.length - 1][0]) : null;
}

describe('countRecords — robust countdistinct path', () => {
  test('uses $apply countdistinct on the primary key, not /$count', async () => {
    stubFetch({ countValue: 9120 });
    const n = await withDynamicsContext({ restrictions: [], requestId: 'r' }, () =>
      DynamicsService.countRecords('akoya_requests', "akoya_folio eq 'PAID'")
    );
    expect(n).toBe(9120);
    const applyUrl = lastApplyUrl();
    expect(applyUrl).toBeTruthy();
    const decoded = decodeURIComponent(applyUrl);
    expect(decoded).toContain('aggregate(akoya_requestid with countdistinct as value)');
    expect(decoded).toContain("filter(akoya_folio eq 'PAID')");
    // The broken endpoint must not be used.
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/$count'))).toBe(false);
  });

  test('unfiltered count omits the filter() wrapper', async () => {
    stubFetch({ countValue: 22580 });
    const n = await withDynamicsContext({ restrictions: [], requestId: 'r' }, () =>
      DynamicsService.countRecords('akoya_requests')
    );
    expect(n).toBe(22580);
    const decoded = decodeURIComponent(lastApplyUrl());
    expect(decoded).toContain('aggregate(akoya_requestid with countdistinct as value)');
    expect(decoded).not.toContain('filter(');
  });

  test('zero matches → 0 (empty value array tolerated)', async () => {
    stubFetch({ countValue: null });
    const n = await withDynamicsContext({ restrictions: [], requestId: 'r' }, () =>
      DynamicsService.countRecords('akoya_requests', "akoya_folio eq 'NOPE'")
    );
    expect(n).toBe(0);
  });

  // Regression (Codex MEDIUM, S202): countRecords received the entity-set name
  // for tables absent from the static KNOWN_ENTITY_SETS reverse map (e.g.
  // systemusers), and PK resolution returned null. primaryIdMap is now keyed by
  // both logical and entity-set name.
  test('resolves PK via entity-set name for tables outside KNOWN_ENTITY_SETS', async () => {
    stubFetch({ countValue: 215, logicalName: 'wmkf_thing', entitySetName: 'wmkf_thingses', primaryIdAttribute: 'wmkf_thingid' });
    const n = await withDynamicsContext({ restrictions: [], requestId: 'r' }, () =>
      DynamicsService.countRecords('wmkf_thingses', "name eq 'x'")
    );
    expect(n).toBe(215);
    expect(decodeURIComponent(lastApplyUrl())).toContain('aggregate(wmkf_thingid with countdistinct as value)');
  });

  test('fails loud when the primary key cannot be resolved', async () => {
    stubFetch({ noPk: true });
    await expect(
      withDynamicsContext({ restrictions: [], requestId: 'r' }, () =>
        DynamicsService.countRecords('akoya_requests', "akoya_folio eq 'PAID'")
      )
    ).rejects.toThrow(/primary-key attribute/i);
  });

  test('enforces table restrictions (fails closed before any fetch)', async () => {
    stubFetch();
    await expect(
      withDynamicsContext({ restrictions: [{ table_name: 'akoya_request' }], requestId: 'r' }, () =>
        DynamicsService.countRecords('akoya_requests', "akoya_folio eq 'PAID'")
      )
    ).rejects.toThrow(/restricted/i);
  });
});

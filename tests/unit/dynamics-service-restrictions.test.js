/**
 * Restriction-check coverage on `DynamicsService` read paths.
 *
 * Background — F-001 (audit 2026-05-26): `getEntityRelationships()` was the
 * one metadata-fetch method that skipped `checkRestriction(tableName)`, so a
 * caller could enumerate lookup targets for a restricted table even though
 * `getEntityAttributes()` would have refused. This test pins the parity.
 */

import {
  withDynamicsContext,
  bypassDynamicsRestrictions,
} from '../../lib/services/dynamics-context.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

describe('DynamicsService.getEntityRelationships — restriction parity (F-001)', () => {
  test('throws when the table is restricted at the table level', async () => {
    await withDynamicsContext(
      { restrictions: [{ table_name: 'akoya_request' }], requestId: 'F-001-test' },
      async () => {
        await expect(
          DynamicsService.getEntityRelationships('akoya_request'),
        ).rejects.toThrow(/restricted/i);
      },
    );
  });

  test('throws when called outside any context (fail-closed)', async () => {
    await expect(
      DynamicsService.getEntityRelationships('akoya_request'),
    ).rejects.toThrow(/Restrictions not initialized/);
  });

  test('matches getEntityAttributes parity — both methods throw under the same restriction', async () => {
    await withDynamicsContext(
      { restrictions: [{ table_name: 'contact' }], requestId: 'F-001-parity' },
      async () => {
        // Both methods should fail with the same restriction error before any
        // outbound metadata fetch is attempted.
        await expect(DynamicsService.getEntityAttributes('contact')).rejects.toThrow(/restricted/i);
        await expect(DynamicsService.getEntityRelationships('contact')).rejects.toThrow(/restricted/i);
      },
    );
  });

  test('does not throw the restriction error for an unrestricted table inside a bypass scope', async () => {
    // We can't assert success without mocking the network, but we can assert
    // that the synchronous restriction check is no longer the failure mode —
    // any throw must come from network/auth, not the restriction guard.
    await bypassDynamicsRestrictions('F-001-bypass', async () => {
      try {
        await DynamicsService.getEntityRelationships('akoya_request');
      } catch (err) {
        expect(err.message).not.toMatch(/restricted/i);
        expect(err.message).not.toMatch(/Restrictions not initialized/);
      }
    });
  });
});

describe('DynamicsService.getEntityRelationships — positive return path (F-001)', () => {
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

  test('returns the structured relationships object for an unrestricted table inside a bypass scope', async () => {
    fetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
        });
      }
      if (u.includes('ManyToOneRelationships')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            value: [{
              SchemaName: 'akoya_request_account',
              ReferencedEntity: 'account',
              ReferencingAttribute: '_akoya_applicantid_value',
              ReferencedAttribute: 'accountid',
            }],
          }),
        });
      }
      if (u.includes('OneToManyRelationships')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            value: [{
              SchemaName: 'akoya_request_potentialreviewer',
              ReferencingEntity: 'wmkf_potentialreviewer',
              ReferencingAttribute: '_akoya_requestid_value',
              ReferencedAttribute: 'akoya_requestid',
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
    });

    const rels = await bypassDynamicsRestrictions('F-001-positive', () =>
      DynamicsService.getEntityRelationships('akoya_request'),
    );

    expect(rels).toEqual({
      manyToOne: [{
        schemaName: 'akoya_request_account',
        referencedEntity: 'account',
        referencingAttribute: '_akoya_applicantid_value',
        referencedAttribute: 'accountid',
      }],
      oneToMany: [{
        schemaName: 'akoya_request_potentialreviewer',
        referencingEntity: 'wmkf_potentialreviewer',
        referencingAttribute: '_akoya_requestid_value',
        referencedAttribute: 'akoya_requestid',
      }],
    });
  });
});

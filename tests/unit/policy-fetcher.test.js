/**
 * @jest-environment node
 */
/**
 * PolicyFetcher — contract test written BEFORE converting policy-fetcher.js
 * onto the lib/dataverse/adapters/policy.js adapter (Wave-3 caller conversion).
 * Locks the current behavior: golden-path DTO shape (`getActivePolicy`) plus
 * the active-child sanity failure paths, and the cache/TTL contract.
 */
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (a, b) => (typeof a === 'function' ? a() : b()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryRecords: jest.fn() } }));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { getActivePolicy, getActivePolicies, invalidate } from '../../lib/external/policy-fetcher';

const PARENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function parentRow(overrides = {}) {
  return {
    wmkf_policyid: PARENT_ID,
    wmkf_code: 'reviewer-coi',
    wmkf_displayname: 'Reviewer COI Policy',
    _wmkf_activeversion_value: VERSION_ID,
    statecode: 0,
    wmkf_ActiveVersion: {
      wmkf_policyversionid: VERSION_ID,
      wmkf_versionlabel: 'v3',
      wmkf_policytitle: 'COI Policy',
      wmkf_policybody: 'Body text',
      wmkf_effectivedate: '2026-01-01',
      statecode: 0,
      _wmkf_policy_value: PARENT_ID,
      ...(overrides.child || {}),
    },
    ...overrides.parent,
  };
}

beforeEach(() => {
  invalidate();
  DynamicsService.queryRecords.mockReset();
});

it('golden path: resolves the active version DTO shape from a fresh (uncached) fetch', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [parentRow()] });

  const out = await getActivePolicy('reviewer-coi');

  const [entity, opts] = DynamicsService.queryRecords.mock.calls[0];
  expect(entity).toBe('wmkf_policies');
  expect(opts.filter).toBe("wmkf_code eq 'reviewer-coi' and statecode eq 0");
  expect(opts.top).toBe(1);

  expect(out).toEqual({
    slotCode: 'reviewer-coi',
    parentId: PARENT_ID,
    parentDisplayName: 'Reviewer COI Policy',
    activeVersionId: VERSION_ID,
    versionLabel: 'v3',
    title: 'COI Policy',
    body: 'Body text',
    effectiveDate: '2026-01-01',
    source: 'dynamics',
    fetchedAt: expect.any(Number),
  });
});

it('caches within the TTL (single Dataverse round-trip across repeat calls)', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [parentRow()] });

  await getActivePolicy('reviewer-coi');
  const second = await getActivePolicy('reviewer-coi');

  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(1);
  expect(second.source).toBe('cache');

  invalidate('reviewer-coi');
  await getActivePolicy('reviewer-coi');
  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
});

it('getActivePolicies resolves multiple slot codes in parallel, keyed by code', async () => {
  DynamicsService.queryRecords
    .mockResolvedValueOnce({ records: [parentRow()] })
    .mockResolvedValueOnce({
      records: [parentRow({
        parent: { wmkf_code: 'reviewer-ai-use', wmkf_policyid: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
        child: { _wmkf_policy_value: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      })],
    });

  const out = await getActivePolicies(['reviewer-coi', 'reviewer-ai-use']);
  expect(Object.keys(out)).toEqual(['reviewer-coi', 'reviewer-ai-use']);
  expect(out['reviewer-coi'].slotCode).toBe('reviewer-coi');
  expect(out['reviewer-ai-use'].slotCode).toBe('reviewer-ai-use');
});

describe('active-child sanity (fail-closed)', () => {
  it('throws when the slot is not found or inactive (no rows)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    await expect(getActivePolicy('unknown-slot')).rejects.toThrow(/not found or inactive/);
  });

  it('throws when the parent has no active version configured', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{ ...parentRow(), wmkf_ActiveVersion: null }],
    });
    await expect(getActivePolicy('reviewer-coi')).rejects.toThrow(/no active version configured/);
  });

  it('throws when the active version itself is not in Active state', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [parentRow({ child: { statecode: 1 } })],
    });
    await expect(getActivePolicy('reviewer-coi')).rejects.toThrow(/is not in Active state/);
  });

  it('throws when the active version does not belong to its parent', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [parentRow({ child: { _wmkf_policy_value: 'mismatched-parent-id' } })],
    });
    await expect(getActivePolicy('reviewer-coi')).rejects.toThrow(/does not belong to its parent/);
  });

  it('rejects a missing slotCode argument', async () => {
    await expect(getActivePolicy()).rejects.toThrow(/slotCode required/);
  });
});

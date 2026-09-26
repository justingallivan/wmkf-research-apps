/**
 * @jest-environment node
 *
 * 6c-ii Stage A, plan "Read-side fan-out of the marker" (a) + (c) + (d):
 * ordinary identity resolution must never see a synthetic
 * (wmkf_issyntheticreviewer = true) person, and upsertByEmail's reuse path
 * must refuse to merge into one. These fences are gated by
 * SYNTHETIC_REVIEWER_ISOLATION='on', mirroring TEST_REQUEST_ISOLATION --
 * production has no wave30 column until the schema apply, so the switch-off
 * path must never name the marker column.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  findByEmailCandidates,
  findByOrcidCandidates,
  searchByName,
  upsertByEmail,
  isPersonSynthetic,
} from '../../lib/dataverse/adapters/potential-reviewer.js';

const SYNTHETIC_ID = '33333333-3333-4333-8333-333333333333';
const ORDINARY_ID = '44444444-4444-4444-8444-444444444444';

function syntheticRow(overrides = {}) {
  return {
    wmkf_potentialreviewersid: SYNTHETIC_ID,
    wmkf_name: 'TEST · Ada Lovelace',
    wmkf_emailaddress: 'ada@example.edu',
    wmkf_orcid: null,
    statecode: 0,
    wmkf_issyntheticreviewer: true,
    ...overrides,
  };
}

function ordinaryRow(overrides = {}) {
  return {
    wmkf_potentialreviewersid: ORDINARY_ID,
    wmkf_name: 'Ada Lovelace',
    wmkf_emailaddress: 'ada@example.edu',
    wmkf_orcid: '0000-0002-1825-0097',
    statecode: 0,
    wmkf_issyntheticreviewer: false,
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SYNTHETIC_REVIEWER_ISOLATION;
});

describe('switch OFF (no wave30 column on the host)', () => {
  it('findByEmailCandidates does not select or filter on the marker', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [ordinaryRow()] });
    await findByEmailCandidates('ada@example.edu');
    const [, options] = spy.mock.calls[0];
    expect(options.select).not.toMatch(/wmkf_issyntheticreviewer/);
    expect(options.filter).not.toMatch(/wmkf_issyntheticreviewer/);
  });

  it('findByOrcidCandidates does not select or filter on the marker', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await findByOrcidCandidates('0000-0002-1825-0097');
    const [, options] = spy.mock.calls[0];
    expect(options.select).not.toMatch(/wmkf_issyntheticreviewer/);
    expect(options.filter).not.toMatch(/wmkf_issyntheticreviewer/);
  });

  it('searchByName does not select or filter on the marker', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await searchByName('Ada Lovelace');
    for (const [, options] of spy.mock.calls) {
      expect(options.select).not.toMatch(/wmkf_issyntheticreviewer/);
      expect(options.filter || '').not.toMatch(/wmkf_issyntheticreviewer/);
    }
  });
});

describe('switch ON — (a) exclude marker-true rows unconditionally', () => {
  beforeEach(() => { process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on'; });

  it('findByEmailCandidates excludes a marker-true row that WOULD match on email', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [syntheticRow()] });
    const result = await findByEmailCandidates('ada@example.edu');
    expect(result.none).toBe(true);
  });

  it('findByEmailCandidates still returns an ordinary row at the same address', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [ordinaryRow()] });
    const result = await findByEmailCandidates('ada@example.edu');
    expect(result.one).toBe(true);
    expect(result.id).toBe(ORDINARY_ID);
  });

  it('findByOrcidCandidates excludes a marker-true row that WOULD match on ORCID', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [syntheticRow({ wmkf_orcid: '0000-0002-1825-0097' })],
    });
    const result = await findByOrcidCandidates('0000-0002-1825-0097');
    expect(result.none).toBe(true);
  });

  it('searchByName excludes a marker-true row that WOULD match on name, agreeing OData + JS post-filter', async () => {
    // M2 mutation-kill (Opus round 1): the row's OWN name (not the "TEST · "
    // seeder-convention prefix, which the fence must not rely on) is the
    // exact query name, so it ranks FIRST on name score; only the JS
    // post-filter drops it. The prior fixture used the prefixed name, which
    // `rankNameRows` scored away on its own -- so removing the post-filter
    // still passed. This fixture fails without the post-filter.
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [syntheticRow({ wmkf_name: 'Ada Lovelace', wmkf_firstname: 'Ada', wmkf_lastname: 'Lovelace' })],
    });
    const result = await searchByName('Ada Lovelace');
    expect(result).toEqual([]);
  });

  it('searchByName selects and filters on the marker (ON-mode assertion)', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await searchByName('Ada Lovelace');
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [, options] of spy.mock.calls) {
      expect(options.select).toMatch(/wmkf_issyntheticreviewer/);
      expect(options.filter).toMatch(/wmkf_issyntheticreviewer/);
    }
  });

  it('the OData filter and select both name the marker so both paths agree', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await findByEmailCandidates('ada@example.edu');
    const [, options] = spy.mock.calls[0];
    expect(options.select).toMatch(/wmkf_issyntheticreviewer/);
    expect(options.filter).toMatch(/wmkf_issyntheticreviewer/);
  });
});

// (c) findSyntheticByEmail's own describe block was removed with the
// function (Opus round 2, decision): it had no production importer once
// lib/services/test-requests/reviews-sandbox-deps.js#findAnyPersonByEmail
// (an unfiltered lookup, filtered by the caller) replaced it at the one
// call site that ever would have used it. See that module's docblock.

describe('(d) upsertByEmail reuse refuses a synthetic target unconditionally', () => {
  beforeEach(() => { process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on'; });

  it('refuses before any PATCH when the caller-supplied existing row is marker-true', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'x' });

    await expect(
      upsertByEmail(
        { name: 'Ada Lovelace', email: 'ada@example.edu' },
        { existing: syntheticRow() },
      ),
    ).rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });

    expect(patch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('still reuses an ordinary caller-supplied existing row', async () => {
    jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const result = await upsertByEmail(
      { name: 'Ada Lovelace', email: 'ada@example.edu' },
      { existing: ordinaryRow() },
    );
    expect(result.id).toBe(ORDINARY_ID);
    expect(result.created).toBe(false);
  });
});

describe('isPersonSynthetic — M8: fails closed on every read failure', () => {
  beforeEach(() => { process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on'; });

  it('rethrows a transient (500) error rather than treating it as "not synthetic"', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(
      Object.assign(new Error('upstream timeout'), { status: 500 }),
    );
    await expect(isPersonSynthetic(SYNTHETIC_ID)).rejects.toThrow('upstream timeout');
  });

  it('rethrows a missing-column 400 rather than treating it as "not synthetic"', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(
      Object.assign(new Error("Could not find a property named 'wmkf_issyntheticreviewer'."), { status: 400 }),
    );
    await expect(isPersonSynthetic(SYNTHETIC_ID)).rejects.toThrow(/wmkf_issyntheticreviewer/);
  });

  it('rethrows a 404 (person missing) -- also refuses binding rather than passing as "not synthetic"', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(
      Object.assign(new Error('Does Not Exist'), {
        serviceName: 'dataverse', status: 404, dataverseCode: '0x80040217',
      }),
    );
    await expect(isPersonSynthetic(SYNTHETIC_ID)).rejects.toThrow('Does Not Exist');
  });

  it('returns true/false normally when the read succeeds', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(syntheticRow());
    expect(await isPersonSynthetic(SYNTHETIC_ID)).toBe(true);
  });
});

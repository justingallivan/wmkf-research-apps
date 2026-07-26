/**
 * @jest-environment node
 */
/** ReviewQuestionFetcher — cache/single-flight, normalization, fail-closed sanity. */
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (a, b) => (typeof a === 'function' ? a() : b()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryRecords: jest.fn() } }));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { getActiveQuestionSet, getAuthoritativeQuestionSet, invalidate, questionSetVersion } from '../../lib/external/review-question-fetcher';

const rowRich = (key, order, overrides = {}) => ({
  wmkf_reviewquestionid: `id-${key}`,
  wmkf_questionkey: key,
  wmkf_questionorder: order,
  wmkf_questiontext: `Question ${key}?`,
  wmkf_questiontype: 'richtext',
  wmkf_required: true,
  wmkf_maxlength: 50000,
  wmkf_hint: null,
  wmkf_options: null,
  ...overrides,
});

const rowPick = (key, order, options, overrides = {}) => ({
  wmkf_reviewquestionid: `id-${key}`,
  wmkf_questionkey: key,
  wmkf_questionorder: order,
  wmkf_questiontext: `Rate ${key}`,
  wmkf_questiontype: 'picklist',
  wmkf_required: true,
  wmkf_maxlength: null,
  wmkf_hint: null,
  wmkf_options: JSON.stringify(options),
  ...overrides,
});

beforeEach(() => {
  invalidate();
  DynamicsService.queryRecords.mockReset();
});

it('queries active rows only, ordered by question order, and normalizes the field shape', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [
      rowPick('impact', 1, [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }]),
      rowRich('q2', 2, { wmkf_hint: 'be specific' }),
    ],
  });

  const set = await getActiveQuestionSet();

  const [, opts] = DynamicsService.queryRecords.mock.calls[0];
  expect(opts.filter).toBe('statecode eq 0');
  expect(opts.orderby).toBe('wmkf_questionorder');

  expect(set).toEqual([
    { key: 'impact', order: 1, label: 'Rate impact', type: 'picklist', required: true,
      options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
    { key: 'q2', order: 2, label: 'Question q2?', type: 'richtext', required: true, maxLength: 50000, hint: 'be specific' },
  ]);
});

it('accepts the camelCase live key overallRating', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [rowPick('overallRating', 10, [{ value: 1, label: 'Poor' }])],
  });
  const set = await getActiveQuestionSet();
  expect(set[0].key).toBe('overallRating');
});

it('coerces wmkf_required to a strict boolean and string option values to ints', async () => {
  DynamicsService.queryRecords.mockResolvedValue({
    records: [
      rowRich('q11', 11, { wmkf_required: false }),
      rowPick('risk', 3, [{ value: '4', label: 'Fatal' }]),
    ],
  });
  const set = await getActiveQuestionSet();
  expect(set.find((q) => q.key === 'q11').required).toBe(false);
  expect(set.find((q) => q.key === 'risk').options).toEqual([{ value: 4, label: 'Fatal' }]);
});

it('caches within TTL and single-flights concurrent cold reads', async () => {
  DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2)] });

  const [a, b] = await Promise.all([getActiveQuestionSet(), getActiveQuestionSet()]);
  expect(a).toBe(b);
  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(1); // single-flight

  await getActiveQuestionSet();
  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(1); // served from cache

  invalidate();
  await getActiveQuestionSet();
  expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2); // refetched after invalidate
});

describe('fail-closed', () => {
  it('throws on an empty active set', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/empty/);
  });

  it('throws when Dataverse is unreachable (does not return a partial set)', async () => {
    DynamicsService.queryRecords.mockRejectedValue(new Error('dataverse 503'));
    await expect(getActiveQuestionSet()).rejects.toThrow(/503/);
  });

  it('throws on a duplicate question key', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2), rowRich('q2', 3)] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/duplicate/);
  });

  it('throws on an unsupported question type', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2, { wmkf_questiontype: 'slider' })] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/unsupported type/);
  });

  it('throws on an invalid question key', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('2q!', 2)] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/invalid question key/);
  });

  it('throws on empty question text', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2, { wmkf_questiontext: '   ' })] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/empty question text/);
  });

  it('throws on a picklist with unparseable options JSON', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{ ...rowPick('impact', 1, []), wmkf_options: '{not json' }],
    });
    await expect(getActiveQuestionSet()).rejects.toThrow(/unparseable options/);
  });

  it('throws on a picklist with no options', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowPick('impact', 1, [])] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/no options/);
  });

  it('throws on a non-boolean required flag (does not degrade to optional)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2, { wmkf_required: null })] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/non-boolean required/);
  });

  it('throws on a numeric-prefix-junk option value ("4abc")', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowPick('impact', 1, [{ value: '4abc', label: 'x' }])] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/non-integer option value/);
  });

  it('throws on a duplicate question order', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 5), rowRich('q4', 5)] });
    await expect(getActiveQuestionSet()).rejects.toThrow(/duplicate question order/);
  });

  it('throws (does not truncate) when the active set exceeds the 100-row fetch cap', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2)], totalCount: 130, hasMore: true });
    await expect(getActiveQuestionSet()).rejects.toThrow(/exceeds the 100-row fetch cap/);
  });
});

describe('invalidate() generation guard', () => {
  it('an in-flight pre-edit fetch that resolves after invalidate() does not repopulate stale cache', async () => {
    let resolveFirst;
    // First fetch hangs until we resolve it manually.
    DynamicsService.queryRecords.mockImplementationOnce(
      () => new Promise((r) => { resolveFirst = () => r({ records: [rowRich('old', 1)] }); }),
    );

    const firstCall = getActiveQuestionSet(); // starts the in-flight fetch (gen 0)
    invalidate();                              // admin save lands mid-fetch → gen 1, cache cleared
    resolveFirst();                            // the stale fetch now resolves
    await firstCall;                           // awaiter still gets the in-flight value once

    // The stale result must NOT have been cached — the next call refetches.
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('new', 1)] });
    const set = await getActiveQuestionSet();
    expect(set[0].key).toBe('new');
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch (next call retries)', async () => {
    DynamicsService.queryRecords.mockRejectedValueOnce(new Error('transient'));
    await expect(getActiveQuestionSet()).rejects.toThrow(/transient/);
    DynamicsService.queryRecords.mockResolvedValue({ records: [rowRich('q2', 2)] });
    const set = await getActiveQuestionSet();
    expect(set).toHaveLength(1);
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
  });
});

describe('questionSetVersion', () => {
  const base = [
    { key: 'q2', type: 'richtext', required: true, order: 2, maxLength: 50000, label: 'Q2 — original', hint: null, options: null },
    { key: 'impact', type: 'picklist', required: true, order: 1, hint: 'pick one',
      options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }], label: 'Q1 — impact' },
  ];
  const clone = (mut) => {
    const c = base.map((f) => ({ ...f, options: f.options ? f.options.map((o) => ({ ...o })) : f.options }));
    mut(c);
    return c;
  };

  it('is deterministic and order-insensitive', () => {
    expect(questionSetVersion(base)).toBe(questionSetVersion([...base].reverse()));
  });

  // Codex Phase B P1-A: label/hint changes MUST flip the version so an in-flight
  // session 409s set_changed — the submit snapshot persists questionText=label.
  it('changes when a question LABEL changes', () => {
    const edited = clone((c) => { c[0].label = 'Q2 — reworded'; });
    expect(questionSetVersion(edited)).not.toBe(questionSetVersion(base));
  });

  it('changes when a question HINT changes', () => {
    const edited = clone((c) => { c[1].hint = 'pick the best one'; });
    expect(questionSetVersion(edited)).not.toBe(questionSetVersion(base));
  });

  it('also changes on type/required/order/option edits', () => {
    expect(questionSetVersion(clone((c) => { c[0].required = false; }))).not.toBe(questionSetVersion(base));
    expect(questionSetVersion(clone((c) => { c[0].order = 9; }))).not.toBe(questionSetVersion(base));
    expect(questionSetVersion(clone((c) => { c[1].options[0].label = 'Very Low'; }))).not.toBe(questionSetVersion(base));
  });
});

// ── Write-boundary authority (cache-coherence fix) ─────────────────────────────
// The cache is process-local with a 5-minute TTL and invalidate() only clears the
// process that receives it. On multi-instance serverless an admin publication
// therefore leaves other instances serving the previous set until their TTL
// expires. At a WRITE boundary that is a correctness failure, not a stale render:
// the submitting instance compares the client's setVersion against its own stale
// set, both agree, the set_changed guard passes, and rows commit against a
// question set that is no longer live.
describe('getAuthoritativeQuestionSet (write-boundary resolver)', () => {
  const oldSet = [rowRich('q2', 1)];
  const newSet = [rowRich('priorWork', 1)];

  it('bypasses a warm cache and returns the live set', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: oldSet });
    const cached = await getActiveQuestionSet();
    expect(cached[0].key).toBe('q2');
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(1);

    // A publication lands on ANOTHER instance: this process is never invalidated.
    DynamicsService.queryRecords.mockResolvedValue({ records: newSet });

    // The cached resolver still serves the stale set — that is the hazard.
    expect((await getActiveQuestionSet())[0].key).toBe('q2');
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(1);

    // The authoritative resolver re-reads and sees the live set.
    const live = await getAuthoritativeQuestionSet();
    expect(live[0].key).toBe('priorWork');
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
  });

  it('makes the stale set_changed comparison detect the change', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: oldSet });
    const clientVersion = questionSetVersion(await getActiveQuestionSet());

    DynamicsService.queryRecords.mockResolvedValue({ records: newSet });

    // Stale path: client and server versions agree, so the guard would pass and
    // a submit would commit against the retired set.
    expect(questionSetVersion(await getActiveQuestionSet())).toBe(clientVersion);

    // Authoritative path: the mismatch is detected, so submit returns set_changed.
    expect(questionSetVersion(await getAuthoritativeQuestionSet())).not.toBe(clientVersion);
  });

  it('refreshes the cache so later cached reads in this process are current', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: oldSet });
    await getActiveQuestionSet();

    DynamicsService.queryRecords.mockResolvedValue({ records: newSet });
    await getAuthoritativeQuestionSet();

    const after = await getActiveQuestionSet();
    expect(after[0].key).toBe('priorWork');
    // Served from the refreshed cache — no third round-trip.
    expect(DynamicsService.queryRecords).toHaveBeenCalledTimes(2);
  });

  it('fails closed exactly like the cached resolver', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    await expect(getAuthoritativeQuestionSet()).rejects.toThrow(/empty/i);
  });
});

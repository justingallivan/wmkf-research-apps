/**
 * Wave-3 unit tests for the review-answer adapter (wmkf_appreviewanswers) and the
 * DAL/core changeset helper. Same discipline as
 * tests/unit/adapter-characterization-stage2.test.js: assert the EXACT
 * DynamicsService call args, URL strings, and body shapes so the mirrored
 * read/write contracts are provably byte-identical to the live surfaces the
 * adapter reproduces (lib/services/review-answers.js,
 * lib/external/review-answer-snapshot.js, and the external-review submit
 * changeset).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import * as reviewAnswer from '../../lib/dataverse/adapters/review-answer.js';
import * as changeset from '../../lib/dataverse/core/changeset.js';

afterEach(() => jest.restoreAllMocks());

const SID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const ANSWER_SELECT =
  'wmkf_questionkey,wmkf_questionorder,wmkf_questiontext,wmkf_questiontype,' +
  'wmkf_answerhtml,wmkf_answertext,wmkf_answervalue,_wmkf_appreviewersuggestion_value';

// ─────────────────────── adapter: fetchAnswersBySuggestion ───────────────────────

describe('review-answer.fetchAnswersBySuggestion (mirror of review-answers.js)', () => {
  test('golden: keyed OR-chain query with the exact select/filter/orderby', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        {
          _wmkf_appreviewersuggestion_value: SID_A,
          wmkf_questionkey: 'impact',
          wmkf_questionorder: 1,
          wmkf_questiontext: 'Impact',
          wmkf_questiontype: 'picklist',
          wmkf_answerhtml: null,
          wmkf_answertext: 'High',
          wmkf_answervalue: 3,
        },
      ],
      capped: false,
    });

    const out = await reviewAnswer.fetchAnswersBySuggestion([SID_A, SID_B]);

    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toBe('wmkf_appreviewanswers');
    expect(q.mock.calls[0][1]).toEqual({
      select: ANSWER_SELECT,
      filter:
        `_wmkf_appreviewersuggestion_value eq ${SID_A} or ` +
        `_wmkf_appreviewersuggestion_value eq ${SID_B}`,
      orderby: 'wmkf_questionorder',
    });
    expect(out[SID_A]).toEqual([
      {
        questionKey: 'impact',
        questionOrder: 1,
        questionText: 'Impact',
        questionType: 'picklist',
        answerHtml: '',
        answerText: 'High',
        answerValue: 3,
      },
    ]);
  });

  test('re-sanitizes answerHtml on read (defense in depth)', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        {
          _wmkf_appreviewersuggestion_value: SID_A,
          wmkf_questionkey: 'summary',
          wmkf_questionorder: 2,
          wmkf_questiontype: 'richtext',
          wmkf_answerhtml: '<p>ok</p><script>alert(1)</script>',
        },
      ],
      capped: false,
    });
    const out = await reviewAnswer.fetchAnswersBySuggestion([SID_A]);
    expect(out[SID_A][0].answerHtml).not.toMatch(/<script>/i);
    expect(out[SID_A][0].answerHtml).toContain('<p>ok</p>');
  });

  test('sorts each suggestion list by questionOrder', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_appreviewersuggestion_value: SID_A, wmkf_questionkey: 'b', wmkf_questionorder: 5 },
        { _wmkf_appreviewersuggestion_value: SID_A, wmkf_questionkey: 'a', wmkf_questionorder: 1 },
      ],
      capped: false,
    });
    const out = await reviewAnswer.fetchAnswersBySuggestion([SID_A]);
    expect(out[SID_A].map((r) => r.questionKey)).toEqual(['a', 'b']);
  });

  test('fail-loud: capped result throws (partial snapshot must not pass for complete)', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: true });
    await expect(reviewAnswer.fetchAnswersBySuggestion([SID_A])).rejects.toThrow(/5000-row cap/);
  });

  test('empty/falsy input short-circuits to {} with no query', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    expect(await reviewAnswer.fetchAnswersBySuggestion([])).toEqual({});
    expect(await reviewAnswer.fetchAnswersBySuggestion(undefined)).toEqual({});
    expect(q).not.toHaveBeenCalled();
  });

  test('chunks at 20 ids per query (OR-chain length bound)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    await reviewAnswer.fetchAnswersBySuggestion(ids);
    expect(q).toHaveBeenCalledTimes(2);
    expect(q.mock.calls[0][1].filter.split(' or ')).toHaveLength(20);
    expect(q.mock.calls[1][1].filter.split(' or ')).toHaveLength(1);
  });
});

// ─────────────────────── adapter: readRatingsBySuggestion ───────────────────────

describe('review-answer.readRatingsBySuggestion (mirror of review-answer-snapshot.js)', () => {
  test('golden: queries the two rating columns filtered by suggestion, derives ratings', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { wmkf_questionkey: 'impact', wmkf_answervalue: 3 },
        { wmkf_questionkey: 'risk', wmkf_answervalue: 2 },
      ],
    });
    const out = await reviewAnswer.readRatingsBySuggestion(SID_A);
    expect(q).toHaveBeenCalledWith('wmkf_appreviewanswers', {
      select: 'wmkf_questionkey,wmkf_answervalue',
      filter: `_wmkf_appreviewersuggestion_value eq ${SID_A}`,
    });
    expect(out).toEqual({ impact: 3, risk: 2, overallRating: null });
  });

  test('GUID guard: a non-GUID suggestionId throws BEFORE any query', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await expect(reviewAnswer.readRatingsBySuggestion('not-a-guid')).rejects.toThrow(/must be a GUID/);
    expect(q).not.toHaveBeenCalled();
  });

  test('no rows → all ratings null', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    expect(await reviewAnswer.readRatingsBySuggestion(SID_A)).toEqual({
      impact: null,
      risk: null,
      overallRating: null,
    });
  });
});

describe('review-answer.ratingsFromAnswers (pure)', () => {
  test('picks the three canonical keys, ignores others, defaults missing to null', () => {
    expect(
      reviewAnswer.ratingsFromAnswers([
        { questionKey: 'impact', answerValue: 3 },
        { questionKey: 'overallRating', answerValue: 4 },
        { questionKey: 'summary', answerValue: 99 },
      ]),
    ).toEqual({ impact: 3, risk: null, overallRating: 4 });
  });
  test('non-array → all null', () => {
    expect(reviewAnswer.ratingsFromAnswers(null)).toEqual({ impact: null, risk: null, overallRating: null });
  });
});

// ─────────────────────── adapter: alt-key upsert URL/body ───────────────────────

describe('review-answer alt-key upsert URL/body (mirror of review-answer-snapshot.js)', () => {
  const KEYS = new Set(['impact', 'risk', "o'brien"]);

  test('answerRowUrl builds the value-attribute alternate-key URL', () => {
    expect(reviewAnswer.answerRowUrl(SID_A, 'impact', KEYS)).toBe(
      `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact')`,
    );
  });

  test('escapes an apostrophe in the question key by doubling (OData rule, not %27)', () => {
    expect(reviewAnswer.answerRowUrl(SID_A, "o'brien", KEYS)).toBe(
      `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='o''brien')`,
    );
  });

  test('rejects a question key not in the snapshot allowlist (wrong-row guard)', () => {
    expect(() => reviewAnswer.answerRowUrl(SID_A, 'unknown', KEYS)).toThrow(/not a known snapshot question key/);
  });

  test('answerRowBody maps only the non-key columns', () => {
    expect(
      reviewAnswer.answerRowBody({
        questionKey: 'impact',
        questionOrder: 1,
        questionText: 'Impact',
        questionType: 'picklist',
        answerHtml: null,
        answerText: 'High',
        answerValue: 3,
      }),
    ).toEqual({
      wmkf_questionorder: 1,
      wmkf_questiontext: 'Impact',
      wmkf_questiontype: 'picklist',
      wmkf_answerhtml: null,
      wmkf_answertext: 'High',
      wmkf_answervalue: 3,
    });
  });

  test('answerUpsertDescriptor names the entity set + predicate + body (no raw URL)', () => {
    const desc = reviewAnswer.answerUpsertDescriptor(
      SID_A,
      { questionKey: 'risk', questionOrder: 2, questionText: 'Risk', questionType: 'picklist', answerHtml: null, answerText: 'Low', answerValue: 1 },
      KEYS,
    );
    expect(desc).toEqual({
      method: 'PATCH',
      entitySet: 'wmkf_appreviewanswers',
      keyPredicate: `_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='risk'`,
      body: {
        wmkf_questionorder: 2,
        wmkf_questiontext: 'Risk',
        wmkf_questiontype: 'picklist',
        wmkf_answerhtml: null,
        wmkf_answertext: 'Low',
        wmkf_answervalue: 1,
      },
    });
  });
});

// ─────────────────────── core: changeset URL building ───────────────────────

describe('changeset.buildOperationUrl', () => {
  test('record key → set(key)', () => {
    expect(changeset.buildOperationUrl({ entitySet: 'wmkf_appreviewersuggestions', key: SID_A })).toBe(
      `wmkf_appreviewersuggestions(${SID_A})`,
    );
  });
  test('keyPredicate (alt key) → set(predicate), and wins over key', () => {
    expect(
      changeset.buildOperationUrl({
        entitySet: 'wmkf_appreviewanswers',
        key: 'ignored',
        keyPredicate: `_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact'`,
      }),
    ).toBe(`wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact')`);
  });
  test('UNKNOWN entity set is rejected (never forwarded as a raw URL)', () => {
    expect(() => changeset.buildOperationUrl({ entitySet: 'wmkf_prompts', key: SID_A })).toThrow(
      /unknown entity set/,
    );
  });
  test('missing key AND keyPredicate throws for PATCH', () => {
    expect(() => changeset.buildOperationUrl({ method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions' })).toThrow(
      /requires a key or keyPredicate/,
    );
  });
  test('bare-collection POST (no key) → set itself; create ops only (S329 review-questions)', () => {
    expect(changeset.buildOperationUrl({ method: 'POST', entitySet: 'wmkf_reviewquestions' })).toBe(
      'wmkf_reviewquestions',
    );
    expect(() => changeset.buildOperationUrl({ method: 'DELETE', entitySet: 'wmkf_reviewquestions' })).toThrow(
      /requires a key or keyPredicate/,
    );
  });
});

describe('changeset.buildOperations', () => {
  test('translates descriptors to transport ops, carrying ifMatch only when present', () => {
    const ops = changeset.buildOperations([
      { method: 'PATCH', entitySet: 'wmkf_appreviewanswers', keyPredicate: `_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact'`, body: { wmkf_answervalue: 3 } },
      { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SID_A, body: { wmkf_reviewreceivedat: 'now' }, ifMatch: 'W/"123"' },
    ]);
    expect(ops).toEqual([
      { method: 'PATCH', url: `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact')`, body: { wmkf_answervalue: 3 } },
      { method: 'PATCH', url: `wmkf_appreviewersuggestions(${SID_A})`, body: { wmkf_reviewreceivedat: 'now' }, ifMatch: 'W/"123"' },
    ]);
    // no zombie ifMatch key on the child op
    expect('ifMatch' in ops[0]).toBe(false);
  });
  test('empty operations array throws', () => {
    expect(() => changeset.buildOperations([])).toThrow(/non-empty array/);
  });
  test('rejects the whole batch if any op names an unknown entity set', () => {
    expect(() =>
      changeset.buildOperations([
        { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SID_A, body: {} },
        { method: 'POST', entitySet: 'wmkf_aiprompts', body: {} },
      ]),
    ).toThrow(/unknown entity set/);
  });
});

// ─────────────────── core: atomic parent+answers write shape ───────────────────

describe('changeset atomic parent+answers (covers the external-review submit flow)', () => {
  const snapshotKeys = new Set(['impact', 'risk', 'overallRating']);
  const parentPatch = { wmkf_reviewreceivedat: '2026-07-04T00:00:00Z', wmkf_reviewstatus: 100000003 };
  const answerRows = [
    { questionKey: 'impact', questionOrder: 1, questionText: 'Impact', questionType: 'picklist', answerHtml: null, answerText: 'High', answerValue: 3 },
    { questionKey: 'risk', questionOrder: 2, questionText: 'Risk', questionType: 'picklist', answerHtml: null, answerText: 'Low', answerValue: 1 },
  ];

  test('atomicParentWithChildren orders children (answer upserts) BEFORE the parent PATCH', () => {
    const children = answerRows.map((row) => reviewAnswer.answerUpsertDescriptor(SID_A, row, snapshotKeys));
    const parent = { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SID_A, body: parentPatch, ifMatch: 'W/"9"' };
    const ops = changeset.atomicParentWithChildren({ parent, children });
    expect(ops).toHaveLength(3);
    expect(ops[0].keyPredicate).toContain("wmkf_questionkey='impact'");
    expect(ops[1].keyPredicate).toContain("wmkf_questionkey='risk'");
    expect(ops[2]).toBe(parent);
  });

  test('runChangeset builds every URL and delegates to the transport with acting-user options', async () => {
    const exec = jest.spyOn(DynamicsService, 'executeChangeset').mockResolvedValue({ ok: true, operations: [] });

    const children = answerRows.map((row) => reviewAnswer.answerUpsertDescriptor(SID_A, row, snapshotKeys));
    const parent = { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SID_A, body: parentPatch, ifMatch: 'W/"9"' };
    const ops = changeset.atomicParentWithChildren({ parent, children });
    // runChangeset requires a trusted DAL context under Stage-7 enforcement
    // (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md); real callers already
    // establish one (e.g. the external-review submit route's
    // bypassDynamicsRestrictions wrapper) before reaching this helper.
    await bypassDynamicsRestrictions('test-review-answer-changeset', () =>
      changeset.runChangeset(ops, { actingUserSystemId: 'user-1' }),
    );

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toEqual({ actingUserSystemId: 'user-1' });
    expect(exec.mock.calls[0][0]).toEqual([
      { method: 'PATCH', url: `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='impact')`, body: { wmkf_questionorder: 1, wmkf_questiontext: 'Impact', wmkf_questiontype: 'picklist', wmkf_answerhtml: null, wmkf_answertext: 'High', wmkf_answervalue: 3 } },
      { method: 'PATCH', url: `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=${SID_A},wmkf_questionkey='risk')`, body: { wmkf_questionorder: 2, wmkf_questiontext: 'Risk', wmkf_questiontype: 'picklist', wmkf_answerhtml: null, wmkf_answertext: 'Low', wmkf_answervalue: 1 } },
      { method: 'PATCH', url: `wmkf_appreviewersuggestions(${SID_A})`, body: parentPatch, ifMatch: 'W/"9"' },
    ]);
  });

  test('runChangeset propagates a transport throw (atomic: nothing committed)', async () => {
    const err = new Error('conflict');
    err.status = 412;
    jest.spyOn(DynamicsService, 'executeChangeset').mockRejectedValue(err);
    await expect(
      bypassDynamicsRestrictions('test-review-answer-changeset', () =>
        changeset.runChangeset([{ method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SID_A, body: {} }]),
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
});

/**
 * Contract test for lib/services/review-answers.js#fetchAnswersBySuggestion,
 * written against CURRENT behavior before the Wave-3 conversion to
 * lib/dataverse/adapters/review-answer.js (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md).
 * Asserts the golden-path DTO shape (keyed-by-suggestion, questionOrder-sorted,
 * re-sanitized answerHtml) and the one failure path (5000-row cap fail-loud),
 * so the post-conversion thin delegate can be proven byte-identical.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { ANSWER_FIELDS, fetchAnswersBySuggestion } from '../../lib/services/review-answers.js';

afterEach(() => jest.restoreAllMocks());

const SID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('review-answers.fetchAnswersBySuggestion (golden path)', () => {
  test('keyed OR-chain query, keyed-by-suggestion output, sorted by questionOrder', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        {
          _wmkf_appreviewersuggestion_value: SID_A,
          wmkf_questionkey: 'b',
          wmkf_questionorder: 5,
          wmkf_questiontext: 'B',
          wmkf_questiontype: 'picklist',
          wmkf_answerhtml: null,
          wmkf_answertext: 'x',
          wmkf_answervalue: 2,
        },
        {
          _wmkf_appreviewersuggestion_value: SID_A,
          wmkf_questionkey: 'a',
          wmkf_questionorder: 1,
          wmkf_questiontext: 'A',
          wmkf_questiontype: 'richtext',
          wmkf_answerhtml: '<p>ok</p><script>alert(1)</script>',
          wmkf_answertext: '',
          wmkf_answervalue: null,
        },
      ],
      capped: false,
    });

    const out = await fetchAnswersBySuggestion([SID_A, SID_B]);

    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toBe('wmkf_appreviewanswers');
    expect(q.mock.calls[0][1]).toEqual({
      select: ANSWER_FIELDS.join(','),
      filter:
        `_wmkf_appreviewersuggestion_value eq ${SID_A} or ` +
        `_wmkf_appreviewersuggestion_value eq ${SID_B}`,
      orderby: 'wmkf_questionorder',
    });
    expect(out[SID_A].map((r) => r.questionKey)).toEqual(['a', 'b']);
    expect(out[SID_A][0].answerHtml).not.toMatch(/<script>/i);
    expect(out[SID_A][0].answerHtml).toContain('<p>ok</p>');
  });

  test('empty/falsy input short-circuits to {} with no query', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    expect(await fetchAnswersBySuggestion([])).toEqual({});
    expect(await fetchAnswersBySuggestion(undefined)).toEqual({});
    expect(q).not.toHaveBeenCalled();
  });

  test('chunks at 20 ids per query (OR-chain length bound)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    await fetchAnswersBySuggestion(ids);
    expect(q).toHaveBeenCalledTimes(2);
    expect(q.mock.calls[0][1].filter.split(' or ')).toHaveLength(20);
    expect(q.mock.calls[1][1].filter.split(' or ')).toHaveLength(1);
  });
});

describe('review-answers.fetchAnswersBySuggestion (failure path)', () => {
  test('fail-loud: capped result throws (partial snapshot must not pass for complete)', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: true });
    await expect(fetchAnswersBySuggestion([SID_A])).rejects.toThrow(/5000-row cap/);
  });
});

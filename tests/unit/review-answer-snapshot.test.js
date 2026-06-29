jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveEntitySetName: jest.fn(async () => 'wmkf_appreviewanswers'),
    queryAllRecords: jest.fn(async () => ({ records: [] })),
  },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

import {
  ANSWER_KEY_LOOKUP_ATTR,
  answerRowUrl,
  answerRowBody,
  buildRatingSnapshotRows,
  ratingsFromAnswers,
  readRatingsBySuggestion,
  REVIEW_RATING_KEYS,
} from '../../lib/external/review-answer-snapshot';
import { reviewFormSchema } from '../../lib/external/review-form-schema';
import { DynamicsService } from '../../lib/services/dynamics-service';

const SNAPSHOT_KEYS = new Set(
  reviewFormSchema.fields.filter((f) => f.type === 'picklist' || f.type === 'richtext').map((f) => f.key),
);

describe('answerRowUrl', () => {
  it('addresses the lookup by its value attribute + escapes the question key', () => {
    const url = answerRowUrl('wmkf_appreviewanswers', 'GUID', 'impact', SNAPSHOT_KEYS);
    expect(url).toBe(`wmkf_appreviewanswers(${ANSWER_KEY_LOOKUP_ATTR}=GUID,wmkf_questionkey='impact')`);
  });

  it('doubles apostrophes per OData (not percent-encoding)', () => {
    const keys = new Set(["o'brien"]);
    expect(answerRowUrl('E', 'G', "o'brien", keys)).toContain("wmkf_questionkey='o''brien'");
  });

  it('throws on a key outside the snapshot allowlist', () => {
    expect(() => answerRowUrl('E', 'G', 'affiliation', SNAPSHOT_KEYS)).toThrow(/not a known snapshot question key/);
    expect(() => answerRowUrl('E', 'G', 'bogus', SNAPSHOT_KEYS)).toThrow();
  });
});

describe('answerRowBody', () => {
  it('maps the row to the six snapshot columns', () => {
    expect(answerRowBody({
      questionOrder: 1, questionText: 'Q', questionType: 'picklist',
      answerHtml: null, answerText: 'Will rewrite textbooks', answerValue: 4,
    })).toEqual({
      wmkf_questionorder: 1,
      wmkf_questiontext: 'Q',
      wmkf_questiontype: 'picklist',
      wmkf_answerhtml: null,
      wmkf_answertext: 'Will rewrite textbooks',
      wmkf_answervalue: 4,
    });
  });
});

describe('buildRatingSnapshotRows', () => {
  const fields = reviewFormSchema.fields;

  it('builds one row per present canonical rating, decoded like submit', () => {
    const rows = buildRatingSnapshotRows(
      { wmkf_reviewerimpact: 3, wmkf_reviewerrisk: 2, wmkf_revieweroverallrating: 5, wmkf_revieweraffiliation: 'MIT' },
      fields,
    );
    expect(rows).toHaveLength(3);
    const byKey = Object.fromEntries(rows.map((r) => [r.questionKey, r]));
    expect(byKey.impact).toMatchObject({
      questionKey: 'impact', questionOrder: 1, questionType: 'picklist',
      answerHtml: null, answerValue: 3, answerText: 'Will result in publications of broad interest',
    });
    expect(byKey.overallRating).toMatchObject({ answerValue: 5, answerText: 'Excellent', questionOrder: 10 });
    // affiliation is a parent string field, never a snapshot row
    expect(rows.find((r) => r.questionKey === 'affiliation')).toBeUndefined();
  });

  it('omits a rating that is absent (informal-feedback / partial path)', () => {
    const rows = buildRatingSnapshotRows({ wmkf_reviewerimpact: 1 }, fields);
    expect(rows.map((r) => r.questionKey)).toEqual(['impact']);
  });

  it('treats null/undefined as absent, not a row with null value', () => {
    expect(buildRatingSnapshotRows({}, fields)).toEqual([]);
    expect(buildRatingSnapshotRows({ wmkf_reviewerrisk: null }, fields)).toEqual([]);
    expect(buildRatingSnapshotRows(null, fields)).toEqual([]);
  });

  it('does not synthesize a row when the value is out of the picklist domain (answerText empty, value preserved)', () => {
    // value present but not a known option → row still emitted (caller validated),
    // answerText falls back to '' so we never invent a label.
    const rows = buildRatingSnapshotRows({ wmkf_reviewerimpact: 99 }, fields);
    expect(rows).toEqual([
      expect.objectContaining({ questionKey: 'impact', answerValue: 99, answerText: '' }),
    ]);
  });
});

describe('ratingsFromAnswers', () => {
  it('maps the three rating keys from snapshot answer rows', () => {
    expect(ratingsFromAnswers([
      { questionKey: 'impact', answerValue: 3 },
      { questionKey: 'q2', answerValue: null },
      { questionKey: 'risk', answerValue: 2 },
      { questionKey: 'overallRating', answerValue: 5 },
    ])).toEqual({ impact: 3, risk: 2, overallRating: 5 });
  });

  it('returns null for a rating with no snapshot row (informal / unrated)', () => {
    expect(ratingsFromAnswers([{ questionKey: 'impact', answerValue: 4 }]))
      .toEqual({ impact: 4, risk: null, overallRating: null });
    expect(ratingsFromAnswers([])).toEqual({ impact: null, risk: null, overallRating: null });
    expect(ratingsFromAnswers(null)).toEqual({ impact: null, risk: null, overallRating: null });
  });

  it('ignores non-rating question keys and preserves the rating-key set', () => {
    expect(REVIEW_RATING_KEYS).toEqual(['impact', 'risk', 'overallRating']);
    expect(ratingsFromAnswers([{ questionKey: 'q11', answerValue: 7 }]))
      .toEqual({ impact: null, risk: null, overallRating: null });
  });
});

describe('readRatingsBySuggestion', () => {
  const GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  beforeEach(() => jest.clearAllMocks());

  it('throws on a non-GUID id before touching Dataverse (trust boundary)', async () => {
    await expect(readRatingsBySuggestion('suggestion-1')).rejects.toThrow(/must be a GUID/);
    expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  });

  it('queries the snapshot by the suggestion lookup and derives the ratings', async () => {
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [
        { wmkf_questionkey: 'impact', wmkf_answervalue: 3 },
        { wmkf_questionkey: 'overallRating', wmkf_answervalue: 5 },
      ],
    });
    const ratings = await readRatingsBySuggestion(GUID);
    expect(ratings).toEqual({ impact: 3, risk: null, overallRating: 5 });
    const [, opts] = DynamicsService.queryAllRecords.mock.calls[0];
    expect(opts.filter).toBe(`_wmkf_appreviewersuggestion_value eq ${GUID}`);
    expect(opts.select).toBe('wmkf_questionkey,wmkf_answervalue');
  });

  it('returns all-null when the suggestion has no snapshot rows', async () => {
    DynamicsService.queryAllRecords.mockResolvedValueOnce({ records: [] });
    expect(await readRatingsBySuggestion(GUID)).toEqual({ impact: null, risk: null, overallRating: null });
  });
});

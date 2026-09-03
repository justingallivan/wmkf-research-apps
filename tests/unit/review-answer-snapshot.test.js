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
  buildMultiselectSnapshotRows,
  buildRatingSnapshotRows,
  ratingsFromAnswers,
  readRatingsBySuggestion,
  REVIEW_RATING_KEYS,
} from '../../lib/external/review-answer-snapshot';
import { reviewFormSchema } from '../../lib/external/review-form-schema';
import { DynamicsService } from '../../lib/services/dynamics-service';

const SNAPSHOT_KEYS = new Set(
  reviewFormSchema.fields.filter((f) => ['picklist', 'richtext', 'multiselect'].includes(f.type)).map((f) => f.key),
);

describe('answerRowUrl', () => {
  it('addresses the lookup by its value attribute + escapes the question key', () => {
    const url = answerRowUrl('wmkf_appreviewanswers', 'GUID', 'impactAreas', SNAPSHOT_KEYS);
    expect(url).toBe(`wmkf_appreviewanswers(${ANSWER_KEY_LOOKUP_ATTR}=GUID,wmkf_questionkey='impactAreas')`);
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
  it('maps the row to the eight snapshot columns', () => {
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
      wmkf_answervalues: null,
      wmkf_questionoptions: null,
    });
  });
});

describe('buildRatingSnapshotRows', () => {
  const fields = reviewFormSchema.fields;

  it('builds one row per present rating (field.key-keyed), decoded like submit', () => {
    const rows = buildRatingSnapshotRows(
      { riskLevel: 2, overallAssessment: 5 },
      fields,
    );
    expect(rows).toHaveLength(2);
    const byKey = Object.fromEntries(rows.map((r) => [r.questionKey, r]));
    expect(byKey.riskLevel).toMatchObject({
      questionKey: 'riskLevel', questionOrder: 4, questionType: 'picklist',
      answerHtml: null, answerValue: 2, answerText: 'Medium risk (parts may succeed, others may fail)',
      answerValues: null,
      questionOptions: reviewFormSchema.fields.find((field) => field.key === 'riskLevel').options,
    });
    expect(byKey.overallAssessment).toMatchObject({ answerValue: 5, answerText: 'Excellent', questionOrder: 10 });
    // affiliation is a string field, never a snapshot row
    expect(rows.find((r) => r.questionKey === 'affiliation')).toBeUndefined();
  });

  it('omits a rating that is absent (informal-feedback / partial path)', () => {
    const rows = buildRatingSnapshotRows({ riskLevel: 1 }, fields);
    expect(rows.map((r) => r.questionKey)).toEqual(['riskLevel']);
  });

  it('treats null/undefined as absent, not a row with null value', () => {
    expect(buildRatingSnapshotRows({}, fields)).toEqual([]);
    expect(buildRatingSnapshotRows({ riskLevel: null }, fields)).toEqual([]);
    expect(buildRatingSnapshotRows(null, fields)).toEqual([]);
  });

  it('does not synthesize a label when the value is out of the picklist domain (answerText empty, value preserved)', () => {
    // value present but not a known option → row still emitted (caller validated),
    // answerText falls back to '' so we never invent a label.
    const rows = buildRatingSnapshotRows({ riskLevel: 99 }, fields);
    expect(rows).toEqual([
      expect.objectContaining({ questionKey: 'riskLevel', answerValue: 99, answerText: '' }),
    ]);
  });
});

describe('buildMultiselectSnapshotRows', () => {
  it('emits canonical pairs and semicolon-delimited fallback text', () => {
    expect(buildMultiselectSnapshotRows({
      impactAreas: {
        values: [1, 4],
        pairs: [
          { value: 1, label: 'Provide enabling tools to the community' },
          { value: 4, label: 'Revise textbooks' },
        ],
        answerText: 'Provide enabling tools to the community; Revise textbooks',
      },
    }, reviewFormSchema.fields)).toEqual([
      expect.objectContaining({
        questionKey: 'impactAreas',
        questionOrder: 3,
        questionType: 'multiselect',
        answerValue: null,
        answerValues: [
          { value: 1, label: 'Provide enabling tools to the community' },
          { value: 4, label: 'Revise textbooks' },
        ],
        questionOptions: reviewFormSchema.fields.find((field) => field.key === 'impactAreas').options,
      }),
    ]);
  });

  it('rejects a non-canonical caller payload', () => {
    expect(() => buildMultiselectSnapshotRows(
      { impactAreas: [1, 4] },
      reviewFormSchema.fields,
    )).toThrow(/not canonicalized/);
  });
});

describe('ratingsFromAnswers', () => {
  it('maps the two rating keys from snapshot answer rows', () => {
    expect(ratingsFromAnswers([
      { questionKey: 'impactAreas', answerValue: null },
      { questionKey: 'riskLevel', answerValue: 2 },
      { questionKey: 'overallAssessment', answerValue: 5 },
    ])).toEqual({ riskLevel: 2, overallAssessment: 5 });
  });

  it('returns null for a rating with no snapshot row (informal / unrated)', () => {
    expect(ratingsFromAnswers([{ questionKey: 'riskLevel', answerValue: 4 }]))
      .toEqual({ riskLevel: 4, overallAssessment: null });
    expect(ratingsFromAnswers([])).toEqual({ riskLevel: null, overallAssessment: null });
    expect(ratingsFromAnswers(null)).toEqual({ riskLevel: null, overallAssessment: null });
  });

  it('ignores non-rating question keys and preserves the rating-key set', () => {
    expect(REVIEW_RATING_KEYS).toEqual(['riskLevel', 'overallAssessment']);
    expect(ratingsFromAnswers([{ questionKey: 'impactAreas', answerValue: 7 }]))
      .toEqual({ riskLevel: null, overallAssessment: null });
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
        { wmkf_questionkey: 'riskLevel', wmkf_answervalue: 3 },
        { wmkf_questionkey: 'overallAssessment', wmkf_answervalue: 5 },
      ],
    });
    const ratings = await readRatingsBySuggestion(GUID);
    expect(ratings).toEqual({ riskLevel: 3, overallAssessment: 5 });
    const [, opts] = DynamicsService.queryAllRecords.mock.calls[0];
    expect(opts.filter).toBe(`_wmkf_appreviewersuggestion_value eq ${GUID}`);
    expect(opts.select).toBe('wmkf_questionkey,wmkf_answervalue');
  });

  it('returns all-null when the suggestion has no snapshot rows', async () => {
    DynamicsService.queryAllRecords.mockResolvedValueOnce({ records: [] });
    expect(await readRatingsBySuggestion(GUID)).toEqual({ riskLevel: null, overallAssessment: null });
  });
});

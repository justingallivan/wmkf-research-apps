import {
  ANSWER_KEY_LOOKUP_ATTR,
  answerRowUrl,
  answerRowBody,
  buildRatingSnapshotRows,
} from '../../lib/external/review-answer-snapshot';
import { reviewFormSchema } from '../../lib/external/review-form-schema';

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

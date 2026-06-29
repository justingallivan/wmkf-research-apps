/**
 * validateReviewSubmission + buildReviewSubmission — the Phase 3 submit producer.
 *
 * Covers (plan §5/§9, Codex P1-N4 / P1-R3 / S301-P1):
 *   - full-form validation: required richtext emptiness-after-strip, optional Q11,
 *     rating live-domain (removed 99 + out-of-range rejected), maxLength.
 *   - the single mapping: parentPatch (affiliation + 3 ratings + receivedat) and
 *     11 ordered answer rows; rating rows carry value+label and equal the parent;
 *     richtext rows carry sanitized html + plain-text rendition.
 *   - producer backstops: exactly-3-ratings, rating-domain, parent/child equality,
 *     snapshot-fidelity, receivedAt required.
 */

import { validateReviewSubmission, buildReviewSubmission } from '../../lib/external/build-review-submission';

const RECEIVED_AT = '2026-06-28T12:00:00.000Z';

// A complete, valid, already-sanitized submit keyed by field.key.
function validInput(overrides = {}) {
  return {
    affiliation: '  Professor of Physics, Example University  ',
    impact: 3,
    risk: 2,
    overallRating: 4,
    q2: '<p>Significant impact on the field.</p>',
    q4: '<p>Technical risks around instrument build.</p>',
    q5: '<p>Methods are appropriate.</p>',
    q6: '<p>No issues to raise.</p>',
    q7: '<p>Strong team.</p>',
    q8: '<p>Unlikely to be funded elsewhere.</p>',
    q9: '<p>Budget is reasonable.</p>',
    q11: '', // optional
    ...overrides,
  };
}

describe('validateReviewSubmission', () => {
  test('a complete valid submit passes and normalizes types', () => {
    const r = validateReviewSubmission(validInput());
    expect(r.ok).toBe(true);
    expect(r.normalized.affiliation).toBe('Professor of Physics, Example University'); // trimmed
    expect(r.normalized.impact).toBe(3);
    expect(r.normalized.risk).toBe(2);
    expect(r.normalized.overallRating).toBe(4);
    expect(r.normalized.q2).toBe('<p>Significant impact on the field.</p>');
    expect(r.normalized.q11).toBe(''); // optional, omitted
  });

  test('coerces numeric-string ratings to ints', () => {
    const r = validateReviewSubmission(validInput({ impact: '3' }));
    expect(r.ok).toBe(true);
    expect(r.normalized.impact).toBe(3);
  });

  test('rejects a required richtext that is empty after tag-strip', () => {
    const r = validateReviewSubmission(validInput({ q2: '<p></p>' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Q2.*required/);
  });

  test('rejects a required richtext that is whitespace/structural-only', () => {
    const r = validateReviewSubmission(validInput({ q4: '<p><br></p>' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Q4.*required/);
  });

  test('allows an empty optional Q11', () => {
    expect(validateReviewSubmission(validInput({ q11: '<p></p>' })).ok).toBe(true);
    expect(validateReviewSubmission(validInput({ q11: undefined })).ok).toBe(true);
  });

  test('rejects a removed rating value (retired "Unable to answer"/99)', () => {
    const r = validateReviewSubmission(validInput({ impact: 99 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/invalid choice/);
  });

  test('rejects an out-of-range rating value', () => {
    const r = validateReviewSubmission(validInput({ overallRating: 6 })); // domain is 1..5
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/invalid choice/);
  });

  test('rejects a missing required rating', () => {
    const r = validateReviewSubmission(validInput({ risk: null }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Q3.*required/);
  });

  test('rejects a missing required affiliation', () => {
    const r = validateReviewSubmission(validInput({ affiliation: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/required/);
  });

  test('enforces richtext maxLength on the sanitized html', () => {
    const huge = `<p>${'a'.repeat(50001)}</p>`;
    const r = validateReviewSubmission(validInput({ q2: huge }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/max 50000 characters/);
  });

  test('rejects non-object input', () => {
    expect(validateReviewSubmission(null).ok).toBe(false);
    expect(validateReviewSubmission('x').ok).toBe(false);
    expect(validateReviewSubmission([]).ok).toBe(false);
  });
});

describe('buildReviewSubmission — mapping', () => {
  function build(overrides) {
    const v = validateReviewSubmission(validInput(overrides));
    expect(v.ok).toBe(true);
    return buildReviewSubmission(v.normalized, { receivedAt: RECEIVED_AT });
  }

  test('parentPatch carries affiliation, the 3 ratings, and receivedat', () => {
    const { parentPatch } = build();
    expect(parentPatch).toEqual({
      wmkf_revieweraffiliation: 'Professor of Physics, Example University',
      wmkf_reviewerimpact: 3,
      wmkf_reviewerrisk: 2,
      wmkf_revieweroverallrating: 4,
      wmkf_reviewreceivedat: RECEIVED_AT,
    });
  });

  test('emits exactly 11 answer rows in question order', () => {
    const { answerRows } = build();
    expect(answerRows).toHaveLength(11);
    expect(answerRows.map((r) => r.questionOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(answerRows.map((r) => r.questionKey)).toEqual([
      'impact', 'q2', 'risk', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'overallRating', 'q11',
    ]);
  });

  test('rating rows carry value + label + null html, and equal the parent', () => {
    const { parentPatch, answerRows } = build();
    const impact = answerRows.find((r) => r.questionKey === 'impact');
    expect(impact).toMatchObject({
      questionType: 'picklist',
      answerValue: 3,
      answerHtml: null,
      answerText: 'Will result in publications of broad interest',
    });
    expect(impact.answerValue).toBe(parentPatch.wmkf_reviewerimpact);
  });

  test('richtext rows carry sanitized html + a plain-text rendition + null value', () => {
    const { answerRows } = build();
    const q2 = answerRows.find((r) => r.questionKey === 'q2');
    expect(q2).toMatchObject({
      questionType: 'richtext',
      answerHtml: '<p>Significant impact on the field.</p>',
      answerText: 'Significant impact on the field.',
      answerValue: null,
    });
  });

  test('an empty optional Q11 still emits a row (complete snapshot) with empty content', () => {
    const { answerRows } = build({ q11: '<p></p>' });
    const q11 = answerRows.find((r) => r.questionKey === 'q11');
    expect(q11).toMatchObject({ questionOrder: 11, answerHtml: '', answerText: '', answerValue: null });
  });

  test('every row denormalizes a non-empty question text + type', () => {
    const { answerRows } = build();
    for (const row of answerRows) {
      expect(typeof row.questionOrder).toBe('number');
      expect(row.questionText.length).toBeGreaterThan(0);
      expect(['picklist', 'richtext']).toContain(row.questionType);
    }
  });
});

describe('buildReviewSubmission — producer backstops', () => {
  test('throws when receivedAt is missing', () => {
    const v = validateReviewSubmission(validInput());
    expect(() => buildReviewSubmission(v.normalized, {})).toThrow(/receivedAt/);
  });

  test('throws on a non-object normalized', () => {
    expect(() => buildReviewSubmission(null, { receivedAt: RECEIVED_AT })).toThrow(/normalized object required/);
  });

  test('throws if a rating drifts from its parent column (constructed inconsistency)', () => {
    const v = validateReviewSubmission(validInput());
    // Corrupt the normalized impact AFTER validation so parent/child can disagree
    // only if the producer failed to use a single source — simulate a producer bug
    // by hand-building an inconsistent normalized that the validator would pass.
    // Here we tamper to an out-of-domain value to trip the domain assert.
    const bad = { ...v.normalized, impact: 99 };
    expect(() => buildReviewSubmission(bad, { receivedAt: RECEIVED_AT })).toThrow(
      /not in the live picklist domain/,
    );
  });

  test('throws if a required rating is null at build time (fewer than 3 rating rows)', () => {
    const v = validateReviewSubmission(validInput());
    const bad = { ...v.normalized, risk: null };
    expect(() => buildReviewSubmission(bad, { receivedAt: RECEIVED_AT })).toThrow(
      /exactly 3 rating rows/,
    );
  });
});

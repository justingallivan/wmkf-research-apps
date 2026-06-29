/**
 * Tests for the reviewer-form schema validator.
 *
 * @jest-environment node
 */

import { validateReviewForm, reviewFormSchema } from '../../lib/external/review-form-schema.js';

function valid() {
  return {
    affiliation: 'Professor of Biology, University of Example',
    impact: 3,
    risk: 2,
    overallRating: 4,
  };
}

describe('reviewFormSchema definition', () => {
  test('parent-mapped fields have unique dataverseField mappings', () => {
    // Only string/picklist fields map to parent columns; richtext answers go to
    // the snapshot child table and intentionally carry no dataverseField.
    const dvFields = reviewFormSchema.fields
      .map(f => f.dataverseField)
      .filter(Boolean);
    expect(new Set(dvFields).size).toBe(dvFields.length);
  });

  test('richtext fields carry no dataverseField (snapshot-child content)', () => {
    for (const f of reviewFormSchema.fields.filter(f => f.type === 'richtext')) {
      expect(f.dataverseField).toBeUndefined();
    }
  });

  test('every question field (picklist + richtext) has a unique 1..11 order; affiliation has none', () => {
    const questions = reviewFormSchema.fields.filter(f => f.type === 'picklist' || f.type === 'richtext');
    const orders = questions.map(f => f.order);
    expect(orders.every(o => Number.isInteger(o) && o >= 1 && o <= 11)).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
    expect(reviewFormSchema.fields.find(f => f.key === 'affiliation').order).toBeUndefined();
  });

  test('the 8 narrative questions (Q2/Q4–Q9/Q11) are present as richtext keys', () => {
    const richtextKeys = reviewFormSchema.fields.filter(f => f.type === 'richtext').map(f => f.key);
    expect(richtextKeys.sort()).toEqual(['q11', 'q2', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
    // Q11 is the only optional free-text field.
    expect(reviewFormSchema.fields.find(f => f.key === 'q11').required).toBe(false);
    for (const k of ['q2', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']) {
      expect(reviewFormSchema.fields.find(f => f.key === k).required).toBe(true);
    }
  });

  test('no picklist field offers an "Unable to answer" option', () => {
    for (const f of reviewFormSchema.fields.filter(f => f.type === 'picklist')) {
      expect(f.options.some(o => o.value === 99 || /unable/i.test(o.label))).toBe(false);
    }
  });
});

describe('validateReviewForm — richtext is not parent-validated', () => {
  test('missing required richtext answers do NOT fail parent validation', () => {
    // The legacy upload path supplies only affiliation + ratings; required
    // richtext questions must not break it (they validate at submit, Phase 3).
    const r = validateReviewForm(valid());
    expect(r.ok).toBe(true);
    expect(r.dataverseValues.wmkf_revieweraffiliation).toBeDefined();
  });

  test('richtext values are ignored (never returned as dataverseValues or ratings)', () => {
    const r = validateReviewForm({ ...valid(), q2: '<p>impactful</p>' });
    expect(r.ok).toBe(true);
    // Post-Phase-E: dataverseValues holds only the affiliation parent column;
    // ratings live in the separate `ratings` bucket (snapshot-only, by field.key).
    expect(Object.keys(r.dataverseValues)).toEqual(['wmkf_revieweraffiliation']);
    expect(r.ratings).toEqual({ impact: 3, risk: 2, overallRating: 4 });
  });
});

describe('validateReviewForm', () => {
  test('happy path: affiliation → dataverseValues, ratings → ratings bucket', () => {
    const r = validateReviewForm(valid());
    expect(r.ok).toBe(true);
    expect(r.dataverseValues).toEqual({
      wmkf_revieweraffiliation: 'Professor of Biology, University of Example',
    });
    expect(r.ratings).toEqual({ impact: 3, risk: 2, overallRating: 4 });
  });

  test('trims whitespace from string fields', () => {
    const r = validateReviewForm({ ...valid(), affiliation: '   Trimmed   ' });
    expect(r.dataverseValues.wmkf_revieweraffiliation).toBe('Trimmed');
  });

  test('accepts clean numeric strings for picklists (routed to ratings)', () => {
    const r = validateReviewForm({ ...valid(), impact: '3' });
    expect(r.ok).toBe(true);
    expect(r.ratings.impact).toBe(3);
  });

  test('rejects a malformed numeric string (strict parse, no parseInt truncation)', () => {
    // "3abc" previously truncated to 3 via parseInt; the strict parse rejects it
    // so only clean values reach the snapshot rows (Codex Phase E P1-3).
    const r = validateReviewForm({ ...valid(), impact: '3abc' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/whole number/);
  });

  test('rejects the removed "Unable to answer" value (99) on each picklist', () => {
    const r = validateReviewForm({ affiliation: 'X', impact: 99, risk: 99, overallRating: 99 });
    expect(r.ok).toBe(false);
    expect(r.errors.every(e => /invalid choice/.test(e))).toBe(true);
  });

  test('rejects missing required fields', () => {
    const r = validateReviewForm({ affiliation: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3); // impact, risk, overallRating
  });

  test('rejects empty affiliation', () => {
    const r = validateReviewForm({ ...valid(), affiliation: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /Title.*Organization/.test(e))).toBe(true);
  });

  test('rejects whitespace-only affiliation', () => {
    const r = validateReviewForm({ ...valid(), affiliation: '   ' });
    expect(r.ok).toBe(false);
  });

  test('rejects affiliation over maxLength', () => {
    const r = validateReviewForm({ ...valid(), affiliation: 'x'.repeat(301) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/300 characters/);
  });

  test('rejects out-of-range picklist value', () => {
    const r = validateReviewForm({ ...valid(), overallRating: 7 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/invalid choice/);
  });

  test('rejects negative picklist value', () => {
    const r = validateReviewForm({ ...valid(), impact: -1 });
    expect(r.ok).toBe(false);
  });

  test('rejects non-numeric picklist input', () => {
    const r = validateReviewForm({ ...valid(), impact: 'somewhat' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/number|invalid choice/);
  });

  test('rejects null/undefined input', () => {
    expect(validateReviewForm(null).ok).toBe(false);
    expect(validateReviewForm(undefined).ok).toBe(false);
  });

  test('aggregates multiple errors instead of bailing on first', () => {
    const r = validateReviewForm({ affiliation: '', impact: 7, risk: 'bad', overallRating: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  describe('partial mode', () => {
    test('accepts entirely missing input', () => {
      const r = validateReviewForm({}, { partial: true });
      expect(r.ok).toBe(true);
      expect(r.dataverseValues).toEqual({});
      expect(r.ratings).toEqual({});
    });

    test('accepts null/undefined input', () => {
      expect(validateReviewForm(null, { partial: true })).toEqual({ ok: true, dataverseValues: {}, ratings: {} });
      expect(validateReviewForm(undefined, { partial: true })).toEqual({ ok: true, dataverseValues: {}, ratings: {} });
    });

    test('still validates types/ranges of present values', () => {
      const r = validateReviewForm({ impact: 7 }, { partial: true });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/invalid choice/);
    });

    test('routes only the ratings that were provided to the ratings bucket', () => {
      const r = validateReviewForm({ overallRating: 4 }, { partial: true });
      expect(r.ok).toBe(true);
      expect(r.dataverseValues).toEqual({});
      expect(r.ratings).toEqual({ overallRating: 4 });
    });
  });
});

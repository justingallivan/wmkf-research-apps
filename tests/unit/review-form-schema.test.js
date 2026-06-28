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
  test('all fields have unique dataverseField mappings', () => {
    const dvFields = reviewFormSchema.fields.map(f => f.dataverseField);
    expect(new Set(dvFields).size).toBe(dvFields.length);
  });

  test('no picklist field offers an "Unable to answer" option', () => {
    for (const f of reviewFormSchema.fields.filter(f => f.type === 'picklist')) {
      expect(f.options.some(o => o.value === 99 || /unable/i.test(o.label))).toBe(false);
    }
  });
});

describe('validateReviewForm', () => {
  test('happy path returns dataverseValues keyed by dataverseField', () => {
    const r = validateReviewForm(valid());
    expect(r.ok).toBe(true);
    expect(r.dataverseValues).toEqual({
      wmkf_revieweraffiliation: 'Professor of Biology, University of Example',
      wmkf_reviewerimpact: 3,
      wmkf_reviewerrisk: 2,
      wmkf_revieweroverallrating: 4,
    });
  });

  test('trims whitespace from string fields', () => {
    const r = validateReviewForm({ ...valid(), affiliation: '   Trimmed   ' });
    expect(r.dataverseValues.wmkf_revieweraffiliation).toBe('Trimmed');
  });

  test('accepts numeric strings for picklists', () => {
    const r = validateReviewForm({ ...valid(), impact: '3' });
    expect(r.ok).toBe(true);
    expect(r.dataverseValues.wmkf_reviewerimpact).toBe(3);
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
    });

    test('accepts null/undefined input', () => {
      expect(validateReviewForm(null, { partial: true })).toEqual({ ok: true, dataverseValues: {} });
      expect(validateReviewForm(undefined, { partial: true })).toEqual({ ok: true, dataverseValues: {} });
    });

    test('still validates types/ranges of present values', () => {
      const r = validateReviewForm({ impact: 7 }, { partial: true });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/invalid choice/);
    });

    test('writes only the fields that were provided', () => {
      const r = validateReviewForm({ overallRating: 4 }, { partial: true });
      expect(r.ok).toBe(true);
      expect(r.dataverseValues).toEqual({ wmkf_revieweroverallrating: 4 });
    });
  });
});

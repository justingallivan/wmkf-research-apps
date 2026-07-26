/**
 * Tests for the reviewer-form schema validator.
 *
 * @jest-environment node
 */

import { validateReviewForm, reviewFormSchema } from '../../lib/external/review-form-schema.js';

function valid() {
  return {
    affiliation: 'Professor of Biology, University of Example',
    impactAreas: [4, 1],
    riskLevel: 2,
    overallAssessment: 4,
  };
}

describe('reviewFormSchema definition', () => {
  test('parent-mapped fields have unique dataverseField mappings', () => {
    const dvFields = reviewFormSchema.fields
      .map((field) => field.dataverseField)
      .filter(Boolean);
    expect(new Set(dvFields).size).toBe(dvFields.length);
  });

  test('question fields carry no parent Dataverse mapping', () => {
    for (const field of reviewFormSchema.fields.filter((item) => item.key !== 'affiliation')) {
      expect(field.dataverseField).toBeUndefined();
    }
  });

  test('every question has a unique 1..11 order; affiliation has none', () => {
    const questions = reviewFormSchema.fields.filter((field) => field.key !== 'affiliation');
    const orders = questions.map((field) => field.order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(orders).size).toBe(orders.length);
    expect(reviewFormSchema.fields.find((field) => field.key === 'affiliation').order).toBeUndefined();
  });

  test('uses the frozen question keys and types', () => {
    expect(reviewFormSchema.fields.map(({ key, type }) => ({ key, type }))).toEqual([
      { key: 'affiliation', type: 'string' },
      { key: 'priorWork', type: 'richtext' },
      { key: 'foreseenImpacts', type: 'richtext' },
      { key: 'impactAreas', type: 'multiselect' },
      { key: 'riskLevel', type: 'picklist' },
      { key: 'riskDetail', type: 'richtext' },
      { key: 'methodsAppropriate', type: 'richtext' },
      { key: 'teamCapacity', type: 'richtext' },
      { key: 'questionsForPi', type: 'richtext' },
      { key: 'traditionalFunding', type: 'richtext' },
      { key: 'overallAssessment', type: 'picklist' },
      { key: 'additionalComments', type: 'richtext' },
    ]);
    expect(reviewFormSchema.fields.find((field) => field.key === 'additionalComments').required).toBe(false);
  });

  test('the multiselect and picklists do not offer an "Unable to answer" option', () => {
    for (const field of reviewFormSchema.fields.filter((item) => ['picklist', 'multiselect'].includes(item.type))) {
      expect(field.options.some((option) => option.value === 99 || /unable/i.test(option.label))).toBe(false);
    }
  });
});

describe('validateReviewForm — snapshot-child content', () => {
  test('missing required richtext answers do not fail parent/staff-path validation', () => {
    const result = validateReviewForm(valid());
    expect(result.ok).toBe(true);
    expect(result.dataverseValues.wmkf_revieweraffiliation).toBeDefined();
  });

  test('richtext values are ignored while ratings and multiselects use separate buckets', () => {
    const result = validateReviewForm({ ...valid(), priorWork: '<p>Prior work</p>' });
    expect(result.ok).toBe(true);
    expect(result.dataverseValues).toEqual({
      wmkf_revieweraffiliation: 'Professor of Biology, University of Example',
    });
    expect(result.ratings).toEqual({ riskLevel: 2, overallAssessment: 4 });
    expect(result.multiselects.impactAreas).toEqual({
      values: [1, 4],
      pairs: [
        { value: 1, label: 'Provide enabling tools to the community' },
        { value: 4, label: 'Revise textbooks' },
      ],
      answerText: 'Provide enabling tools to the community; Revise textbooks',
    });
  });
});

describe('validateReviewForm', () => {
  test('happy path canonicalizes affiliation, ratings, and multiselect values', () => {
    const result = validateReviewForm(valid());
    expect(result.ok).toBe(true);
    expect(result.dataverseValues).toEqual({
      wmkf_revieweraffiliation: 'Professor of Biology, University of Example',
    });
    expect(result.ratings).toEqual({ riskLevel: 2, overallAssessment: 4 });
    expect(result.multiselects.impactAreas.values).toEqual([1, 4]);
  });

  test('deduplicates repeated multiselect values in live option order', () => {
    const result = validateReviewForm({ ...valid(), impactAreas: [4, 1, 4, 2] });
    expect(result.ok).toBe(true);
    expect(result.multiselects.impactAreas.values).toEqual([1, 2, 4]);
  });

  test('rejects request-supplied multiselect labels and unknown values', () => {
    expect(validateReviewForm({ ...valid(), impactAreas: [{ value: 1, label: 'Forged' }] }).ok).toBe(false);
    expect(validateReviewForm({ ...valid(), impactAreas: [1, 999] }).ok).toBe(false);
  });

  test('rejects string and fractional multiselect values', () => {
    expect(validateReviewForm({ ...valid(), impactAreas: ['1'] }).ok).toBe(false);
    expect(validateReviewForm({ ...valid(), impactAreas: [1.5] }).ok).toBe(false);
  });

  test('rejects an empty required multiselect', () => {
    const result = validateReviewForm({ ...valid(), impactAreas: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/required/i);
  });

  test('trims whitespace from string fields', () => {
    const result = validateReviewForm({ ...valid(), affiliation: '   Trimmed   ' });
    expect(result.dataverseValues.wmkf_revieweraffiliation).toBe('Trimmed');
  });

  test('accepts clean numeric strings for picklists', () => {
    const result = validateReviewForm({ ...valid(), riskLevel: '3' });
    expect(result.ok).toBe(true);
    expect(result.ratings.riskLevel).toBe(3);
  });

  test('rejects malformed picklist values without parseInt truncation', () => {
    const result = validateReviewForm({ ...valid(), riskLevel: '3abc' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/whole number/);
  });

  test('rejects missing required snapshot fields', () => {
    const result = validateReviewForm({ affiliation: 'X' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test('rejects invalid affiliation values', () => {
    expect(validateReviewForm({ ...valid(), affiliation: '' }).ok).toBe(false);
    expect(validateReviewForm({ ...valid(), affiliation: '   ' }).ok).toBe(false);
    const tooLong = validateReviewForm({ ...valid(), affiliation: 'x'.repeat(301) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors[0]).toMatch(/300 characters/);
  });

  test('rejects out-of-domain and nonnumeric picklist values', () => {
    expect(validateReviewForm({ ...valid(), overallAssessment: 7 }).ok).toBe(false);
    expect(validateReviewForm({ ...valid(), riskLevel: -1 }).ok).toBe(false);
    expect(validateReviewForm({ ...valid(), riskLevel: 'somewhat' }).ok).toBe(false);
  });

  test('rejects null/undefined input', () => {
    expect(validateReviewForm(null).ok).toBe(false);
    expect(validateReviewForm(undefined).ok).toBe(false);
  });

  test('aggregates errors instead of bailing on the first', () => {
    const result = validateReviewForm({
      affiliation: '',
      impactAreas: [99],
      riskLevel: 'bad',
      overallAssessment: -1,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  describe('partial mode', () => {
    test('accepts entirely missing input', () => {
      expect(validateReviewForm({}, { partial: true })).toEqual({
        ok: true,
        dataverseValues: {},
        ratings: {},
        multiselects: {},
      });
      expect(validateReviewForm(null, { partial: true })).toEqual({
        ok: true,
        dataverseValues: {},
        ratings: {},
        multiselects: {},
      });
    });

    test('still validates present values', () => {
      expect(validateReviewForm({ riskLevel: 7 }, { partial: true }).ok).toBe(false);
      expect(validateReviewForm({ impactAreas: [999] }, { partial: true }).ok).toBe(false);
      expect(validateReviewForm({ impactAreas: '1' }, { partial: true }).ok).toBe(false);
    });

    test('treats an empty-string multiselect as absent', () => {
      expect(validateReviewForm({ impactAreas: '' }, { partial: true })).toEqual({
        ok: true,
        dataverseValues: {},
        ratings: {},
        multiselects: {},
      });
    });

    test('routes only provided rating and multiselect values', () => {
      expect(validateReviewForm({ overallAssessment: 4 }, { partial: true })).toEqual({
        ok: true,
        dataverseValues: {},
        ratings: { overallAssessment: 4 },
        multiselects: {},
      });
      const multiselect = validateReviewForm({ impactAreas: [2] }, { partial: true });
      expect(multiselect.ok).toBe(true);
      expect(multiselect.multiselects.impactAreas.values).toEqual([2]);
    });
  });
});

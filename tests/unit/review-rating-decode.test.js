/**
 * labelForReviewRating — decode for the Reviews-tab read surface. Must mirror
 * the exact option labels the form wrote (single source of truth) and return
 * null for absent or out-of-range values.
 */
import { labelForReviewRating, reviewRatingShortLabels } from '../../lib/external/review-form-schema';

test('decodes each rating field to its written label', () => {
  expect(labelForReviewRating('riskLevel', 2)).toBe('Medium risk (parts may succeed, others may fail)');
  expect(labelForReviewRating('overallAssessment', 5)).toBe('Excellent');
});

test('the removed "Unable to answer" sentinel (99) now decodes to null', () => {
  expect(labelForReviewRating('riskLevel', 99)).toBeNull();
  expect(labelForReviewRating('overallAssessment', 99)).toBeNull();
});

test('accepts string-numeric values (as they can arrive over the wire)', () => {
  expect(labelForReviewRating('riskLevel', '3')).toBe('High risk (significant risk of failure)');
});

test('returns null for absent values (never submitted)', () => {
  expect(labelForReviewRating('riskLevel', null)).toBeNull();
  expect(labelForReviewRating('riskLevel', undefined)).toBeNull();
  expect(labelForReviewRating('riskLevel', '')).toBeNull();
});

test('returns null for an out-of-range value or unknown field', () => {
  expect(labelForReviewRating('riskLevel', 999)).toBeNull();
  expect(labelForReviewRating('impact', 4)).toBeNull();
  expect(labelForReviewRating('bogusField', 1)).toBeNull();
});

test('short labels cover exactly the two structured ratings', () => {
  expect(reviewRatingShortLabels).toEqual({ riskLevel: 'Risk', overallAssessment: 'Overall' });
});

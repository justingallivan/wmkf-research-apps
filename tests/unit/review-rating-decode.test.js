/**
 * labelForReviewRating — decode for the Reviews-tab read surface. Must mirror
 * the exact option labels the form wrote (single source of truth) and return
 * null for absent or out-of-range values.
 */
import { labelForReviewRating, reviewRatingShortLabels } from '../../lib/external/review-form-schema';

test('decodes each rating field to its written label', () => {
  expect(labelForReviewRating('impact', 4)).toBe('Will rewrite textbooks');
  expect(labelForReviewRating('risk', 2)).toBe('Medium risk (parts may succeed, others may fail)');
  expect(labelForReviewRating('overallRating', 5)).toBe('Excellent');
});

test('the removed "Unable to answer" sentinel (99) now decodes to null', () => {
  expect(labelForReviewRating('impact', 99)).toBeNull();
  expect(labelForReviewRating('overallRating', 99)).toBeNull();
});

test('accepts string-numeric values (as they can arrive over the wire)', () => {
  expect(labelForReviewRating('impact', '3')).toBe('Will result in publications of broad interest');
});

test('returns null for absent values (never submitted)', () => {
  expect(labelForReviewRating('impact', null)).toBeNull();
  expect(labelForReviewRating('impact', undefined)).toBeNull();
  expect(labelForReviewRating('impact', '')).toBeNull();
});

test('returns null for an out-of-range value or unknown field', () => {
  expect(labelForReviewRating('impact', 999)).toBeNull();
  expect(labelForReviewRating('bogusField', 1)).toBeNull();
});

test('short labels cover the three structured ratings', () => {
  expect(reviewRatingShortLabels).toMatchObject({ impact: 'Impact', risk: 'Risk', overallRating: 'Overall' });
});

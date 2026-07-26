/**
 * @jest-environment node
 */

import {
  ReviewMultiselectError,
  canonicalizeMultiselectSelection,
} from '../../lib/external/review-multiselect.js';

const FIELD = {
  key: 'impactAreas',
  label: 'Impact areas',
  required: true,
  options: [
    { value: 1, label: 'One' },
    { value: 2, label: 'Two' },
    { value: 3, label: 'Three' },
  ],
};

describe('canonicalizeMultiselectSelection', () => {
  test('deduplicates and orders by the authoritative option list', () => {
    expect(canonicalizeMultiselectSelection(FIELD, [3, 1, 3])).toEqual({
      values: [1, 3],
      pairs: [
        { value: 1, label: 'One' },
        { value: 3, label: 'Three' },
      ],
      answerText: 'One; Three',
    });
  });

  test.each([
    ['not an array', '1'],
    ['a numeric string', ['1']],
    ['a fractional number', [1.5]],
    ['a request-supplied object', [{ value: 1, label: 'One' }]],
    ['an unknown numeric value', [99]],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalizeMultiselectSelection(FIELD, value))
      .toThrow(ReviewMultiselectError);
  });

  test('required empty is rejected while optional empty remains canonical', () => {
    expect(() => canonicalizeMultiselectSelection(FIELD, [])).toThrow(/required/i);
    expect(canonicalizeMultiselectSelection({ ...FIELD, required: false }, [])).toEqual({
      values: [],
      pairs: [],
      answerText: '',
    });
  });

  test('duplicate option configuration fails closed', () => {
    expect(() => canonicalizeMultiselectSelection({
      ...FIELD,
      options: [...FIELD.options, { value: 1, label: 'Duplicate' }],
    }, [1])).toThrow(/malformed configured options/i);
  });
});

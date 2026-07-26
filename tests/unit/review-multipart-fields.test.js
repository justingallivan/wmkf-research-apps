/**
 * @jest-environment node
 */

import { addReviewMultipartField } from '../../lib/external/review-multipart-fields';

describe('addReviewMultipartField', () => {
  test('preserves the historical scalar coercion contract', () => {
    const fields = {};
    addReviewMultipartField(fields, 'riskLevel', '3');
    addReviewMultipartField(fields, 'affiliation', 'Example University');
    addReviewMultipartField(fields, 'notInteger', '3.5');
    expect(fields).toEqual({
      riskLevel: 3,
      affiliation: 'Example University',
      notInteger: '3.5',
    });
  });

  test('accumulates repeated bracket fields as the numeric client array', () => {
    const fields = {};
    addReviewMultipartField(fields, 'impactAreas[]', '4');
    addReviewMultipartField(fields, 'impactAreas[]', '1');
    addReviewMultipartField(fields, 'impactAreas[]', '4');
    expect(fields).toEqual({ impactAreas: [4, 1, 4] });
  });

  test('fails closed on mixed scalar and array encodings', () => {
    const scalarFirst = { impactAreas: 1 };
    expect(() => addReviewMultipartField(scalarFirst, 'impactAreas[]', '2'))
      .toThrow(/mixed scalar and array/);

    const arrayFirst = {};
    addReviewMultipartField(arrayFirst, 'impactAreas[]', '2');
    expect(() => addReviewMultipartField(arrayFirst, 'impactAreas', '1'))
      .toThrow(/mixed scalar and array/);
  });
});

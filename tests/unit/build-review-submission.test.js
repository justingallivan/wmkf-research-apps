/**
 * validateReviewSubmission + buildReviewSubmission — final reviewer submit.
 */

import {
  validateReviewSubmission,
  buildReviewSubmission,
} from '../../lib/external/build-review-submission';
import { reviewFormSchema } from '../../lib/external/review-form-schema';

const RECEIVED_AT = '2026-06-28T12:00:00.000Z';
const RUNTIME_SET = reviewFormSchema.fields.map((field) => {
  const { dataverseField, ...rest } = field;
  return { ...rest, order: typeof field.order === 'number' ? field.order : 0 };
});

function validInput(overrides = {}) {
  return {
    affiliation: '  Professor of Physics, Example University  ',
    priorWork: '<p>Existing work is narrower.</p>',
    foreseenImpacts: '<p>Significant impact on the field.</p>',
    impactAreas: [4, 1, 4],
    riskLevel: 2,
    riskDetail: '<p>Technical risks around instrument build.</p>',
    methodsAppropriate: '<p>Methods are appropriate.</p>',
    teamCapacity: '<p>Strong team.</p>',
    questionsForPi: '<p>How will scale-up work?</p>',
    traditionalFunding: '<p>Unlikely to be funded elsewhere.</p>',
    overallAssessment: 4,
    additionalComments: '',
    ...overrides,
  };
}

describe('validateReviewSubmission', () => {
  test('normalizes the complete frozen question set', () => {
    const result = validateReviewSubmission(validInput());
    expect(result.ok).toBe(true);
    expect(result.normalized.affiliation).toBe('Professor of Physics, Example University');
    expect(result.normalized.riskLevel).toBe(2);
    expect(result.normalized.overallAssessment).toBe(4);
    expect(result.normalized.impactAreas).toEqual({
      values: [1, 4],
      pairs: [
        { value: 1, label: 'Provide enabling tools to the community' },
        { value: 4, label: 'Revise textbooks' },
      ],
      answerText: 'Provide enabling tools to the community; Revise textbooks',
    });
    expect(result.normalized.additionalComments).toBe('');
  });

  test('coerces clean numeric-string ratings but rejects malformed values', () => {
    expect(validateReviewSubmission(validInput({ riskLevel: '2 ' })).normalized.riskLevel).toBe(2);
    expect(validateReviewSubmission(validInput({ riskLevel: '2abc' })).ok).toBe(false);
    expect(validateReviewSubmission(validInput({ riskLevel: '2.5' })).ok).toBe(false);
  });

  test('rejects unknown or request-labelled multiselect values', () => {
    expect(validateReviewSubmission(validInput({ impactAreas: [99] })).ok).toBe(false);
    expect(validateReviewSubmission(validInput({
      impactAreas: [{ value: 1, label: 'Forged' }],
    })).ok).toBe(false);
  });

  test('rejects required richtext that is structurally empty', () => {
    const result = validateReviewSubmission(validInput({ priorWork: '<p><br></p>' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Q1.*required/);
  });

  test('allows empty optional additional comments', () => {
    expect(validateReviewSubmission(validInput({ additionalComments: '<p></p>' })).ok).toBe(true);
    expect(validateReviewSubmission(validInput({ additionalComments: undefined })).ok).toBe(true);
  });

  test('rejects invalid, missing, and out-of-domain required fields', () => {
    expect(validateReviewSubmission(validInput({ riskLevel: null })).ok).toBe(false);
    expect(validateReviewSubmission(validInput({ overallAssessment: 6 })).ok).toBe(false);
    expect(validateReviewSubmission(validInput({ impactAreas: [] })).ok).toBe(false);
    const emptyMultiselect = validateReviewSubmission(validInput({ impactAreas: '' }));
    expect(emptyMultiselect.ok).toBe(false);
    expect(emptyMultiselect.errors.join(' ')).toMatch(/Q3.*required/);
    expect(validateReviewSubmission(validInput({ affiliation: '   ' })).ok).toBe(false);
  });

  test('enforces richtext maxLength on sanitized HTML', () => {
    const result = validateReviewSubmission(validInput({
      foreseenImpacts: `<p>${'a'.repeat(50001)}</p>`,
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/max 50000 characters/);
  });

  test('rejects non-object input', () => {
    expect(validateReviewSubmission(null).ok).toBe(false);
    expect(validateReviewSubmission('x').ok).toBe(false);
    expect(validateReviewSubmission([]).ok).toBe(false);
  });
});

describe('buildReviewSubmission', () => {
  function build(overrides, questionSet = reviewFormSchema.fields) {
    const validated = validateReviewSubmission(validInput(overrides), questionSet);
    expect(validated.ok).toBe(true);
    return buildReviewSubmission(validated.normalized, { receivedAt: RECEIVED_AT, questionSet });
  }

  test('keeps only affiliation and receipt lifecycle on the parent row', () => {
    expect(build().parentPatch).toEqual({
      wmkf_reviewreceivedat: RECEIVED_AT,
      wmkf_reviewstatus: 100000003,
      wmkf_revieweraffiliation: 'Professor of Physics, Example University',
    });
  });

  test('emits exactly eleven ordered answer rows using the frozen keys', () => {
    const { answerRows } = build();
    expect(answerRows).toHaveLength(11);
    expect(answerRows.map((row) => row.questionOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(answerRows.map((row) => row.questionKey)).toEqual([
      'priorWork',
      'foreseenImpacts',
      'impactAreas',
      'riskLevel',
      'riskDetail',
      'methodsAppropriate',
      'teamCapacity',
      'questionsForPi',
      'traditionalFunding',
      'overallAssessment',
      'additionalComments',
    ]);
  });

  test('stores canonical multiselect pairs, fallback text, and no numeric scalar', () => {
    const row = build().answerRows.find((answer) => answer.questionKey === 'impactAreas');
    expect(row).toMatchObject({
      questionType: 'multiselect',
      answerValue: null,
      answerValues: [
        { value: 1, label: 'Provide enabling tools to the community' },
        { value: 4, label: 'Revise textbooks' },
      ],
      answerText: 'Provide enabling tools to the community; Revise textbooks',
      answerHtml: null,
    });
  });

  test('stores rating labels and richtext plain-text renditions', () => {
    const { answerRows } = build();
    expect(answerRows.find((row) => row.questionKey === 'riskLevel')).toMatchObject({
      answerValue: 2,
      answerText: 'Medium risk (parts may succeed, others may fail)',
      answerValues: null,
    });
    expect(answerRows.find((row) => row.questionKey === 'foreseenImpacts')).toMatchObject({
      answerHtml: '<p>Significant impact on the field.</p>',
      answerText: 'Significant impact on the field.',
      answerValue: null,
      answerValues: null,
    });
  });

  test('emits an empty optional row for a complete historical snapshot', () => {
    expect(build({ additionalComments: '<p></p>' }).answerRows.find(
      (row) => row.questionKey === 'additionalComments',
    )).toMatchObject({
      questionOrder: 11,
      answerHtml: '',
      answerText: '',
      answerValue: null,
      answerValues: null,
    });
  });

  test('backstops required inputs at the producer boundary', () => {
    const { normalized } = validateReviewSubmission(validInput());
    expect(() => buildReviewSubmission(normalized, {})).toThrow(/receivedAt/);
    expect(() => buildReviewSubmission(null, { receivedAt: RECEIVED_AT })).toThrow(/normalized object required/);
    expect(() => buildReviewSubmission(
      { ...normalized, impactAreas: [1] },
      { receivedAt: RECEIVED_AT },
    )).toThrow(/canonical multiselect/);
    expect(() => buildReviewSubmission(
      { ...normalized, riskLevel: 99 },
      { receivedAt: RECEIVED_AT },
    )).toThrow(/not in the live picklist domain/);
    expect(() => buildReviewSubmission(
      { ...normalized, overallAssessment: null },
      { receivedAt: RECEIVED_AT },
    )).toThrow(/exactly 2 core rating rows/);
  });

  test('Dataverse-loaded and static question sets produce identical output', () => {
    const staticValidated = validateReviewSubmission(validInput());
    const runtimeValidated = validateReviewSubmission(validInput(), RUNTIME_SET);
    expect(runtimeValidated).toEqual(staticValidated);
    expect(buildReviewSubmission(runtimeValidated.normalized, {
      receivedAt: RECEIVED_AT,
      questionSet: RUNTIME_SET,
    })).toEqual(buildReviewSubmission(staticValidated.normalized, {
      receivedAt: RECEIVED_AT,
    }));
  });

  test('runtime affiliation order 0 does not create an answer row', () => {
    const output = build(undefined, RUNTIME_SET);
    expect(output.answerRows.some((row) => row.questionKey === 'affiliation')).toBe(false);
    expect(output.answerRows).toHaveLength(11);
  });
});

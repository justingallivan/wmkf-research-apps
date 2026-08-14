/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  default as ReviewAuthoringForm,
  buildInitialValues,
  isComplete,
  ReviewQuestionFields,
} from '../../shared/components/external/ReviewAuthoringForm';
import { reviewFormSchema } from '../../lib/external/review-form-schema';

afterEach(() => {
  jest.restoreAllMocks();
});

test('external reviewer authoring selects the compact six-button toolbar', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, draftJson: {} }),
  });
  render(
    <ReviewAuthoringForm
      data={{
        questions: [{
          key: 'comments',
          label: 'Scientific assessment',
          type: 'richtext',
          required: true,
        }],
        questionSetVersion: 'set-v1',
        prefill: {},
      }}
      token="review-token"
      onSubmitted={jest.fn()}
    />,
  );

  const toolbar = await screen.findByRole('toolbar', { name: 'Review formatting' });
  expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);
});

describe('ReviewAuthoringForm multiselect reconciliation', () => {
  test('hydrates numeric live values only, deduplicated in option order', () => {
    const values = buildInitialValues(reviewFormSchema.fields, {}, {
      impactAreas: [4, '1', 999, 1, 4, 2.5],
    });
    expect(values.impactAreas).toEqual([1, 4]);
  });

  test('wrong-shape historical values are discarded without leaking into controls', () => {
    const values = buildInitialValues(reviewFormSchema.fields, {
      riskLevel: 2,
      overallAssessment: 4,
    }, {
      impactAreas: { value: 1, label: 'Forged' },
      riskLevel: '<p>old richtext</p>',
      foreseenImpacts: 3,
    });
    expect(values.impactAreas).toEqual([]);
    expect(values.riskLevel).toBe(2);
    expect(values.foreseenImpacts).toBe('');
  });

  test('a required multiselect must contain at least one value for submit gating', () => {
    const complete = buildInitialValues(reviewFormSchema.fields, {
      affiliation: 'Example University',
    }, {
      priorWork: '<p>a</p>',
      foreseenImpacts: '<p>a</p>',
      impactAreas: [1],
      riskLevel: 2,
      riskDetail: '<p>a</p>',
      methodsAppropriate: '<p>a</p>',
      teamCapacity: '<p>a</p>',
      questionsForPi: '<p>a</p>',
      traditionalFunding: '<p>a</p>',
      overallAssessment: 4,
    });
    expect(isComplete(reviewFormSchema.fields, complete)).toBe(true);
    expect(isComplete(reviewFormSchema.fields, { ...complete, impactAreas: [] })).toBe(false);
  });

  test('renders native checkboxes with connected required guidance and canonical toggles', () => {
    const onChange = jest.fn();
    const field = reviewFormSchema.fields.find((candidate) => candidate.key === 'impactAreas');
    render(
      <ReviewQuestionFields
        fields={[field]}
        values={{ impactAreas: [] }}
        onChange={onChange}
      />,
    );

    const group = screen.getByRole('group', { name: field.label });
    const requiredGuidance = screen.getByText('Choose at least one option.');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAttribute('aria-describedby', requiredGuidance.id);

    fireEvent.click(screen.getByRole('checkbox', { name: field.options[1].label }));
    expect(onChange).toHaveBeenCalledWith('impactAreas', [field.options[1].value]);
  });
});

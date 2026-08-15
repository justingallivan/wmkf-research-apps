/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react';
import ManualReviewEntryForm from '../../shared/components/workbench/ManualReviewEntryForm';

afterEach(() => {
  jest.restoreAllMocks();
});

test('staff manual review entry uses the compact rich-text toolbar', async () => {
  const question = {
    key: 'scientificAssessment',
    order: 1,
    label: 'Scientific assessment',
    type: 'richtext',
    required: true,
    maxLength: 50000,
  };
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      questions: [question],
      setVersion: 'set-v1',
      affiliation: 'Example University',
    }),
  });

  render(
    <ManualReviewEntryForm
      reviewer={{ suggestionId: '00000000-0000-0000-0000-000000000001', name: 'Reviewer One' }}
      onCancel={jest.fn()}
      onSubmitted={jest.fn()}
    />,
  );

  const toolbar = await screen.findByRole('toolbar', { name: 'Question 1 formatting' });
  expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);
});

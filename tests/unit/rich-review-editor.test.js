/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { getSchema } from '@tiptap/core';
import RichReviewEditor, {
  RICH_REVIEW_EXTENSIONS,
} from '../../shared/components/external/RichReviewEditor';

test('compact reviewer toolbar matches the caption formatting controls', async () => {
  render(
    <RichReviewEditor
      value="<p><em>Escherichia coli</em> and H<sub>2</sub>O</p>"
      onChange={jest.fn()}
      ariaLabel="Scientific assessment"
      toolbarVariant="compact"
    />,
  );

  const toolbar = await screen.findByRole('toolbar', { name: 'Review formatting' });
  expect(toolbar).toHaveClass('flex-wrap');
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);
  expect(screen.getByRole('textbox', { name: 'Scientific assessment' })).toHaveTextContent(
    'Escherichia coli and H2O',
  );
});

test('full toolbar remains available to the staff rescue form by default', async () => {
  render(<RichReviewEditor value="<p>Review</p>" onChange={jest.fn()} ariaLabel="Manual review" />);

  await screen.findByRole('toolbar', { name: 'Review formatting' });
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Quote', 'Link',
  ]);
});

test('review subscript and superscript exclude one another at the schema level', () => {
  const schema = getSchema(RICH_REVIEW_EXTENSIONS);
  expect(schema.marks.subscript.excludes(schema.marks.superscript)).toBe(true);
  expect(schema.marks.superscript.excludes(schema.marks.subscript)).toBe(true);
});

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
      toolbarLabel="Scientific assessment formatting"
      toolbarVariant="compact"
    />,
  );

  const toolbar = await screen.findByRole('toolbar', { name: 'Scientific assessment formatting' });
  expect(toolbar).toHaveClass('flex-wrap');
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);
  expect(screen.getByRole('textbox', { name: 'Scientific assessment' })).toHaveTextContent(
    'Escherichia coli and H2O',
  );
});

test('compact mode retains historical structural HTML in the shared schema', async () => {
  render(
    <RichReviewEditor
      value="<h2>Prior heading</h2><ul><li>Prior item</li></ul>"
      onChange={jest.fn()}
      ariaLabel="Historical review"
      toolbarVariant="compact"
    />,
  );

  const editor = await screen.findByRole('textbox', { name: 'Historical review' });
  expect(editor.querySelector('h2')).toHaveTextContent('Prior heading');
  expect(editor.querySelector('ul li')).toHaveTextContent('Prior item');
});

test('an unknown toolbar variant fails closed to the compact controls', async () => {
  render(
    <RichReviewEditor
      value="<p>Review</p>"
      onChange={jest.fn()}
      ariaLabel="Review"
      toolbarVariant="unexpected"
    />,
  );

  await screen.findByRole('toolbar', { name: 'Review formatting' });
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);
});

test('full toolbar remains available when the staff rescue form requests it', async () => {
  render(
    <RichReviewEditor
      value="<p>Review</p>"
      onChange={jest.fn()}
      ariaLabel="Manual review"
      toolbarVariant="full"
    />,
  );

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

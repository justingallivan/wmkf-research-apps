/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSchema } from '@tiptap/core';
import GranteeAbstractEditor, {
  GRANTEE_ABSTRACT_EXTENSIONS,
} from '../../shared/components/external/GranteeAbstractEditor';

const baseProps = {
  value: '*Escherichia coli* study',
  htmlValue: '<p><em>Escherichia coli</em> study</p>',
  onChange: jest.fn(),
  ariaLabel: 'Abstract',
  required: true,
};

beforeEach(() => {
  baseProps.onChange.mockReset();
});

test('renders only the allowed responsive toolbar and accessible editable region without emitting on load', async () => {
  render(<GranteeAbstractEditor {...baseProps} />);

  const toolbar = await screen.findByRole('toolbar', { name: 'Abstract formatting' });
  expect(toolbar).toHaveClass('flex-wrap');
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Bold', 'Italic', 'Subscript', 'Superscript', 'Undo', 'Redo',
  ]);

  const editor = screen.getByRole('textbox', { name: 'Abstract' });
  expect(editor).toHaveAttribute('aria-required', 'true');
  expect(editor).toHaveAttribute('aria-invalid', 'false');
  expect(editor).toHaveAttribute('aria-readonly', 'false');
  expect(editor).toHaveTextContent('Escherichia coli study');
  expect(screen.getByText(/characters remaining/i)).toBeInTheDocument();
  expect(baseProps.onChange).not.toHaveBeenCalled();
});

test('caption mode reuses the same formatting controls with a compact editor', async () => {
  render(
    <GranteeAbstractEditor
      value="*Escherichia coli* image"
      htmlValue="<em>Escherichia coli</em> image"
      onChange={jest.fn()}
      ariaLabel="Image caption"
      toolbarLabel="Caption formatting"
      maxLength={2000}
      compact
    />,
  );

  expect(await screen.findByRole('toolbar', { name: 'Caption formatting' })).toBeInTheDocument();
  const editor = screen.getByRole('textbox', { name: 'Image caption' });
  expect(editor).toHaveClass('min-h-[6rem]');
  expect(editor).toHaveTextContent('Escherichia coli image');
  expect(editor.querySelector('em')).toHaveTextContent('Escherichia coli');
  expect(screen.getByText(/1,976 characters remaining/i)).toBeInTheDocument();
});

test('server-driven reseed replaces visible content without reporting a user edit', async () => {
  const { rerender } = render(<GranteeAbstractEditor {...baseProps} />);
  const editor = await screen.findByRole('textbox', { name: 'Abstract' });
  expect(editor).toHaveTextContent('Escherichia coli study');

  rerender(
    <GranteeAbstractEditor
      {...baseProps}
      value="**Updated server abstract**"
      htmlValue="<p><strong>Updated server abstract</strong></p>"
    />,
  );

  await waitFor(() => expect(editor).toHaveTextContent('Updated server abstract'));
  expect(baseProps.onChange).not.toHaveBeenCalled();
});

test('over-limit and read-only states are explicit and block every toolbar action', async () => {
  render(
    <GranteeAbstractEditor
      {...baseProps}
      value="123456"
      htmlValue="<p>123456</p>"
      maxLength={5}
      disabled
      invalid
    />,
  );

  const editor = await screen.findByRole('textbox', { name: 'Abstract' });
  expect(editor).toHaveAttribute('contenteditable', 'false');
  expect(editor).toHaveAttribute('aria-readonly', 'true');
  expect(editor).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('1 characters over the 5 character limit');
  screen.getAllByRole('button').forEach((button) => expect(button).toBeDisabled());
});

test('subscript and superscript exclude one another at the schema level', () => {
  const schema = getSchema(GRANTEE_ABSTRACT_EXTENSIONS);
  expect(schema.marks.subscript.excludes(schema.marks.superscript)).toBe(true);
  expect(schema.marks.superscript.excludes(schema.marks.subscript)).toBe(true);
});

test('selection-preserving toolbar click emits canonical Markdown and parent echo does not reseed', async () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <GranteeAbstractEditor
      value="Escherichia coli"
      htmlValue="<p>Escherichia coli</p>"
      onChange={onChange}
      ariaLabel="Abstract"
    />,
  );
  const editor = await screen.findByRole('textbox', { name: 'Abstract' });
  fireEvent.focus(editor);
  fireEvent.keyDown(editor, { key: 'a', code: 'KeyA', ctrlKey: true });

  fireEvent.mouseDown(screen.getByRole('button', { name: 'Italic' }));
  fireEvent.click(screen.getByRole('button', { name: 'Italic' }));

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange).toHaveBeenLastCalledWith('*Escherichia coli*');
  expect(editor.querySelector('em')).toHaveTextContent('Escherichia coli');

  // The parent updates Markdown immediately, while htmlValue remains the
  // original server seed until a real server reload. This echo must not reset
  // the editor or caret to the old unformatted HTML.
  rerender(
    <GranteeAbstractEditor
      value="*Escherichia coli*"
      htmlValue="<p>Escherichia coli</p>"
      onChange={onChange}
      ariaLabel="Abstract"
    />,
  );
  expect(editor.querySelector('em')).toHaveTextContent('Escherichia coli');
});

test('pasted unsupported structure keeps text and allowed marks while emitting only canonical Markdown', async () => {
  const onChange = jest.fn();
  render(
    <GranteeAbstractEditor
      value=""
      htmlValue="<p></p>"
      onChange={onChange}
      ariaLabel="Abstract"
    />,
  );
  const editor = await screen.findByRole('textbox', { name: 'Abstract' });
  fireEvent.focus(editor);
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type) => (type === 'text/html'
        ? '<h2>Heading</h2><ul><li><em>Escherichia coli</em></li><li><a href="https://example.com">linked words</a></li></ul>'
        : 'Heading\nEscherichia coli\nlinked words'),
      types: ['text/html', 'text/plain'],
      files: [],
    },
  });

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const markdown = onChange.mock.calls.at(-1)[0];
  expect(markdown).toContain('Heading');
  expect(markdown).toContain('*Escherichia coli*');
  expect(markdown).toContain('linked words');
  expect(markdown).not.toMatch(/<|>|\]\(/);
});

test('external HTML drop follows the same text-preserving restricted contract', async () => {
  const onChange = jest.fn();
  render(
    <GranteeAbstractEditor
      value=""
      htmlValue="<p></p>"
      onChange={onChange}
      ariaLabel="Abstract"
    />,
  );
  const editor = await screen.findByRole('textbox', { name: 'Abstract' });
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => editor;
  fireEvent.drop(editor, {
    clientX: 0,
    clientY: 0,
    dataTransfer: {
      getData: (type) => (type === 'text/html'
        ? '<table><tr><td><strong>Result</strong></td><td>42</td></tr></table>'
        : 'Result 42'),
    },
  });
  document.elementFromPoint = originalElementFromPoint;

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const markdown = onChange.mock.calls.at(-1)[0];
  expect(markdown).toContain('**Result**');
  expect(markdown).toContain('42');
  expect(markdown).not.toContain('<table>');
});

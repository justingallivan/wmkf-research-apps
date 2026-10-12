/**
 * @jest-environment jsdom
 *
 * Shared Button `variant="link"`: the quiet underlined text action (Site Visit redesign plan §10, the
 * card's former BTN_LINK string). It takes no padding, background or size scale from the boxed variants.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../shared/components/Layout';

const classesOf = (element) => element.className.split(/\s+/).filter(Boolean);

test('renders an underlined text action without the boxed button chrome', () => {
  render(<Button variant="link" size="sm" type="button">Upload manually</Button>);
  const classes = classesOf(screen.getByRole('button', { name: 'Upload manually' }));
  expect(classes).toEqual(expect.arrayContaining([
    'text-sm', 'font-medium', 'text-gray-700', 'underline', 'underline-offset-2', 'hover:text-gray-950',
    'focus:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-blue-600',
    'disabled:cursor-not-allowed', 'disabled:opacity-50',
  ]));
  for (const boxed of ['px-3', 'py-2', 'rounded-lg', 'font-semibold', 'inline-flex', 'border', 'bg-white', 'hover:bg-gray-400', 'focus:ring-offset-2']) {
    expect(classes).not.toContain(boxed);
  }
});

test('passes props and extra classes through, and disables while disabled or loading', () => {
  const onClick = jest.fn();
  const { rerender } = render(<Button variant="link" type="button" onClick={onClick} aria-expanded={false} className="mt-3">Try again</Button>);
  const button = screen.getByRole('button', { name: 'Try again' });
  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(classesOf(button)).toContain('mt-3');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);

  rerender(<Button variant="link" type="button" onClick={onClick} disabled>Try again</Button>);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  rerender(<Button variant="link" type="button" onClick={onClick} loading>Try again</Button>);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
});

test('the boxed variants are unchanged', () => {
  render(<Button variant="outline" size="sm" type="button">Retry</Button>);
  const classes = classesOf(screen.getByRole('button', { name: 'Retry' }));
  expect(classes).toEqual(expect.arrayContaining(['rounded-lg', 'px-3', 'py-2', 'text-sm', 'border', 'border-gray-300', 'bg-white']));
  expect(classes).not.toContain('underline');
});

/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import ArtifactRow from '../../shared/components/meeting-tracker/ArtifactRow';

const renderRow = (props) => render(<ul><ArtifactRow name="Presentation summary" testId="row" {...props} /></ul>);

test('the name is the link and opens in a new tab; there is no separate Open control', () => {
  renderRow({ href: 'https://example.sharepoint.com/summary.docx', status: { tone: 'green', label: 'Published' }, detail: 'Oct 10, 5:35 PM' });
  const link = screen.getByRole('link', { name: 'Presentation summary' });
  expect(link).toHaveAttribute('href', 'https://example.sharepoint.com/summary.docx');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByTestId('row')).toHaveTextContent('PublishedOct 10, 5:35 PM');
  expect(screen.queryByRole('link', { name: /^Open/ })).toBeNull();
});

test('without an href the name is plain text', () => {
  renderRow({ status: { tone: 'gray', label: 'Not made yet' } });
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByTestId('row')).toHaveTextContent('Presentation summaryNot made yet');
});

test('the menu appears only when it has items, and a disabled item stays listed', () => {
  const { unmount } = renderRow({});
  expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  unmount();
  const onSelect = jest.fn();
  renderRow({ menuItems: [
    { key: 'again', label: 'Summarize again', onSelect },
    { key: 'off', label: 'Replace · not available', disabled: true },
  ] });
  fireEvent.click(within(screen.getByTestId('row')).getByRole('button', { name: 'More actions for presentation summary' }));
  expect(screen.getByRole('menuitem', { name: 'Replace · not available' })).toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Summarize again' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('an inline action and children render inside the row', () => {
  renderRow({ action: <button type="button">Summarize</button>, children: <p>Confirmation</p> });
  const row = screen.getByTestId('row');
  expect(within(row).getByRole('button', { name: 'Summarize' })).toBeInTheDocument();
  expect(within(row).getByText('Confirmation')).toBeInTheDocument();
});

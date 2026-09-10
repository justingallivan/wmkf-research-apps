/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import OverflowMenu from '../../shared/components/workbench/OverflowMenu';

test('renders nothing without items, and a portalled menu with links and buttons that closes on select, Escape, and outside click', () => {
  const { container, rerender } = render(<OverflowMenu label="More actions" items={[]} />);
  expect(container).toBeEmptyDOMElement();

  const onSelect = jest.fn();
  rerender(
    <OverflowMenu
      label="More actions"
      items={[
        { key: 'download', label: 'Download', href: 'https://sp.test/doc.docx?download=1', download: 'doc.docx' },
        { key: 'regen', label: 'Regenerate', onSelect },
        { key: 'off', label: 'Disabled item', onSelect: jest.fn(), disabled: true },
        null,
      ]}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'More actions' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  const menu = screen.getByRole('menu', { name: 'More actions' });
  // Portalled: the menu is not inside the trigger's container.
  expect(container.contains(menu)).toBe(false);
  expect(screen.getByRole('menuitem', { name: 'Download' })).toHaveAttribute('download', 'doc.docx');
  expect(screen.getByRole('menuitem', { name: 'Disabled item' })).toBeDisabled();

  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('a disabled trigger never opens', () => {
  render(<OverflowMenu label="More actions" disabled items={[{ key: 'a', label: 'A', onSelect: jest.fn() }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import DataverseBulkExport from '../../pages/dataverse-bulk-export';
import PhaseIDynamics from '../../pages/phase-i-dynamics';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: () => <button type="button">mock-upload</button>,
}));

test('Dataverse bulk export renders the real ErrorAlert for a metadata failure', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ statuses: [], programs: [] }) })
    .mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('gateway HTML'); } });
  render(<DataverseBulkExport />);
  fireEvent.click(await screen.findByRole('button', { name: /Preview \(true count/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show details' }));
  expect(await screen.findByText('gateway HTML')).toBeInTheDocument();
});

test('Phase I Dynamics renders the real ErrorAlert for a lookup failure', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Lookup unavailable' }),
  }));
  render(<PhaseIDynamics />);
  fireEvent.change(screen.getByPlaceholderText('e.g. 1002807'), { target: { value: '1002807' } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show details' }));
  expect(await screen.findByText('Lookup unavailable')).toBeInTheDocument();
});

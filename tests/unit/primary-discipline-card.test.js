/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PrimaryDiscipline from '../../shared/components/workbench/PrimaryDiscipline';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  Button: ({ children, loading, variant, size, ...props }) => <button {...props}>{children}</button>,
}));

const GLACIOLOGY = 'e94bd184-a1e3-f111-84ea-6045bd04539e';
const PALEO = 'ea4bd184-a1e3-f111-84ea-6045bd04539e';
const read = (current) => ({
  success: true, version: 'W/"5"', canEdit: true, current,
  options: [
    { id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science', group: 'Earth and Environmental Sciences' },
    { id: PALEO, name: 'Paleoclimatology', group: 'Earth and Environmental Sciences' },
  ],
});
beforeEach(() => jest.resetAllMocks());

test('shows the current discipline and Claude’s pick when they differ, never the ids', async () => {
  requestJson.mockResolvedValue(read({ id: PALEO, name: 'Paleoclimatology' }));
  const { container } = render(<PrimaryDiscipline requestId="r1" claudePrimary="Glaciology and Cryospheric Science" />);
  expect(await screen.findByText('Paleoclimatology')).toBeInTheDocument();
  expect(screen.getByText('Claude suggested: Glaciology and Cryospheric Science')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/e94bd184|ea4bd184/);
});

test('change saves the chosen discipline with the version, then shows it', async () => {
  requestJson.mockResolvedValueOnce(read({ id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science' }))
    .mockResolvedValueOnce({ ...read({ id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science' }), version: 'W/"6"' })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce(read({ id: PALEO, name: 'Paleoclimatology' }));
  render(<PrimaryDiscipline requestId="r1" claudePrimary="Glaciology and Cryospheric Science" claudeRunnerUp="Paleoclimatology" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change primary discipline' }));
  expect(await screen.findByRole('group', { name: 'Suggested by Claude' })).toBeInTheDocument();
  expect(screen.getByText(/Proposal lists built after you save/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Primary discipline'), { target: { value: PALEO } });
  fireEvent.click(screen.getByText('Save discipline'));
  await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(4));
  // Change re-reads the request with the list, so the save uses the fresh version.
  expect(requestJson.mock.calls[1][0]).toBe('/api/workbench/primary-discipline?requestId=r1&options=1');
  expect(requestJson.mock.calls[2]).toEqual(['/api/workbench/primary-discipline', { method: 'PATCH', body: { requestId: 'r1', version: 'W/"6"', disciplineId: PALEO } }]);
  expect(await screen.findByText('Saved.')).toBeInTheDocument();
  expect(screen.getByText('Paleoclimatology')).toBeInTheDocument();
});

test('a conflict keeps the editor and offers a reload', async () => {
  requestJson.mockResolvedValueOnce(read({ id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science' }))
    .mockResolvedValueOnce(read({ id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science' }))
    .mockRejectedValueOnce(new Error('The request changed.'));
  render(<PrimaryDiscipline requestId="r1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change primary discipline' }));
  fireEvent.change(await screen.findByLabelText('Primary discipline'), { target: { value: PALEO } });
  fireEvent.click(screen.getByText('Save discipline'));
  expect(await screen.findByText('The request changed.')).toBeInTheDocument();
  expect(screen.getByLabelText('Primary discipline')).toBeInTheDocument();
  expect(screen.getByText('Reload')).toBeInTheDocument();
});

test('no Change button when the staff member cannot edit', async () => {
  requestJson.mockResolvedValue({ ...read(null), canEdit: false });
  render(<PrimaryDiscipline requestId="r1" />);
  expect(await screen.findByText('Not set')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change primary discipline' })).toBeNull();
});

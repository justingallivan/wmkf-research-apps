import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppAccess } from '../../shared/context/AppAccessContext';
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: jest.fn(() => ({ isSuperuser: false })) }));
import StaffingPanel from '../../shared/components/staffing/StaffingPanel';
jest.mock('../../shared/components/admin/FinalWriteupMatrixAudiencesSection', () => function MockFinalWriteupEditor() { return <div>Existing publication editor</div>; });
const snapshot = { isSuperuser: false, staff: [{ systemUserId: 'one', name: 'First Person', canUseWorkbench: true }, { systemUserId: 'two', name: 'Second Person', canUseWorkbench: true }], roles: Object.fromEntries(['president', 'cso', 'grantsManager', 'programCoordinator', 'systemsSpecialist'].map(role => [role, { value: { version: 1, systemUserId: 'one' }, revision: `${role}-old` }])) };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => useAppAccess.mockReturnValue({ isSuperuser: false }));
afterEach(() => jest.restoreAllMocks());
test('Grants Manager saves one role with its revision and sees no Admin editors', async () => {
  global.fetch = jest.fn(async (_url, options) => response(options.method === 'POST' ? { value: { version: 1, systemUserId: 'two' }, revision: 'new' } : snapshot));
  render(<StaffingPanel />);
  fireEvent.change(await screen.findByLabelText('President'), { target: { value: 'two' } });
  expect(await screen.findByText('Assignment saved.')).toBeTruthy();
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ role: 'president', value: { version: 1, systemUserId: 'two' }, expectedRevision: 'president-old' });
  expect(screen.getByLabelText('President').value).toBe('two');
  expect(screen.getByLabelText('CSO').value).toBe('one');
  expect(screen.queryByText('Existing publication editor')).toBeNull();
});
test('failed save retains choice for retry; reload obtains a fresh revision', async () => {
  let revision = 'president-old';
  global.fetch = jest.fn(async (_url, options) => options.method === 'POST' ? response({ error: 'Changed by another person. Reload first.' }, 409) : response({ ...snapshot, roles: { ...snapshot.roles, president: { ...snapshot.roles.president, revision } } }));
  render(<StaffingPanel />);
  fireEvent.change(await screen.findByLabelText('President'), { target: { value: 'two' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Changed by another person');
  expect(screen.getByLabelText('President').value).toBe('two');
  fireEvent.click(screen.getByText('Retry assignment'));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(2));
  revision = 'fresh';
  await screen.findByText('Retry assignment');
  fireEvent.click(screen.getByText('Reload assignments'));
  await waitFor(() => expect(screen.getByLabelText('President').value).toBe('one'));
  fireEvent.change(screen.getByLabelText('President'), { target: { value: 'two' } });
  await screen.findByText('Retry assignment');
  expect(JSON.parse(global.fetch.mock.calls.at(-1)[1].body).expectedRevision).toBe('fresh');
});
test('Admin publication editor remains available if shared role loading fails', async () => {
  useAppAccess.mockReturnValue({ isSuperuser: true });
  global.fetch = jest.fn(async () => response({ error: 'Shared settings unavailable' }, 500));
  render(<StaffingPanel includeFinalWriteups />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Shared settings unavailable');
  expect(screen.getByText('Existing publication editor')).toBeTruthy();
});
test('departing Grants Manager must pass authorization again before another edit', async () => {
  let departed = false;
  global.fetch = jest.fn(async (_url, options) => {
    if (options.method === 'POST') { departed = true; return response({ value: { version: 1, systemUserId: 'two' }, revision: 'new' }); }
    return departed ? response({ error: 'Setup manager required' }, 403) : response(snapshot);
  });
  render(<StaffingPanel />);
  fireEvent.change(await screen.findByLabelText('Grants Manager'), { target: { value: 'two' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup manager required');
  expect(screen.queryByLabelText('President')).toBeNull();
});
test('late load cannot update an unmounted editor', async () => {
  let resolve;
  global.fetch = jest.fn(() => new Promise(r => { resolve = r; }));
  const { unmount } = render(<StaffingPanel />);
  const signal = global.fetch.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response(snapshot)));
});
test('another successful role save cannot hide a failed draft', async () => {
  global.fetch = jest.fn(async (_url, options) => {
    if (options.method !== 'POST') return response(snapshot);
    const body = JSON.parse(options.body);
    return body.role === 'cso' ? response({ error: 'CSO conflict' }, 409) : response({ value: body.value, revision: 'new' });
  });
  render(<StaffingPanel />);
  fireEvent.change(await screen.findByLabelText('CSO'), { target: { value: 'two' } });
  await screen.findByText('CSO conflict');
  fireEvent.change(screen.getByLabelText('President'), { target: { value: 'two' } });
  await screen.findByText('Assignment saved.');
  expect(screen.getByText('CSO conflict')).toBeTruthy();
  expect(screen.getByText('Retry assignment')).toBeTruthy();
});

test('direct Admin staffing URL does not render Admin editors for a Grants Manager', async () => {
  global.fetch = jest.fn(async () => response(snapshot));
  render(<StaffingPanel includeFinalWriteups />);
  await screen.findByLabelText('President');
  expect(screen.queryByText('Existing publication editor')).toBeNull();
  expect(screen.queryByText('Related assignments')).toBeNull();
});

test('staff without Workbench access appear only in the President, Program Coordinator and Systems Specialist selectors', async () => {
  global.fetch = jest.fn(async () => response({ ...snapshot, staff: [...snapshot.staff, { systemUserId: 'president-only', name: 'Anneli Example', canUseWorkbench: false }] }));
  render(<StaffingPanel />);
  const president = await screen.findByLabelText('President');
  expect([...president.options].map(x => x.text)).toContain('Anneli Example');
  for (const label of ['Program Coordinator', 'Systems Specialist']) expect([...screen.getByLabelText(label).options].map(x => x.text)).toContain('Anneli Example');
  for (const label of ['CSO', 'Grants Manager']) expect([...screen.getByLabelText(label).options].map(x => x.text)).not.toContain('Anneli Example');
});

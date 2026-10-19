import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BoardWriteups from '../../shared/components/board-writeups/BoardWriteups';
const ID = '11111111-1111-4111-8111-111111111111';
const row = { requestId: ID, source: { number: '1002988', institution: 'Institute', documentId: ID, eTag: 'one', versionId: '1', earlyDraft: true, stage: 'Drafting' } };
const data = { config: { active: true, rosterConfirmed: true, materialsDue: '2026-11-01' }, progress: { released: 0, expected: 23 }, rows: [row], events: [], canRelease: true, canArchive: false };
const response = body => ({ ok: true, status: 200, json: async () => body });
afterEach(() => jest.restoreAllMocks());
test('early draft release requires warning and submits the version shown, with queued result', async () => {
  const calls = [];
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') { calls.push(JSON.parse(options.body)); return response({ results: [{ requestId: ID, status: 'queued' }] }); }
    return response(url.includes('?') ? data : { canRelease: true, canArchive: false, isSuperuser: false });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BoardWriteups />);
  fireEvent.click(await screen.findByLabelText('Select 1002988'));
  fireEvent.click(screen.getByText('Release selected to the President'));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(window.confirm).toHaveBeenCalledWith('This writeup is still in drafting. Release the current version to the President?');
  expect(calls[0].selections[0]).toMatchObject({ requestId: ID, eTag: 'one', versionId: '1', draftConfirmed: true });
  expect(await screen.findByText(/1002988: queued/)).toBeTruthy();
  expect(screen.getByText('0 of 23 released to the President')).toBeTruthy();
});
test('a late response from the previous cycle cannot replace the new cycle', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  global.fetch = jest.fn(async url => {
    if (!url.includes('?')) return response({ canRelease: true, canArchive: false });
    if (url.includes('D26')) return old;
    return response({ ...data, rows: [{ ...row, source: { ...row.source, number: 'NEW123' } }] });
  });
  render(<BoardWriteups />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('cycle=D26'), expect.anything()));
  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByText('Open cycle'));
  expect(await screen.findByText('NEW123')).toBeTruthy();
  await act(async () => { resolveOld(response(data)); });
  expect(screen.queryByText('1002988')).toBeNull();
  expect(screen.getByText('NEW123')).toBeTruthy();
});

test('disabled response shows no release or setup controls and makes no further requests', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Board writeups are disabled.', code: 'board_disabled' }) }));
  render(<BoardWriteups />);
  expect(await screen.findByText('Board writeups are disabled.')).toBeTruthy();
  expect(screen.queryByText('Release selected to the President')).toBeNull();
  expect(screen.queryByText('Admin: cycle setup and roles')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('admin can mark cleanup complete and sees the saved completion state', async () => {
  let complete = false;
  const posts = [];
  const board = () => ({ ...data, isSuperuser: true, cleanup: { dueDate: '2026-12-08', canComplete: !complete, completedAt: complete ? '2026-12-08T17:00:00Z' : null, completedBy: complete ? 'Admin' : null } });
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); complete = true; return response({ completedAt: '2026-12-08T17:00:00Z' }); }
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null }, roles: { president: { value: null, revision: null }, cso: { value: null }, grantsManager: { value: null } }, staff: [], candidates: [] });
    return response(url.includes('?') ? board() : { canRelease: true, canArchive: true, isSuperuser: true });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BoardWriteups mode="setup" />);
  fireEvent.click(await screen.findByText('Mark cleanup complete'));
  await waitFor(() => expect(posts).toEqual([{ action: 'completeCleanup', cycle: 'D26' }]));
  expect(await screen.findByText(/Cleanup marked complete by Admin/)).toBeTruthy();
  expect(screen.queryByText('Mark cleanup complete')).toBeNull();
});

test('non-admin cannot see cleanup completion control even when cleanup is due', async () => {
  global.fetch = jest.fn(async url => response(url.includes('?')
    ? { ...data, cleanup: { dueDate: '2026-12-08', canComplete: false } }
    : { canRelease: true, canArchive: false, isSuperuser: false }));
  render(<BoardWriteups />);
  await screen.findByText('1002988');
  expect(screen.queryByText('Mark cleanup complete')).toBeNull();
});

test('late cleanup completion response does not update a newly selected cycle', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') return pending;
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null }, roles: { president: { value: null, revision: null }, cso: { value: null }, grantsManager: { value: null } }, staff: [], candidates: [] });
    if (!url.includes('?')) return response({ canRelease: true, canArchive: true, isSuperuser: true });
    return response({ ...data, isSuperuser: true, cleanup: { dueDate: url.includes('J27') ? '2027-06-08' : '2026-12-08', canComplete: !url.includes('J27') } });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BoardWriteups mode="setup" />);
  fireEvent.click(await screen.findByText('Mark cleanup complete'));
  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByText('Open cycle'));
  await screen.findByText(/June 8, 2027/);
  await act(async () => { finish(response({ completedAt: '2026-12-08T17:00:00Z' })); });
  expect(screen.queryByText(/Cleanup marked complete/)).toBeNull();
  expect(screen.getByText(/June 8, 2027/)).toBeTruthy();
});

test('failed setup save shows an error beside Save setup and preserves entered dates', async () => {
  let refuse = true;
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') return refuse
      ? { ok: false, status: 500, json: async () => ({ error: 'Board operation failed.' }) }
      : response({ value: JSON.parse(options.body).value, revision: 'saved' });
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null, revision: null }, roles: { president: { value: null, revision: null }, cso: { value: null }, grantsManager: { value: null } }, staff: [], candidates: [] });
    return response(url.includes('?') ? data : { canRelease: true, canArchive: true, isSuperuser: true });
  });
  render(<BoardWriteups mode="setup" />);
  const save = await screen.findByText('Save setup');
  expect(screen.getByRole('region', { name: 'Cycle setup' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Board meeting end date'), { target: { value: '2026-12-10' } });
  fireEvent.click(save);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Setup could not be saved');
  expect(alert.textContent).toContain('Your entries are still here');
  expect(alert.className).toContain('bg-red-50');
  expect(save.nextElementSibling).toBe(alert);
  expect(document.activeElement).toBe(alert);
  expect(screen.getByLabelText('Board meeting end date').value).toBe('2026-12-10');
  expect(screen.getByText('Unsaved cycle changes')).toBeTruthy();
  refuse = false;
  fireEvent.click(save);
  await screen.findByText('Cycle setup saved.');
  expect(screen.getByText('No unsaved cycle changes')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(save.nextElementSibling.getAttribute('role')).toBe('status');
});


test('cycle setup shows shared assignments and links to the central editor', async () => {
  global.fetch = jest.fn(async url => response(url.startsWith('/api/admin/')
    ? { cycle: { value: null }, roles: { president: { value: { systemUserId: ID } }, cso: {}, grantsManager: {} }, staff: [{ systemUserId: ID, name: 'Example Staff' }], candidates: [] }
    : url.includes('?') ? { ...data, isSuperuser: true, canArchive: true } : { isSuperuser: true, canManageSetup: true, canArchive: true }));
  render(<BoardWriteups mode="setup" />);
  expect(await screen.findByText('Example Staff')).toBeTruthy();
  expect(screen.queryByLabelText('President')).toBeNull();
  expect(screen.getByText('Manage shared roles in Staffing').getAttribute('href')).toBe('/admin?workspace=people&view=staffing');
});

test.each([
  ['system administrator', { isSuperuser: true, canArchive: true, canRelease: false }],
  ['Grants Manager', { isSuperuser: false, canArchive: true, canRelease: false }],
])('%s can view dashboard without setup requests or release/maintenance controls', async (_role, permissions) => {
  const urls = [];
  global.fetch = jest.fn(async url => { urls.push(url); return response(url.includes('?') ? { ...data, ...permissions, cleanup: { canComplete: true } } : permissions); });
  render(<BoardWriteups />);
  await screen.findByText('1002988');
  expect(screen.getByText('Cycle setup & maintenance').getAttribute('href')).toBe('/board-cycle-setup?cycle=D26');
  expect(screen.queryByText('Release selected to the President')).toBeNull();
  expect(screen.queryByText('Save setup')).toBeNull();
  expect(screen.queryByText('Staff-discussion cleanup')).toBeNull();
  expect(screen.queryByText('Check Board writeups')).toBeNull();
  expect(urls.some(url => url.startsWith('/api/admin/'))).toBe(false);
});

test('empty inactive cycle explains setup without zero denominator or empty headers', async () => {
  global.fetch = jest.fn(async url => response(url.includes('?') ? { ...data, config: { active: false }, progress: { expected: 0, released: 0 }, rows: [] } : { canRelease: true }));
  render(<BoardWriteups />);
  await screen.findByText('This cycle isn’t ready for release yet');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(/0 of 0/)).toBeNull();
  expect(screen.queryByText('Release selected to the President')).toBeNull();
  expect(screen.getByText(/No proposals have been selected/)).toBeTruthy();
});

test('only missing cycle is treated as setup needed; real read errors remain errors', async () => {
  let code = 'board_cycle_unconfigured';
  global.fetch = jest.fn(async url => url.includes('?') ? { ok: false, status: 404, json: async () => ({ code, error: 'Read failed' }) } : response({ canArchive: true }));
  render(<BoardWriteups />);
  await screen.findByText('Complete cycle setup');
  code = 'board_settings_corrupt';
  fireEvent.click(screen.getByText('Refresh status'));
  await screen.findByRole('alert');
  expect(screen.queryByText('Complete cycle setup')).toBeNull();
  expect(screen.getByText('Try again')).toBeTruthy();
});

test('Grants Manager can open setup before a cycle exists; dashboard remains separate', async () => {
  global.fetch = jest.fn(async url => {
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null, revision: null }, roles: { president: {}, cso: {}, grantsManager: {} }, staff: [], candidates: [] });
    if (url.includes('?')) return { ok: false, status: 404, json: async () => ({ code: 'board_cycle_unconfigured' }) };
    return response({ canArchive: true, canRelease: false, isSuperuser: false });
  });
  render(<BoardWriteups mode="setup" />);
  await screen.findByText('Save setup');
  expect(screen.getByText('Manage shared roles in Staffing').getAttribute('href')).toBe('/staffing');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('Release selected to the President')).toBeNull();
});

test('CSO without setup authority cannot load settings on setup page', async () => {
  global.fetch = jest.fn(async () => response({ canRelease: true, canArchive: false }));
  render(<BoardWriteups mode="setup" />);
  await screen.findByRole('alert');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Save setup')).toBeNull();
});

test('cycle input waits for valid submission and retains loaded data while typing', async () => {
  global.fetch = jest.fn(async url => response(url.includes('?') ? data : { canRelease: true }));
  render(<BoardWriteups />);
  await screen.findByText('1002988');
  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J' } });
  expect(screen.getByText('1002988')).toBeTruthy();
  fireEvent.click(screen.getByText('Open cycle'));
  await screen.findByText('Enter a cycle such as D26 or J27.');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('refresh and cycle switching require confirmation before discarding unsaved setup', async () => {
  global.fetch = jest.fn(async url => url.startsWith('/api/admin/')
    ? response({ cycle: { value: null, revision: null }, roles: { president: {}, cso: {}, grantsManager: {} }, staff: [], candidates: [] })
    : response(url.includes('?') ? data : { canArchive: true, isSuperuser: true }));
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BoardWriteups mode="setup" />);
  fireEvent.change(await screen.findByLabelText('Board meeting end date'), { target: { value: '2026-12-10' } });
  fireEvent.click(screen.getByText('Refresh status'));
  expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved cycle setup changes?');
  expect(screen.getByLabelText('Board meeting end date').value).toBe('2026-12-10');
  expect(global.fetch).toHaveBeenCalledTimes(3);
  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByText('Open cycle'));
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByLabelText('Board meeting end date').value).toBe('2026-12-10');
  window.confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText('Refresh status'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(6));
  expect((await screen.findByLabelText('Board meeting end date')).value).toBe('');
});

test('Select all proposals includes search-hidden candidates, preserves prior selections, and leaves confirmation and activation unchanged', async () => {
  const second = '22222222-2222-4222-8222-222222222222';
  const previous = '33333333-3333-4333-8333-333333333333';
  const posts = [];
  const value = { version: 1, cycle: 'D26', programId: 'c247b11a-a7cb-ee11-9078-000d3a341e8f', requestIds: [ID, previous], rosterConfirmed: false, active: false, materialsDue: null, boardEnds: null, adminId: null };
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') { const body = JSON.parse(options.body); posts.push(body); return response({ value: body.value, revision: 'saved' }); }
    if (url.startsWith('/api/admin/')) return response({ cycle: { value, revision: 'one' }, roles: { president: {}, cso: {}, grantsManager: {} }, staff: [], candidates: [{ requestId: ID, number: '1002988', institution: 'Institute' }, { requestId: second, number: '1003000', institution: 'Other Institute' }] });
    return response(url.includes('?') ? data : { canArchive: true, isSuperuser: true });
  });
  render(<BoardWriteups mode="setup" />);
  const selectAll = await screen.findByRole('button', { name: 'Select all proposals' });
  fireEvent.change(screen.getByLabelText('Find proposal'), { target: { value: '1002988' } });
  expect(screen.queryByLabelText('1003000 — Other Institute')).toBeNull();
  fireEvent.click(selectAll);
  expect(selectAll.disabled).toBe(true);
  expect(screen.getByText('Expected proposals — 3 selected of 23')).toBeTruthy();
  expect(screen.getByLabelText('Staff has confirmed this expected proposal list').checked).toBe(false);
  expect(screen.getByLabelText('Activate this cycle').checked).toBe(false);
  expect(posts).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Find proposal'), { target: { value: '' } });
  expect(screen.getByLabelText('1003000 — Other Institute').checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save setup' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].value.requestIds).toEqual([ID, previous, second]);
});

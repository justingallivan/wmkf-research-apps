import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BoardWriteups from '../../shared/components/board-writeups/BoardWriteups';
const ID = '11111111-1111-4111-8111-111111111111';
const row = { requestId: ID, source: { number: '1002988', institution: 'Institute', documentId: ID, eTag: 'one', versionId: '1', earlyDraft: true, stage: 'Drafting' } };
const data = { config: { materialsDue: '2026-11-01' }, progress: { released: 0, expected: 23 }, rows: [row], events: [], canRelease: true, canArchive: false };
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
  fireEvent.click(screen.getByText('Release selected to Allison'));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(window.confirm).toHaveBeenCalledWith('This writeup is still in drafting. Release the current version to Allison?');
  expect(calls[0].selections[0]).toMatchObject({ requestId: ID, eTag: 'one', versionId: '1', draftConfirmed: true });
  expect(await screen.findByText(/1002988: queued/)).toBeTruthy();
  expect(screen.getByText('0 of 23 released to Allison')).toBeTruthy();
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
  expect(await screen.findByText('NEW123')).toBeTruthy();
  await act(async () => { resolveOld(response(data)); });
  expect(screen.queryByText('1002988')).toBeNull();
  expect(screen.getByText('NEW123')).toBeTruthy();
});

test('disabled response shows no release or setup controls and makes no further requests', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Board writeups are disabled.', code: 'board_disabled' }) }));
  render(<BoardWriteups />);
  expect(await screen.findByText('Board writeups are disabled.')).toBeTruthy();
  expect(screen.queryByText('Release selected to Allison')).toBeNull();
  expect(screen.queryByText('Admin: cycle setup and roles')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('admin can mark cleanup complete and sees the saved completion state', async () => {
  let complete = false;
  const posts = [];
  const board = () => ({ ...data, isSuperuser: true, cleanup: { dueDate: '2026-12-08', canComplete: !complete, completedAt: complete ? '2026-12-08T17:00:00Z' : null, completedBy: complete ? 'Admin' : null } });
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); complete = true; return response({ completedAt: '2026-12-08T17:00:00Z' }); }
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null }, roles: { cso: { value: null }, grantsManager: { value: null } }, staff: [], candidates: [] });
    return response(url.includes('?') ? board() : { canRelease: true, canArchive: false, isSuperuser: true });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BoardWriteups />);
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
    if (url.startsWith('/api/admin/')) return response({ cycle: { value: null }, roles: { cso: { value: null }, grantsManager: { value: null } }, staff: [], candidates: [] });
    if (!url.includes('?')) return response({ canRelease: true, isSuperuser: true });
    return response({ ...data, isSuperuser: true, cleanup: { dueDate: url.includes('J27') ? '2027-06-08' : '2026-12-08', canComplete: !url.includes('J27') } });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BoardWriteups />);
  fireEvent.click(await screen.findByText('Mark cleanup complete'));
  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J27' } });
  await screen.findByText(/2027-06-08/);
  await act(async () => { finish(response({ completedAt: '2026-12-08T17:00:00Z' })); });
  expect(screen.queryByText(/Cleanup marked complete/)).toBeNull();
  expect(screen.getByText(/2027-06-08/)).toBeTruthy();
});

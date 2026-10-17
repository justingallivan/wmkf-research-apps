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

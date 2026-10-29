import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import CycleCalendarPanel from '../../shared/components/cycle-calendar/CycleCalendarPanel';

const mockRouter = { pathname: '/cycle-calendar', query: {}, replace: jest.fn() };
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
import { CYCLE_CALENDAR_DATE_COLUMNS } from '../../shared/config/cycleCalendar';

const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function cycle(code, name, etag, overrides = {}) {
  return {
    id: `${code}-id`, code, name, etag, boardDate: code === 'D26' ? '2026-12-10' : '2027-06-10', historyAvailable: true,
    rowModifiedAt: '2026-10-29T03:00:00Z', rowModifiedBy: 'Connor Noda',
    board: { column: 'wmkf_meetingdate', label: 'Board Meeting Date', value: code === 'D26' ? '2026-12-10' : '2027-06-10', changedAt: null, changedBy: null },
    dates: CYCLE_CALENDAR_DATE_COLUMNS.map(({ column, label }) => ({ column, label, value: null, changedAt: null, changedBy: null })),
    ...overrides,
  };
}
function snapshot({ canEdit = true, savingAvailable = true, j27 = {} } = {}) {
  return { canEdit, savingAvailable, defaultCycleCode: 'D26', cycles: [cycle('D26', 'December 2026', 'W/"1"'), cycle('J27', 'June 2027', 'W/"7"', j27)] };
}
beforeEach(() => { mockRouter.query = {}; mockRouter.replace.mockClear(); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('non-editors see dates and attribution without edit controls', async () => {
  const dates = CYCLE_CALENDAR_DATE_COLUMNS.map(({ column, label }, i) => ({ column, label, value: i === 0 ? '2026-12-07' : null, changedAt: i === 0 ? '2026-10-29T17:00:00Z' : null, changedBy: i === 0 ? 'Sarah Hibler' : null }));
  global.fetch = jest.fn(async () => response({ ...snapshot({ canEdit: false }), defaultCycleCode: 'J27', cycles: [cycle('D26', 'December 2026', 'W/"1"'), cycle('J27', 'June 2027', 'W/"7"', { dates })] }));
  render(<CycleCalendarPanel />);
  expect(await screen.findByText('Mon, Dec 7, 2026')).toBeTruthy();
  expect(screen.getByText('Changed by Sarah Hibler, Oct 29, 2026')).toBeTruthy();
  expect(screen.getByLabelText('Grant cycle').value).toBe('J27');
  expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
});

test('editor picks a cycle, edits one date with the picker and saves with that cycle\'s ETag', async () => {
  global.fetch = jest.fn(async (_url, options) => response(options?.method === 'POST' ? snapshot() : snapshot()));
  render(<CycleCalendarPanel />);
  fireEvent.change(await screen.findByLabelText('Grant cycle'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Reviews Due Date' }));
  fireEvent.change(screen.getByLabelText('Reviews Due Date'), { target: { value: '2027-03-17' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Date saved.')).toBeTruthy();
  const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ cycleCode: 'J27', column: 'wmkf_researchreviewsduedate', value: '2027-03-17', etag: 'W/"7"' });
});

test('clearing a set date sends null', async () => {
  const dates = CYCLE_CALENDAR_DATE_COLUMNS.map(({ column, label }) => ({ column, label, value: column === 'wmkf_boardmailingdate' ? '2027-05-27' : null, changedAt: null, changedBy: null }));
  const data = { ...snapshot(), cycles: [cycle('D26', 'December 2026', 'W/"1"', { dates })] };
  global.fetch = jest.fn(async () => response(data));
  render(<CycleCalendarPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Board Mailing Date' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true));
  const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
  expect(JSON.parse(post[1].body)).toMatchObject({ column: 'wmkf_boardmailingdate', value: null });
});

test('a refused save shows the server message and keeps the editor open', async () => {
  global.fetch = jest.fn(async (_url, options) => options?.method === 'POST'
    ? response({ error: 'This cycle changed since you opened it. Reload to see the latest dates.', code: 'calendar_conflict' }, 409)
    : response(snapshot()));
  render(<CycleCalendarPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Proposal Due' }));
  fireEvent.change(screen.getByLabelText('Proposal Due'), { target: { value: '2026-12-07' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This cycle changed since you opened it');
  expect(screen.getByLabelText('Proposal Due')).toBeTruthy();
});

test('saving disabled when changes could not be attributed', async () => {
  global.fetch = jest.fn(async () => response(snapshot({ savingAvailable: false })));
  render(<CycleCalendarPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be attributed to you');
  expect(screen.getByRole('button', { name: 'Edit Proposal Due' }).disabled).toBe(true);
});

test('unavailable history shows the labelled row-level change, not per-date claims', async () => {
  const data = { ...snapshot(), cycles: [cycle('D26', 'December 2026', 'W/"1"', { historyAvailable: false })] };
  global.fetch = jest.fn(async () => response(data));
  render(<CycleCalendarPanel />);
  expect(await screen.findByText(/Last change to this cycle \(any date\): Oct 28, 2026 by Connor Noda/)).toBeTruthy();
  expect(screen.queryByText(/^Changed by/)).toBeNull();
});

test('Board date is shown read-only', async () => {
  global.fetch = jest.fn(async () => response(snapshot()));
  render(<CycleCalendarPanel />);
  const board = await screen.findByText('Board Meeting Date:');
  expect(within(board.parentElement).getByText('Thu, Dec 10, 2026')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit Board Meeting Date' })).toBeNull();
});

test('the cycle in the URL survives a reload and choosing a cycle writes it to the URL', async () => {
  mockRouter.query = { cycle: 'J27' };
  global.fetch = jest.fn(async () => response(snapshot()));
  render(<CycleCalendarPanel />);
  expect((await screen.findByLabelText('Grant cycle')).value).toBe('J27');
  fireEvent.change(screen.getByLabelText('Grant cycle'), { target: { value: 'D26' } });
  expect(screen.getByLabelText('Grant cycle').value).toBe('D26');
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/cycle-calendar', query: { cycle: 'D26' } }, undefined, { shallow: true, scroll: false });
});

test('an unknown URL cycle falls back to the server default', async () => {
  mockRouter.query = { cycle: 'D99' };
  global.fetch = jest.fn(async () => response(snapshot()));
  render(<CycleCalendarPanel />);
  expect((await screen.findByLabelText('Grant cycle')).value).toBe('D26');
});

test('after a save the row shows "Recording…" until a re-check finds the attribution', async () => {
  const withDate = (changedBy) => ({ ...snapshot(), cycles: [cycle('D26', 'December 2026', 'W/"2"', {
    dates: CYCLE_CALENDAR_DATE_COLUMNS.map(({ column, label }) => (column === 'wmkf_researchproposalduedate'
      ? { column, label, value: '2026-12-07', changedAt: changedBy ? '2026-10-29T04:00:00Z' : null, changedBy }
      : { column, label, value: null, changedAt: null, changedBy: null })),
  })] });
  let gets = 0;
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'POST') return response(withDate(null)); // audit entry not readable yet
    gets += 1;
    return response(gets === 1 ? snapshot() : withDate('Justin Gallivan'));
  });
  render(<CycleCalendarPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Proposal Due' }));
  fireEvent.change(screen.getByLabelText('Proposal Due'), { target: { value: '2026-12-07' } });
  jest.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Recording who made this change…')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(2100); });
  jest.useRealTimers();
  expect(await screen.findByText('Changed by Justin Gallivan, Oct 28, 2026')).toBeTruthy();
  expect(screen.queryByText('Recording who made this change…')).toBeNull();
  expect(gets).toBe(2);
});

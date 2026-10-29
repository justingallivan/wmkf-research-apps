/**
 * Landing cycle control on the calendar page (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md §3.2).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LandingCyclePanel from '../../shared/components/landing-cycle/LandingCyclePanel';

jest.mock('../../shared/components/Layout', () => ({
  Button: ({ children, variant: _variant, ...props }) => <button type="button" {...props}>{children}</button>,
}));

const CYCLES = [{ code: 'D26', name: 'December 2026', boardDate: '2026-12-10' }, { code: 'J27', name: 'June 2027', boardDate: '2027-06-10' }];
const AUTO = { code: 'D26', boardDate: '2026-12-10', switchesOn: '2026-12-11' };
const view = (over = {}) => ({ landingCycleCode: 'D26', automatic: AUTO, storedValue: null, status: 'automatic', setBy: null, setAt: null, revision: null, canEdit: true, cycles: CYCLES, ...over });
const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

function mockFetch(handlers) {
  global.fetch = jest.fn(async (url, options = {}) => handlers(url, options));
}

test('shows the automatic cycle and when it switches, and lets an editor choose a cycle with the revision they opened', async () => {
  mockFetch((url, options) => (options.method === 'POST'
    ? reply(view({ landingCycleCode: 'J27', storedValue: 'J27', status: 'active', setBy: 'Grants Manager', setAt: '2026-11-01T17:00:00Z', revision: 'W/"2"' }))
    : reply(view({ revision: 'W/"1"' }))));
  render(<LandingCyclePanel />);
  expect(await screen.findByText('Automatic: D26 · December 2026')).toBeInTheDocument();
  expect(screen.getByText('Switches to the next cycle on Fri, Dec 11, 2026.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('Apps now open on J27 where they can.');
  const post = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(post[0]).toBe('/api/landing-cycle');
  expect(JSON.parse(post[1].body)).toEqual({ cycleCode: 'J27', revision: 'W/"1"' });
  expect(screen.getByText('J27 · June 2027 (chosen)')).toBeInTheDocument();
  expect(screen.getByText('Apps stay on J27 until you switch back to Automatic; they do not switch on their own.')).toBeInTheDocument();
  expect(screen.getByText('Automatic would be D26 · December 2026, switching to the next cycle on Fri, Dec 11, 2026.')).toBeInTheDocument();
  expect(screen.getByText(/Set by Grants Manager/)).toBeInTheDocument();
});

test('a non-editor sees the value but no Edit button', async () => {
  mockFetch(() => reply(view({ landingCycleCode: 'J27', storedValue: 'J27', status: 'active', canEdit: false })));
  render(<LandingCyclePanel />);
  await screen.findByText('J27 · June 2027 (chosen)');
  expect(screen.queryByText('Edit')).toBeNull();
});

test('an orphaned override is flagged, apps use automatic, and it can be switched back to Automatic', async () => {
  mockFetch((url, options) => (options.method === 'POST' ? reply(view()) : reply(view({ storedValue: 'D27', status: 'missing', revision: 'W/"3"' }))));
  render(<LandingCyclePanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The saved landing cycle D27 is not in the Grant Cycle table, so apps are using the automatic cycle');
  expect(screen.getByText('Automatic: D26 · December 2026')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit'));
  const save = screen.getByText('Save');
  expect(save).not.toBeDisabled();
  fireEvent.click(save);
  await screen.findByText('Back to automatic: apps open on the cycle with the next Board meeting.');
  const post = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ cycleCode: null, revision: 'W/"3"' });
});

test('a conflict closes the editor, reloads and explains', async () => {
  let reads = 0;
  mockFetch((url, options) => {
    if (options.method === 'POST') return reply({ error: 'Someone else changed the landing cycle.', code: 'landing_conflict' }, 409);
    reads += 1;
    return reply(reads === 1 ? view({ revision: 'W/"1"' }) : view({ landingCycleCode: 'J27', storedValue: 'J27', status: 'active', revision: 'W/"2"' }));
  });
  render(<LandingCyclePanel />);
  await screen.findByText('Automatic: D26 · December 2026');
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'J27' } });
  fireEvent.click(screen.getByText('Save'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed the landing cycle.');
  await waitFor(() => expect(screen.getByText('J27 · June 2027 (chosen)')).toBeInTheDocument());
  expect(screen.queryByRole('combobox')).toBeNull();
});

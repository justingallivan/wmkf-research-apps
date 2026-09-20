/**
 * @jest-environment jsdom
 *
 * RequestLocator — T5 gap-fill (Stage 5a). tests/unit/request-locator-
 * controls.test.js already pins 2xx success, network rejection for the
 * options load, and (after this stage's call-shape fix) exact GET request
 * shape for both fetch sites (mode=options load, and the search POST-less
 * GET). Both sites now use requestEnvelope with an explicit
 * `body.error || `... (${status})`` throw (Stage 5a review finding 1),
 * restoring the old code's status-interpolated fallback text. The search
 * site renders its error message verbatim (`role="alert"`), so the suffix
 * is pinned there directly; the options-load site only ever surfaces
 * `optionsError` as a boolean (the "Retry filters" affordance and a fixed
 * copy string — `filtersFeedback` never renders `error.message`), so its
 * fix is pinned structurally (the affordance still appears on a 500 + {}
 * body) rather than by asserting text that the component never displays.
 * This file adds axis (e): a non-2xx response whose body cannot be parsed,
 * never silent.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { RequestLocator } from '../../shared/components/workbench/RequestLocator';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('options load axis (e): non-2xx unparseable body is never silent (Retry filters affordance appears)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<RequestLocator />);
  expect(await screen.findByRole('button', { name: 'Retry filters' })).toBeInTheDocument();
});

test('options load: non-2xx empty body ({}) is never silent (Retry filters affordance appears, finding 1 parity)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<RequestLocator />);
  expect(await screen.findByRole('button', { name: 'Retry filters' })).toBeInTheDocument();
});

test('search axis (e): non-2xx unparseable body is never silent (search status announces the failure with status suffix)', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ programs: [], programId: 'p1', programName: 'Research', cycles: [], statuses: [] }) })
    .mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<RequestLocator />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'University' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to search requests (502)');
});

test('search: non-2xx empty body ({}) falls to the fallback text with status suffix (finding 1 parity)', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ programs: [], programId: 'p1', programName: 'Research', cycles: [], statuses: [] }) })
    .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<RequestLocator />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'University' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to search requests (500)');
});

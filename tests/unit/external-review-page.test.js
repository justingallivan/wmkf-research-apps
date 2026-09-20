/**
 * pages/external/review/[token].js — the T5 axis (a)-(e) matrix for the
 * dispatcher's single context GET (fetchContext). View dispatch itself and
 * the email-action deep-link helpers are covered by
 * external-review-email-action.test.js; this file isolates the fetch outcome.
 *
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import ExternalReviewPage from '../../pages/external/review/[token]';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'tok' } }) }));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));
jest.mock('../../shared/components/external/Stage2aView', () => ({ __esModule: true, default: () => <div>stage2a</div> }));
jest.mock('../../shared/components/external/DeclineFormView', () => ({ __esModule: true, default: () => <div>decline-form</div> }));
jest.mock('../../shared/components/external/AcceptedConfirmationView', () => ({ __esModule: true, default: () => <div>accepted</div> }));
jest.mock('../../shared/components/external/DeclinedConfirmationView', () => ({ __esModule: true, default: () => <div>declined</div> }));
jest.mock('../../shared/components/external/MaterialsView', () => ({ __esModule: true, default: () => <div>materials</div> }));

function response(body, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

afterEach(() => jest.restoreAllMocks());

test('(a) a 2xx ok body with a server view dispatches to that view', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: true, engagementState: { view: 'stage2a' } }));
  render(<ExternalReviewPage />);
  await screen.findByText('stage2a');
  expect(global.fetch).toHaveBeenCalledWith('/api/external/review/tok/context', { method: 'GET', signal: undefined });
});

test('(b) non-2xx {ok:false, reason} shows the mapped error message', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false, reason: 'revoked' }, 401));
  render(<ExternalReviewPage />);
  await screen.findByText(/This link has been revoked/i);
});

test('(b) a 2xx body with ok:false shows the mapped error message (body-level flag, not status)', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false, reason: 'not_found' }, 200));
  render(<ExternalReviewPage />);
  await screen.findByText(/couldn't find a review/i);
});

test('a non-2xx body with no reason falls back to the server_error message', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false }, 500));
  render(<ExternalReviewPage />);
  await screen.findByText(/Something went wrong on our end/i);
});

test('(c) network rejection shows the network error message', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(<ExternalReviewPage />);
  await screen.findByText(/Network error\. Please check your connection/i);
});

test('(d)/(e) a malformed 2xx body (bare .json(), no catch, throws today) shows the network error message', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  render(<ExternalReviewPage />);
  await screen.findByText(/Network error\. Please check your connection/i);
});

test('(e) a non-2xx unparseable body (502 gateway page) also shows the network error message', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
  render(<ExternalReviewPage />);
  await screen.findByText(/Network error\. Please check your connection/i);
});

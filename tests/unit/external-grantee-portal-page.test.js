/**
 * pages/external/grantee/[token].js — fail-closed reasons, edit/submitted/closed
 * views, and the T5 axis (a)-(e) matrix for the single context GET.
 *
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import GranteePortalPage from '../../pages/external/grantee/[token]';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { token: 'tok' } }) }));
jest.mock('../../shared/components/external/GranteeDeliverableForm', () => ({
  __esModule: true,
  default: () => <div>edit-form</div>,
}));

function response(body, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

afterEach(() => jest.restoreAllMocks());

test('(a) a 2xx ok body with view=edit renders the edit form', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, request: { title: 'A Title' }, deliverable: {}, view: 'edit', preview: null, waiverPolicy: {}, waiverToken: 't',
  }));
  render(<GranteePortalPage />);
  await screen.findByText('edit-form');
  expect(global.fetch).toHaveBeenCalledWith('/api/external/grantee/tok/context', { method: 'GET', signal: undefined });
});

test('(a) view=submitted renders the thank-you notice', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, request: {}, deliverable: null, view: 'submitted', preview: null,
  }));
  render(<GranteePortalPage />);
  await screen.findByText(/your materials have been received/i);
});

test('(a) view=closed renders the closed notice', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({
    ok: true, request: {}, deliverable: null, view: 'closed', preview: null,
  }));
  render(<GranteePortalPage />);
  await screen.findByText(/this submission is closed/i);
});

test('(b) non-2xx {ok:false, reason} shows the mapped fail-closed message', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false, reason: 'expired' }, 401));
  render(<GranteePortalPage />);
  await screen.findByText(/This link has expired/);
});

test('(b) a 2xx body with ok:false shows the mapped fail-closed message (body-level flag, not status)', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ok: false, reason: 'not_found' }, 200));
  render(<GranteePortalPage />);
  await screen.findByText(/We could not find the associated grant/);
});

test('(c) network rejection falls back to the generic server_error message', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(<GranteePortalPage />);
  await screen.findByText(/Something went wrong on our end/);
});

test('(d)/(e) a malformed 2xx body (bare .json(), no catch, throws today) falls back to server_error', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  render(<GranteePortalPage />);
  await screen.findByText(/Something went wrong on our end/);
});

test('(e) a non-2xx unparseable body (502 gateway page) also falls back to server_error', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
  render(<GranteePortalPage />);
  await screen.findByText(/Something went wrong on our end/);
});

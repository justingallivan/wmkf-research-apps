/**
 * @jest-environment jsdom
 *
 * SiteVisitMaterialsCard — T5 gap-fill (Stage 5a). tests/unit/site-visit-
 * materials-card.test.js already pins 2xx success, action=create/waive
 * request bytes, the invitation-failure banner, and the 503-hides-the-card
 * behavior for the file's 2 fetch sites (materials GET, materials POST),
 * migrated to requestEnvelope with tolerantBody: true. This file adds
 * network-rejection and axis (e).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import SiteVisitMaterialsCard from '../../shared/components/meeting-tracker/SiteVisitMaterialsCard';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: { id: 7 }, status: 'ready' }) }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
});

test('load axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The materials collection could not be loaded.');
});

test('act (POST): network rejection is never silent', async () => {
  global.fetch = jest.fn((url, options = {}) => (
    options.method === 'POST'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, collection: null }) })
  ));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request materials' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
});

test('act (POST) axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn((url, options = {}) => (
    options.method === 'POST'
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, collection: null }) })
  ));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request materials' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByText(/preview could not be rendered|materials collection could not be updated/i)).toBeInTheDocument();
});

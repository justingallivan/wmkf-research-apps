/**
 * @jest-environment jsdom
 *
 * DynamicsExplorerRestrictionsSection — T3 per-call-site matrix (Stage 3,
 * group A) ahead of migrating its three fetch sites onto
 * shared/utils/api-request.js. All three sites are D1-preserve: none checks
 * `response.ok` today (plan §9 D1; execution doc Stage 3), so migration must
 * keep reading the parsed body regardless of status, and the DELETE site
 * never reads a body at all.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DynamicsExplorerRestrictionsSection from '../../shared/components/admin/DynamicsExplorerRestrictionsSection';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function unparseableResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  };
}

describe('DynamicsExplorerRestrictionsSection', () => {
  // addRestriction/removeRestriction have no try/catch today (D1); a
  // rejected body parse or network failure is an unhandled rejection both
  // before and after migration. Swallow it here so the test process does
  // not fail on that pre-existing, unchanged behavior.
  let unhandledRejectionListeners;

  beforeEach(() => {
    global.fetch = jest.fn();
    unhandledRejectionListeners = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', () => {});
  });

  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    unhandledRejectionListeners.forEach((listener) => process.on('unhandledRejection', listener));
  });

  describe('GET /api/dynamics-explorer/restrictions (load)', () => {
    test('(a) 2xx with restrictions renders them', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, {
        restrictions: [{ id: 'r1', table_name: 'contact', field_name: null, restriction_type: 'blocked', reason: null }],
      }));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      expect(await screen.findByText('contact')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith('/api/dynamics-explorer/restrictions');
    });

    test('(b) non-2xx {error} is read regardless of status (D1 silent)', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      expect(await screen.findByText('No Explorer safeguards configured.')).toBeInTheDocument();
    });

    test('(c) network rejection leaves list empty, stops loading', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      expect(await screen.findByText('No Explorer safeguards configured.')).toBeInTheDocument();
    });

    test('(d) malformed 2xx body caught the same as a rejection', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(200));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      expect(await screen.findByText('No Explorer safeguards configured.')).toBeInTheDocument();
    });

    test('(e) non-2xx unparseable body (502 gateway page) stays silent (D1 pin)', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      expect(await screen.findByText('No Explorer safeguards configured.')).toBeInTheDocument();
    });
  });

  describe('POST /api/dynamics-explorer/restrictions (addRestriction)', () => {
    async function setup() {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { restrictions: [] }));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      await screen.findByText('No Explorer safeguards configured.');
      fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'contact' } });
      fireEvent.change(screen.getByLabelText('Field (optional)'), { target: { value: 'email' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'PII' } });
    }

    test('(a) 2xx {restriction} appends it and resets the form', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(200, {
        restriction: { id: 'new-1', table_name: 'contact', field_name: 'email', restriction_type: 'blocked', reason: 'PII' },
      }));
      fireEvent.click(screen.getByText('Add safeguard'));
      expect(await screen.findByText('contact')).toBeInTheDocument();
      expect(screen.getByLabelText('Table name')).toHaveValue('');

      const [, postCall] = global.fetch.mock.calls;
      expect(postCall[0]).toBe('/api/dynamics-explorer/restrictions');
      expect(postCall[1].method).toBe('POST');
      expect(postCall[1].headers).toEqual({ 'Content-Type': 'application/json' });
      expect(postCall[1].body).toBe(JSON.stringify({ table_name: 'contact', field_name: 'email', reason: 'PII', userProfileId: 'u1' }));
    });

    test('(b) non-2xx {error} has no restriction field, so nothing is appended (D1 silent)', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      fireEvent.click(screen.getByText('Add safeguard'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      expect(screen.getByText('No Explorer safeguards configured.')).toBeInTheDocument();
      expect(screen.getByLabelText('Table name')).toHaveValue('contact');
    });

    test('(e) non-2xx unparseable body (502) also appends nothing (D1 pin)', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      fireEvent.click(screen.getByText('Add safeguard'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      expect(screen.getByText('No Explorer safeguards configured.')).toBeInTheDocument();
    });
  });

  describe('DELETE /api/dynamics-explorer/restrictions (removeRestriction)', () => {
    async function setupWithOne() {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, {
        restrictions: [{ id: 'r1', table_name: 'contact', field_name: null, restriction_type: 'blocked', reason: null }],
      }));
      render(<DynamicsExplorerRestrictionsSection userProfileId="u1" />);
      await screen.findByText('contact');
    }

    test('(a) 2xx removes the row locally regardless of body', async () => {
      await setupWithOne();
      global.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
      fireEvent.click(screen.getByText('Remove'));
      await waitFor(() => expect(screen.getByText('No Explorer safeguards configured.')).toBeInTheDocument());

      const [, deleteCall] = global.fetch.mock.calls;
      expect(deleteCall[0]).toBe('/api/dynamics-explorer/restrictions');
      expect(deleteCall[1].method).toBe('DELETE');
      expect(deleteCall[1].headers).toEqual({ 'Content-Type': 'application/json' });
      expect(deleteCall[1].body).toBe(JSON.stringify({ id: 'r1', userProfileId: 'u1' }));
    });

    test('(b) non-2xx {error} still removes the row locally (D1: no ok check, no body read)', async () => {
      await setupWithOne();
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      fireEvent.click(screen.getByText('Remove'));
      await waitFor(() => expect(screen.getByText('No Explorer safeguards configured.')).toBeInTheDocument());
    });

    test('(c) network rejection leaves the row in place (throws before the filter)', async () => {
      await setupWithOne();
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      fireEvent.click(screen.getByText('Remove'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      expect(screen.getByText('contact')).toBeInTheDocument();
    });

    test('(e) non-2xx unparseable body (502) still removes the row (D1: body never read)', async () => {
      await setupWithOne();
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      fireEvent.click(screen.getByText('Remove'));
      await waitFor(() => expect(screen.getByText('No Explorer safeguards configured.')).toBeInTheDocument());
    });
  });
});

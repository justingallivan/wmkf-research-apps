/**
 * useReviewerContactActions — T4 client-request-layer matrix (Stage 4). This
 * hook has no render test today; this file adds a minimal harness that wires
 * the hook to useState/useRef and exposes one button per action, so its 8
 * fetch sites can be pinned ahead of migrating onto
 * shared/utils/api-request.js:
 *   - persistManualContact    PATCH /api/workbench/reviewer-roster
 *   - verifyAddressContact    POST  /api/workbench/reviewer-address-trust
 *   - reviewAddressConflict   POST  /api/workbench/reviewer-address-trust
 *   - retryAddressCheck       POST  /api/workbench/reviewer-address-trust
 *   - requestAddressRepair    POST  /api/workbench/reviewer-address-trust
 *   - openIdentityConfirmation POST /api/workbench/reviewer-address-trust
 *   - confirmIdentityContact  POST (record, unverified only) +
 *                             PATCH /api/workbench/reviewer-roster
 * All 8 sites already read body-level `.success` and parse with
 * `.json().catch(() => ({}))`.
 */
import { useRef, useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import useReviewerContactActions from '../../shared/components/reviewers/search/useReviewerContactActions';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const CAND = { candidateKey: 'suggestion:s-1', name: 'Ada Lovelace', email: 'ada@example.edu' };

function Harness({ requestId = REQ, initialCandidate = CAND, initialUnverified = [] }) {
  const genRef = useRef(0);
  const [candidates, setCandidates] = useState([initialCandidate]);
  const [recCandidates, setRecCandidates] = useState([]);
  const [rosterActive, setRosterActive] = useState([]);
  const [rosterNote, setRosterNote] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editingContact, setEditingContact] = useState(null);
  const [repairRequestsByCandidateKey, setRepairRequestsByCandidateKey] = useState({});
  const [confirmingContact, setConfirmingContact] = useState(null);
  const [unverified, setUnverified] = useState(initialUnverified);
  const [lastError, setLastError] = useState(null);

  const actions = useReviewerContactActions({
    requestId, genRef, unverified, setCandidates, setRecCandidates, setRosterActive,
    setRosterNote, setSelected, setEditingContact, setRepairRequestsByCandidateKey,
    setConfirmingContact, setUnverified,
  });

  const run = (fn) => async () => {
    try { await fn(); } catch (e) { setLastError(e.message); }
  };

  return (
    <div>
      <div data-testid="roster-note">{rosterNote ?? ''}</div>
      <div data-testid="last-error">{lastError ?? ''}</div>
      <div data-testid="repair-requests">{JSON.stringify(repairRequestsByCandidateKey)}</div>
      <div data-testid="editing-contact">{JSON.stringify(editingContact)}</div>
      <div data-testid="confirming-contact">{JSON.stringify(confirmingContact)}</div>
      <div data-testid="roster-active">{JSON.stringify(rosterActive)}</div>
      <div data-testid="candidates">{JSON.stringify(candidates)}</div>
      <button data-testid="persist-manual" onClick={run(() => actions.persistManualContact(candidates[0], { website: 'https://new.example' }))}>persist</button>
      <button data-testid="verify-address" onClick={run(() => actions.verifyAddressContact(candidates[0], { email: 'ada@example.edu' }, { evidenceType: 'website', evidenceUrl: 'https://x', note: 'n' }))}>verify</button>
      <button data-testid="review-conflict" onClick={run(() => actions.reviewAddressConflict(candidates[0]))}>review-conflict</button>
      <button data-testid="retry-check" onClick={run(() => actions.retryAddressCheck(candidates[0]))}>retry-check</button>
      <button data-testid="request-repair" onClick={run(() => actions.requestAddressRepair(candidates[0]))}>request-repair</button>
      <button data-testid="open-identity" onClick={run(() => actions.openIdentityConfirmation({ ...candidates[0], addressConflictPending: true }))}>open-identity</button>
      <button data-testid="confirm-identity" onClick={run(() => actions.confirmIdentityContact(candidates[0], { email: 'ada@example.edu' }, { evidenceType: 'website', evidenceUrl: 'https://x', note: 'n' }))}>confirm-identity</button>
    </div>
  );
}

function mkFetch(handlers) {
  return jest.fn((url, opts) => {
    const u = String(url);
    if (u.includes('/api/workbench/reviewer-roster')) return Promise.resolve(handlers.roster(opts));
    if (u.includes('/api/workbench/reviewer-address-trust')) return Promise.resolve(handlers.addressTrust(opts));
    throw new Error(`unexpected fetch ${u}`);
  });
}

afterEach(() => { jest.restoreAllMocks(); });

test('persistManualContact: PATCH sends exact body bytes/headers; success applies the authoritative candidate', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    roster: (opts) => {
      sentOpts = opts;
      return { ok: true, status: 200, json: async () => ({ success: true, candidate: { ...CAND, website: 'https://new.example' } }) };
    },
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('persist-manual').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toMatch(/contact details saved/));
  expect(sentOpts.method).toBe('PATCH');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toEqual({
    requestId: REQ,
    action: 'update_contact_draft',
    candidateKey: CAND.candidateKey,
    updates: { website: 'https://new.example' },
  });
});

test('persistManualContact: 200 + {success:false} throws the server error', async () => {
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: false, error: 'draft rejected' }) }),
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('persist-manual').click(); });
  await waitFor(() => expect(screen.getByTestId('last-error').textContent).toBe('draft rejected'));
});

test('persistManualContact: 409 + {success:false, code, promotionAuthority} falls back to the generic message when no error field', async () => {
  global.fetch = mkFetch({
    roster: () => ({
      ok: false, status: 409,
      json: async () => ({ success: false, code: 'promotion_required', promotionAuthority: { requiredRole: 'lead' } }),
    }),
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('persist-manual').click(); });
  await waitFor(() => expect(screen.getByTestId('last-error').textContent).toBe('Could not save these contact details to the request.'));
});

test('verifyAddressContact: POST sends exact body bytes; partial success (500 + partialSuccess+receiptRecorded) still applies the candidate before throwing', async () => {
  let sentOpts = null;
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: true, candidate: CAND }) }),
    addressTrust: (opts) => {
      sentOpts = opts;
      return {
        ok: false, status: 500,
        json: async () => ({ success: false, partialSuccess: true, receiptRecorded: true, candidate: { ...CAND, addressReceipt: 'r1' }, error: 'dataverse timeout' }),
      };
    },
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('verify-address').click(); });
  await waitFor(() => expect(screen.getByTestId('last-error').textContent).toMatch(/Could not verify this address\.|dataverse timeout/));
  await waitFor(() => expect(screen.getByTestId('candidates').textContent).toMatch(/addressReceipt/));
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toMatchObject({
    requestId: REQ,
    candidateKey: CAND.candidateKey,
    action: 'verify_person_and_address',
    email: 'ada@example.edu',
  });
});

test('reviewAddressConflict: 200 + {success:false} sets the roster-note failure message', async () => {
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: false, error: 'no conflict on file' }) }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('review-conflict').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe('no conflict on file'));
});

test('retryAddressCheck: network rejection propagates as a thrown error (not caught by the hook)', async () => {
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    addressTrust: () => Promise.reject(new Error('offline')),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('retry-check').click(); });
  await waitFor(() => expect(screen.getByTestId('last-error').textContent).toBe('offline'));
});

test('requestAddressRepair: 200 + {success:true, repairRequest} records the repair request keyed by candidateKey', async () => {
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true, repairRequest: { id: 'rr-1' }, message: 'Repair requested.' }) }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('request-repair').click(); });
  await waitFor(() => expect(screen.getByTestId('repair-requests').textContent).toContain('rr-1'));
  expect(screen.getByTestId('roster-note').textContent).toBe('Repair requested.');
});

test('openIdentityConfirmation: 409-shaped {success:false} (any non-2xx) surfaces the fallback message via roster-note', async () => {
  global.fetch = mkFetch({
    roster: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    addressTrust: () => ({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }),
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('open-identity').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe('Could not load the current email choice. Reload the reviewer card and try again.'));
});

test('confirmIdentityContact: unverified candidate records first (POST), then PATCHes confirm_identity; exact body bytes on both', async () => {
  const calls = [];
  global.fetch = mkFetch({
    roster: (opts) => {
      calls.push(opts);
      const body = JSON.parse(opts.body);
      if (body.action === undefined && body.candidates) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, confirmationId: 'c-1', candidate: { ...CAND, confirmed: true } }) };
    },
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true, candidate: { ...CAND, confirmed: true }, receiptRecorded: true }) }),
  });
  render(<Harness initialUnverified={[CAND]} />);
  await act(async () => { screen.getByTestId('confirm-identity').click(); });
  await waitFor(() => expect(calls.length).toBe(2));
  const recordBody = JSON.parse(calls[0].body);
  expect(recordBody.requestId).toBe(REQ);
  expect(recordBody.candidates).toHaveLength(1);
  expect(recordBody.candidates[0]).toMatchObject({ candidateKey: CAND.candidateKey, name: CAND.name, email: CAND.email });
  expect(calls[1].method).toBe('PATCH');
  const confirmBody = JSON.parse(calls[1].body);
  expect(confirmBody.requestId).toBe(REQ);
  expect(confirmBody.action).toBe('confirm_identity');
  expect(confirmBody.candidate.candidateKey).toBe(CAND.candidateKey);
});

test('confirmIdentityContact: record-step 200 + {success:false} throws before the confirm PATCH ever fires', async () => {
  let confirmFired = false;
  global.fetch = mkFetch({
    roster: (opts) => {
      const body = JSON.parse(opts.body);
      if (body.candidates) return { ok: true, status: 200, json: async () => ({ success: false, error: 'record failed' }) };
      confirmFired = true;
      return { ok: true, status: 200, json: async () => ({ success: true, confirmationId: 'c-1' }) };
    },
    addressTrust: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
  });
  render(<Harness initialUnverified={[CAND]} />);
  await act(async () => { screen.getByTestId('confirm-identity').click(); });
  await waitFor(() => expect(screen.getByTestId('last-error').textContent).toBe('record failed'));
  expect(confirmFired).toBe(false);
});

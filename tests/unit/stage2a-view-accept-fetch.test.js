/**
 * @jest-environment jsdom
 *
 * T5 matrix for Stage2aView's single POST /respond (accept) fetch site.
 * Address/identity validation and policy-ack wiring are covered elsewhere
 * (stage2a-view-address.test.js, stage2a-view-board-identity.test.js); this
 * file isolates the fetch outcome by opting out of the honorarium (no
 * address required) and mocking PolicyAckModal so both slots can be
 * acknowledged with a single click each.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Stage2aView from '../../shared/components/external/Stage2aView';

jest.mock('../../shared/components/external/PolicyAckModal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="policy-modal">
      <button type="button" onClick={props.onAcknowledge}>mock-acknowledge</button>
    </div>
  ),
}));

function makeData() {
  return {
    etag: 'W/"1"',
    proposal: { title: 'A Proposal', applicantInstitution: 'Example University', projectLeader: 'Dr. PI', coPIs: [] },
    prefill: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.org', honorariumOptOut: true },
    policies: {
      'reviewer-coi': { slotCode: 'reviewer-coi', title: 'Conflict of Interest', versionLabel: '1', body: 'COI body' },
      'reviewer-ai-use': { slotCode: 'reviewer-ai-use', title: 'AI Use', versionLabel: '1', body: 'AI body' },
    },
  };
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Academic rank/), { target: { value: 'Professor' } });
  fireEvent.change(screen.getByLabelText(/Primary department/), { target: { value: 'Chemistry' } });
  fireEvent.change(screen.getByLabelText(/Main institution/), { target: { value: 'Stanford University' } });
  for (const button of screen.getAllByRole('button', { name: /Read policy/i })) {
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'mock-acknowledge' }));
  }
}

afterEach(() => jest.restoreAllMocks());

test('(a) a successful accept calls onAccepted', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const onAccepted = jest.fn(async () => {});
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={onAccepted} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith('/api/external/review/tok/respond', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': 'W/"1"' },
  }));
});

test('(b) a 409 with a server message shows it verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ ok: false, message: 'Already handled.' }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Already handled.');
});

test('(b) a 412 shows the optimistic-lock conflict copy', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 412, json: async () => ({ ok: false }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText(/Someone else updated this invitation/i);
});

test('(b) reason:policy_misconfigured shows the configuration-error copy', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, reason: 'policy_misconfigured' }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText(/configuration error on our end/i);
});

test('(b) reason:board_identity_required flags the named fields', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, reason: 'board_identity_required', fields: ['academicRank'] }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText(/Please complete your academic rank/i);
  expect(screen.getByText('Please enter your academic rank.')).toBeInTheDocument();
});

test('(b) any other non-ok status shows the generic retry copy', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(b) a 2xx body with ok:false is treated as a failure too (body-level flag, not status)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false }) });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(c) a network rejection shows the network-error copy', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Network error. Please try again.');
});

test('(d) a malformed 2xx body is tolerated to {} and treated as a failure', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(e) a non-2xx unparseable body (502 gateway page) is tolerated to {} and hits the generic retry copy', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } });
  render(<Stage2aView data={makeData()} token="tok" onRequestDecline={() => {}} onAccepted={() => {}} />);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

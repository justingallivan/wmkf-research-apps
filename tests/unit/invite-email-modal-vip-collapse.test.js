/**
 * @jest-environment jsdom
 *
 * VIP routing in InviteEmailModal (plan: reviewer invitation VIP preview
 * slice). VIP-flagged, skipped, quick-check, edited, expanded, and
 * single-candidate drafts render as full editable cards; everything else
 * collapses to the batch summary. Collapse is view state only — the send
 * payload is unchanged.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteEmailModal from '../../shared/components/reviewers/InviteEmailModal';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

function draft(id, name, extra = {}) {
  return {
    suggestionId: id,
    candidateName: name,
    candidateEmail: `${id.toLowerCase()}@example.org`,
    subject: `Invitation for ${name}`,
    body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/send_time_token.pending_authority.not_live',
    externalLinkExpected: true,
    ...extra,
  };
}

function mockJson(data, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data };
}

function mockRender(drafts) {
  global.fetch.mockImplementation(async (url) => {
    if (String(url).startsWith('/api/user-preferences')) return mockJson({});
    if (url === '/api/review-manager/campaign-timeline-defaults') {
      return mockJson({ timeline: {}, isDefault: true, malformed: false });
    }
    if (url === '/api/review-manager/render-emails') return mockJson({ drafts });
    if (url === '/api/review-manager/send-emails') {
      return { ok: true, body: { getReader: () => ({ read: jest.fn() }) } };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const CANDIDATES = [
  { suggestionId: 'S1', name: 'VIP Person', email: 's1@example.org', potentialReviewerId: 'pr-1', vip: true },
  { suggestionId: 'S2', name: 'Standard One', email: 's2@example.org', potentialReviewerId: 'pr-2', vip: false },
  { suggestionId: 'S3', name: 'Standard Two', email: 's3@example.org', potentialReviewerId: 'pr-3', vip: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

test('VIP drafts render full editable cards; standard drafts collapse to the summary', async () => {
  mockRender([draft('S1', 'VIP Person'), draft('S2', 'Standard One'), draft('S3', 'Standard Two')]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText('2 standard invitations ready')).toBeTruthy());
  // The VIP draft has an editable subject input; collapsed drafts have none.
  expect(screen.getByDisplayValue('Invitation for VIP Person')).toBeTruthy();
  expect(screen.queryByDisplayValue('Invitation for Standard One')).toBeNull();
  // Collapsed names still listed in the summary.
  expect(screen.getByText('Standard One')).toBeTruthy();
  expect(screen.getByText('Standard Two')).toBeTruthy();
});

test('a quick-check draft renders full even when not VIP (collapse must never hide a required confirmation)', async () => {
  mockRender([
    draft('S1', 'VIP Person'),
    draft('S2', 'Standard One', { emailConfidence: { action: 'quick_check', reason: 'generic mailbox' } }),
    draft('S3', 'Standard Two'),
  ]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText('1 standard invitation ready')).toBeTruthy());
  // S2 (quick-check) gets a full card with its editable subject despite vip:false.
  expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy();
  // Only S3 collapsed.
  expect(screen.queryByDisplayValue('Invitation for Standard Two')).toBeNull();
});

test('the ★ VIP badge marks only VIP full cards, not other full cards', async () => {
  mockRender([
    draft('S1', 'VIP Person'),
    draft('S2', 'Standard One', { emailConfidence: { action: 'quick_check', reason: 'generic mailbox' } }),
    draft('S3', 'Standard Two'),
  ]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText('1 standard invitation ready')).toBeTruthy());
  // Two full cards (S1 VIP, S2 quick-check) but exactly one badge, on the VIP card.
  expect(screen.getAllByText('★ VIP')).toHaveLength(1);
});

test('no ★ VIP badge under vipUnknown — every card is full, but nobody is known-VIP', async () => {
  mockRender([draft('S1', 'VIP Person'), draft('S2', 'Standard One'), draft('S3', 'Standard Two')]);
  const unknownCandidates = CANDIDATES.map((c) => ({ ...c, vip: false }));
  render(
    <InviteEmailModal requestId="req-1" candidates={unknownCandidates} vipUnknown onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard Two')).toBeTruthy());
  expect(screen.queryByText('★ VIP')).toBeNull();
});

test('Review expands a collapsed draft into a full editable card', async () => {
  mockRender([draft('S1', 'VIP Person'), draft('S2', 'Standard One'), draft('S3', 'Standard Two')]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText('2 standard invitations ready')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy());
  expect(screen.getByText('1 standard invitation ready')).toBeTruthy();
});

test('a single-candidate open renders a full card regardless of VIP state', async () => {
  mockRender([draft('S2', 'Standard One')]);
  render(
    <InviteEmailModal
      requestId="req-1"
      candidates={[CANDIDATES[1]]}
      onClose={() => {}}
      onSent={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy());
  expect(screen.queryByText(/standard invitation.* ready/)).toBeNull();
});

test('vipUnknown (flags failed to load) renders EVERY draft full — a read failure must not collapse a VIP', async () => {
  mockRender([draft('S1', 'VIP Person'), draft('S2', 'Standard One'), draft('S3', 'Standard Two')]);
  // Simulate the panel's fail-closed path: flags GET failed, so every
  // candidate arrives vip:false but vipUnknown is set.
  const unknownCandidates = CANDIDATES.map((c) => ({ ...c, vip: false }));
  render(
    <InviteEmailModal
      requestId="req-1"
      candidates={unknownCandidates}
      vipUnknown
      onClose={() => {}}
      onSent={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for VIP Person')).toBeTruthy());
  expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy();
  expect(screen.getByDisplayValue('Invitation for Standard Two')).toBeTruthy();
  expect(screen.queryByText(/standard invitations? ready/)).toBeNull();
});

test('a draft that would fail the send-time body-integrity gate renders FULL — collapse never hides a missing link or unresolved token', async () => {
  mockRender([
    draft('S1', 'VIP Person'),
    // Missing the secure /external/review/ link → server would withhold it.
    draft('S2', 'Standard One', { body: 'Please use your secure personal link:\n' }),
    // Unresolved {{token}} → server would withhold it.
    draft('S3', 'Standard Two', { body: 'Dear {{candidateName}},\nhttps://reviews.wmkeck.org/external/review/token.value' }),
  ]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  // Both defective drafts get full editable cards despite vip:false…
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy());
  expect(screen.getByDisplayValue('Invitation for Standard Two')).toBeTruthy();
  // …so nothing is left to collapse.
  expect(screen.queryByText(/standard invitations? ready/)).toBeNull();
});

test('a LINKLESS draft renders FULL even when the template expected no link — the send gate withholds every linkless invitation', async () => {
  mockRender([
    draft('S1', 'VIP Person'),
    draft('S2', 'Standard One', { body: 'No reviewer link anywhere.', externalLinkExpected: false }),
    draft('S3', 'Standard Two'),
  ]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy());
  expect(screen.queryByDisplayValue('Invitation for Standard Two')).toBeNull();
  expect(screen.getByText('1 standard invitation ready')).toBeTruthy();
});

test('a hardcoded malformed reviewer path renders FULL even when externalLinkExpected is false', async () => {
  mockRender([
    draft('S1', 'VIP Person'),
    draft('S2', 'Standard One', {
      body: 'Hardcoded link: https://reviews.wmkeck.org/external/review/token.value',
      externalLinkExpected: false,
    }),
    draft('S3', 'Standard Two'),
  ]);
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Invitation for Standard One')).toBeTruthy());
  expect(screen.queryByDisplayValue('Invitation for Standard Two')).toBeNull();
  expect(screen.getByText('1 standard invitation ready')).toBeTruthy();
});

test('collapsed drafts are still included in the send payload unchanged', async () => {
  mockRender([draft('S1', 'VIP Person'), draft('S2', 'Standard One'), draft('S3', 'Standard Two')]);
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({ event: 'result', data: { sent: [], failed: [], skipped: [] } });
  });
  render(
    <InviteEmailModal requestId="req-1" candidates={CANDIDATES} onClose={() => {}} onSent={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText('2 standard invitations ready')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Send 3 invitations/i }));
  await waitFor(() => {
    const sendCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
    expect(sendCall).toBeTruthy();
    const body = JSON.parse(sendCall[1].body);
    expect(body.drafts.map((d) => d.suggestionId).sort()).toEqual(['S1', 'S2', 'S3']);
    expect(body.templateType).toBe('invitation');
  });
});

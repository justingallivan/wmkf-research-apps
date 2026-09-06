/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/reviewer-finder/generate-emails-service.js
 * (Reviewer Lifecycle Stage 3F).
 *
 * Mocks the EXTRACTED module (`reviewer-engagement/record-invitation`)
 * wholesale and drives the legacy caller (`generateEmails`, mark-as-sent
 * loop) to pin: it calls `markInvitationGenerated` once per generated
 * suggestionId with `{ suggestionId, now }`, and a rejection is
 * best-effort — it increments nothing but the loop continues to the next
 * id. This must go red if `generateEmails` reimplements the mark-as-sent
 * write inline while keeping the import.
 */

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: jest.fn(),
  patchFields: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/app-request-person', () => ({
  queryPersons: jest.fn(async () => ({ records: [] })),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: jest.fn(async () => 600),
}));
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async () => ({ text: 'personalized' })),
  })),
}));

// The module under delegation test: mocked wholesale so this suite pins
// only the CALL SHAPE and best-effort continuation, never the real write
// logic (that is covered directly by tests/unit/record-invitation.test.js).
const markInvitationGenerated = jest.fn(async () => {});
jest.mock('../../lib/services/reviewer-engagement/record-invitation', () => ({
  markInvitationGenerated: (...a) => markInvitationGenerated(...a),
}));

import { generateEmails } from '../../lib/services/reviewer-finder/generate-emails-service';

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');

const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';

function recordingOnEvent() {
  const events = [];
  const onEvent = (e) => events.push(e);
  return { events, onEvent };
}

function baseArgs(overrides = {}) {
  const candidates = overrides.candidates || [
    { name: 'Dr. Reviewer', email: 'reviewer@example.org' },
  ];
  const validCandidates = candidates.filter((c) => c.email);
  return {
    candidates,
    validCandidates,
    skippedCount: candidates.length - validCandidates.length,
    suggestionIds: validCandidates.map((c) => c.suggestionId).filter((id) => id != null),
    template: { subject: 'Hi {{name}}', body: 'Please review.' },
    settings: { senderEmail: 'staff@wmkeck.org' },
    proposalInfo: undefined,
    attachmentConfig: {},
    options: {},
    userProfileId: 'p-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  suggestionAdapter.findById.mockResolvedValue(null);
});

test('mark-as-sent loop calls markInvitationGenerated once per id with { suggestionId, now }', async () => {
  const { events, onEvent } = recordingOnEvent();
  await generateEmails(
    baseArgs({
      candidates: [
        { name: 'A', email: 'a@example.org', suggestionId: SUGGESTION_ID },
        { name: 'B', email: 'b@example.org', suggestionId: OTHER_ID },
      ],
      options: { markAsSent: true },
    }),
    onEvent,
  );

  expect(markInvitationGenerated).toHaveBeenCalledTimes(2);
  expect(markInvitationGenerated).toHaveBeenNthCalledWith(1, { suggestionId: SUGGESTION_ID, now: expect.any(String) });
  expect(markInvitationGenerated).toHaveBeenNthCalledWith(2, { suggestionId: OTHER_ID, now: expect.any(String) });
  // One batch timestamp computed once before the loop, not recomputed per row.
  expect(markInvitationGenerated.mock.calls[0][0].now).toBe(markInvitationGenerated.mock.calls[1][0].now);

  const result = events.find((e) => e.event === 'result');
  expect(result.data.stats.markedAsSent).toBe(2);
});

test('options.markAsSent: false never calls markInvitationGenerated', async () => {
  const { events, onEvent } = recordingOnEvent();
  await generateEmails(
    baseArgs({
      candidates: [
        { name: 'A', email: 'a@example.org', suggestionId: SUGGESTION_ID },
        { name: 'B', email: 'b@example.org', suggestionId: OTHER_ID },
      ],
      options: { markAsSent: false },
    }),
    onEvent,
  );

  expect(markInvitationGenerated).not.toHaveBeenCalled();
  const result = events.find((e) => e.event === 'result');
  expect(result.data.stats.markedAsSent).toBe(0);
});

test('a rejection for one id is best-effort: no count for it, but the loop continues to the next id', async () => {
  markInvitationGenerated
    .mockRejectedValueOnce(new Error('dataverse down'))
    .mockResolvedValueOnce(undefined);

  const { events, onEvent } = recordingOnEvent();
  await generateEmails(
    baseArgs({
      candidates: [
        { name: 'A', email: 'a@example.org', suggestionId: SUGGESTION_ID },
        { name: 'B', email: 'b@example.org', suggestionId: OTHER_ID },
      ],
      options: { markAsSent: true },
    }),
    onEvent,
  );

  expect(markInvitationGenerated).toHaveBeenCalledTimes(2);
  const result = events.find((e) => e.event === 'result');
  expect(result.data.stats.markedAsSent).toBe(1);
  expect(events.map((e) => e.event)).toContain('complete');
});

/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/generate-emails-service.js
 * (Route→Service Consolidation Plan, micro-stage 2s — Decision 1a streaming
 * pilot). Logic-level coverage with adapters mocked — the test layer that
 * could not exist while the logic lived in the route. The service emits
 * events through `onEvent({ event, data })` and never touches `res`;
 * assertions run against a recording onEvent.
 *
 * Covers: happy-path event emission order, non-terminal per-candidate
 * failure (errors[] + loop continues), the time-budget abort path
 * (terminal `error` with timeout:true, no result/complete), and mark-sent
 * best-effort semantics (a patchFields failure is skipped, not terminal).
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
  // complete() honors the AbortSignal so the time-budget abort test can force
  // a real mid-loop abort without mocking timers.
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(({ signal } = {}) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ text: 'personalized' }), 200);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }
    })),
  })),
}));

import { generateEmails } from '../../lib/services/reviewer-finder/generate-emails-service';

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const timeBudget = require('../../lib/services/reviewer-time-budget');

const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';

function recordingOnEvent() {
  const events = [];
  const onEvent = (e) => events.push(e);
  return { events, onEvent };
}

/** Minimal valid (shell-pre-validated) args for one plain candidate. */
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
});

test('happy path: emits progress(starting) → progress(generating) → email_generated → result → complete, in order', async () => {
  const { events, onEvent } = recordingOnEvent();
  await generateEmails(baseArgs(), onEvent);

  expect(events.map((e) => e.event)).toEqual([
    'progress',
    'progress',
    'email_generated',
    'result',
    'complete',
  ]);
  expect(events[0].data).toMatchObject({ stage: 'starting', total: 1, skipped: 0 });
  expect(events[1].data).toMatchObject({ stage: 'generating', current: 1, total: 1, candidate: 'Dr. Reviewer' });
  expect(events[2].data).toMatchObject({
    index: 0,
    candidateName: 'Dr. Reviewer',
    candidateEmail: 'reviewer@example.org',
  });
  expect(events[3].data.emails).toHaveLength(1);
  expect(events[3].data.stats).toEqual({ total: 1, generated: 1, skipped: 0, errors: 0, markedAsSent: 0 });
  expect(events[4].data).toMatchObject({ generated: 1, skipped: 0, markedAsSent: 0 });
});

test('non-terminal per-candidate failure: recorded in result.errors, loop continues to complete', async () => {
  const emailGenerator = require('../../lib/utils/email-generator');
  const spy = jest
    .spyOn(emailGenerator, 'generateEmlContent')
    .mockImplementationOnce(() => {
      throw new Error('boom');
    });

  const { events, onEvent } = recordingOnEvent();
  await generateEmails(
    baseArgs({
      candidates: [
        { name: 'Fails First', email: 'fails@example.org' },
        { name: 'Succeeds Second', email: 'ok@example.org' },
      ],
    }),
    onEvent,
  );
  spy.mockRestore();

  expect(events.filter((e) => e.event === 'email_generated')).toHaveLength(1);
  const result = events.find((e) => e.event === 'result');
  expect(result.data.stats).toMatchObject({ total: 2, generated: 1, errors: 1 });
  expect(result.data.errors).toEqual([
    { candidateName: 'Fails First', error: 'Failed to generate email' },
  ]);
  expect(events.map((e) => e.event)).toContain('complete');
  expect(events.map((e) => e.event)).not.toContain('error');
});

test('time-budget abort: terminal error event with timeout:true, no result/complete, service resolves (never throws)', async () => {
  // 50ms virtual budget; the mocked LLMClient.complete() takes 200ms and
  // rejects on abort, so the deadline fires mid-personalization.
  timeBudget.getReviewerTimeBudgetSeconds.mockResolvedValueOnce(0.05);

  const prevKey = process.env.CLAUDE_API_KEY;
  process.env.CLAUDE_API_KEY = 'test-key';
  try {
    const { events, onEvent } = recordingOnEvent();
    await expect(
      generateEmails(
        baseArgs({
          candidates: [
            { name: 'Slow One', email: 'slow@example.org' },
            { name: 'Never Reached', email: 'never@example.org' },
          ],
          options: { useClaudePersonalization: true },
        }),
        onEvent,
      ),
    ).resolves.toBeUndefined();

    const last = events[events.length - 1];
    expect(last.event).toBe('error');
    expect(last.data.timeout).toBe(true);
    expect(last.data.message).toMatch(/exceeding the configured/i);
    expect(events.map((e) => e.event)).not.toContain('result');
    expect(events.map((e) => e.event)).not.toContain('complete');
    expect(events.filter((e) => e.event === 'email_generated')).toHaveLength(0);
  } finally {
    if (prevKey === undefined) delete process.env.CLAUDE_API_KEY;
    else process.env.CLAUDE_API_KEY = prevKey;
  }
}, 10000);

test('mark-sent is best-effort per suggestion: a patchFields failure is skipped, run still completes', async () => {
  // Two candidates with (GUID-valid) suggestionIds; the suggestion lookup
  // itself is exercised (findById), then the first patch fails.
  const OTHER_ID = '44444444-4444-4444-8444-444444444444';
  suggestionAdapter.findById.mockResolvedValue(null); // lookup misses → proposalInfo fallback
  suggestionAdapter.patchFields
    .mockRejectedValueOnce(new Error('dataverse down'))
    .mockResolvedValueOnce({});

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

  expect(suggestionAdapter.patchFields).toHaveBeenCalledTimes(2);
  expect(suggestionAdapter.patchFields).toHaveBeenCalledWith(
    SUGGESTION_ID,
    expect.objectContaining({ wmkf_invited: true }),
  );

  // updating_database progress frame emitted, and only the surviving patch counts.
  expect(events.some((e) => e.event === 'progress' && e.data.stage === 'updating_database')).toBe(true);
  const result = events.find((e) => e.event === 'result');
  expect(result.data.stats).toMatchObject({ generated: 2, markedAsSent: 1 });
  expect(events[events.length - 1].event).toBe('complete');
  expect(events[events.length - 1].data.markedAsSent).toBe(1);
});

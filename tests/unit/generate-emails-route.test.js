/**
 * @jest-environment node
 *
 * Tests-before coverage (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6)
 * for pages/api/reviewer-finder/generate-emails.js ahead of converting its
 * grant-request-owned + reviewer-suggestion-owned raw DynamicsService calls
 * to their adapters (the wmkf_apprequestpersons Co-PI lookup has no owning
 * adapter in this cluster and stays raw). Captures CURRENT behavior: golden
 * path (single candidate, no suggestionId, generates one email) and one
 * failure path (no candidates → SSE error, no email generated).
 *
 * Extended (docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md Decision 1a, micro-stage
 * 2s Phase A — pre-extraction SSE event-contract commit): pins the FULL event
 * vocabulary this route emits — event names, payload key sets, ordering, the
 * two terminal events (`complete` on success, `error` on failure), the
 * pre-stream 405 (no SSE headers touched), every pre-stream validation
 * `error` event, the non-terminal per-candidate failure path (added to
 * `result.errors`, stream continues), and the mid-stream time-budget abort
 * (`error` with `timeout:true`, no `result`/`complete`). Characterization
 * only — pins CURRENT behavior, not a spec, ahead of extracting this route's
 * business logic into a service per Decision 1a (framing/headers/write/end
 * stay in the route shell).
 */
import { createMockReq } from '../helpers/auth-mock';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 'p-1' })) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => async () => true }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), queryRecords: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: jest.fn(),
}));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../lib/services/reviewer-time-budget', () => ({ getReviewerTimeBudgetSeconds: jest.fn(async () => 600) }));
jest.mock('../../lib/services/llm-client', () => ({
  // Only instantiated when options.useClaudePersonalization + a Claude API key
  // are both present. The mock `complete()` honors the AbortSignal so the
  // time-budget-abort characterization test below can force a real mid-loop
  // abort without mocking timers.
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

function mockRes() {
  const events = [];
  const res = {
    setHeader: jest.fn(),
    write: jest.fn((chunk) => {
      const s = String(chunk);
      const m = s.match(/^event: (.+)\n$/);
      if (m) events.push({ event: m[1] });
      const dm = s.match(/^data: (.+)\n\n$/);
      if (dm && events.length) events[events.length - 1].data = JSON.parse(dm[1]);
    }),
    end: jest.fn(),
    events,
  };
  // Pre-stream (non-SSE) responses use the plain status/json envelope
  // (405 method-not-allowed; auth/rate-limit guards short-circuit before
  // this handler's own res calls, so those aren't exercised here).
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/generate-emails').default;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('golden path: one candidate with no suggestionId generates one email', async () => {
  const req = createMockReq({
    method: 'POST',
    body: {
      candidates: [{ name: 'Dr. Reviewer', email: 'reviewer@example.org' }],
      template: { subject: 'Hi {{name}}', body: 'Please review.' },
      settings: { senderEmail: 'staff@wmkeck.org' },
      options: {},
    },
  });
  const res = mockRes();
  await handler(req, res);

  const result = res.events.find((e) => e.event === 'result');
  expect(result).toBeDefined();
  expect(result.data.stats).toMatchObject({ total: 1, generated: 1, skipped: 0, errors: 0 });
  expect(result.data.emails).toHaveLength(1);
});

test('failure path: no candidates → SSE error event, no emails generated', async () => {
  const req = createMockReq({
    method: 'POST',
    body: { candidates: [], template: { subject: 'x', body: 'y' }, settings: { senderEmail: 'a@b.com' } },
  });
  const res = mockRes();
  await handler(req, res);

  const errorEvent = res.events.find((e) => e.event === 'error');
  expect(errorEvent).toBeDefined();
  expect(errorEvent.data.message).toMatch(/No candidates/);
});

// ---------------------------------------------------------------------------
// Pre-stream, non-SSE response (guard runs before SSE headers are set)
// ---------------------------------------------------------------------------

test('non-POST method → 405 JSON envelope, no SSE headers/events touched', async () => {
  const req = createMockReq({ method: 'GET', body: {} });
  const res = mockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  expect(res.setHeader).not.toHaveBeenCalled();
  expect(res.write).not.toHaveBeenCalled();
  expect(res.events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Pre-processing validation → single terminal `error` event, no other events
// ---------------------------------------------------------------------------

test.each([
  [
    'missing template',
    { candidates: [{ name: 'A', email: 'a@b.com' }], settings: { senderEmail: 'a@b.com' } },
    /template/i,
  ],
  [
    'missing sender email',
    {
      candidates: [{ name: 'A', email: 'a@b.com' }],
      template: { subject: 's', body: 'b' },
      settings: {},
    },
    /Sender email/,
  ],
  [
    'no candidates have email addresses',
    {
      candidates: [{ name: 'A' }],
      template: { subject: 's', body: 'b' },
      settings: { senderEmail: 'a@b.com' },
    },
    /email addresses/,
  ],
  [
    'malformed suggestionId is rejected before any Dataverse lookup',
    {
      candidates: [{ name: 'A', email: 'a@b.com', suggestionId: 'not-a-guid' }],
      template: { subject: 's', body: 'b' },
      settings: { senderEmail: 'a@b.com' },
    },
    /valid GUID/,
  ],
])('validation error: %s → SSE headers set, one terminal error event, res.end called', async (_label, body, messagePattern) => {
  const req = createMockReq({ method: 'POST', body });
  const res = mockRes();
  await handler(req, res);

  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  expect(res.events).toHaveLength(1);
  expect(res.events[0].event).toBe('error');
  expect(Object.keys(res.events[0].data)).toEqual(['message']);
  expect(res.events[0].data.message).toMatch(messagePattern);
  expect(res.end).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Full event vocabulary + ordering on the happy path
// ---------------------------------------------------------------------------

test('event vocabulary + ordering: progress(starting) → progress(generating) → email_generated → result → complete', async () => {
  const req = createMockReq({
    method: 'POST',
    body: {
      candidates: [{ name: 'Dr. Reviewer', email: 'reviewer@example.org' }],
      template: { subject: 'Hi {{name}}', body: 'Please review.' },
      settings: { senderEmail: 'staff@wmkeck.org' },
      options: {},
    },
  });
  const res = mockRes();
  await handler(req, res);

  expect(res.events.map((e) => e.event)).toEqual([
    'progress',
    'progress',
    'email_generated',
    'result',
    'complete',
  ]);

  const [startProgress, genProgress, emailGenerated, result, complete] = res.events;

  expect(startProgress.data).toMatchObject({ stage: 'starting', total: 1, skipped: 0 });
  expect(Object.keys(startProgress.data).sort()).toEqual(
    ['message', 'skipped', 'stage', 'total', 'uniqueProposals'].sort(),
  );

  expect(genProgress.data).toMatchObject({ stage: 'generating', current: 1, total: 1 });
  expect(Object.keys(genProgress.data).sort()).toEqual(
    ['candidate', 'current', 'message', 'stage', 'total'].sort(),
  );

  // suggestionId is undefined for a candidate with none, and JSON.stringify
  // drops undefined-valued keys — pin the absence for this fixture, not a
  // fixed key set (a candidate WITH a suggestionId would include it).
  expect(Object.keys(emailGenerated.data).sort()).toEqual(
    ['candidateEmail', 'candidateName', 'filename', 'index', 'subject'].sort(),
  );
  expect(emailGenerated.data).not.toHaveProperty('suggestionId');

  expect(Object.keys(result.data).sort()).toEqual(['emails', 'stats'].sort());
  // `errors` is JSON.stringify-omitted (`undefined`) when there are none —
  // pin the absence, not just the presence, of the optional key.
  expect(result.data).not.toHaveProperty('errors');
  expect(Object.keys(result.data.stats).sort()).toEqual(
    ['errors', 'generated', 'markedAsSent', 'skipped', 'total'].sort(),
  );

  expect(Object.keys(complete.data).sort()).toEqual(
    ['generated', 'markedAsSent', 'message', 'skipped'].sort(),
  );
  expect(res.end).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Non-terminal per-candidate failure: added to result.errors, stream continues
// ---------------------------------------------------------------------------

test('per-candidate generation failure is non-terminal: recorded in result.errors, loop continues to complete', async () => {
  const emailGenerator = require('../../lib/utils/email-generator');
  const spy = jest
    .spyOn(emailGenerator, 'generateEmlContent')
    .mockImplementationOnce(() => {
      throw new Error('boom');
    });

  const req = createMockReq({
    method: 'POST',
    body: {
      candidates: [
        { name: 'Fails First', email: 'fails@example.org' },
        { name: 'Succeeds Second', email: 'ok@example.org' },
      ],
      template: { subject: 'Hi {{name}}', body: 'Please review.' },
      settings: { senderEmail: 'staff@wmkeck.org' },
      options: {},
    },
  });
  const res = mockRes();
  await handler(req, res);
  spy.mockRestore();

  // Only the surviving candidate gets an `email_generated` event.
  expect(res.events.filter((e) => e.event === 'email_generated')).toHaveLength(1);

  const result = res.events.find((e) => e.event === 'result');
  expect(result.data.stats).toMatchObject({ total: 2, generated: 1, errors: 1 });
  expect(result.data.errors).toEqual([
    { candidateName: 'Fails First', error: 'Failed to generate email' },
  ]);

  // Non-terminal: the stream still reaches `complete`, not `error`.
  expect(res.events.map((e) => e.event)).toContain('complete');
  expect(res.events.map((e) => e.event)).not.toContain('error');
});

// ---------------------------------------------------------------------------
// Mid-stream terminal failure: generic exception after streaming has started
// ---------------------------------------------------------------------------

test('mid-stream generic failure (after progress has started): terminal error event, no result/complete', async () => {
  const timeBudget = require('../../lib/services/reviewer-time-budget');
  timeBudget.getReviewerTimeBudgetSeconds.mockRejectedValueOnce(new Error('config lookup failed'));

  const req = createMockReq({
    method: 'POST',
    body: {
      candidates: [{ name: 'Dr. Reviewer', email: 'reviewer@example.org' }],
      template: { subject: 'Hi {{name}}', body: 'Please review.' },
      settings: { senderEmail: 'staff@wmkeck.org' },
      options: {},
    },
  });
  const res = mockRes();
  await handler(req, res);

  // The `starting` progress event proves the stream was already underway —
  // this is a mid-stream failure, not a pre-processing validation error.
  expect(res.events.some((e) => e.event === 'progress' && e.data.stage === 'starting')).toBe(true);

  expect(res.events[res.events.length - 1].event).toBe('error');
  expect(res.events[res.events.length - 1].data).toEqual({ message: 'Failed to generate email' });
  expect(res.events.map((e) => e.event)).not.toContain('result');
  expect(res.events.map((e) => e.event)).not.toContain('complete');
  expect(res.end).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Mid-stream time-budget abort: distinct terminal error envelope (timeout:true)
// ---------------------------------------------------------------------------

test('mid-stream time-budget abort: terminal error event carries timeout:true, no result/complete', async () => {
  const timeBudget = require('../../lib/services/reviewer-time-budget');
  // 50ms virtual budget; the mocked LLMClient.complete() above takes 200ms and
  // rejects on abort, so the deadline fires mid-personalization for candidate 1.
  timeBudget.getReviewerTimeBudgetSeconds.mockResolvedValueOnce(0.05);

  const prevKey = process.env.CLAUDE_API_KEY;
  process.env.CLAUDE_API_KEY = 'test-key';
  try {
    const req = createMockReq({
      method: 'POST',
      body: {
        candidates: [
          { name: 'Slow One', email: 'slow@example.org' },
          { name: 'Never Reached', email: 'never@example.org' },
        ],
        template: { subject: 'Hi {{name}}', body: 'Please review.' },
        settings: { senderEmail: 'staff@wmkeck.org' },
        options: { useClaudePersonalization: true },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.events[res.events.length - 1].event).toBe('error');
    expect(res.events[res.events.length - 1].data.timeout).toBe(true);
    expect(res.events[res.events.length - 1].data.message).toMatch(/exceeding the configured/i);
    expect(res.events.map((e) => e.event)).not.toContain('result');
    expect(res.events.map((e) => e.event)).not.toContain('complete');
    expect(res.events.filter((e) => e.event === 'email_generated')).toHaveLength(0);
    expect(res.end).toHaveBeenCalledTimes(1);
  } finally {
    if (prevKey === undefined) delete process.env.CLAUDE_API_KEY;
    else process.env.CLAUDE_API_KEY = prevKey;
  }
}, 10000);

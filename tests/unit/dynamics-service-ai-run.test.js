/**
 * DynamicsService ai-run characterization — Checkpoint F (Stage 9) baseline.
 *
 * Pins the behavior of the AI Run Logging cluster BEFORE it moves to
 * lib/services/dynamics/ai-run.js, so the extraction is provably a
 * behavior-freeze:
 *   - `logAiRun` resolves `AI_RUN_TASK_TYPES`/`AI_RUN_STATUSES` as STATIC
 *     PROPERTY reads, not calls — this is the C1 "known trap" (plan doc): a
 *     naive `function logAiRun(svc, ...)` extraction that left these as
 *     `this.*` would dereference an unbound receiver and throw. Pinning
 *     `svc.AI_RUN_TASK_TYPES`/`svc.AI_RUN_STATUSES` resolution here means the
 *     post-extraction facade MUST keep re-exposing the frozen statics.
 *   - Unknown taskType / status both throw with the full valid-keys list in
 *     the message (a byte-identical error-shape freeze).
 *   - `_truncateForMemo`'s marker math: no-op under the cap, truncates +
 *     appends the "…[truncated N chars]" marker over the cap, with the total
 *     output length staying at exactly maxChars.
 *   - `createRecord` dispatch (svc.createRecord) still fires under context.
 *
 * Only `fetch` is mocked; the REAL `logAiRun` runs, so it is wrapped in
 * `bypassDynamicsRestrictions` to establish the trusted DAL context that
 * `createRecord`'s `assertTrustedDalContext` requires.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:dynamics-service-ai-run', fn);
}

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  fetch.mockReset();
  DynamicsService.clearCaches();
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('login.microsoftonline.com')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ wmkf_ai_runid: 'run-1', wmkf_ai_runnum: 'AI-1' }),
    });
  });
});

describe('AI_RUN_TASK_TYPES / AI_RUN_STATUSES — facade-static resolution (C1 trap)', () => {
  test('a known taskType + status resolves via the facade statics and writes the numeric codes', ctx(async () => {
    const result = await DynamicsService.logAiRun({
      requestGuid: '11111111-1111-1111-1111-111111111111',
      taskType: 'summary',
      model: 'claude-test',
      status: 'completed',
    });
    expect(result).toEqual({ runId: 'run-1', runNum: 'AI-1' });

    const calls = fetch.mock.calls.filter(([url]) => !String(url).includes('login.microsoftonline.com'));
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.wmkf_ai_tasktype).toBe(DynamicsService.AI_RUN_TASK_TYPES.summary);
    expect(body.wmkf_ai_status).toBe(DynamicsService.AI_RUN_STATUSES.completed);
  }));

  test('unknown taskType throws listing the valid keys', ctx(async () => {
    await expect(
      DynamicsService.logAiRun({
        requestGuid: '11111111-1111-1111-1111-111111111111',
        taskType: 'not-a-real-type',
        model: 'claude-test',
        status: 'completed',
      }),
    ).rejects.toThrow(/unknown taskType "not-a-real-type".*summary.*report.*check-in.*pd_assignment/s);
  }));

  test('unknown status throws listing the valid keys', ctx(async () => {
    await expect(
      DynamicsService.logAiRun({
        requestGuid: '11111111-1111-1111-1111-111111111111',
        taskType: 'summary',
        model: 'claude-test',
        status: 'not-a-real-status',
      }),
    ).rejects.toThrow(/unknown status "not-a-real-status".*completed.*failed.*needs_review/s);
  }));

  test('missing requestGuid throws before touching the network', ctx(async () => {
    await expect(
      DynamicsService.logAiRun({ taskType: 'summary', model: 'claude-test', status: 'completed' }),
    ).rejects.toThrow(/requestGuid is required/);
    const nonTokenCalls = fetch.mock.calls.filter(([url]) => !String(url).includes('login.microsoftonline.com'));
    expect(nonTokenCalls).toHaveLength(0);
  }));
});

describe('_truncateForMemo — marker math', () => {
  test('a string at or under the cap passes through unchanged', () => {
    expect(DynamicsService._truncateForMemo('short', 100)).toBe('short');
    expect(DynamicsService._truncateForMemo('', 100)).toBe('');
  });

  test('a string over the cap is truncated and carries the visible marker, total length == maxChars', () => {
    const s = 'x'.repeat(3000);
    const result = DynamicsService._truncateForMemo(s, 2000);
    expect(result.length).toBe(2000);
    expect(result).toMatch(/…\[truncated 1000 chars\]$/);
  });
});

describe('logAiRun — notes truncation composes with _truncateForMemo', () => {
  test('a notes string over 2000 chars is truncated in the write payload', ctx(async () => {
    const longNotes = 'n'.repeat(2500);
    await DynamicsService.logAiRun({
      requestGuid: '11111111-1111-1111-1111-111111111111',
      taskType: 'report',
      model: 'claude-test',
      status: 'failed',
      notes: longNotes,
    });
    const calls = fetch.mock.calls.filter(([url]) => !String(url).includes('login.microsoftonline.com'));
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.wmkf_ai_notes.length).toBe(2000);
    expect(body.wmkf_ai_notes).toMatch(/…\[truncated \d+ chars\]$/);
  }));
});

/**
 * Unit tests for lib/services/operational-event-service.js.
 *
 * Covers: insert paths (plain / drain dedupe / app fold-reopen), best-effort
 * never-throw contract, redaction + size caps in the sanitization boundary,
 * recovery/supersede marking, admin status transitions, bounded querying.
 *
 * @jest-environment node
 */

const sqlMock = jest.fn();
sqlMock.query = jest.fn();
jest.mock('@vercel/postgres', () => ({
  sql: Object.assign((strings, ...values) => sqlMock(strings, ...values), {
    query: (...args) => sqlMock.query(...args),
  }),
}));

const OperationalEventService = require('../../lib/services/operational-event-service');
const { sanitizeMetadata, _internal } = require('../../lib/services/operational-event-service');
const { canonicalizeKey } = _internal;

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.query.mockReset();
});

function lastQueryText() {
  const [strings] = sqlMock.mock.calls[sqlMock.mock.calls.length - 1];
  return strings.join(' ');
}

describe('recordEvent', () => {
  test('plain app event inserts and returns id', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const result = await OperationalEventService.recordEvent({
      eventType: 'grantee_submit_failed',
      severity: 'error',
      summary: 'SharePoint upload failed',
      subsystem: 'grantee-submit',
      requestNumber: '1002912',
    });
    expect(result).toEqual({ id: 7, folded: false });
    expect(lastQueryText()).toContain('INSERT INTO operational_events');
    expect(lastQueryText()).not.toContain('ON CONFLICT');
  });

  test('drain event uses ON CONFLICT DO NOTHING and marks duplicates distinctly from failures', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [] });
    const result = await OperationalEventService.recordEvent({
      source: 'vercel-drain',
      eventType: 'runtime_5xx',
      severity: 'error',
      summary: 'lambda /api/x status 500',
      dedupeKey: 'vercel:abc123',
    });
    // Duplicate is a marker object; null is reserved for storage FAILURE so
    // the drain route can refuse acknowledgement (Codex cycle-3 finding).
    expect(result).toEqual({ duplicate: true });
    expect(lastQueryText()).toContain('DO NOTHING');
  });

  test('app event with dedupe key folds/reopens via ON CONFLICT DO UPDATE', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 3, folded: true }] });
    const result = await OperationalEventService.recordEvent({
      eventType: 'honorarium_onboard_failed',
      severity: 'warning',
      summary: 'dataverse no-response: This operation was aborted',
      dedupeKey: 'alert:honorarium_onboard_failed:sugg-1',
      recoveryKey: 'honorarium_onboard_failed:sugg-1',
    });
    expect(result).toEqual({ id: 3, folded: true });
    const text = lastQueryText();
    expect(text).toContain('DO UPDATE');
    expect(text).toContain("occurrence_count = operational_events.occurrence_count + 1");
    // Settled rows reopen on recurrence.
    expect(text).toContain("IN ('recovered', 'resolved', 'superseded')");
  });

  test('identity keys are canonicalized, never redacted: distinct long ids stay distinct (Codex cycle-4 finding)', async () => {
    // Display redaction's long-token rule collapsed distinct ≥40-char opaque
    // ids into the same '[REDACTED:long-token]' dedupe key → false duplicate
    // → acknowledged data loss. Identity must be stable and collision-free.
    const idA = `vercel:${'a'.repeat(250)}`;
    const idB = `vercel:${'b'.repeat(250)}`;
    sqlMock.mockResolvedValue({ rows: [{ id: 1 }] });
    await OperationalEventService.recordEvent({
      source: 'vercel-drain', eventType: 'runtime_5xx', severity: 'error',
      summary: 's', dedupeKey: idA,
    });
    await OperationalEventService.recordEvent({
      source: 'vercel-drain', eventType: 'runtime_5xx', severity: 'error',
      summary: 's', dedupeKey: idB,
    });
    const keyA = sqlMock.mock.calls[0].slice(1).find(v => typeof v === 'string' && v.startsWith('vercel:'));
    const keyB = sqlMock.mock.calls[1].slice(1).find(v => typeof v === 'string' && v.startsWith('vercel:'));
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toContain('[REDACTED');
    expect(keyA).toContain('sha256:');
    expect(keyA.length).toBeLessThanOrEqual(200);

    // A normal documented-shape Vercel id passes through EXACTLY.
    await OperationalEventService.recordEvent({
      source: 'vercel-drain', eventType: 'runtime_5xx', severity: 'error',
      summary: 's', dedupeKey: 'vercel:1573817187330377061717300000',
    });
    const keyC = sqlMock.mock.calls[2].slice(1).find(v => typeof v === 'string' && v.startsWith('vercel:'));
    expect(keyC).toBe('vercel:1573817187330377061717300000');
  });

  test('recovery lookups canonicalize identically to stored keys (symmetry)', async () => {
    const longKey = `honorarium_onboard_failed:${'x'.repeat(300)}`;
    expect(canonicalizeKey(longKey)).toBe(canonicalizeKey(longKey));

    // Record side: the INSERTED recovery-key parameter must be the canonical
    // form — without this half, deleting recordEvent's canonicalization would
    // leave the lookup-side assertion green while production recovery missed
    // overlong stored keys (Codex cycle-5 finding).
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await OperationalEventService.recordEvent({
      eventType: 'honorarium_onboard_failed',
      severity: 'warning',
      summary: 's',
      recoveryKey: longKey,
    });
    const storedKey = sqlMock.mock.calls[0].slice(1)
      .find(v => typeof v === 'string' && v.startsWith('honorarium_onboard_failed:'));
    expect(storedKey).toBe(canonicalizeKey(longKey));
    expect(storedKey).toContain('sha256:');

    // Lookup side: markRecovered must query with the identical canonical form.
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await OperationalEventService.markRecovered(longKey);
    const lookupKey = sqlMock.mock.calls[1].slice(1)
      .find(v => typeof v === 'string' && v.startsWith('honorarium_onboard_failed:'));
    expect(lookupKey).toBe(storedKey);
  });

  test('never throws: SQL failure returns null and leaves caller unaffected', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(OperationalEventService.recordEvent({
      eventType: 'x', severity: 'error', summary: 'y',
    })).resolves.toBeNull();
  });

  test('missing eventType is skipped without insert', async () => {
    await expect(OperationalEventService.recordEvent({ summary: 'orphan' }))
      .resolves.toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('invalid severity coerces to error and info severity defaults status info', async () => {
    sqlMock.mockResolvedValue({ rows: [{ id: 1 }] });
    await OperationalEventService.recordEvent({
      eventType: 'weird', severity: 'catastrophic', summary: 's',
    });
    let values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain('error');

    await OperationalEventService.recordEvent({
      eventType: 'notice', severity: 'info', summary: 's',
    });
    values = sqlMock.mock.calls[1].slice(1);
    expect(values).toContain('info');
    // status derived 'info' — both severity and status present
    expect(values.filter(v => v === 'info').length).toBeGreaterThanOrEqual(2);
  });

  test('summary is redacted and capped before insert', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const secret = 'Bearer abcdefghijklmnop';
    const email = 'reviewer@example.org';
    await OperationalEventService.recordEvent({
      eventType: 'x',
      severity: 'error',
      summary: `failed for ${email} with ${secret} ${'lorem ipsum '.repeat(500)}`,
    });
    const values = sqlMock.mock.calls[0].slice(1);
    const summary = values.find(v => typeof v === 'string' && v.startsWith('failed for'));
    expect(summary).toContain('[REDACTED:email]');
    expect(summary).toContain('Bearer [REDACTED]');
    expect(summary).not.toContain('reviewer@example.org');
    expect(summary.length).toBeLessThanOrEqual(2020);
    expect(summary).toContain('[truncated]');
  });
});

describe('sanitizeMetadata', () => {
  test('redacts sensitive keys, strings, and caps structures', () => {
    const clean = sanitizeMetadata({
      authorization: 'Bearer xyz',
      sessionToken: 'abc',
      contactEmail: 'person@example.org',
      note: 'reach me at person@example.org',
      nested: { deep: { deeper: { tooDeep: true } } },
      list: Array.from({ length: 30 }, (_, i) => i),
      count: 3,
      ok: true,
    });
    expect(clean.authorization).toBe('[REDACTED]');
    expect(clean.sessionToken).toBe('[REDACTED]');
    expect(clean.contactEmail).toBe('[REDACTED]');
    expect(clean.note).toContain('[REDACTED:email]');
    expect(clean.nested.deep.deeper).toBe('[max-depth]');
    expect(clean.list.length).toBe(21);
    expect(clean.list[20]).toBe('[+10 more]');
    expect(clean.count).toBe(3);
    expect(clean.ok).toBe(true);
  });

  test('redacts IP addresses by key vocabulary AND value pattern (Codex finding 2026-08-19)', () => {
    const clean = sanitizeMetadata({
      ip: '203.0.113.9',
      ipAddress: '198.51.100.2',
      remoteAddress: '192.0.2.1',
      'x-forwarded-for': '203.0.113.7, 198.51.100.9',
      note: 'request came from 203.0.113.9 and fe80::1ff:fe23:4567:890a today',
    });
    const json = JSON.stringify(clean);
    expect(json).not.toContain('203.0.113.9');
    expect(json).not.toContain('198.51.100.2');
    expect(json).not.toContain('192.0.2.1');
    expect(json).not.toContain('198.51.100.9');
    expect(json).not.toContain('fe80::1ff:fe23:4567:890a');
    // Denylisted keys are fully redacted; the bare `ip` key survives via the
    // value-level pattern backstop.
    expect(clean.ipAddress).toBe('[REDACTED]');
    expect(clean.remoteAddress).toBe('[REDACTED]');
    expect(clean['x-forwarded-for']).toBe('[REDACTED]');
    expect(clean.ip).toBe('[REDACTED:ip]');
    expect(clean.note).toContain('[REDACTED:ip]');
  });

  test('projects Error objects to message/code only (no stack, no cause)', () => {
    const err = new Error('boom at person@example.org');
    err.code = 'dataverse_timeout';
    err.stack = 'SECRET-STACK';
    err.cause = { body: 'huge' };
    const clean = sanitizeMetadata({ error: err });
    expect(clean.error).toEqual({
      message: expect.stringContaining('[REDACTED:email]'),
      code: 'dataverse_timeout',
    });
    expect(JSON.stringify(clean)).not.toContain('SECRET-STACK');
  });

  test('oversized metadata collapses to a truncation marker', () => {
    const big = {};
    for (let i = 0; i < 40; i += 1) big[`k${i}`] = 'lorem ipsum '.repeat(35);
    const clean = sanitizeMetadata(big);
    expect(clean.truncated).toBe(true);
  });
});

describe('markRecovered / markSuperseded', () => {
  test('marks open rows by recovery key and returns count', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const count = await OperationalEventService.markRecovered('honorarium_onboard_failed:sugg-1');
    expect(count).toBe(2);
    const text = lastQueryText();
    expect(text).toContain("status = 'open'");
    expect(text).toContain('recovery_key =');
  });

  test('never throws on SQL failure (returns 0)', async () => {
    sqlMock.mockRejectedValueOnce(new Error('down'));
    await expect(OperationalEventService.markSuperseded('key')).resolves.toBe(0);
  });

  test('empty key is a no-op', async () => {
    await expect(OperationalEventService.markRecovered('')).resolves.toBe(0);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('setEventStatus', () => {
  test('resolve stamps resolved status', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 5, status: 'resolved' }] });
    const row = await OperationalEventService.setEventStatus(5, 'resolve', { profileId: 9 });
    expect(row).toEqual({ id: 5, status: 'resolved' });
    expect(lastQueryText()).toContain("status <> 'info'");
  });

  test('stale expected state throws stale_state with the current row (Codex cycle-3 finding)', async () => {
    // Conditional UPDATE misses (row folded a new occurrence and reopened),
    // then the existence probe finds the live row → 409 material.
    sqlMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'open', last_occurred_at: 'now', occurrence_count: 3 }] });
    await expect(OperationalEventService.setEventStatus(5, 'resolve', {
      profileId: 9,
      expectedStatus: 'open',
      expectedLastOccurredAt: '2026-08-19T00:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'stale_state',
      current: expect.objectContaining({ occurrence_count: 3 }),
    });
  });

  test('missing row returns null (404), not stale_state', async () => {
    sqlMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(OperationalEventService.setEventStatus(999, 'resolve', {}))
      .resolves.toBeNull();
  });

  test('invalid action throws typed error', async () => {
    await expect(OperationalEventService.setEventStatus(5, 'delete'))
      .rejects.toMatchObject({ code: 'invalid_action' });
  });

  test('invalid id throws typed error', async () => {
    await expect(OperationalEventService.setEventStatus('abc', 'resolve'))
      .rejects.toMatchObject({ code: 'invalid_id' });
  });

  test('malformed expectedLastOccurredAt is a typed 400, not a 500 (Codex cycle-6 note)', async () => {
    await expect(OperationalEventService.setEventStatus(5, 'resolve', {
      expectedLastOccurredAt: 'not-a-date',
    })).rejects.toMatchObject({ code: 'invalid_action' });
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('queryEvents', () => {
  test('bounds hours and limit, applies filters and search', async () => {
    sqlMock.query.mockResolvedValueOnce({ rows: [] });
    await OperationalEventService.queryEvents({
      status: 'open',
      severity: 'error',
      source: 'vercel-drain',
      search: '1002912',
      hours: 999999,
      limit: 99999,
    });
    const [text, values] = sqlMock.query.mock.calls[0];
    expect(text).toContain('FROM operational_events');
    expect(values).toContain(2160); // hours clamped to 90 days
    expect(values).toContain(500); // limit clamped
    expect(values).toContain('open');
    expect(values).toContain('error');
    expect(values).toContain('vercel-drain');
    expect(values).toContain('%1002912%');
  });

  test('unknown filter values are ignored (no injection into WHERE)', async () => {
    sqlMock.query.mockResolvedValueOnce({ rows: [] });
    await OperationalEventService.queryEvents({ status: "x'; DROP TABLE", severity: 'nope' });
    const [text] = sqlMock.query.mock.calls[0];
    expect(text).not.toContain('DROP TABLE');
    // only the window + limit params remain
    expect(sqlMock.query.mock.calls[0][1]).toHaveLength(2);
  });
});

describe('setEventStatuses (bulk)', () => {
  test('applies each row with its own precondition and buckets the outcomes', async () => {
    // Row 5: updated. Row 6: precondition miss → current row exists → stale.
    // Row 7: no such row → notFound. Row 'x': invalid id (never queried).
    sqlMock
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'resolved' }] }) // UPDATE 5
      .mockResolvedValueOnce({ rows: [] })                               // UPDATE 6 (miss)
      .mockResolvedValueOnce({ rows: [{ id: 6, status: 'open', last_occurred_at: 'later', occurrence_count: 2 }] }) // SELECT 6
      .mockResolvedValueOnce({ rows: [] })                               // UPDATE 7 (miss)
      .mockResolvedValueOnce({ rows: [] });                              // SELECT 7 (gone)
    const outcome = await OperationalEventService.setEventStatuses([
      { id: 5, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:00.000Z' },
      { id: 6, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:01.000Z' },
      { id: 7, expectedStatus: 'open' },
      { id: 'x' },
    ], 'resolve', { profileId: 9, note: 'bulk' });
    expect(outcome).toEqual({ updated: [5], stale: [6], notFound: [7], invalid: [NaN] });
    expect(sqlMock).toHaveBeenCalledTimes(5);
  });

  test('rejects an invalid action before touching the database', async () => {
    await expect(OperationalEventService.setEventStatuses([{ id: 1 }], 'nuke')).rejects.toMatchObject({ code: 'invalid_action' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('rejects a batch over the admin list cap', async () => {
    await expect(OperationalEventService.setEventStatuses(new Array(501).fill({ id: 1 }), 'resolve'))
      .rejects.toMatchObject({ code: 'batch_too_large' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('an unexpected database error still propagates (not swallowed into a bucket)', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection reset'));
    await expect(OperationalEventService.setEventStatuses([{ id: 1 }], 'resolve')).rejects.toThrow('connection reset');
  });
});

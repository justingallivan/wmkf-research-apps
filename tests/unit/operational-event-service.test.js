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
const { sanitizeMetadata } = require('../../lib/services/operational-event-service');

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

  test('drain event uses ON CONFLICT DO NOTHING and reports duplicate as null', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [] });
    const result = await OperationalEventService.recordEvent({
      source: 'vercel-drain',
      eventType: 'runtime_5xx',
      severity: 'error',
      summary: 'lambda /api/x status 500',
      dedupeKey: 'vercel:abc123',
    });
    expect(result).toBeNull();
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

  test('invalid action throws typed error', async () => {
    await expect(OperationalEventService.setEventStatus(5, 'delete'))
      .rejects.toMatchObject({ code: 'invalid_action' });
  });

  test('invalid id throws typed error', async () => {
    await expect(OperationalEventService.setEventStatus('abc', 'resolve'))
      .rejects.toMatchObject({ code: 'invalid_id' });
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

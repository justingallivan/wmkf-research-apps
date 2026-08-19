/**
 * Unit tests for lib/services/vercel-log-drain-ingest.js.
 *
 * Covers: JSON/NDJSON/test-delivery parsing, the selection policy (what is
 * kept vs skipped), the metadata allowlist (clientIp/userAgent/referer/JA
 * fingerprints NEVER stored), summary redaction, structured-event lifting,
 * and the batch/storage caps with loud dropped counts.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/operational-event-service', () => ({
  recordEvent: jest.fn(),
}));

const OperationalEventService = require('../../lib/services/operational-event-service');
const {
  parseDrainBody,
  classifyEntry,
  buildMetadata,
  buildSummary,
  ingestDrainEntries,
  MAX_ENTRIES_STORED,
} = require('../../lib/services/vercel-log-drain-ingest');

beforeEach(() => {
  OperationalEventService.recordEvent.mockReset();
  OperationalEventService.recordEvent.mockResolvedValue({ id: 1, folded: false });
});

const baseEntry = {
  id: 'log-1',
  deploymentId: 'dpl_x',
  source: 'lambda',
  host: 'apps.example.test',
  timestamp: 1755600000000,
  projectId: 'prj_x',
  level: 'error',
  message: 'Unhandled error in /api/thing',
  path: '/api/thing',
  requestId: 'req-uuid-1',
  environment: 'production',
  statusCode: 500,
  proxy: {
    timestamp: 1755600000000,
    method: 'POST',
    host: 'apps.example.test',
    path: '/api/thing?token=abc',
    userAgent: ['Mozilla/5.0 secret-agent'],
    region: 'iad1',
    statusCode: 500,
    clientIp: '203.0.113.9',
    referer: 'https://apps.example.test/page',
    scheme: 'https',
    vercelCache: 'MISS',
  },
};

describe('parseDrainBody', () => {
  test('parses a JSON array delivery', () => {
    const { entries, malformed } = parseDrainBody(JSON.stringify([baseEntry, baseEntry]));
    expect(entries).toHaveLength(2);
    expect(malformed).toBe(0);
  });

  test('parses NDJSON lines and counts malformed lines', () => {
    const body = `${JSON.stringify(baseEntry)}\nnot-json\n${JSON.stringify(baseEntry)}\n`;
    const { entries, malformed } = parseDrainBody(body);
    expect(entries).toHaveLength(2);
    expect(malformed).toBe(1);
  });

  test('single-object test delivery is accepted', () => {
    const { entries } = parseDrainBody(JSON.stringify(baseEntry));
    expect(entries).toHaveLength(1);
  });

  test('empty body yields no entries', () => {
    expect(parseDrainBody('').entries).toHaveLength(0);
  });
});

describe('classifyEntry selection policy', () => {
  test('error level is kept as error', () => {
    const c = classifyEntry({ ...baseEntry, statusCode: null });
    expect(c.keep).toBe(true);
    expect(c.severity).toBe('error');
  });

  test('fatal level is kept as critical', () => {
    const c = classifyEntry({ ...baseEntry, level: 'fatal' });
    expect(c.keep).toBe(true);
    expect(c.severity).toBe('critical');
  });

  test('statusCode -1 (crash) is kept as critical', () => {
    const c = classifyEntry({ ...baseEntry, level: 'info', statusCode: -1 });
    expect(c.keep).toBe(true);
    expect(c.severity).toBe('critical');
    expect(c.eventType).toBe('runtime_function_crash');
  });

  test('info-level 5xx is kept as error', () => {
    const c = classifyEntry({ ...baseEntry, level: 'info', statusCode: 502 });
    expect(c.keep).toBe(true);
    expect(c.eventType).toBe('runtime_5xx');
  });

  test('info-level 200 is skipped', () => {
    const c = classifyEntry({ ...baseEntry, level: 'info', statusCode: 200, proxy: undefined });
    expect(c.keep).toBe(false);
  });

  test('warning level without failure status is skipped', () => {
    const c = classifyEntry({ ...baseEntry, level: 'warning', statusCode: 200, proxy: undefined });
    expect(c.keep).toBe(false);
  });

  test('structured dependency timeout is kept even at info level/200', () => {
    const structuredMessage = JSON.stringify({
      event: 'workbench.dependency', v: 1, correlationId: 'corr-1',
      dependency: 'dataverse', operation: 'GET', outcome: 'timeout', ms: 30000,
    });
    const c = classifyEntry({
      ...baseEntry, level: 'info', statusCode: 200, message: structuredMessage, proxy: undefined,
    });
    expect(c.keep).toBe(true);
    expect(c.eventType).toBe('runtime_dependency_failure');
    expect(c.structured.correlationId).toBe('corr-1');
  });

  test('structured dependency success is skipped', () => {
    const structuredMessage = JSON.stringify({
      event: 'workbench.dependency', v: 1, outcome: 'success', statusClass: '2xx',
    });
    const c = classifyEntry({
      ...baseEntry, level: 'info', statusCode: 200, message: structuredMessage, proxy: undefined,
    });
    expect(c.keep).toBe(false);
  });
});

describe('metadata allowlist', () => {
  test('never stores clientIp, userAgent, referer, or JA fingerprints', () => {
    const metadata = buildMetadata(
      { ...baseEntry, ja3Digest: 'ja3-secret', ja4Digest: 'ja4-secret' },
      null,
    );
    const json = JSON.stringify(metadata);
    expect(json).not.toContain('203.0.113.9');
    expect(json).not.toContain('secret-agent');
    expect(json).not.toContain('referer');
    expect(json).not.toContain('ja3');
    expect(json).not.toContain('ja4');
    expect(metadata.proxy.method).toBe('POST');
    expect(metadata.proxy.statusCode).toBe(500);
  });

  test('strips query strings from paths', () => {
    const metadata = buildMetadata(baseEntry, null);
    expect(metadata.proxy.path).toBe('/api/thing');
    expect(JSON.stringify(metadata)).not.toContain('token=abc');
  });
});

describe('buildSummary', () => {
  test('redacts secrets and emails in free-text messages', () => {
    const summary = buildSummary({
      ...baseEntry,
      message: 'auth failed for user@example.org with Bearer abcdef123456789012345',
    }, null);
    expect(summary).toContain('[REDACTED:email]');
    expect(summary).toContain('Bearer [REDACTED]');
  });

  test('structured events summarize from closed fields, not raw message', () => {
    const structured = {
      event: 'workbench.dependency', dependency: 'dataverse',
      operation: 'GET', outcome: 'timeout', statusClass: undefined,
    };
    expect(buildSummary(baseEntry, structured))
      .toBe('workbench.dependency dataverse GET timeout');
  });
});

describe('ingestDrainEntries', () => {
  test('stores kept entries with vercel:<id> dedupe key and counts duplicates', async () => {
    OperationalEventService.recordEvent
      .mockResolvedValueOnce({ id: 1, folded: false })
      .mockResolvedValueOnce(null); // duplicate delivery
    const counts = await ingestDrainEntries([
      { ...baseEntry, id: 'a' },
      { ...baseEntry, id: 'b' },
      { ...baseEntry, id: 'c', level: 'info', statusCode: 200, proxy: undefined },
    ]);
    expect(counts).toMatchObject({ considered: 3, stored: 1, duplicates: 1, skipped: 1 });
    const call = OperationalEventService.recordEvent.mock.calls[0][0];
    expect(call.dedupeKey).toBe('vercel:a');
    expect(call.source).toBe('vercel-drain');
    expect(call.occurredAt).toBe(baseEntry.timestamp);
  });

  test('entries without a stable id are counted invalid, not stored', async () => {
    const counts = await ingestDrainEntries([{ ...baseEntry, id: undefined }]);
    expect(counts.invalid).toBe(1);
    expect(OperationalEventService.recordEvent).not.toHaveBeenCalled();
  });

  test('storage cap drops excess entries loudly', async () => {
    const entries = Array.from({ length: MAX_ENTRIES_STORED + 5 }, (_, i) => ({
      ...baseEntry, id: `id-${i}`,
    }));
    const counts = await ingestDrainEntries(entries);
    expect(counts.stored).toBe(MAX_ENTRIES_STORED);
    expect(counts.droppedByCap).toBe(5);
  });

  test('non-array input is a no-op', async () => {
    const counts = await ingestDrainEntries(null);
    expect(counts.considered).toBe(0);
  });
});

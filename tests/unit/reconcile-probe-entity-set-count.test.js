/**
 * Tests for probeEntitySetCount in scripts/reconcile-memory-claims.js.
 *
 * Covers the three failure modes the script must distinguish, since
 * conflating them broke check:memory-drift:
 *
 *   - $top=1 OR $count timeout — DIFFERENT outcomes:
 *       $top=1 timeout → status:'unknown' (entity-exists not proven)
 *       $count timeout → status:200 with count_error:'timeout'
 *                        (huge tables like akoya_requests legitimately
 *                        exceed the 15s timeout on $count alone;
 *                        Codex S185 confirmed this is the desired
 *                        downgrade)
 *
 *   - $count NON-timeout exception (TLS/DNS/etc) — MUST remain
 *     status:'unknown' so it surfaces in probe_errors. Original fix
 *     silently swallowed this; Codex S185 caught the regression.
 *
 *   - $top=1 404 — status:'probe_404' (entity set does not exist).
 *
 *   - $top=1 200 + $count 200 — status:200 with row_count populated.
 */

const {
  buildHistoricalClaimAudit,
  buildLiveSummary,
  extractAtlasFacts,
  nearestAtlasClaim,
  parseClaimAudit,
  probeEntitySetCount,
  writeAuthoritativeReport,
} = require('../../scripts/reconcile-memory-claims.js');
const { checkMemoryDrift, reportIsFresh } = require('../../scripts/check-memory-drift.js');

// Minimal Response-shaped stub. fetchWithTimeout returns a Response;
// production code reads .status, .ok, .text(), and .json() on it.
function makeResponse({ status = 200, body = '', json = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => json,
  };
}

function makeAbortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

const TOKEN = 'test-token';
const ENTITY = 'wmkf_appgrantcycles';
const OPTS_BASE = { _baseUrl: 'https://example.test/api/data/v9.2' };

describe('probeEntitySetCount', () => {
  test('returns status:200 with row count when both probes succeed', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))                                      // $top=1
      .mockResolvedValueOnce(makeResponse({ status: 200, json: { '@odata.count': 42 } }));       // $count=true&$top=1
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 200, entitySet: ENTITY, row_count: 42 });
    expect(_fetch).toHaveBeenCalledTimes(2);
  });

  test('returns status:200 with count_error when $count response lacks @odata.count annotation', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))                                       // $top=1
      .mockResolvedValueOnce(makeResponse({ status: 200, json: { value: [{}] } }));               // $count=true&$top=1 without annotation
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r.status).toBe(200);
    expect(r.entitySet).toBe(ENTITY);
    expect(r.row_count).toBeNull();
    expect(r.count_error).toMatch(/annotation/i);
  });

  test('correctly returns true count above the 5000 OData $count cap', async () => {
    // Regression guard for the apprequestpersons-style false-staleness.
    // Switching from /$count (capped at 5000) to ?$count=true&$top=1
    // unlocks Dataverse's aggregate path which goes up to ~50k.
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))
      .mockResolvedValueOnce(makeResponse({ status: 200, json: { '@odata.count': 5561 } }));
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r.row_count).toBe(5561);
  });

  test('returns probe_404 when $top=1 returns 404 (no $count call)', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 404 }));
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 'probe_404', entitySet: ENTITY, row_count: null });
    expect(_fetch).toHaveBeenCalledTimes(1);
  });

  test('returns unknown when $top=1 returns a non-404 error status', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 503, body: 'Service Unavailable' }));
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r.status).toBe('unknown');
    expect(r.entitySet).toBe(ENTITY);
    expect(r.error).toMatch(/503/);
  });

  test('returns unknown when $top=1 throws (network) — timeout-tagged on AbortError', async () => {
    const _fetch = jest.fn().mockRejectedValueOnce(makeAbortError());
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 'unknown', entitySet: ENTITY, row_count: null, error: 'timeout' });
  });

  test('returns unknown when $top=1 throws (network) — preserves non-timeout error message', async () => {
    const _fetch = jest.fn().mockRejectedValueOnce(new Error('TLS handshake failed'));
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 'unknown', entitySet: ENTITY, row_count: null, error: 'TLS handshake failed' });
  });

  // The Codex-caught regression case: $count AbortError must downgrade to
  // status:200/count_error, but NON-AbortError $count failures must remain
  // status:'unknown' so they surface in probe_errors.
  test('returns status:200 with count_error:timeout when $count aborts (huge-table case)', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))   // $top=1 ok
      .mockRejectedValueOnce(makeAbortError());                // $count timeout
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 200, entitySet: ENTITY, row_count: null, count_error: 'timeout' });
  });

  test('returns status:unknown when $count throws a non-AbortError (TLS/network)', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))                  // $top=1 ok
      .mockRejectedValueOnce(new Error('ECONNRESET socket hang up'));        // $count network err
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r).toEqual({ status: 'unknown', entitySet: ENTITY, row_count: null, error: 'ECONNRESET socket hang up' });
  });

  test('returns status:200 with count_error when $count returns a non-ok response (entity still exists)', async () => {
    const _fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 200 }))                      // $top=1 ok
      .mockResolvedValueOnce(makeResponse({ status: 500, body: 'Server error' })); // $count 500
    const r = await probeEntitySetCount(TOKEN, ENTITY, { ...OPTS_BASE, _fetch });
    expect(r.status).toBe(200);
    expect(r.row_count).toBeNull();
    expect(r.count_error).toMatch(/500/);
  });
});

describe('reconciliation report semantics', () => {
  const completedProbeNotes = { dataverse: 'completed', postgres: 'completed' };

  test('does not replace an authoritative report when a live probe fails', () => {
    const writeFile = jest.fn();
    const failedReport = {
      generated: new Date().toISOString(),
      summary: { live_drift_findings: 0, probe_errors: 1 },
      probe_notes: { dataverse: 'probe_error: fetch failed', postgres: 'completed' },
    };

    expect(() => writeAuthoritativeReport(failedReport, '/tmp/report.json', writeFile))
      .toThrow(/preserved existing/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('does not replace an authoritative report when a probe was skipped', () => {
    const writeFile = jest.fn();
    const skippedReport = {
      generated: new Date().toISOString(),
      summary: { live_drift_findings: 0, probe_errors: 0 },
      probe_notes: { dataverse: 'completed', postgres: 'probe_skipped: missing DATABASE_URL' },
    };

    expect(() => writeAuthoritativeReport(skippedReport, '/tmp/report.json', writeFile))
      .toThrow(/preserved existing/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('fails closed when probe status fields are missing or malformed', () => {
    const writeFile = jest.fn();
    const malformedReport = {
      generated: new Date().toISOString(),
      summary: { live_drift_findings: 0, probe_errors: null },
      probe_notes: { dataverse: 'completed', postgres: 'completed' },
    };

    expect(() => writeAuthoritativeReport(malformedReport, '/tmp/report.json', writeFile))
      .toThrow(/probe_errors=missing/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('writes a report only when both live probes completed cleanly', () => {
    const writeFile = jest.fn();
    const report = {
      generated: new Date().toISOString(),
      summary: { live_drift_findings: 0, probe_errors: 0 },
      probe_notes: completedProbeNotes,
    };

    writeAuthoritativeReport(report, '/tmp/report.json', writeFile);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toContain('"probe_errors": 0');
  });

  test('treats a recent failed or incomplete report as not fresh', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-drift-freshness-'));
    const reportPath = path.join(tempDir, 'report.json');
    const generated = '2026-08-22T12:00:00.000Z';
    const now = Date.parse('2026-08-22T12:01:00.000Z');

    try {
      fs.writeFileSync(reportPath, JSON.stringify({
        generated,
        summary: { probe_errors: 1 },
        probe_notes: { dataverse: 'probe_error: fetch failed', postgres: 'completed' },
      }));
      expect(reportIsFresh(reportPath, now)).toBe(false);

      fs.writeFileSync(reportPath, JSON.stringify({
        generated,
        summary: { probe_errors: 0 },
        probe_notes: completedProbeNotes,
      }));
      expect(reportIsFresh(reportPath, now)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('fails closed without creating a missing report', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-drift-missing-'));
    const missingPath = path.join(tempDir, 'report.json');
    const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

    try {
      expect(checkMemoryDrift(missingPath, { logger })).toBe(false);
      expect(fs.existsSync(missingPath)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('npm run refresh:memory-drift'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('fails closed on an incomplete committed report', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-drift-incomplete-'));
    const targetPath = path.join(tempDir, 'report.json');
    const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

    try {
      fs.writeFileSync(targetPath, JSON.stringify({
        generated: new Date().toISOString(),
        summary: { live_drift_findings: 0, probe_errors: null },
        probe_notes: completedProbeNotes,
        drift_buckets: {},
      }));

      expect(checkMemoryDrift(targetPath, { logger })).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('incomplete or non-authoritative'));
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('evaluates a stale authoritative report without changing its bytes', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-drift-read-only-'));
    const targetPath = path.join(tempDir, 'report.json');
    const reportBytes = `${JSON.stringify({
      generated: '2020-01-01T00:00:00.000Z',
      summary: { live_drift_findings: 0, probe_errors: 0 },
      probe_notes: completedProbeNotes,
      drift_buckets: {},
    }, null, 2)}\n`;
    const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };

    try {
      fs.writeFileSync(targetPath, reportBytes);

      expect(checkMemoryDrift(targetPath, { now: Date.parse('2026-08-29T00:00:00.000Z'), logger })).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(reportBytes);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('read-only'));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('memory drift clean'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('keeps check commands read-only and exposes probing as an explicit refresh', () => {
    const fs = require('fs');
    const scripts = require('../../package.json').scripts;
    const checkerSource = fs.readFileSync(require.resolve('../../scripts/check-memory-drift.js'), 'utf8');

    expect(scripts['check:memory-drift']).not.toContain('reconcile-memory-claims');
    expect(scripts['check:memory-drift:no-write']).not.toContain('reconcile-memory-claims');
    expect(scripts['refresh:memory-drift']).toContain('reconcile-memory-claims.js');
    expect(scripts['refresh:memory-drift']).toContain('check-memory-drift.js');
    expect(checkerSource).not.toContain("require('child_process')");
    expect(checkerSource).not.toContain('reconcile-memory-claims.js');
  });

  test('keeps historical classifications out of the current live summary', () => {
    const historical = buildHistoricalClaimAudit([
      { status: 'stale' },
      { status: 'verified' },
      { status: 'unknown' },
    ]);
    const live = buildLiveSummary({
      specWithoutEntity: [],
      entityWithoutAtlas: [],
      staleRowCount: [{ entity: 'example' }],
      docLabelCollisions: [],
      postgresTableMismatch: [],
      probeErrors: 0,
    });

    expect(live).toEqual({ live_drift_findings: 1, probe_errors: 0 });
    expect(live).not.toHaveProperty('stale');
    expect(live).not.toHaveProperty('verified');
    expect(live).not.toHaveProperty('unknown');
    expect(historical).toMatchObject({
      audit_date: '2026-05-14',
      status: 'historical_snapshot',
      summary: {
        total_claims_at_audit: 3,
        stale_at_audit: 1,
        verified_at_audit: 1,
        unknown_at_audit: 1,
      },
    });
  });

  test('labels the actual S154 source as historical provenance', () => {
    const historical = buildHistoricalClaimAudit(parseClaimAudit());

    expect(historical.source_file).toBe('docs/AUDIT_S154_MEMORY_V2.md');
    expect(historical.status).toBe('historical_snapshot');
    expect(historical.note).toMatch(/not current drift/i);
    expect(historical.claims.length).toBeGreaterThan(0);
  });

  test('prefers the canonical entity Atlas page over historical count mentions', () => {
    const atlasFacts = extractAtlasFacts();
    const claim = nearestAtlasClaim('wmkf_appreviewersuggestions', atlasFacts.rowClaims);

    expect(claim).toMatchObject({
      entity: 'wmkf_appreviewersuggestion',
      // Tracks the dated "Live row count" snapshot on the canonical Atlas
      // page; update together with that page (was 724 pre-2026-08-15).
      atlas_claim: 793,
      source_file: 'docs/atlas/dataverse-wmkf-appreviewersuggestion.md',
    });
  });

  test('parses explicit live counts from multi-entity Atlas sections', () => {
    const atlasFacts = extractAtlasFacts();

    expect(nearestAtlasClaim('wmkf_appgrantcycles', atlasFacts.rowClaims)).toMatchObject({
      entity: 'wmkf_appgrantcycle',
      atlas_claim: 10,
      source_file: 'docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md',
    });
  });
});

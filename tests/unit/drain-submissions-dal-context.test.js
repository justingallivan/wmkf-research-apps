/**
 * Regression pin for the S331 drain enforcement fix: processJob must establish
 * a trusted DAL context around every state handler, because the drain's
 * adapter writes (grant-request / budget-line creates) fail closed under
 * DATAVERSE_DAL_ENFORCEMENT without one. Latent since the S330 prod flip;
 * confirmed by an enforcement probe (an adapter create outside any context
 * rejects with "no trusted Dataverse context") before this fix landed.
 *
 * The test drives the REAL context machinery (no dynamics-context /
 * core-context mocks): a stubbed scanning-state job whose handler asserts it
 * is running inside a trusted Dataverse context.
 */

jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('@vercel/blob', () => ({ get: jest.fn() }));
jest.mock('../../lib/services/graph-service', () => ({ GraphService: {} }));
jest.mock('../../lib/services/alert-service', () => ({
  AlertService: { createAlert: jest.fn(async () => ({})) },
}));

const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');

describe('drain-submissions processJob DAL context (S331 enforcement fix)', () => {
  test('state handlers run inside a trusted Dataverse context', async () => {
    const { _testing } = require('../../pages/api/cron/drain-submissions');
    const seen = { inside: null };

    // Drive processJob with a real dispatchable status but intercept before
    // any Dataverse/Postgres work: handleQueued's first await is the client
    // query — give it a client whose query records context-ness then throws
    // a terminal-classified error so the run stops immediately after probing.
    const probeErr = new Error('probe-stop');
    probeErr.statusCode = 400; // classify() routes 4xx terminal, no retries
    const client = {
      query: jest.fn(async () => {
        // Record only the FIRST query — the in-handler one. Later calls
        // (recordFailure's bookkeeping in processJob's catch) legitimately
        // run outside the handler's DAL context.
        if (seen.inside === null) seen.inside = hasTrustedDalContext();
        throw probeErr;
      }),
    };
    const job = { id: 'job-1', status: 'queued', attempts: 0, lease_token: 't' };

    await _testing.processJob(client, job).catch(() => {});
    expect(seen.inside).toBe(true);
  });
});

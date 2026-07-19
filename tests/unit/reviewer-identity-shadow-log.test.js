/**
 * @jest-environment node
 */

const sqlMock = jest.fn();
jest.mock('@vercel/postgres', () => ({
  sql: (...args) => sqlMock(...args),
}));

const {
  recordShadowComparison,
  recordShadowError,
  _internals,
} = require('../../lib/services/reviewer-identity-shadow-log');
const { RESOLVER_MODE, _internals: runtimeInternals } =
  require('../../lib/services/reviewer-identity-runtime');

const { evaluateWithRuntimeSeam } = runtimeInternals;

function lastInsertValues() {
  const call = sqlMock.mock.calls[sqlMock.mock.calls.length - 1];
  return call.slice(1); // tagged template: [strings, ...values]
}

describe('reviewer identity shadow log (durable, best-effort)', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue({ rowCount: 1 });
    _internals.resetBreaker();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('persists only whitelisted comparison fields', async () => {
    const outcome = await recordShadowComparison({
      runId: 'run-1',
      candidateKey: 'abcd1234abcd1234',
      legacyDecision: 'bind',
      worksDecision: 'review',
      combinedDecision: 'review',
      combinedReason: 'anchor_disagreement',
      anchorsAgree: false,
      name: 'Will Harcombe',
      email: 'someone@example.edu',
      providerPayload: { raw: 'never-stored' },
    });

    expect(outcome).toBe('inserted');
    const values = lastInsertValues();
    expect(values).toEqual([
      'run-1', 'shadow', 'comparison', 'abcd1234abcd1234',
      'bind', 'review', 'review', 'anchor_disagreement', false, null,
    ]);
    const serialized = JSON.stringify(values);
    expect(serialized).not.toContain('Harcombe');
    expect(serialized).not.toContain('example.edu');
    expect(serialized).not.toContain('never-stored');
  });

  test('error rows store a stable code, never the error message', async () => {
    await recordShadowError({
      runId: 'run-2',
      errorCode: 'reviewer_identity_shadow_timeout',
    });
    const values = lastInsertValues();
    expect(values[2]).toBe('error');
    expect(values[9]).toBe('reviewer_identity_shadow_timeout');
  });

  test('clamps oversized text values', async () => {
    await recordShadowComparison({ combinedReason: 'x'.repeat(5000) });
    const values = lastInsertValues();
    expect(values[7]).toHaveLength(_internals.MAX_TEXT);
  });

  test('storage failure resolves without throwing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    sqlMock.mockRejectedValue(new Error('connection refused'));
    await expect(recordShadowComparison({ runId: 'run-3' })).resolves.toBe('failed');
  });

  test('synchronous sql failure resolves without throwing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    sqlMock.mockImplementation(() => {
      throw new Error('client not configured');
    });
    await expect(recordShadowComparison({ runId: 'run-4' })).resolves.toBe('failed');
  });

  test('an insert that never settles is bounded and resolves as failed', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    sqlMock.mockImplementation(() => new Promise(() => {}));

    const outcome = recordShadowComparison({ runId: 'run-timeout' });
    await jest.advanceTimersByTimeAsync(_internals.INSERT_TIMEOUT_MS);

    await expect(outcome).resolves.toBe('failed');
  });

  test('circuit breaker suspends writes after consecutive failures, then recovers', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    sqlMock.mockRejectedValue(new Error('db down'));
    for (let i = 0; i < _internals.FAILURE_THRESHOLD; i += 1) {
      await recordShadowComparison({ runId: `run-${i}` });
    }
    expect(_internals.breaker.suspendedUntil).toBeGreaterThan(Date.now());

    sqlMock.mockClear();
    await expect(recordShadowComparison({ runId: 'suspended' })).resolves.toBe('skipped');
    expect(sqlMock).not.toHaveBeenCalled();

    _internals.breaker.suspendedUntil = Date.now() - 1;
    sqlMock.mockResolvedValue({ rowCount: 1 });
    await expect(recordShadowComparison({ runId: 'recovered' })).resolves.toBe('inserted');
    expect(_internals.breaker.suspendedUntil).toBe(0);
  });

  describe('runtime seam integration (default observers)', () => {
    const suggestion = {
      name: 'Will Harcombe',
      suggestedInstitution: 'University of Minnesota',
    };
    const legacyResult = {
      status: 'probable',
      orcid: '0000-0001-8445-2052',
      selectedRecord: { openAlexId: 'https://openalex.org/A1' },
    };

    function runShadow() {
      jest.spyOn(console, 'info').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      return evaluateWithRuntimeSeam(suggestion, {}, {
        mode: RESOLVER_MODE.SHADOW,
        evaluateLegacy: async () => legacyResult,
        evaluateWorksFirst: async () => ({
          decision: 'bind',
          anchor: 'orcid:0000-0001-8445-2052',
        }),
        createAnchorsMatch: () => async () => true,
      });
    }

    test('default observer writes a durable row with run correlation', async () => {
      const result = await runShadow();
      expect(result).toBe(legacyResult);
      expect(sqlMock).toHaveBeenCalledTimes(1);
      const values = lastInsertValues();
      expect(values[0]).toEqual(expect.any(String)); // minted run id
      expect(values[1]).toBe('shadow');
      expect(values[2]).toBe('comparison');
      expect(values[3]).toMatch(/^[a-f0-9]{16}$/);
      const serialized = JSON.stringify(values);
      expect(serialized).not.toContain('Harcombe');
      expect(serialized).not.toContain('0000-0001-8445-2052');
    });

    test('storage outage never alters the legacy result', async () => {
      sqlMock.mockRejectedValue(new Error('storage outage'));
      const result = await runShadow();
      expect(result).toBe(legacyResult);
    });

    test('synchronous logger failure never alters the legacy result', async () => {
      sqlMock.mockImplementation(() => {
        throw new Error('driver exploded');
      });
      const result = await runShadow();
      expect(result).toBe(legacyResult);
    });
  });
});

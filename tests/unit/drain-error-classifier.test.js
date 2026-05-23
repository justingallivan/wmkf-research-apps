/**
 * drain-error-classifier.test.js
 *
 * Covers all 10 taxonomy categories from drain plan v7 §"Error taxonomy" +
 * §"Explicit pg SQLSTATE mapping". Each category must be exercised so that
 * a regression in classify() (e.g. accidentally widening 412 to all 4xx)
 * fails a test, not production.
 */

const { classify, CAPS } = require('../../lib/utils/drain-error-classifier.js');

function dvErr({ status, dataverseCode, isTransient } = {}) {
  return {
    serviceName: 'dataverse',
    status,
    dataverseCode,
    isTransient,
  };
}

function pgErr({ sqlState, noResponse } = {}) {
  return {
    serviceName: 'postgres',
    sqlState,
    noResponse,
  };
}

describe('classify — Dataverse HTTP status branch', () => {
  test('412 on dataverse → duplicate_pk', () => {
    expect(classify(dvErr({ status: 412 })).category).toBe('duplicate_pk');
  });
  test('409 on dataverse → duplicate_pk', () => {
    expect(classify(dvErr({ status: 409 })).category).toBe('duplicate_pk');
  });
  test('409 on graph (not dataverse) → validation_400 (not duplicate_pk)', () => {
    expect(classify({ serviceName: 'graph', status: 409 }).category).toBe('validation_400');
  });
  test('401 → auth_4xx', () => {
    expect(classify(dvErr({ status: 401 })).category).toBe('auth_4xx');
  });
  test('403 → auth_4xx', () => {
    expect(classify(dvErr({ status: 403 })).category).toBe('auth_4xx');
  });
  test('404 → not_found_404', () => {
    expect(classify(dvErr({ status: 404 })).category).toBe('not_found_404');
  });
  test('400 → validation_400', () => {
    expect(classify(dvErr({ status: 400 })).category).toBe('validation_400');
  });
  test('422 → validation_400', () => {
    expect(classify(dvErr({ status: 422 })).category).toBe('validation_400');
  });
  test('429 → throttle_429', () => {
    expect(classify(dvErr({ status: 429 })).category).toBe('throttle_429');
  });
  test('408 → transient_5xx (per service-error.js convention)', () => {
    expect(classify(dvErr({ status: 408 })).category).toBe('transient_5xx');
  });
  test('502 → transient_5xx', () => {
    expect(classify(dvErr({ status: 502 })).category).toBe('transient_5xx');
  });
  test('503 → transient_5xx', () => {
    expect(classify(dvErr({ status: 503 })).category).toBe('transient_5xx');
  });
});

describe('classify — no-response branch', () => {
  test('noResponse: true → network_no_response', () => {
    expect(classify({ noResponse: true, serviceName: 'dataverse' }).category)
      .toBe('network_no_response');
  });
  test('noResponse takes precedence over status', () => {
    // A wrapped no-response error may carry status=null
    expect(classify({ noResponse: true, status: null }).category)
      .toBe('network_no_response');
  });
});

describe('classify — postgres branch', () => {
  test('40P01 deadlock → pg_transient', () => {
    expect(classify(pgErr({ sqlState: '40P01' })).category).toBe('pg_transient');
  });
  test('40001 serialization failure → pg_transient', () => {
    expect(classify(pgErr({ sqlState: '40001' })).category).toBe('pg_transient');
  });
  test('23505 unique violation → duplicate_pk', () => {
    expect(classify(pgErr({ sqlState: '23505' })).category).toBe('duplicate_pk');
  });
  test('23502 not-null violation → validation_400', () => {
    expect(classify(pgErr({ sqlState: '23502' })).category).toBe('validation_400');
  });
  test('08006 connection failure → network_no_response', () => {
    expect(classify(pgErr({ sqlState: '08006' })).category).toBe('network_no_response');
  });
  test('pg ETIMEDOUT (noResponse on pg-scoped err) → network_no_response', () => {
    expect(classify(pgErr({ noResponse: true })).category).toBe('network_no_response');
  });
});

describe('classify — cloudmersive branch', () => {
  test('cloudmersive 5xx → scan_error', () => {
    expect(classify({ serviceName: 'cloudmersive', status: 503 }).category)
      .toBe('scan_error');
  });
  test('scanResult=infected → scan_infected', () => {
    expect(classify({ scanResult: 'infected' }).category).toBe('scan_infected');
  });
});

describe('classify — retryable / maxAttempts contract', () => {
  test('terminal categories are not retryable', () => {
    const terminals = ['validation_400', 'auth_4xx', 'not_found_404', 'scan_infected'];
    for (const cat of terminals) {
      expect(CAPS[cat]).toBe(0);
    }
  });
  test('retry categories have maxAttempts >= 3', () => {
    const retries = ['throttle_429', 'transient_5xx', 'network_no_response', 'pg_transient'];
    for (const cat of retries) {
      expect(CAPS[cat]).toBeGreaterThanOrEqual(3);
    }
  });
  test('scan_error retries up to 3', () => {
    expect(CAPS.scan_error).toBe(3);
  });
  test('unknown is treated as retryable (defensive)', () => {
    const r = classify({ status: 999 });
    expect(r.category).toBe('unknown');
    expect(r.retryable).toBe(true);
  });
  test('returned shape has category + retryable + maxAttempts', () => {
    const r = classify(dvErr({ status: 429 }));
    expect(r).toHaveProperty('category', 'throttle_429');
    expect(r).toHaveProperty('retryable', true);
    expect(r).toHaveProperty('maxAttempts', 10);
  });
});

describe('classify — defensive inputs', () => {
  test('null → unknown', () => {
    expect(classify(null).category).toBe('unknown');
  });
  test('undefined → unknown', () => {
    expect(classify(undefined).category).toBe('unknown');
  });
  test('non-object → unknown', () => {
    expect(classify('whoops').category).toBe('unknown');
  });
  test('object with no recognized fields → unknown', () => {
    expect(classify({}).category).toBe('unknown');
  });
});

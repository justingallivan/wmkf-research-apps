/**
 * @jest-environment node
 *
 * Owner-run Wave 35 tooling: Production runs refuse to start unless the
 * interlock is on and the operator opted in, and the round-trip script only
 * touches one row of a marked test request.
 */
import {
  parseTargetArg, resolveTargetResource, hasDatedProdWriteAck,
} from '../../scripts/lib/dataverse-script-target.cjs';
import {
  parseArgs, assertRoundTripAllowed, originalValues, matches,
} from '../../scripts/roundtrip-reviewer-outcomes-test-row.mjs';
import { DID_NOT_SUBMIT_REVIEW_STATUS_VALUE, ENDED_BY_VALUES } from '../../shared/config/reviewerOutcome.js';

const DATE = '2026-10-31';
const PROD_ENV = {
  DYNAMICS_URL: 'https://wmkf.crm.dynamics.com/',
  DYNAMICS_SANDBOX_URL: 'https://orgd9e66399.crm.dynamics.com',
  DATAVERSE_TARGET_INTERLOCK: 'on',
  DATAVERSE_ALLOW_PROD_READS: 'yes',
  DATAVERSE_PROD_WRITE_ACK: `outcomes schema ${DATE}`,
};
const resolve = (overrides, { target = 'prod', write = false } = {}) => resolveTargetResource({
  target, write, env: { ...PROD_ENV, ...overrides }, date: DATE,
});

describe('dataverse-script-target', () => {
  test('requires an explicit known target', () => {
    expect(() => parseTargetArg(['node', 'x'])).toThrow('--target=prod or --target=sandbox');
    expect(() => parseTargetArg(['node', 'x', '--target=staging'])).toThrow();
    expect(parseTargetArg(['node', 'x', '--target=sandbox'])).toBe('sandbox');
  });

  test('a fully opted-in Production write resolves the registered host', () => {
    expect(resolve({}, { write: true })).toBe('https://wmkf.crm.dynamics.com');
  });

  test.each([
    ['interlock unset', { DATAVERSE_TARGET_INTERLOCK: undefined }, 'DATAVERSE_TARGET_INTERLOCK=on'],
    ['interlock warn', { DATAVERSE_TARGET_INTERLOCK: 'warn' }, 'DATAVERSE_TARGET_INTERLOCK=on'],
    ['reads not allowed', { DATAVERSE_ALLOW_PROD_READS: undefined }, 'DATAVERSE_ALLOW_PROD_READS=yes'],
    ['unregistered host', { DYNAMICS_URL: 'https://other.crm.dynamics.com' }, 'not a registered production'],
  ])('refuses a Production read run: %s', (_label, overrides, message) => {
    expect(() => resolve(overrides)).toThrow(message);
  });

  test.each([
    ['missing ack', { DATAVERSE_PROD_WRITE_ACK: undefined }],
    ['stale ack', { DATAVERSE_PROD_WRITE_ACK: 'outcomes schema 2026-10-30' }],
    ['ack without a purpose', { DATAVERSE_PROD_WRITE_ACK: ` ${DATE}` }],
  ])('refuses a Production write run: %s', (_label, overrides) => {
    expect(() => resolve(overrides, { write: true })).toThrow('DATAVERSE_PROD_WRITE_ACK');
    // The same environment may still read.
    expect(resolve(overrides)).toBe('https://wmkf.crm.dynamics.com');
  });

  test('the sandbox needs no Production opt-in but must be the registered sandbox host', () => {
    const bare = { DATAVERSE_TARGET_INTERLOCK: undefined, DATAVERSE_ALLOW_PROD_READS: undefined, DATAVERSE_PROD_WRITE_ACK: undefined };
    expect(resolve(bare, { target: 'sandbox', write: true })).toBe('https://orgd9e66399.crm.dynamics.com');
    expect(() => resolve({ ...bare, DYNAMICS_SANDBOX_URL: PROD_ENV.DYNAMICS_URL }, { target: 'sandbox' }))
      .toThrow('not a registered sandbox');
  });

  test('ack parsing requires a purpose and today', () => {
    expect(hasDatedProdWriteAck(`x ${DATE}`, DATE)).toBe(true);
    expect(hasDatedProdWriteAck(DATE, DATE)).toBe(false);
  });
});

describe('roundtrip-reviewer-outcomes-test-row', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  const options = [{ Value: 100000006 }, { Value: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE }];
  const row = { '@odata.etag': 'W/"1"', wmkf_endedby: null, wmkf_reviewstatus: 100000001 };
  const request = { wmkf_istestrequest: true };

  test('needs a GUID suggestion and allows --pause only with --execute', () => {
    expect(parseArgs(['node', 'x', `--suggestion=${ID}`, '--target=prod'])).toEqual(
      { execute: false, pause: false, suggestionId: ID },
    );
    expect(() => parseArgs(['node', 'x', '--suggestion=abc'])).toThrow('GUID');
    expect(() => parseArgs(['node', 'x', `--suggestion=${ID}`, '--pause'])).toThrow('--pause');
    expect(() => parseArgs(['node', 'x', `--suggestion=${ID}`, '--force'])).toThrow('Unknown flag');
  });

  test('allows an ordinary row of a marked test request', () => {
    expect(() => assertRoundTripAllowed({ row, request, options })).not.toThrow();
  });

  test.each([
    ['an unmarked request', { request: { wmkf_istestrequest: false } }, 'marked test request'],
    ['a missing marker', { request: {} }, 'marked test request'],
    ['no ETag', { row: { ...row, '@odata.etag': undefined } }, 'ETag'],
    ['Ended by not provisioned', { row: { '@odata.etag': 'W/"1"', wmkf_reviewstatus: null } }, 'wmkf_endedby'],
    ['Did not submit not provisioned', { options: [{ Value: 100000006 }] }, 'does not exist yet'],
    ['a row already holding the test values', {
      row: { ...row, wmkf_endedby: ENDED_BY_VALUES.foundation, wmkf_reviewstatus: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE },
    }, 'already holds'],
  ])('refuses %s', (_label, overrides, message) => {
    expect(() => assertRoundTripAllowed({ row, request, options, ...overrides })).toThrow(message);
  });

  test('restore compares both original values, including nulls', () => {
    const original = originalValues({ wmkf_reviewstatus: 100000001 });
    expect(original).toEqual({ wmkf_endedby: null, wmkf_reviewstatus: 100000001 });
    expect(matches({ wmkf_endedby: null, wmkf_reviewstatus: 100000001 }, original)).toBe(true);
    expect(matches({ wmkf_endedby: ENDED_BY_VALUES.foundation, wmkf_reviewstatus: 100000001 }, original)).toBe(false);
  });
});

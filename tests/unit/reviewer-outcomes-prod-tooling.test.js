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
      { execute: false, pause: false, recover: false, suggestionId: ID },
    );
    expect(() => parseArgs(['node', 'x', '--suggestion=abc'])).toThrow('GUID');
    expect(() => parseArgs(['node', 'x', `--suggestion=${ID}`, '--pause'])).toThrow('--pause');
    expect(() => parseArgs(['node', 'x', `--suggestion=${ID}`, '--force'])).toThrow('Unknown flag');
    expect(() => parseArgs(['node', 'x', `--suggestion=${ID}`, '--execute', '--recover'])).toThrow('not both');
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

describe('roundtrip orchestration against a fake Dataverse', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { runRoundTrip, recover, recordPathFor } = require('../../scripts/roundtrip-reviewer-outcomes-test-row.mjs');
  const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const REQ = '99999999-8888-7777-6666-555555555555';
  const OTHER_REQ = '12345678-1234-1234-1234-123456789012';
  const RESOURCE = 'https://wmkf.crm.dynamics.com';
  const NOON = new Date('2026-10-31T12:00:00Z');
  const TEST = { wmkf_endedby: ENDED_BY_VALUES.foundation, wmkf_reviewstatus: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE };
  let cwd;
  let tmp;

  beforeEach(() => {
    cwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-'));
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function fakeDataverse({ marked = true, patchHook } = {}) {
    const db = {
      version: 1,
      row: { wmkf_endedby: null, wmkf_reviewstatus: 100000001, _wmkf_request_value: REQ },
      requests: { [REQ]: { akoya_requestnum: '1009999', wmkf_istestrequest: marked }, [OTHER_REQ]: { akoya_requestnum: '1001111', wmkf_istestrequest: false } },
      patches: [],
    };
    const snapshot = () => ({ ...db.row, '@odata.etag': `W/"${db.version}"` });
    const client = {
      get: async (p) => {
        if (p.startsWith('/wmkf_appreviewersuggestions(')) return { ok: true, status: 200, body: snapshot(), text: '' };
        if (p.startsWith('/akoya_requests(')) {
          const id = p.match(/\(([^)]+)\)/)[1];
          return { ok: true, status: 200, body: db.requests[id], text: '' };
        }
        return { ok: true, status: 200, body: { OptionSet: { Options: [{ Value: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE }] } }, text: '' };
      },
      patch: async (p, body, headers) => {
        if (patchHook) {
          const hooked = await patchHook({ db, body, headers });
          if (hooked) return hooked;
        }
        if (headers['If-Match'] !== `W/"${db.version}"`) return { ok: false, status: 412, text: 'precondition' };
        db.patches.push(body);
        Object.assign(db.row, body);
        db.version += 1;
        return { ok: true, status: 200, body: snapshot(), text: '' };
      },
    };
    return { db, client };
  }

  const run = (client, extra = {}) => runRoundTrip({
    client, makeRestoreClient: async () => client, resourceUrl: RESOURCE, suggestionId: ID,
    execute: true, pause: false, now: NOON, ...extra,
  });

  test('writes the test values, restores the originals and removes the recovery record', async () => {
    const { db, client } = fakeDataverse();
    await run(client);
    expect(db.patches).toEqual([TEST, { wmkf_endedby: null, wmkf_reviewstatus: 100000001 }]);
    expect(db.row).toMatchObject({ wmkf_endedby: null, wmkf_reviewstatus: 100000001 });
    expect(fs.existsSync(recordPathFor(ID))).toBe(false);
  });

  test('preview writes nothing', async () => {
    const { db, client } = fakeDataverse();
    await run(client, { execute: false });
    expect(db.patches).toEqual([]);
  });

  test('refuses an unmarked request before writing', async () => {
    const { db, client } = fakeDataverse({ marked: false });
    await expect(run(client)).rejects.toThrow('marked test request');
    expect(db.patches).toEqual([]);
  });

  test('a change during the pause makes the restore stop instead of adopting the new version', async () => {
    const { db, client } = fakeDataverse();
    const pauseFn = async () => {
      db.row._wmkf_request_value = OTHER_REQ; // another writer reparents the row
      db.version += 1;
    };
    await expect(run(client, { pause: true, pauseFn })).rejects.toThrow(/412.*--recover/s);
    expect(db.patches).toEqual([TEST]);
    expect(fs.existsSync(recordPathFor(ID))).toBe(true);
    // Recovery also refuses: the row is no longer on the recorded test request.
    await expect(recover({ client, resourceUrl: RESOURCE, suggestionId: ID })).rejects.toThrow('recorded request');
    expect(db.patches).toEqual([TEST]);
  });

  test('a write response without a version is never followed by a blind restore', async () => {
    const { db, client } = fakeDataverse({
      patchHook: ({ db: state, body }) => {
        Object.assign(state.row, body);
        state.version += 1;
        state.patches.push(body);
        return { ok: true, status: 204, body: null, text: '' };
      },
    });
    await expect(run(client)).rejects.toThrow(/no row version.*--recover/s);
    expect(db.patches).toEqual([TEST]);
    expect(fs.existsSync(recordPathFor(ID))).toBe(true);
  });

  test('an ambiguous write keeps the record and --recover restores while the test values are still there', async () => {
    let first = true;
    const { db, client } = fakeDataverse({
      patchHook: ({ db: state, body }) => {
        if (!first) return null;
        first = false;
        Object.assign(state.row, body); // committed server-side, then the connection drops
        state.version += 1;
        state.patches.push(body);
        throw new Error('socket hang up');
      },
    });
    await expect(run(client)).rejects.toThrow(/outcome unknown.*--recover/s);
    expect(db.patches).toEqual([TEST]);
    await recover({ client, resourceUrl: RESOURCE, suggestionId: ID });
    expect(db.row).toMatchObject({ wmkf_endedby: null, wmkf_reviewstatus: 100000001 });
    expect(fs.existsSync(recordPathFor(ID))).toBe(false);
  });

  test('a failing pause still restores', async () => {
    const { db, client } = fakeDataverse();
    await run(client, { pause: true, pauseFn: async () => { throw new Error('stdin closed'); } });
    expect(db.row).toMatchObject({ wmkf_endedby: null, wmkf_reviewstatus: 100000001 });
  });

  test('a 412 on the test write leaves nothing behind', async () => {
    const { db, client } = fakeDataverse({
      patchHook: () => ({ ok: false, status: 412, text: 'precondition' }),
    });
    await expect(run(client)).rejects.toThrow('412');
    expect(db.patches).toEqual([]);
    expect(fs.existsSync(recordPathFor(ID))).toBe(false);
  });

  test('refuses to start near UTC midnight or over an unfinished run', async () => {
    const { db, client } = fakeDataverse();
    await expect(run(client, { now: new Date('2026-10-31T23:45:00Z') })).rejects.toThrow('UTC midnight');
    fs.mkdirSync('outputs');
    fs.writeFileSync(recordPathFor(ID), '{}');
    await expect(run(client)).rejects.toThrow('--recover first');
    expect(db.patches).toEqual([]);
  });

  test('recovery refuses a row holding neither the test nor the original values', async () => {
    const { db, client } = fakeDataverse();
    fs.mkdirSync('outputs');
    fs.writeFileSync(recordPathFor(ID), JSON.stringify({
      resourceUrl: RESOURCE, suggestionId: ID, requestId: REQ, original: { wmkf_endedby: null, wmkf_reviewstatus: 100000000 },
    }));
    await expect(recover({ client, resourceUrl: RESOURCE, suggestionId: ID })).rejects.toThrow('neither');
    expect(db.patches).toEqual([]);
  });
});

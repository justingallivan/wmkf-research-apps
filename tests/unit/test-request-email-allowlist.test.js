/**
 * Test-Request email recipient allowlist (owner, S546; MVP build list item 4):
 * the pure rules, the admin write, and both email seams.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations.js';
import { assertRequestEmailAllowed } from '../../lib/services/test-requests/request-test-state.js';
import {
  TEST_REQUEST_EMAIL_ALLOWLIST_KEY,
  decideRecipients,
  parseAllowlistValue,
  testRequestRecipientsAllowed,
  writeTestRequestEmailAllowlist,
} from '../../lib/services/test-requests/email-allowlist.js';

// The CommonJS module object itself: an `import * as` namespace would be a copy the spy cannot reach.
const settings = require('../../lib/services/settings-service.js');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const EMAIL_ID = '55555555-5555-4555-8555-555555555555';
const SYNTHETIC = { wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID };
const stored = (addresses) => ({ found: true, value: JSON.stringify({ addresses }) });

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:test-request-email-allowlist', fn);
}

describe('decideRecipients (pure)', () => {
  const list = new Set(['tester@gmail.com']);
  test.each([
    [['pd@wmkeck.org'], true],
    [['PD@WMKECK.ORG '], true],
    [['tester@gmail.com'], true],
    [['tester+rev1@gmail.com'], true],
    [['pd@wmkeck.org', 'tester@gmail.com'], true],
    [['someone@wmkeck.org.evil.com'], false],
    [['pd@sub.wmkeck.org'], false],
    [['other@gmail.com'], false],
    [['pd@wmkeck.org', 'real.person@university.edu'], false],
    [[], false],
    [['not an address'], false],
    [[''], false],
  ])('%j -> allowed %s', (recipients, allowed) => {
    expect(decideRecipients(recipients, list).allowed).toBe(allowed);
  });

  test('a malformed stored value throws, so enforcement falls back to the Foundation domain only', async () => {
    expect(() => parseAllowlistValue('{"addresses":["bad"]}')).toThrow();
    const decision = await testRequestRecipientsAllowed(['tester@gmail.com'], { load: async () => { throw new Error('x'); } });
    expect(decision.allowed).toBe(false);
    const foundation = await testRequestRecipientsAllowed(['pd@wmkeck.org'], { load: async () => { throw new Error('x'); } });
    expect(foundation.allowed).toBe(true);
  });
});

describe('writeTestRequestEmailAllowlist', () => {
  test('normalizes, drops Foundation addresses and plus-tags, sorts, and records the editor', async () => {
    const save = jest.fn(async () => true);
    const result = await writeTestRequestEmailAllowlist(['B@x.org', 'a+t@x.org', 'pd@wmkeck.org', 'b@x.org'], 'profile-1', { save });
    expect(result).toEqual({ ok: true, addresses: ['a@x.org', 'b@x.org'] });
    expect(save).toHaveBeenCalledWith(TEST_REQUEST_EMAIL_ALLOWLIST_KEY, JSON.stringify({ addresses: ['a@x.org', 'b@x.org'] }), 'profile-1');
  });

  test('any invalid entry refuses the whole write', async () => {
    const save = jest.fn();
    const result = await writeTestRequestEmailAllowlist(['ok@x.org', 'nope'], 'p', { save });
    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('email seams under TEST_REQUEST_ISOLATION=on', () => {
  let getRecord;
  let writeFetch;
  let getSettingStrict;
  const EMAIL = {
    subject: 'Invitation', body: '<p>Hi</p>', from: 'pd@wmkeck.org', regardingId: REQUEST_ID, regardingType: 'akoya_request',
  };

  beforeAll(() => { process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com'; });
  beforeEach(() => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getRecord = jest.spyOn(DynamicsService, 'getRecord');
    getSettingStrict = jest.spyOn(settings, 'getSettingStrict').mockResolvedValue(stored(['tester@gmail.com']));
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    jest.spyOn(DynamicsService, 'resolveSystemUser').mockResolvedValue('33333333-3333-4333-8333-333333333333');
    jest.spyOn(DynamicsService, 'resolveEntitySetName').mockResolvedValue('akoya_requests');
    writeFetch = jest.spyOn(DynamicsService, '_writeFetch').mockResolvedValue({ ok: true, json: async () => ({ activityid: EMAIL_ID }) });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TEST_REQUEST_ISOLATION;
  });

  describe('createEmailActivity', () => {
    test.each([
      ['a Foundation address', { to: 'reviewer@wmkeck.org' }],
      ['an allowlisted address', { to: 'tester@gmail.com' }],
      ['a plus-tag of an allowlisted address, with a Foundation cc', { to: 'tester+r1@gmail.com', cc: 'pd@wmkeck.org' }],
    ])('creates email about a test request to %s', (_label, parties) => ctx(async () => {
      getRecord.mockResolvedValue(SYNTHETIC);
      await expect(DynamicsService.createEmailActivity({ ...EMAIL, ...parties })).resolves.toBe(EMAIL_ID);
      expect(writeFetch).toHaveBeenCalledTimes(1);
    })());

    test.each([
      ['a real external reviewer', { to: 'real.person@university.edu' }],
      ['an allowed to with a disallowed cc', { to: 'tester@gmail.com', cc: 'real.person@university.edu' }],
    ])('refuses %s before any write', (_label, parties) => ctx(async () => {
      getRecord.mockResolvedValue(SYNTHETIC);
      await expect(DynamicsService.createEmailActivity({ ...EMAIL, ...parties })).rejects.toMatchObject({ code: 'test_request_email_denied' });
      expect(writeFetch).not.toHaveBeenCalled();
    })());

    test('an anomalous marker is refused even with allowed recipients', ctx(async () => {
      getRecord.mockResolvedValue({ wmkf_istestrequest: true, wmkf_testcreationrunid: null });
      await expect(DynamicsService.createEmailActivity({ ...EMAIL, to: 'pd@wmkeck.org' })).rejects.toMatchObject({ code: 'test_request_email_denied' });
      expect(writeFetch).not.toHaveBeenCalled();
    }));

    test('an ordinary request never reads the allowlist', ctx(async () => {
      getRecord.mockResolvedValue({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
      await DynamicsService.createEmailActivity({ ...EMAIL, to: 'real.person@university.edu' });
      expect(getSettingStrict).not.toHaveBeenCalled();
      expect(writeFetch).toHaveBeenCalledTimes(1);
    }));
  });

  describe('sendEmail dispatch recheck', () => {
    const regarding = { _regardingobjectid_value: REQUEST_ID, '_regardingobjectid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'akoya_request' };
    function reads({ request, parties }) {
      getRecord.mockImplementation(async (entitySet, _id, options) => {
        if (entitySet === 'emails') {
          if (options?.expand) {
            if (parties instanceof Error) throw parties;
            return { activityid: EMAIL_ID, email_activity_parties: parties };
          }
          return processAnnotations(regarding);
        }
        return request;
      });
    }

    test('sends when the activity\'s own recipients are all allowed', ctx(async () => {
      writeFetch.mockResolvedValue({ ok: true });
      reads({ request: SYNTHETIC, parties: [
        { participationtypemask: 1, addressused: 'sender@anywhere.org' },
        { participationtypemask: 2, addressused: 'tester+x@gmail.com' },
        { participationtypemask: 3, addressused: 'pd@wmkeck.org' },
      ] });
      await DynamicsService.sendEmail(EMAIL_ID);
      expect(writeFetch).toHaveBeenCalledTimes(1);
    }));

    test.each([
      ['a recipient edited to a real address', [{ participationtypemask: 2, addressused: 'real.person@university.edu' }]],
      ['a bcc to a real address', [{ participationtypemask: 2, addressused: 'pd@wmkeck.org' }, { participationtypemask: 4, addressused: 'real.person@university.edu' }]],
      ['a recipient with no address', [{ participationtypemask: 2, addressused: null }]],
      ['no recipients', [{ participationtypemask: 1, addressused: 'pd@wmkeck.org' }]],
      ['unreadable parties', new Error('boom')],
    ])('refuses, as a definite non-send, %s', (_label, parties) => ctx(async () => {
      reads({ request: SYNTHETIC, parties });
      await expect(DynamicsService.sendEmail(EMAIL_ID)).rejects.toMatchObject({ code: 'test_request_email_denied', dispatched: false });
      expect(writeFetch).not.toHaveBeenCalled();
    })());

    test('an ordinary request never reads the recipients', ctx(async () => {
      writeFetch.mockResolvedValue({ ok: true });
      reads({ request: { wmkf_istestrequest: null, wmkf_testcreationrunid: null }, parties: new Error('should not be read') });
      await DynamicsService.sendEmail(EMAIL_ID);
      expect(getRecord.mock.calls.some(([, , options]) => options?.expand)).toBe(false);
      expect(writeFetch).toHaveBeenCalledTimes(1);
    }));
  });

  describe('assertRequestEmailAllowed (early service refusal)', () => {
    const on = { TEST_REQUEST_ISOLATION: 'on' };
    const synthetic = jest.fn(async () => ({ kind: 'synthetic', reason: 'marker_and_run_valid' }));
    test('allows a test request whose named recipients are allowed', async () => {
      await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve: synthetic, env: on, recipients: ['tester@gmail.com'] })).resolves.toBeUndefined();
    });
    test('refuses a test request with a disallowed or no named recipient', async () => {
      await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve: synthetic, env: on, recipients: ['real.person@university.edu'] }))
        .rejects.toMatchObject({ httpStatus: 409, code: 'test_request_email_denied' });
      await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve: synthetic, env: on }))
        .rejects.toMatchObject({ message: 'Email is disabled for test requests.' });
    });
    test('an unknown state is refused even with allowed recipients', async () => {
      const unknown = jest.fn(async () => ({ kind: 'unknown', reason: 'read_failed' }));
      await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve: unknown, env: on, recipients: ['pd@wmkeck.org'] }))
        .rejects.toMatchObject({ code: 'test_request_email_denied' });
    });
  });
});

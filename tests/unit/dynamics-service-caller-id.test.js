/**
 * MSCRMCallerID impersonation header — unit coverage for write helpers.
 *
 * Verifies:
 *   - Direct write helpers (createRecord/updateRecord/deleteRecord) inject
 *     MSCRMCallerID when actingUserSystemId is supplied AND the impersonation
 *     feature flag is on.
 *   - Composed helpers (updateIfEmpty, logAiRun, createEmailActivity,
 *     addEmailAttachment, sendEmail, createAndSendEmail) propagate the option
 *     down to every underlying write.
 *   - Reads never carry the header (would impersonate for security-role
 *     evaluation and break callers with restricted Dynamics roles).
 *   - The DYNAMICS_IMPERSONATION_ENABLED flag, when off, suppresses the header
 *     even when actingUserSystemId is set.
 *   - Privilege-intersection fallback: a 403 from an impersonated write
 *     triggers a single retry without MSCRMCallerID and the eventual response
 *     is the retry's, with a warning logged.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { withDynamicsContext, bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';

const ACTING_GUID = '00000000-0000-0000-0000-000000000abc';

// Entity-CRUD calls in this file exercise the REAL DynamicsService write
// helpers (only `fetch` is mocked), so under Stage-7 enforcement
// (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md, on by default in test —
// jest.setup.js) they now require a trusted Dataverse context, same as any
// real caller would establish. Every test body below runs wrapped in
// `bypassDynamicsRestrictions` for exactly this reason. (A `beforeEach`
// establishing the context does NOT work here — jest-circus does not run
// hooks and tests in the same AsyncLocalStorage causal chain, so the store
// set in a hook is invisible inside the test body; verified empirically.)
function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:dynamics-service-caller-id', fn);
}

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  // mockClear leaves queued mockImplementationOnce entries from prior tests in
  // place; mockReset wipes them. Without this, a stub from one test bleeds
  // into the next.
  fetch.mockReset();
  DynamicsService.clearCaches();
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';

  // Token endpoint always succeeds first; non-token requests succeed empty.
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('login.microsoftonline.com')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
  });
});

afterEach(() => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
});

function nonTokenCalls() {
  return fetch.mock.calls.filter(([url]) => !String(url).includes('login.microsoftonline.com'));
}

function lastWriteHeaders() {
  const calls = nonTokenCalls();
  return calls.length === 0 ? {} : (calls[calls.length - 1][1]?.headers || {});
}

describe('MSCRMCallerID — direct write helpers', () => {
  test('createRecord adds the header when actingUserSystemId is set', ctx(async () => {
    fetch.mockImplementationOnce((url) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1' }) }),
    );
    await DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' }, { actingUserSystemId: ACTING_GUID });
    expect(lastWriteHeaders().MSCRMCallerID).toBe(ACTING_GUID);
  }));

  test('createRecord omits the header when actingUserSystemId is null', ctx(async () => {
    await DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' });
    expect(lastWriteHeaders().MSCRMCallerID).toBeUndefined();
  }));

  test('updateRecord adds the header alongside If-Match', ctx(async () => {
    await DynamicsService.updateRecord(
      'akoya_requests',
      'guid',
      { wmkf_ai_summary: 'hi' },
      { ifMatch: 'W/"123"', actingUserSystemId: ACTING_GUID },
    );
    const h = lastWriteHeaders();
    expect(h.MSCRMCallerID).toBe(ACTING_GUID);
    expect(h['If-Match']).toBe('W/"123"');
  }));

  test('deleteRecord adds the header', ctx(async () => {
    await DynamicsService.deleteRecord('wmkf_ai_runs', 'guid', { actingUserSystemId: ACTING_GUID });
    expect(lastWriteHeaders().MSCRMCallerID).toBe(ACTING_GUID);
  }));
});

describe('MSCRMCallerID — feature flag', () => {
  test('flag disabled suppresses the header even when actingUserSystemId is supplied', ctx(async () => {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';
    await DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' }, { actingUserSystemId: ACTING_GUID });
    expect(lastWriteHeaders().MSCRMCallerID).toBeUndefined();
  }));

  test('flag unset suppresses the header', ctx(async () => {
    delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
    await DynamicsService.updateRecord('akoya_requests', 'g', { x: 1 }, { actingUserSystemId: ACTING_GUID });
    expect(lastWriteHeaders().MSCRMCallerID).toBeUndefined();
  }));
});

describe('MSCRMCallerID — composed helpers', () => {
  test('logAiRun forwards actingUserSystemId to the underlying createRecord', ctx(async () => {
    await DynamicsService.logAiRun({
      requestGuid: '11111111-1111-1111-1111-111111111111',
      taskType: 'summary',
      model: 'claude-test',
      status: 'completed',
      actingUserSystemId: ACTING_GUID,
    });
    expect(lastWriteHeaders().MSCRMCallerID).toBe(ACTING_GUID);
  }));

  test('logAiRun honors hash rawOutputRetention', ctx(async () => {
    await DynamicsService.logAiRun({
      requestGuid: '11111111-1111-1111-1111-111111111111',
      taskType: 'summary',
      model: 'claude-test',
      status: 'completed',
      rawOutput: 'sensitive generated narrative',
      rawOutputRetention: 'hash',
      actingUserSystemId: ACTING_GUID,
    });

    const calls = nonTokenCalls();
    const body = JSON.parse(calls[calls.length - 1][1].body);
    expect(body.wmkf_ai_rawoutput).not.toContain('sensitive generated narrative');
    expect(JSON.parse(body.wmkf_ai_rawoutput)).toEqual(expect.objectContaining({
      retention: 'hash',
      originalChars: 'sensitive generated narrative'.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  }));

  test('updateIfEmpty: when the field is empty, the PATCH carries the header', async () => {
    // Token, then GET (empty field), then PATCH
    fetch.mockImplementationOnce((url) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ '@odata.etag': 'W/"42"', wmkf_ai_summary: '' }),
      }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
    );

    // getRecord under the hood calls checkRestriction; needs a context.
    const result = await withDynamicsContext({ restrictions: [], requestId: 'test' }, () =>
      DynamicsService.updateIfEmpty(
        'akoya_requests', 'guid', 'wmkf_ai_summary', 'hello',
        { actingUserSystemId: ACTING_GUID },
      ),
    );
    expect(result.ok).toBe(true);

    const calls = nonTokenCalls();
    // Last call is the PATCH; first non-token call is the GET (no caller id on reads).
    expect(calls[0][1].headers.MSCRMCallerID).toBeUndefined();
    expect(calls[calls.length - 1][1].headers.MSCRMCallerID).toBe(ACTING_GUID);
    expect(calls[calls.length - 1][1].headers['If-Match']).toBe('W/"42"');
  });

  test('createAndSendEmail propagates to email create, attachment, and SendEmail', async () => {
    // Token + resolveSystemUser (queryRecords) → returns one row → then create → attachment → send
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    // resolveSystemUser
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: [{ systemuserid: 'user-1' }] }),
      }),
    );
    // createEmailActivity
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ activityid: 'mail-1' }) }),
    );
    // addEmailAttachment
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
    );
    // sendEmail
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
    );

    await withDynamicsContext({ restrictions: [], requestId: 'test' }, () =>
      DynamicsService.createAndSendEmail({
        subject: 's',
        body: 'b',
        from: 'sender@example.com',
        to: 'to@example.com',
        attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('x') }],
        actingUserSystemId: ACTING_GUID,
      }),
    );

    const calls = nonTokenCalls();
    // [0] resolveSystemUser (read — no caller id), [1] email create, [2] attachment, [3] send
    expect(calls[0][1].headers.MSCRMCallerID).toBeUndefined();
    expect(calls[1][1].headers.MSCRMCallerID).toBe(ACTING_GUID);
    expect(calls[2][1].headers.MSCRMCallerID).toBe(ACTING_GUID);
    expect(calls[3][1].headers.MSCRMCallerID).toBe(ACTING_GUID);
  });
});

describe('MSCRMCallerID — privilege-intersection fallback', () => {
  test('403 on impersonated write retries once without the header and surfaces the retry response', ctx(async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Token, then 403 from Dataverse, then the retry succeeds
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () => Promise.resolve('PrincipalPrivilegeDenied'),
        json: () => Promise.resolve({}),
      }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({}),
      }),
    );

    await DynamicsService.updateRecord(
      'akoya_requests', 'guid', { x: 1 },
      { actingUserSystemId: ACTING_GUID },
    );

    const calls = nonTokenCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0][1].headers.MSCRMCallerID).toBe(ACTING_GUID);
    expect(calls[1][1].headers.MSCRMCallerID).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Impersonated write rejected'),
    );

    warnSpy.mockRestore();
  }));

  test('non-403 errors are not retried (regular failure path)', ctx(async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 412,
        text: () => Promise.resolve('PreconditionFailed'),
        json: () => Promise.resolve({}),
      }),
    );

    await expect(
      DynamicsService.updateRecord(
        'akoya_requests', 'guid', { x: 1 },
        { ifMatch: 'W/"old"', actingUserSystemId: ACTING_GUID },
      ),
    ).rejects.toMatchObject({ status: 412 });

    expect(nonTokenCalls()).toHaveLength(1);
  }));

  test('non-impersonated 403 (no caller id) is not retried', ctx(async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () => Promise.resolve('PrincipalPrivilegeDenied'),
        json: () => Promise.resolve({}),
      }),
    );

    await expect(
      DynamicsService.updateRecord('akoya_requests', 'guid', { x: 1 }),
    ).rejects.toThrow(/403/);

    expect(nonTokenCalls()).toHaveLength(1);
  }));
});

describe('Reads never carry MSCRMCallerID', () => {
  test('queryRecords does not include the header even with the flag on', async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
    );
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: [], '@odata.count': 0 }),
      }),
    );

    await withDynamicsContext({ restrictions: [], requestId: 'test' }, () =>
      DynamicsService.queryRecords('wmkf_ai_runs', { top: 1 }),
    );
    expect(lastWriteHeaders().MSCRMCallerID).toBeUndefined();
  });
});

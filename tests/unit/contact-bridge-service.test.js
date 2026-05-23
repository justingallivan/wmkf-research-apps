/**
 * contact-bridge-service.test.js
 *
 * Covers resolveContactForSession across the 3 happy paths (OID match,
 * email link, create new) + the 2 unhappy paths (conflict, multi-match).
 * DynamicsService is mocked at the module boundary; the bridge's job is
 * to issue the right queries and branch on the responses.
 */

const queryRecordsMock = jest.fn();
const updateRecordMock = jest.fn();
const createRecordMock = jest.fn();
const getEntityKeyMock = jest.fn();

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: (...args) => queryRecordsMock(...args),
    updateRecord: (...args) => updateRecordMock(...args),
    createRecord: (...args) => createRecordMock(...args),
    getEntityKey: (...args) => getEntityKeyMock(...args),
  },
}));

// Force require AFTER the jest.mock so the bridge picks up the mocked
// DynamicsService.
const {
  resolveContactForSession,
  _testing,
  _resetAltKeyCacheForTests,
} = require('../../lib/services/contact-bridge-service');

const OID = '00000000-1111-2222-3333-444444444444';
const EMAIL = 'jane@example.org';
const NAME = 'Jane Doe';
const CONTACT_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function setupQueueByOid(records) {
  queryRecordsMock.mockResolvedValueOnce({ records });
}
function setupQueueByEmail(records) {
  queryRecordsMock.mockResolvedValueOnce({ records });
}

beforeEach(() => {
  queryRecordsMock.mockReset();
  updateRecordMock.mockReset();
  createRecordMock.mockReset();
  getEntityKeyMock.mockReset();
  // Default: alt-key Active so existing tests don't need to opt in
  getEntityKeyMock.mockResolvedValue({ EntityKeyIndexStatus: 'Active' });
  _resetAltKeyCacheForTests();
});

describe('resolveContactForSession — invalid inputs', () => {
  test('missing oid → invalid_session', async () => {
    const r = await resolveContactForSession({ email: EMAIL });
    expect(r).toEqual({ ok: false, reason: 'invalid_session', message: 'oid required' });
  });
  test('missing email → invalid_session', async () => {
    const r = await resolveContactForSession({ oid: OID });
    expect(r).toEqual({ ok: false, reason: 'invalid_session', message: 'email required' });
  });
  test('non-string oid → invalid_session', async () => {
    const r = await resolveContactForSession({ oid: 123, email: EMAIL });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_session');
  });
});

describe('resolveContactForSession — OID match (step 1)', () => {
  test('returns contactId with source=oid_match', async () => {
    setupQueueByOid([{ contactid: CONTACT_GUID, wmkf_portaloid: OID }]);
    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'oid_match' });
    expect(queryRecordsMock).toHaveBeenCalledTimes(1);
    // The OID filter should be escaped-quoted (no SQL injection vector)
    expect(queryRecordsMock.mock.calls[0][1].filter).toContain(`wmkf_portaloid eq '${OID}'`);
  });
  test('multi-match on OID → throws (alt-key violation, should be impossible)', async () => {
    setupQueueByOid([
      { contactid: CONTACT_GUID, wmkf_portaloid: OID },
      { contactid: 'other-guid', wmkf_portaloid: OID },
    ]);
    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toThrow(/alt-key violated/);
  });
});

describe('resolveContactForSession — email link (step 2, null OID)', () => {
  test('attaches OID + returns source=email_link', async () => {
    setupQueueByOid([]); // step 1 miss
    setupQueueByEmail([{ contactid: CONTACT_GUID, wmkf_portaloid: null, emailaddress1: EMAIL }]);
    updateRecordMock.mockResolvedValueOnce(undefined);

    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'email_link' });
    expect(updateRecordMock).toHaveBeenCalledWith('contacts', CONTACT_GUID, { wmkf_portaloid: OID });
  });
  test('email lowercased for filter', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([{ contactid: CONTACT_GUID, wmkf_portaloid: null }]);
    updateRecordMock.mockResolvedValueOnce(undefined);

    await resolveContactForSession({ oid: OID, email: 'JANE@EXAMPLE.ORG' });
    expect(queryRecordsMock.mock.calls[1][1].filter)
      .toContain("emailaddress1 eq 'jane@example.org'");
  });
});

describe('resolveContactForSession — conflict (step 2, different OID)', () => {
  test('email match with different OID → conflict, no link', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([{
      contactid: CONTACT_GUID,
      wmkf_portaloid: 'someone-elses-oid',
      emailaddress1: EMAIL,
    }]);

    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('conflict');
    expect(r.existingContactId).toBe(CONTACT_GUID);
    expect(r.existingOid).toBe('someone-elses-oid');
    expect(updateRecordMock).not.toHaveBeenCalled();
    expect(createRecordMock).not.toHaveBeenCalled();
  });
  test('email match with SAME OID → accept as oid_match (defensive consistency)', async () => {
    setupQueueByOid([]); // OID query missed transiently
    setupQueueByEmail([{ contactid: CONTACT_GUID, wmkf_portaloid: OID }]);

    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'oid_match' });
  });
  test('multi-match on email → conflict (operational ambiguity)', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([
      { contactid: 'c1', wmkf_portaloid: null },
      { contactid: 'c2', wmkf_portaloid: null },
    ]);

    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('conflict');
    expect(r.candidates).toHaveLength(2);
  });
});

describe('resolveContactForSession — create (step 3)', () => {
  test('creates contact with split name + returns source=created', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });

    const r = await resolveContactForSession({ oid: OID, email: EMAIL, name: NAME });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'created' });
    expect(createRecordMock).toHaveBeenCalledWith('contacts', {
      wmkf_portaloid: OID,
      emailaddress1: 'jane@example.org',
      firstname: 'Jane',
      lastname: 'Doe',
    });
  });
  test('missing name → fallback to email username for lastname', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });

    await resolveContactForSession({ oid: OID, email: 'flossie@example.org' });
    expect(createRecordMock).toHaveBeenCalledWith('contacts', {
      wmkf_portaloid: OID,
      emailaddress1: 'flossie@example.org',
      lastname: 'flossie',
    });
  });
  test('single-word name → lastname only', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });

    await resolveContactForSession({ oid: OID, email: EMAIL, name: 'Cher' });
    expect(createRecordMock.mock.calls[0][1].lastname).toBe('Cher');
    expect(createRecordMock.mock.calls[0][1].firstname).toBeUndefined();
  });
  test('multi-word name: firstname=all-but-last, lastname=last word', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });

    await resolveContactForSession({ oid: OID, email: EMAIL, name: 'Mary Jane Watson' });
    expect(createRecordMock.mock.calls[0][1].firstname).toBe('Mary Jane');
    expect(createRecordMock.mock.calls[0][1].lastname).toBe('Watson');
  });
});

describe('resolveContactForSession — duplicate-PK race recovery', () => {
  test('create returns duplicate_pk → re-query OID + return that contact', async () => {
    setupQueueByOid([]);                  // step 1: miss
    setupQueueByEmail([]);                // step 2: miss
    // step 3: create races, alt-key (when Active) returns 412 dataverse
    const dupErr = {
      serviceName: 'dataverse',
      status: 412,
      message: 'duplicate alt-key violation',
    };
    createRecordMock.mockRejectedValueOnce(dupErr);
    // Recovery: re-query OID — this time the other worker's row is there
    setupQueueByOid([{ contactid: CONTACT_GUID, wmkf_portaloid: OID }]);

    const r = await resolveContactForSession({ oid: OID, email: EMAIL, name: NAME });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'oid_match' });
  });
  test('create returns duplicate_pk but recovery finds nothing → throws with bridgeNote', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    const dupErr = {
      serviceName: 'dataverse',
      status: 409,
      message: 'duplicate',
    };
    createRecordMock.mockRejectedValueOnce(dupErr);
    setupQueueByOid([]); // recovery also misses

    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toMatchObject({ bridgeNote: expect.stringContaining('OID lookup found no row') });
  });
  test('create returns non-duplicate error → bubbles', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    const err = new Error('server explosion');
    err.serviceName = 'dataverse';
    err.status = 500;
    err.isTransient = true;
    createRecordMock.mockRejectedValueOnce(err);

    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toThrow('server explosion');
  });
});

describe('alt-key Active probe (Codex round-13 Q3 BLOCKER)', () => {
  test('Active alt-key → create proceeds', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });

    const r = await resolveContactForSession({ oid: OID, email: EMAIL, name: NAME });
    expect(r).toEqual({ ok: true, contactId: CONTACT_GUID, source: 'created' });
    expect(getEntityKeyMock).toHaveBeenCalledWith('contact', 'wmkf_portaloid');
  });
  test('Pending alt-key → throws altKeyNotActive + does NOT createRecord', async () => {
    getEntityKeyMock.mockReset();
    getEntityKeyMock.mockResolvedValue({ EntityKeyIndexStatus: 'Pending' });
    setupQueueByOid([]);
    setupQueueByEmail([]);

    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toMatchObject({
        altKeyNotActive: true,
        altKeyStatus: 'Pending',
        isTransient: true, // retry-eligible — status is monotonic
      });
    expect(createRecordMock).not.toHaveBeenCalled();
  });
  test('alt-key probe failure → throws altKeyNotActive transient', async () => {
    getEntityKeyMock.mockReset();
    getEntityKeyMock.mockRejectedValue(new Error('probe boom'));
    setupQueueByOid([]);
    setupQueueByEmail([]);

    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toMatchObject({ altKeyNotActive: true, isTransient: true });
    expect(createRecordMock).not.toHaveBeenCalled();
  });
  test('alt-key absent (null) → throws non-transient (config issue)', async () => {
    getEntityKeyMock.mockReset();
    getEntityKeyMock.mockResolvedValue(null);
    setupQueueByOid([]);
    setupQueueByEmail([]);

    await expect(resolveContactForSession({ oid: OID, email: EMAIL }))
      .rejects.toMatchObject({ altKeyNotActive: true, isTransient: false });
  });
  test('alt-key Active cached — second call does not re-probe', async () => {
    // First call: probe + create
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });
    await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(getEntityKeyMock).toHaveBeenCalledTimes(1);

    // Second call: OID match (no create) — should still not re-probe
    setupQueueByOid([{ contactid: CONTACT_GUID, wmkf_portaloid: OID }]);
    await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(getEntityKeyMock).toHaveBeenCalledTimes(1); // still 1

    // Third call: another create path — cache hit, no re-probe
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: 'other-guid' });
    await resolveContactForSession({ oid: 'other-oid', email: 'other@x.com' });
    expect(getEntityKeyMock).toHaveBeenCalledTimes(1); // STILL 1 — cached
  });
  test('Pending status NOT cached — next call re-probes', async () => {
    getEntityKeyMock.mockReset();
    getEntityKeyMock.mockResolvedValueOnce({ EntityKeyIndexStatus: 'Pending' });
    setupQueueByOid([]);
    setupQueueByEmail([]);
    await expect(resolveContactForSession({ oid: OID, email: EMAIL })).rejects.toMatchObject({
      altKeyNotActive: true,
    });

    // Second call: alt-key transitioned to Active mid-process → should succeed
    getEntityKeyMock.mockResolvedValueOnce({ EntityKeyIndexStatus: 'Active' });
    setupQueueByOid([]);
    setupQueueByEmail([]);
    createRecordMock.mockResolvedValueOnce({ contactid: CONTACT_GUID });
    const r = await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(r.ok).toBe(true);
    expect(getEntityKeyMock).toHaveBeenCalledTimes(2);
  });
  test('OID-match path does NOT trigger alt-key probe (read-only)', async () => {
    setupQueueByOid([{ contactid: CONTACT_GUID, wmkf_portaloid: OID }]);
    await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(getEntityKeyMock).not.toHaveBeenCalled();
  });
  test('email-link path does NOT trigger alt-key probe (PATCH, not Create)', async () => {
    setupQueueByOid([]);
    setupQueueByEmail([{ contactid: CONTACT_GUID, wmkf_portaloid: null }]);
    updateRecordMock.mockResolvedValueOnce(undefined);
    await resolveContactForSession({ oid: OID, email: EMAIL });
    expect(getEntityKeyMock).not.toHaveBeenCalled();
  });
});

describe('splitName — defensive cases', () => {
  test('empty name → email username', () => {
    expect(_testing.splitName('', 'foo@bar.com')).toEqual({ firstname: null, lastname: 'foo' });
  });
  test('null name → email username', () => {
    expect(_testing.splitName(null, 'foo@bar.com')).toEqual({ firstname: null, lastname: 'foo' });
  });
  test('whitespace-only → email username', () => {
    expect(_testing.splitName('   ', 'foo@bar.com').lastname).toBe('foo');
  });
  test('email missing → "unknown"', () => {
    expect(_testing.splitName('', '').lastname).toBe('unknown');
  });
  test('apostrophe in name preserved', () => {
    expect(_testing.splitName("Mary O'Brien", EMAIL)).toEqual({ firstname: 'Mary', lastname: "O'Brien" });
  });
});

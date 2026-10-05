const {
  REQUEST_ID,
  REQUEST_NUMBER,
  RUN_ID,
  REQUEST_SELECT,
  assertProductionProbePreflight,
  runSiteVisitEndFenceProbe,
  buildConditionalPatch,
} = require('../../scripts/lib/site-visit-end-fence-probe');

const ACTIVITY_ID = '4079ab1a-f9c0-f111-aaad-6045bd04539e';
const SCHEDULED_END = '2026-10-06T18:30:00Z';

function choice(label, value, state) {
  return { Value: value, State: state, Label: { UserLocalizedLabel: { Label: label } } };
}

function fixture(expectedState) {
  const completed = expectedState === 'completed';
  const statecode = completed ? 1 : 0;
  const statuscode = completed ? 21 : 11;
  const visit = (etag) => ({
    activityid: ACTIVITY_ID,
    _regardingobjectid_value: REQUEST_ID,
    scheduledend: SCHEDULED_END,
    statecode,
    statuscode,
    _etag: etag,
  });
  let reads = 0;
  const changesets = [];
  return {
    changesets,
    deps: {
      testIsolationEnabled: true,
      env: {
        NODE_ENV: 'development',
        DATAVERSE_TARGET_INTERLOCK: 'on',
        DATAVERSE_ALLOW_PROD_READS: 'yes',
        DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
        DATAVERSE_PROD_WRITE_ACK: 'bounded site visit ETag proof 2026-10-05',
      },
      productionHosts: ['wmkf.crm.dynamics.com'],
      now: '2026-10-05T21:00:00.000Z',
      withDalContext: (_label, callback) => callback(),
      getRequest: jest.fn(async (id, options) => {
        expect(id).toBe(REQUEST_ID);
        expect(options.select).toEqual(REQUEST_SELECT);
        return {
          akoya_requestid: REQUEST_ID,
          akoya_requestnum: REQUEST_NUMBER,
          wmkf_istestrequest: true,
          wmkf_testcreationrunid: RUN_ID,
        };
      }),
      getChoiceMetadata: jest.fn(async (field) => (field === 'statecode'
        ? { OptionSet: { Options: [choice('Open', 0), choice('Completed', 1), choice('Canceled', 2)] } }
        : { OptionSet: { Options: [choice('In Progress', 11, 0), choice('Succeeded', 21, 1), choice('Canceled', 31, 2)] } })),
      findVisits: jest.fn(async () => ({ records: [visit('W/"1"')], capped: false, hasMore: false })),
      getVisit: jest.fn(async () => {
        reads += 1;
        return visit(reads === 1 ? 'W/"1"' : 'W/"2"');
      }),
      runChangeset: jest.fn(async (operations) => {
        changesets.push(operations);
        if (changesets.length === 2) throw Object.assign(new Error('precondition failed'), { status: 412 });
        return { ok: true, operations: [{ status: 204 }] };
      }),
    },
  };
}

describe.each(['active', 'completed'])('Site Visit end-fence probe (%s)', (expectedState) => {
  test('patches only the unchanged end with current ETag, then proves stale ETag rejection', async () => {
    const { deps, changesets } = fixture(expectedState);
    const result = await runSiteVisitEndFenceProbe({
      target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState,
    }, deps);

    expect(result).toMatchObject({
      requestNumber: REQUEST_NUMBER,
      activityId: ACTIVITY_ID,
      expectedState,
      sameValuePatch: 'confirmed',
      staleEtagStatus: 412,
      staleAttemptReadback: 'unchanged',
      writes: 1,
      cleanup: 'none; retained test activity',
    });
    expect(changesets).toHaveLength(2);
    expect(changesets[0]).toEqual([{
      method: 'PATCH',
      entitySet: 'wmkf_sitevisits',
      key: ACTIVITY_ID,
      body: { scheduledend: SCHEDULED_END },
      ifMatch: 'W/"1"',
    }]);
    expect(changesets[1]).toEqual(changesets[0]);
  });
});

test('requires explicit production target, execute, and active/completed expectation', async () => {
  const { deps } = fixture('active');
  await expect(runSiteVisitEndFenceProbe({ target: 'sandbox', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, deps)).rejects.toThrow('explicit --target=prod');
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: false, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, deps)).rejects.toThrow('explicit --target=prod');
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'unknown' }, deps)).rejects.toThrow('--expected-state=active|completed');
  expect(deps.getRequest).not.toHaveBeenCalled();
});

test('requires isolation and exact pinned TEST identity before any visit write', async () => {
  const { deps } = fixture('active');
  deps.testIsolationEnabled = false;
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, deps)).rejects.toThrow('TEST_REQUEST_ISOLATION=on');
  expect(deps.getRequest).not.toHaveBeenCalled();
  deps.testIsolationEnabled = true;
  deps.getRequest.mockResolvedValueOnce({ akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, wmkf_istestrequest: true, wmkf_testcreationrunid: 'd5c56cf2-c9b0-45e0-a0f6-9d601f899999' });
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, deps)).rejects.toThrow('Pinned TEST Factory request');
  expect(deps.runChangeset).not.toHaveBeenCalled();
});

test('refuses capped/ambiguous enumeration and unknown metadata pairs', async () => {
  const capped = fixture('active');
  capped.deps.findVisits.mockResolvedValueOnce({ records: [], capped: true, hasMore: true });
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, capped.deps)).rejects.toThrow('enumeration was capped');
  expect(capped.deps.runChangeset).not.toHaveBeenCalled();

  const duplicate = fixture('active');
  duplicate.deps.findVisits.mockResolvedValueOnce({ records: [
    { activityid: ACTIVITY_ID, _regardingobjectid_value: REQUEST_ID, scheduledend: SCHEDULED_END, statecode: 0, statuscode: 11, _etag: 'W/"1"' },
    { activityid: 'a20cf6ee-517e-4d04-bf85-5e5dd349b13b', _regardingobjectid_value: REQUEST_ID, scheduledend: SCHEDULED_END, statecode: 0, statuscode: 11, _etag: 'W/"8"' },
  ], capped: false });
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, duplicate.deps)).rejects.toThrow('found 2');
  expect(duplicate.deps.runChangeset).not.toHaveBeenCalled();

  const unknown = fixture('active');
  unknown.deps.getChoiceMetadata.mockImplementation(async (field) => (field === 'statecode'
    ? { OptionSet: { Options: [choice('Open', 0)] } }
    : { OptionSet: { Options: [choice('Unknown', 11, 9)] } }));
  await expect(runSiteVisitEndFenceProbe({ target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active' }, unknown.deps)).rejects.toThrow('Malformed Site Visit status option metadata');
  expect(unknown.deps.runChangeset).not.toHaveBeenCalled();
});


test('without --execute, validates the marked visit but does not write', async () => {
  const { deps, changesets } = fixture('active');
  delete deps.env.DATAVERSE_PROD_WRITE_ACK;
  const result = await runSiteVisitEndFenceProbe({
    target: 'prod', targetSpecified: true, execute: false, activityId: ACTIVITY_ID, expectedState: 'active',
  }, deps);
  expect(result).toMatchObject({ sameValuePatch: 'not-run; read-only invocation', writes: 0 });
  expect(changesets).toHaveLength(0);
});

test.each([
  ['interlock off', { DATAVERSE_TARGET_INTERLOCK: 'off' }, 'DATAVERSE_TARGET_INTERLOCK=on'],
  ['production reads off', { DATAVERSE_ALLOW_PROD_READS: 'no' }, 'DATAVERSE_ALLOW_PROD_READS=yes'],
  ['wrong target host', { DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com' }, 'tracked production Dataverse host'],
  ['nonstandard target port', { DYNAMICS_URL: 'https://wmkf.crm.dynamics.com:8443' }, 'tracked production Dataverse host'],
  ['non-local execution', { VERCEL_ENV: 'production' }, 'local operator process'],
  ['production Node mode', { NODE_ENV: 'production' }, 'local operator process'],
  ['missing write acknowledgement', { DATAVERSE_PROD_WRITE_ACK: '' }, 'same-UTC-day DATAVERSE_PROD_WRITE_ACK'],
  ['stale write acknowledgement', { DATAVERSE_PROD_WRITE_ACK: 'proof 2026-10-04' }, 'same-UTC-day DATAVERSE_PROD_WRITE_ACK'],
])('preflight rejects %s before any request read or write', async (_label, overrides, message) => {
  const { deps } = fixture('active');
  Object.assign(deps.env, overrides);
  await expect(runSiteVisitEndFenceProbe({
    target: 'prod', targetSpecified: true, execute: true, activityId: ACTIVITY_ID, expectedState: 'active',
  }, deps)).rejects.toThrow(message);
  expect(deps.getRequest).not.toHaveBeenCalled();
  expect(deps.runChangeset).not.toHaveBeenCalled();
});

test('read-only preflight still requires tracked local production-read controls', () => {
  const env = {
    NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes',
    DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
  };
  expect(assertProductionProbePreflight({ env, productionHosts: ['wmkf.crm.dynamics.com'] }).writeAckRequired).toBe(false);
  expect(() => assertProductionProbePreflight({ env: { ...env, NODE_ENV: 'test' }, productionHosts: ['wmkf.crm.dynamics.com'] })).toThrow('local operator process');
});

test('conditional operation permits only the Site Visit end and requires a valid activity GUID', () => {
  expect(buildConditionalPatch(ACTIVITY_ID, SCHEDULED_END, 'W/"17"')).toEqual([{
    method: 'PATCH', entitySet: 'wmkf_sitevisits', key: ACTIVITY_ID,
    body: { scheduledend: SCHEDULED_END }, ifMatch: 'W/"17"',
  }]);
  expect(() => buildConditionalPatch('not-a-guid', SCHEDULED_END, 'W/"17"')).toThrow();
});

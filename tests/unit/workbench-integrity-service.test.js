/** @jest-environment node */
import {
  getLatestRequestIntegrityRun,
  getWorkbenchIntegrityContext,
  loadRequestIntegrityPeople,
  runWorkbenchIntegrityScreen,
  WORKBENCH_INTEGRITY_MAX_PEOPLE,
} from '../../lib/services/workbench/integrity-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PI_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COPI_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function peopleDependencies(overrides = {}) {
  return {
    grantRequestAdapter: {
      getById: jest.fn().mockResolvedValue({
        akoya_requestid: REQUEST_ID,
        _wmkf_projectleader_value: PI_ID,
        _akoya_applicantid_value_formatted: 'Request Institution',
      }),
    },
    appRequestPersonAdapter: {
      queryAllPersons: jest.fn().mockResolvedValue({
        records: [
          { _wmkf_contact_value: PI_ID.toUpperCase(), wmkf_role: 100000001, wmkf_Contact: { fullname: 'Wrong Copi Role', adx_organizationname: 'Other' } },
          { _wmkf_contact_value: PI_ID, wmkf_role: 100000000, wmkf_Contact: { fullname: 'Priya Investigator', adx_organizationname: 'PI Institution' } },
          { _wmkf_contact_value: COPI_ID, wmkf_role: 100000001, wmkf_Contact: { firstname: 'Casey', lastname: 'Collaborator', adx_organizationname: 'CoPI Institution' } },
          { _wmkf_contact_value: COPI_ID, wmkf_role: 100000001, wmkf_Contact: { fullname: 'Duplicate' } },
        ],
        totalCount: 4,
        capped: false,
      }),
    },
    contactAdapter: { getByIdWithSelect: jest.fn() },
    ...overrides,
  };
}

test('UNIONs project leader and PI/Co-PI junction, dedupes lowercase GUIDs, and gives PI precedence', async () => {
  const deps = peopleDependencies();
  const people = await loadRequestIntegrityPeople(REQUEST_ID, deps);
  expect(people).toEqual([
    { contactId: PI_ID, name: 'Priya Investigator', institution: 'PI Institution', role: 'PI' },
    { contactId: COPI_ID, name: 'Casey Collaborator', institution: 'CoPI Institution', role: 'Co-PI' },
  ]);
  expect(deps.appRequestPersonAdapter.queryAllPersons).toHaveBeenCalledWith({
    select: '_wmkf_contact_value,wmkf_role,wmkf_authorposition',
    expand: 'wmkf_Contact($select=fullname,firstname,lastname,adx_organizationname,_parentcustomerid_value)',
    filter: `_wmkf_request_value eq ${REQUEST_ID} and (wmkf_role eq 100000000 or wmkf_role eq 100000001)`,
    orderby: 'wmkf_authorposition asc,createdon asc',
  });
  expect(deps.contactAdapter.getByIdWithSelect).not.toHaveBeenCalled();
});

test('request institution falls back only to the current Project Leader, not a distinct junction PI', async () => {
  const distinctPi = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const deps = peopleDependencies({
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({
      records: [{ _wmkf_contact_value: distinctPi, wmkf_role: 100000000, wmkf_Contact: { fullname: 'Junction PI' } }],
      capped: false,
    }) },
    contactAdapter: { getByIdWithSelect: jest.fn().mockResolvedValue(null) },
  });
  const people = await loadRequestIntegrityPeople(REQUEST_ID, deps);
  expect(people).toEqual([
    { contactId: PI_ID, name: '', institution: 'Request Institution', role: 'PI' },
    { contactId: distinctPi, name: 'Junction PI', institution: '', role: 'PI' },
  ]);
});

test('no identities returns empty people; junction failures propagate instead of hiding Co-PIs', async () => {
  const deps = peopleDependencies({ appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: [], capped: false }) } });
  deps.grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: REQUEST_ID });
  expect(await loadRequestIntegrityPeople(REQUEST_ID, deps)).toEqual([]);
  deps.appRequestPersonAdapter.queryAllPersons.mockRejectedValue(new Error('junction unavailable'));
  await expect(loadRequestIntegrityPeople(REQUEST_ID, deps)).rejects.toThrow('junction unavailable');
});

test('capped junction reads fail closed; unresolved names remain visible but cannot be screened', async () => {
  const capped = peopleDependencies({ appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: [], capped: true }) } });
  await expect(loadRequestIntegrityPeople(REQUEST_ID, capped)).rejects.toThrow('capped');
  const malformed = peopleDependencies({
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({ akoya_requestid: REQUEST_ID }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: Array.from({ length: WORKBENCH_INTEGRITY_MAX_PEOPLE + 1 }, (_, i) => ({ _wmkf_contact_value: `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`, wmkf_role: 100000001, wmkf_Contact: { fullname: `Person ${i}` } })), capped: false }) },
  });
  await expect(loadRequestIntegrityPeople(REQUEST_ID, malformed)).rejects.toMatchObject({ body: { code: 'person_limit_exceeded' } });
  expect(malformed.contactAdapter.getByIdWithSelect).not.toHaveBeenCalled();

  const unresolved = peopleDependencies({
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({ akoya_requestid: REQUEST_ID, _wmkf_projectleader_value: PI_ID }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: [], capped: false }) },
    contactAdapter: { getByIdWithSelect: jest.fn().mockResolvedValue(null) },
  });
  const screenApplicants = jest.fn();
  const result = await getWorkbenchIntegrityContext({ requestId: REQUEST_ID }, { ...unresolved, sql: async () => ({ rows: [] }) });
  expect(result.people[0]).toMatchObject({ contactId: PI_ID, name: '', role: 'PI' });
  await expect(runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 5, claudeApiKey: 'key' }, {
    ...unresolved,
    sql: jest.fn(),
    IntegrityService: { screenApplicants },
  })).rejects.toMatchObject({ body: { code: 'person_identity_unavailable' } });
  expect(screenApplicants).not.toHaveBeenCalled();
});

test('empty people and over-limit people are rejected before the paid engine', async () => {
  const engine = { screenApplicants: jest.fn() };
  const empty = peopleDependencies({
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({ akoya_requestid: REQUEST_ID }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: [], capped: false }) },
  });
  await expect(runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 7, claudeApiKey: 'key' }, { ...empty, IntegrityService: engine, sql: jest.fn() }))
    .rejects.toMatchObject({ body: { code: 'no_people' } });

  const records = Array.from({ length: WORKBENCH_INTEGRITY_MAX_PEOPLE + 1 }, (_, index) => ({
    _wmkf_contact_value: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    wmkf_role: 100000001,
    wmkf_Contact: { fullname: `Person ${index}` },
  }));
  const tooMany = peopleDependencies({
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({ akoya_requestid: REQUEST_ID }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records, capped: false }) },
  });
  await expect(runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 7, claudeApiKey: 'key' }, { ...tooMany, IntegrityService: engine, sql: jest.fn() }))
    .rejects.toMatchObject({ body: { code: 'person_limit_exceeded' } });
  expect(engine.screenApplicants).not.toHaveBeenCalled();
});

test('schema preflight and linked persistence are awaited; insert failures fail the run', async () => {
  const engine = { screenApplicants: jest.fn(async function* (applicants, key, serpKey, actorId, options) {
    expect(applicants).toEqual([{ name: 'Priya Investigator', role: 'PI', institution: 'PI Institution' }]);
    expect(actorId).toBeNull();
    expect(options).toEqual({ strictSourceErrors: true });
    yield { type: 'complete', results: [{ matchCount: 2 }] };
  }) };
  const sqlCalls = [];
  const db = async (parts, ...values) => {
    const query = parts.join('?');
    sqlCalls.push({ query, values });
    if (query.includes('SELECT id, created_at')) return { rows: [] };
    return { rows: [{ id: 42, created_at: '2026-09-26T10:00:00Z', screened_names: [], results: [{ matchCount: 2 }], match_count: 2, status: 'pending' }] };
  };
  const onePerson = peopleDependencies({
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({ akoya_requestid: REQUEST_ID, _wmkf_projectleader_value: PI_ID }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: [{ _wmkf_contact_value: PI_ID, wmkf_role: 100000000, wmkf_Contact: { fullname: 'Priya Investigator', adx_organizationname: 'PI Institution' } }], capped: false }) },
  });
  const result = await runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 7, claudeApiKey: 'key' }, { ...onePerson, IntegrityService: engine, sql: db });
  expect(sqlCalls[0].query).toContain('WHERE request_id = ?');
  expect(sqlCalls[0].query).toContain('ORDER BY created_at DESC, id DESC');
  expect(sqlCalls[1].query).toContain('request_id');
  expect(sqlCalls[1].query).toContain('RETURNING id, created_at');
  expect(sqlCalls[1].values).toContain(7);
  expect(sqlCalls[1].values).toContain(REQUEST_ID);
  expect(result.run).toMatchObject({ id: 42, matchCount: 2, status: 'pending' });

  await expect(runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 7, claudeApiKey: 'key' }, {
    ...onePerson,
    IntegrityService: engine,
    sql: async (parts) => {
      if (parts.join('?').includes('SELECT id, created_at')) return { rows: [] };
      throw new Error('database unavailable');
    },
  })).rejects.toThrow('database unavailable');
  expect(engine.screenApplicants).toHaveBeenCalledTimes(2);
});

test('real-shaped Dataverse 404 maps to request 404 before Postgres or screening', async () => {
  const dataverse404 = Object.assign(new Error('dataverse failed (404): not found'), {
    serviceName: 'dataverse', status: 404, isTransient: false,
  });
  const sql = jest.fn();
  const engine = { screenApplicants: jest.fn() };
  const deps = peopleDependencies({ grantRequestAdapter: { getById: jest.fn().mockRejectedValue(dataverse404) } });
  await expect(getWorkbenchIntegrityContext({ requestId: REQUEST_ID }, { ...deps, sql }))
    .rejects.toMatchObject({ httpStatus: 404, message: 'Request not found' });
  await expect(runWorkbenchIntegrityScreen({ requestId: REQUEST_ID, actorProfileId: 7, claudeApiKey: 'key' }, {
    ...deps, sql, IntegrityService: engine,
  })).rejects.toMatchObject({ httpStatus: 404, message: 'Request not found' });
  expect(sql).not.toHaveBeenCalled();
  expect(engine.screenApplicants).not.toHaveBeenCalled();

  const nullRequest = peopleDependencies({ grantRequestAdapter: { getById: jest.fn().mockResolvedValue(null) } });
  await expect(getWorkbenchIntegrityContext({ requestId: REQUEST_ID }, { ...nullRequest, sql }))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(sql).not.toHaveBeenCalled();
});

test('latest run reader returns null when empty and projects the newest persisted row', async () => {
  const rows = [{ id: 9, created_at: '2026-09-26T10:00:00Z', screened_names: [], results: [], match_count: 0, status: 'pending' }];
  const db = jest.fn(async () => ({ rows }));
  await expect(getLatestRequestIntegrityRun(REQUEST_ID, { sql: jest.fn(async () => ({ rows: [] })) })).resolves.toBeNull();
  await expect(getLatestRequestIntegrityRun(REQUEST_ID, { sql: db })).resolves.toEqual({
    id: 9, createdAt: rows[0].created_at, screenedNames: [], results: [], matchCount: 0, status: 'pending',
  });
  expect(db).toHaveBeenCalledTimes(1);
  expect(db.mock.calls[0].slice(1)).toContain(REQUEST_ID);
});


test('migration 056 and fresh-install setup both define nullable request linkage and latest index', () => {
  const fs = require('fs');
  const migration = fs.readFileSync('lib/db/migrations/056_integrity_screenings_request_id.sql', 'utf8');
  const setup = fs.readFileSync('scripts/setup-database.js', 'utf8');
  expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS request_id UUID/);
  expect(migration).toMatch(/idx_integrity_screenings_request_latest[\s\S]*request_id, created_at DESC, id DESC/);
  expect(setup).toMatch(/CREATE TABLE IF NOT EXISTS integrity_screenings[\s\S]*request_id UUID/);
  expect(setup).toMatch(/idx_integrity_screenings_request_latest[\s\S]*request_id, created_at DESC, id DESC/);
});

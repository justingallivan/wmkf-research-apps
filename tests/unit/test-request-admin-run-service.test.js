/**
 * Admin Test Request Factory form service (slice 1): target binding, ledger
 * guard, ledger-first Confirm, create-only artifacts, ownership, kill switch,
 * isolation, advance/recovery. Fakes only: an in-memory ledger db that
 * interprets the few statements run-ledger.js issues, an in-memory Blob, and
 * injected Dataverse/Graph/preflight. No Postgres, Blob or Dataverse access.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { createAdminRunService } from '../../lib/services/test-requests/admin-run-service.js';
import { deriveActorId, deriveRunIds } from '../../lib/services/test-requests/admin-run-identity.js';
import { artifactDigest, draftPathname, runPathname } from '../../lib/services/test-requests/factory-artifact-store.js';
import { SANDBOX_URL, PRODUCTION_URL, sha256 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { MANAGED_LEDGER_HOSTS } from '../../lib/db/ledger-registry.js';
import { TEST_REQUEST_FIXED_FIELDS } from '../../lib/services/test-requests/policy.js';

const MANAGED = MANAGED_LEDGER_HOSTS[0];
const SANDBOX_LEDGER = `postgresql://role:pw@${MANAGED}/ledger?sslmode=require`;
const PROD_LEDGER = `postgresql://role:pw@${MANAGED}/ledger_prod?sslmode=require`;
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const APP_USER_ID = '44444444-4444-4444-8444-444444444444';
const PD_ID = '66666666-6666-4666-8666-666666666666';
const PROGRAM_ID = '77777777-7777-4777-8777-777777777777';
const PI_ID = '88888888-8888-4888-8888-888888888888';
const LIAISON_ID = '99999999-9999-4999-8999-999999999999';
const RL_ID = '15151515-1515-4151-8151-151515151515';
const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_ID = 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111';
const DRIVE_ID = 'b!GQ6TSC-650adweD3-KAAAAAAAAAAAA';
const HOUR = 3600_000;
const PROFILE = 11;
const KEY = 'draft-key-1';

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { console.log.mockRestore?.(); });

// ---- fakes -----------------------------------------------------------------

function runRowFromInsert(p) {
  return {
    run_id: p[0], actor_id: p[1], idempotency_key: p[2], status: 'prepared', current_step: 'fence_source', step_index: 0, recipe: p[3],
    source_dataverse_host: p[4], source_request_id: p[5], source_request_number: p[6], source_revision: p[7],
    bundle_sha256: p[8], bundle_exported_at: p[9], copy_policy_version: p[10], copy_policy_digest: p[11], plan_digest: p[12],
    create_body_sha256: p[13], destination_environment: p[14], destination_dataverse_host: p[15],
    destination_request_id: p[16], destination_location_id: p[17], expected_app_user_id: p[18], expected_organization_id: p[19],
    expected_graph_site_id: p[20], expected_graph_drive_id: p[21], fiscal_year: p[22], meeting_date: p[23], test_label: p[24],
    lease_token: 'secret-lease', version: 1,
  };
}

function fakeLedger({ failReserve = false } = {}) {
  const rows = new Map();
  const ends = { count: 0 };
  const state = { failReserve };
  const db = {
    async query(text, params = []) {
      if (/INSERT INTO test_request_runs/.test(text)) {
        if (state.failReserve) throw new Error('reserve exploded');
        const dup = [...rows.values()].some((r) => r.run_id === params[0] || (r.actor_id === params[1] && r.idempotency_key === params[2]));
        if (dup) return { rows: [] };
        rows.set(params[0], runRowFromInsert(params));
        return { rows: [{ run_id: params[0] }] };
      }
      if (/FROM test_request_runs WHERE actor_id = \$1::text AND idempotency_key/.test(text)) {
        return { rows: [...rows.values()].filter((r) => r.actor_id === params[0] && r.idempotency_key === params[1]) };
      }
      if (/FROM test_request_runs WHERE run_id/.test(text)) return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] };
      if (/FROM test_request_runs WHERE actor_id/.test(text)) return { rows: [...rows.values()].filter((r) => r.actor_id === params[0]) };
      return { rows: [] };
    },
    async transaction(fn) { return fn(db); },
    async end() { ends.count += 1; },
  };
  return { db, rows, ends, state };
}

function fakeBlob() {
  const objects = new Map();
  const calls = { put: [], get: [], del: [] };
  return {
    objects,
    calls,
    blob: {
      async put(pathname, bytes, options) {
        calls.put.push({ pathname, options });
        if (objects.has(pathname) && !options.allowOverwrite) throw new Error('Vercel Blob: This blob already exists');
        objects.set(pathname, { text: Buffer.from(bytes).toString('utf8'), uploadedAt: new Date() });
        return { pathname };
      },
      async get(pathname) {
        calls.get.push(pathname);
        const hit = objects.get(pathname);
        if (!hit) return null;
        const bytes = Buffer.from(hit.text, 'utf8');
        return { stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) };
      },
      async del(pathname) { calls.del.push(pathname); objects.delete(pathname); },
      async list() { return { blobs: [], hasMore: false }; },
    },
  };
}

function metadata(production) {
  const fieldNames = [
    'akoya_requestid', 'akoya_title', 'akoya_purpose', 'akoya_request', 'akoya_fiscalyear',
    TEST_REQUEST_FIXED_FIELDS.requestType, 'wmkf_meetingdate', TEST_REQUEST_FIXED_FIELDS.marker,
    TEST_REQUEST_FIXED_FIELDS.runId, TEST_REQUEST_FIXED_FIELDS.responseReminder, TEST_REQUEST_FIXED_FIELDS.reviewReminder,
  ];
  const typeOf = (field) => {
    if (field === 'akoya_request') return 'Money';
    if (field === 'akoya_purpose') return 'Memo';
    if (field === 'akoya_requestid' || field === TEST_REQUEST_FIXED_FIELDS.runId) return 'Uniqueidentifier';
    if (field === TEST_REQUEST_FIXED_FIELDS.requestType) return 'Picklist';
    if (field.includes('reminder') || field === TEST_REQUEST_FIXED_FIELDS.marker) return 'Boolean';
    if (field === 'wmkf_meetingdate') return 'DateOnly';
    return 'String';
  };
  const fields = Object.fromEntries(fieldNames.map((field) => [field, {
    createable: true, requiredLevel: 'None', type: typeOf(field),
    ...(field === 'akoya_request' ? { minValue: 0, maxValue: 1e9 } : {}),
    ...(['akoya_title', 'akoya_fiscalyear'].includes(field) ? { maxLength: 120 } : {}),
    ...(field === 'akoya_purpose' ? { maxLength: 100000 } : {}),
  }]));
  fields.akoya_applicantid = { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'accounts' };
  if (production) {
    const lookup = (lookupEntity, navigationProperty) => ({
      createable: true, requiredLevel: 'None', type: 'Lookup', lookupEntity, navigationProperty,
    });
    fields.akoya_requeststatus = { createable: true, requiredLevel: 'None', type: 'String', maxLength: 100 };
    fields.wmkf_programdirector = lookup('systemuser', 'wmkf_ProgramDirector');
    fields.wmkf_grantprogram = lookup('wmkf_grantprogram', 'wmkf_GrantProgram');
    fields.wmkf_projectleader = lookup('contact', 'wmkf_ProjectLeader');
    fields.akoya_primarycontactid = lookup('contact', 'akoya_primarycontactid');
    fields.wmkf_researchleader = lookup('contact', 'wmkf_ResearchLeader');
  }
  return { entity: 'akoya_request', fields };
}

function preflightFor(targetEnvironment) {
  const production = targetEnvironment === 'production';
  return {
    targetEnvironment,
    metadata: metadata(production),
    grantOption: { value: 100000000, label: 'Grant' },
    foundation: { accountid: ORG_ID, name: 'W. M. Keck Foundation' },
    contacts: [],
    sharePointSites: [],
    requestLibraryParent: null,
    appUser: { systemuserid: APP_USER_ID, fullname: 'App' },
    siteId: SITE_ID,
    driveId: DRIVE_ID,
    ...(production ? { grantProgram: { grantprogramid: PROGRAM_ID } } : {}),
  };
}

function bundleAt(exportedAt) {
  return buildSourceBundle({
    sourceRow: {
      akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 1,
    },
    documents: [],
    dataverseHost: PRODUCTION_HOSTS[0],
    exportedAt: new Date(exportedAt),
  });
}

function harness({ deployment = 'preview', env = {}, preflightTarget = null } = {}) {
  const production = deployment === 'production';
  const ledger = fakeLedger();
  const blobs = fakeBlob();
  const clock = { t: Date.now() };
  const createClientCalls = [];
  const dbUrls = [];
  const spies = {
    resolveProgramDirector: jest.fn(async () => ({ systemuserid: PD_ID })),
    readCast: jest.fn(async () => ({
      pi: { memberId: PI_ID }, liaison: { memberId: LIAISON_ID }, research_leader: { memberId: RL_ID },
    })),
    schemaCheck: jest.fn(async () => {}),
    advanceRun: jest.fn(async () => ({
      step: 'create_request', outcome: 'advanced', run: { status: 'creating', destinationRequestNumber: null }, errorMessage: null,
    })),
  };
  const fullEnv = {
    TEST_REQUEST_FACTORY_FORM: 'on',
    FACTORY_BLOB_RW_TOKEN: 'fake-blob-token',
    ...(production
      ? { TEST_REQUEST_LEDGER_URL: PROD_LEDGER, TEST_REQUEST_ISOLATION: 'on', SYNTHETIC_REVIEWER_ISOLATION: 'on' }
      : { TEST_REQUEST_SANDBOX_LEDGER_URL: SANDBOX_LEDGER }),
    ...env,
  };
  const service = createAdminRunService({
    env: fullEnv,
    deployment,
    ledgerDbFactory: (url, options) => { dbUrls.push({ url, options }); return ledger.db; },
    schemaCheck: spies.schemaCheck,
    blob: blobs.blob,
    createClient: (options) => { createClientCalls.push(options); return { baseUrl: `${options.resourceUrl}/api/data/v9.2` }; },
    getAccessToken: async () => 'fake-token',
    graphContext: async () => ({ graph: {}, sharePointTarget: () => ({}) }),
    runPreflight: async () => preflightFor(preflightTarget ?? (production ? 'production' : 'sandbox')),
    now: () => clock.t,
    exportBundle: async ({ exportedAt }) => bundleAt(exportedAt),
    readCast: spies.readCast,
    resolveProgramDirector: spies.resolveProgramDirector,
    advanceRun: spies.advanceRun,
  });
  const actorId = deriveActorId(PROFILE);
  const target = production ? 'production' : 'sandbox';
  const exportDraft = async () => (await service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' })).draftId;
  const confirmArgs = (draftId, extra = {}) => ({
    profileId: PROFILE, actorEmail: 'pd@wmkeck.org', draftId, idempotencyKey: KEY, confirmSourceRequestNumber: '9000001', testLabel: 'Factory proof', ...extra,
  });
  const confirm = async (extra = {}, draftId = null) => service.confirmRun(confirmArgs(draftId ?? await exportDraft(), extra));
  const seedRun = (runId, overrides = {}) => {
    ledger.rows.set(runId, {
      ...runRowFromInsert([
        runId, actorId, 'digest', 'basic', PRODUCTION_HOSTS[0], SOURCE_ID, '9000001', 'rev-1', 'a'.repeat(64), new Date().toISOString(),
        '1', 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), target, 'x.crm.dynamics.com',
        '12121212-1212-4121-8121-121212121212', '13131313-1313-4131-8131-131313131313', APP_USER_ID, ORG_ID, SITE_ID, DRIVE_ID,
        'December 2026', '2026-12-01', 'label',
      ]),
      ...overrides,
    });
  };
  return {
    service, ledger, blobs, clock, createClientCalls, dbUrls, spies, actorId, target, exportDraft, confirm, confirmArgs, seedRun,
  };
}

const ids = (actorId) => deriveRunIds(actorId, KEY);
const code = (promise) => promise.then(() => null, (error) => error.code ?? error.message);

// ---- tests -----------------------------------------------------------------

describe('target and ledger selection', () => {
  test('production deployment uses the production host and ledger_prod; sandbox deployments use the sandbox host and ledger', async () => {
    for (const [deployment, expectedUrl, expectedDb, expectedHost] of [
      ['production', PROD_LEDGER, '/ledger_prod', PRODUCTION_URL],
      ['preview', SANDBOX_LEDGER, '/ledger?', SANDBOX_URL],
      ['test', SANDBOX_LEDGER, '/ledger?', SANDBOX_URL],
      ['local', SANDBOX_LEDGER, '/ledger?', SANDBOX_URL],
    ]) {
      const h = harness({ deployment });
      await h.confirm();
      expect(h.dbUrls[0].url).toBe(expectedUrl);
      expect(h.dbUrls[0].url).toContain(expectedDb);
      expect(h.createClientCalls.map((c) => c.resourceUrl)).toEqual([expectedHost]);
      expect(h.dbUrls[0].options.pool).toEqual({ max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
    }
  });

  test('a sandbox target with no sandbox variable is refused before the registry fallback to the production variable', async () => {
    // The fallback variable names the sandbox database, so the registry alone would ACCEPT it
    // for a sandbox target; only the service's own guard refuses (discriminating fixture).
    const h = harness({ deployment: 'preview', env: { TEST_REQUEST_SANDBOX_LEDGER_URL: undefined, TEST_REQUEST_LEDGER_URL: SANDBOX_LEDGER } });
    expect(await code(h.service.listRuns({ profileId: PROFILE }))).toBe('factory_ledger_unconfigured');
    expect(h.dbUrls).toHaveLength(0);
  });

  test('a sandbox ledger URL naming the production database is refused by the registry guard', async () => {
    const h = harness({ deployment: 'preview', env: { TEST_REQUEST_SANDBOX_LEDGER_URL: PROD_LEDGER } });
    expect(await code(h.service.listRuns({ profileId: PROFILE }))).toBe('factory_ledger_unconfigured');
    expect(h.dbUrls).toHaveLength(0);
  });

  test.each([
    ['off', undefined],
    ['warn', undefined],
    ['on', undefined],
    ['on', JSON.stringify({ purpose: 'rehearsal', host: PRODUCTION_HOSTS[0] })],
  ])('interlock mode %s and a rehearsal grant never change the host a Preview form addresses', async (mode, grant) => {
    const saved = { mode: process.env.DATAVERSE_TARGET_INTERLOCK, grant: process.env.DATAVERSE_REHEARSAL_GRANT, allow: process.env.DATAVERSE_ALLOW_PROD_READS };
    process.env.DATAVERSE_TARGET_INTERLOCK = mode;
    if (grant) process.env.DATAVERSE_REHEARSAL_GRANT = grant; else delete process.env.DATAVERSE_REHEARSAL_GRANT;
    process.env.DATAVERSE_ALLOW_PROD_READS = 'yes';
    try {
      const h = harness({ deployment: 'preview' });
      await h.confirm();
      await h.service.advance({ profileId: PROFILE, runId: ids(h.actorId).runId });
      expect(h.createClientCalls.length).toBeGreaterThan(0);
      for (const call of h.createClientCalls) expect(call.resourceUrl).toBe(SANDBOX_URL);
    } finally {
      for (const [name, value] of [['DATAVERSE_TARGET_INTERLOCK', saved.mode], ['DATAVERSE_REHEARSAL_GRANT', saved.grant], ['DATAVERSE_ALLOW_PROD_READS', saved.allow]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  test('a manifest whose target mismatches the deployment is refused at advance', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const manifestPath = runPathname('sandbox', runId, 'manifest');
    const stored = JSON.parse(h.blobs.objects.get(manifestPath).text);
    h.blobs.objects.set(manifestPath, { ...h.blobs.objects.get(manifestPath), text: JSON.stringify({ ...stored, target: PRODUCTION_URL, targetEnvironment: 'production' }) });
    expect(await code(h.service.advance({ profileId: PROFILE, runId }))).toBe('factory_target_mismatch');
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
  });

  test('a preflight from the wrong target is refused at confirm (manifest build or target guard)', async () => {
    const h = harness({ deployment: 'preview', preflightTarget: 'production' });
    await expect(h.confirm()).rejects.toThrow();
    expect(h.blobs.calls.put.filter((c) => c.pathname.includes('/runs/'))).toHaveLength(0);
  });
});

describe('Confirm: sandbox and production reservations', () => {
  test('a sandbox reservation through the real buildCloneManifest succeeds with no director and no cast', async () => {
    const h = harness({ deployment: 'preview' });
    const { run, created } = await h.confirm();
    const { runId, requestId, locationId } = ids(h.actorId);
    expect(created).toBe(true);
    expect(run).toMatchObject({ runId, actorId: h.actorId, status: 'prepared', destinationEnvironment: 'sandbox', destinationRequestId: requestId, destinationLocationId: locationId });
    expect(run.leaseToken).toBeUndefined();
    expect(run.idempotencyKey).toBeUndefined();
    expect(h.spies.resolveProgramDirector).not.toHaveBeenCalled();
    expect(h.spies.readCast).not.toHaveBeenCalled();
    expect(h.spies.schemaCheck).toHaveBeenCalledWith(SANDBOX_LEDGER, { mode: 'reserve' });
    const manifest = JSON.parse(h.blobs.objects.get(runPathname('sandbox', runId, 'manifest')).text);
    expect(manifest.createBody.akoya_requestid).toBe(requestId);
    expect(manifest.createBody[TEST_REQUEST_FIXED_FIELDS.runId]).toBe(runId);
    expect(manifest.values.testLabel).toBe('Factory proof');
  });

  test('a production reservation resolves the director from the session email, binds the cast, and the create body carries the derived ids', async () => {
    const h = harness({ deployment: 'production' });
    const { run, created } = await h.confirm();
    const { runId, requestId } = ids(h.actorId);
    expect(created).toBe(true);
    expect(run.destinationEnvironment).toBe('production');
    expect(h.spies.resolveProgramDirector).toHaveBeenCalledWith(expect.anything(), 'pd@wmkeck.org');
    const manifest = JSON.parse(h.blobs.objects.get(runPathname('production', runId, 'manifest')).text);
    expect(manifest.createBody.akoya_requestid).toBe(requestId);
    expect(manifest.createBody[TEST_REQUEST_FIXED_FIELDS.runId]).toBe(runId);
    expect(manifest.values).toMatchObject({ programDirectorId: PD_ID, piContactId: PI_ID });
    expect(h.createClientCalls.map((c) => c.resourceUrl)).toEqual([PRODUCTION_URL]);
  });

  test('production refuses a missing or invalid actor email and writes nothing', async () => {
    const h = harness({ deployment: 'production' });
    const draftId = await h.exportDraft();
    for (const actorEmail of [undefined, '', 'not-an-email']) {
      expect(await code(h.service.confirmRun(h.confirmArgs(draftId, { actorEmail })))).toBe('factory_actor_email_required');
    }
    expect(h.blobs.calls.put.filter((c) => c.pathname.includes('/runs/'))).toHaveLength(0);
  });

  test('artifact pathnames are server-minted and actor/target-bound; another actor cannot reach this draft', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    expect(h.blobs.calls.put[0].pathname).toBe(draftPathname('sandbox', h.actorId, draftId));
    const other = 12;
    const err = await code(h.service.confirmRun({ ...h.confirmArgs(draftId), profileId: other }));
    expect(err).toBe('factory_draft_missing');
    await expect(h.service.confirmRun(h.confirmArgs('../../etc/passwd'))).rejects.toThrow(/GUID/);
    await h.service.confirmRun(h.confirmArgs(draftId));
    const { runId } = ids(h.actorId);
    expect(h.blobs.calls.put.slice(1).map((c) => c.pathname)).toEqual([runPathname('sandbox', runId, 'bundle'), runPathname('sandbox', runId, 'manifest')]);
    expect(h.blobs.calls.put.every((c) => c.options.allowOverwrite === false && c.options.access === 'private' && c.options.token === 'fake-blob-token')).toBe(true);
  });

  test('the typed source number must match; the label is required and bounded', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    expect(await code(h.service.confirmRun(h.confirmArgs(draftId, { confirmSourceRequestNumber: '9000002' })))).toBe('factory_source_mismatch');
    for (const testLabel of [undefined, '   ', 'x'.repeat(121)]) {
      expect(await code(h.service.confirmRun(h.confirmArgs(draftId, { testLabel })))).toBe('factory_invalid_input');
    }
    expect(await code(h.service.confirmRun(h.confirmArgs(draftId, { idempotencyKey: 'has space' })))).toBe('factory_invalid_input');
  });

  test('an existing row is returned with no freshness check and no Blob read; a new reservation on a stale draft is refused', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    await h.service.confirmRun(h.confirmArgs(draftId));
    h.clock.t += 7 * HOUR; // draft now stale (> 6 h)
    h.blobs.calls.get.length = 0;
    const again = await h.service.confirmRun(h.confirmArgs(draftId));
    expect(again.created).toBe(false);
    expect(h.blobs.calls.get).toHaveLength(0);
    const staleKey = h.service.confirmRun({ ...h.confirmArgs(draftId), idempotencyKey: 'fresh-key-2' });
    expect(await code(staleKey)).toBe('factory_draft_stale');
    expect(h.ledger.rows.size).toBe(1);
  });

  test('a same-key retry still requires the typed source number to match the stored run', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    await h.service.confirmRun(h.confirmArgs(draftId));
    const wrongNumber = h.service.confirmRun({ ...h.confirmArgs(draftId), confirmSourceRequestNumber: '9999999' });
    expect(await code(wrongNumber)).toBe('factory_source_mismatch');
    expect(h.ledger.rows.size).toBe(1);
  });


  test('a failed or throwing reserveRun leaves artifacts in place and never deletes', async () => {
    const h = harness({ deployment: 'preview' });
    h.ledger.state.failReserve = true;
    await expect(h.confirm()).rejects.toThrow('reserve exploded');
    const { runId } = ids(h.actorId);
    expect(h.blobs.objects.has(runPathname('sandbox', runId, 'bundle'))).toBe(true);
    expect(h.blobs.objects.has(runPathname('sandbox', runId, 'manifest'))).toBe(true);
    expect(h.blobs.calls.del).toHaveLength(0);
    // The same key is then refused (artifacts exist, no row): re-export with a new key.
    h.ledger.state.failReserve = false;
    expect(await code(h.confirm())).toBe('factory_artifact_exists');
    expect(h.blobs.calls.del).toHaveLength(0);
  });

  test('a throwing schema check also leaves artifacts in place', async () => {
    const h = harness({ deployment: 'preview' });
    h.spies.schemaCheck.mockRejectedValueOnce(new Error('schema differs'));
    await expect(h.confirm()).rejects.toThrow('schema differs');
    expect(h.blobs.calls.del).toHaveLength(0);
    expect(h.ledger.rows.size).toBe(0);
  });

  test('any existing object at the run path is refused with factory_artifact_exists and not overwritten', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    for (const file of ['bundle', 'manifest']) {
      const fresh = harness({ deployment: 'preview' });
      const path = runPathname('sandbox', runId, file);
      fresh.blobs.objects.set(path, { text: '{"planted":true}', uploadedAt: new Date() });
      expect(await code(fresh.confirm())).toBe('factory_artifact_exists');
      expect(fresh.blobs.objects.get(path).text).toBe('{"planted":true}');
      expect(fresh.ledger.rows.size).toBe(0);
      expect(fresh.blobs.calls.del).toHaveLength(0);
    }
    expect(h.ledger.rows.size).toBe(0);
  });

  test('a missing draft fails cleanly with re-export guidance', async () => {
    const h = harness({ deployment: 'preview' });
    expect(await code(h.service.confirmRun(h.confirmArgs('11111111-1111-4111-8111-111111111111')))).toBe('factory_draft_missing');
  });
});

describe('pools', () => {
  test('the ledger pool is ended on success and on error, for every ledger-using entry point', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    expect(h.ledger.ends.count).toBe(1);
    await h.service.listRuns({ profileId: PROFILE });
    expect(h.ledger.ends.count).toBe(2);
    await expect(h.service.inspectRun({ profileId: PROFILE, runId: '11111111-1111-4111-8111-111111111111' })).rejects.toBeDefined();
    expect(h.ledger.ends.count).toBe(3);
    h.ledger.state.failReserve = true;
    await expect(h.service.confirmRun({ ...h.confirmArgs(await h.exportDraft()), idempotencyKey: 'another-key' })).rejects.toBeDefined();
    expect(h.ledger.ends.count).toBe(4);
  });
});

describe('kill switch and isolation', () => {
  test('with the switch off (or unset) write methods refuse and touch nothing; read methods work', async () => {
    for (const value of [undefined, 'off', 'ON']) {
      const h = harness({ deployment: 'preview', env: { TEST_REQUEST_FACTORY_FORM: value } });
      expect(await code(h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' }))).toBe('factory_form_disabled');
      expect(await code(h.service.confirmRun(h.confirmArgs('11111111-1111-4111-8111-111111111111')))).toBe('factory_form_disabled');
      expect(await code(h.service.advance({ profileId: PROFILE, runId: '11111111-1111-4111-8111-111111111111' }))).toBe('factory_form_disabled');
      expect(h.blobs.calls.put).toHaveLength(0);
      expect(h.dbUrls).toHaveLength(0);
      expect(await h.service.listRuns({ profileId: PROFILE })).toEqual([]);
      const { runId } = ids(h.actorId);
      h.seedRun(runId, { status: 'ready' });
      expect((await h.service.inspectRun({ profileId: PROFILE, runId })).run.runId).toBe(runId);
      expect((await h.service.readArtifacts({ profileId: PROFILE, runId })).cleanedUp).toBe(true);
    }
  });

  test('isolation off on production refuses reserve and advance; off production there is no check', async () => {
    for (const env of [{ TEST_REQUEST_ISOLATION: undefined }, { SYNTHETIC_REVIEWER_ISOLATION: undefined }, { TEST_REQUEST_ISOLATION: 'off' }]) {
      const h = harness({ deployment: 'production', env });
      expect(await code(h.confirm())).toBe('factory_isolation_off');
      const { runId } = ids(h.actorId);
      h.seedRun(runId, { status: 'creating' });
      expect(await code(h.service.advance({ profileId: PROFILE, runId }))).toBe('factory_isolation_off');
      expect(h.spies.advanceRun).not.toHaveBeenCalled();
    }
    const sandbox = harness({ deployment: 'preview', env: { TEST_REQUEST_ISOLATION: undefined, SYNTHETIC_REVIEWER_ISOLATION: undefined } });
    await expect(sandbox.confirm()).resolves.toMatchObject({ created: true });
  });
});

describe('identity and ownership', () => {
  test('a null or invalid profileId is refused everywhere', async () => {
    const h = harness({ deployment: 'preview' });
    const runId = '11111111-1111-4111-8111-111111111111';
    for (const profileId of [null, undefined, 0, -3, '11', 1.5]) {
      for (const call of [
        () => h.service.exportSource({ profileId, sourceRequestNumber: '9000001' }),
        () => h.service.confirmRun(h.confirmArgs(runId, { profileId })),
        () => h.service.advance({ profileId, runId }),
        () => h.service.listRuns({ profileId }),
        () => h.service.inspectRun({ profileId, runId }),
        () => h.service.readArtifacts({ profileId, runId }),
        () => h.service.recheck({ profileId, runId }),
      ]) {
        expect(await code(call())).toBe('factory_profile_required');
      }
    }
    expect(h.dbUrls).toHaveLength(0);
  });

  test("another actor's run is not found on every per-run entry point, and is not listed", async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const other = 99;
    expect(await h.service.listRuns({ profileId: other })).toEqual([]);
    for (const call of [
      () => h.service.inspectRun({ profileId: other, runId }),
      () => h.service.readArtifacts({ profileId: other, runId }),
      () => h.service.recheck({ profileId: other, runId }),
      () => h.service.advance({ profileId: other, runId }),
    ]) {
      expect(await code(call())).toBe('factory_run_not_found');
    }
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
    expect((await h.service.inspectRun({ profileId: PROFILE, runId })).run.runId).toBe(runId);
  });

  test('a non-GUID run id is not found before any ledger read', async () => {
    const h = harness({ deployment: 'preview' });
    expect(await code(h.service.inspectRun({ profileId: PROFILE, runId: "1'; DROP TABLE x" }))).toBe('factory_run_not_found');
  });
});

describe('advance', () => {
  test('a ready run returns without reading Blob or advancing', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'ready', current_step: 'verify', destination_request_number: '1004000' });
    const result = await h.service.advance({ profileId: PROFILE, runId });
    expect(result).toMatchObject({ outcome: 'ready', status: 'ready', destinationRequestNumber: '1004000' });
    expect(h.blobs.calls.get).toHaveLength(0);
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
    expect(h.createClientCalls).toHaveLength(0);
  });

  test('missing artifacts on a creating run are recovery-required, never re-exported', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'creating' });
    const error = await h.service.advance({ profileId: PROFILE, runId }).catch((e) => e);
    expect(error.code).toBe('factory_recovery_required');
    expect(error.message).toContain(runId);
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
    expect(h.blobs.calls.put).toHaveLength(0);
  });

  test('a resumable run advances one step with the stored manifest and digest-checked bundle', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const result = await h.service.advance({ profileId: PROFILE, runId });
    expect(result).toEqual({
      step: 'create_request', outcome: 'advanced', status: 'creating', destinationRequestNumber: null, errorMessage: null,
    });
    expect(h.spies.advanceRun).toHaveBeenCalledTimes(1);
    const call = h.spies.advanceRun.mock.calls[0][0];
    expect(call.runId).toBe(runId);
    expect(call.manifest.values.runId).toBe(runId);
    expect(sha256(call.bundle)).toBe(call.manifest.source.bundleSha256);
    expect(call.deps.client.baseUrl).toContain(SANDBOX_URL);
    expect(call.options.leaseSeconds).toBe(300);
  });

  test('a tampered stored bundle fails its digest check before advancing', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const path = runPathname('sandbox', runId, 'bundle');
    const stored = JSON.parse(h.blobs.objects.get(path).text);
    h.blobs.objects.set(path, { ...h.blobs.objects.get(path), text: JSON.stringify({ ...stored, tampered: true }) });
    expect(await code(h.service.advance({ profileId: PROFILE, runId }))).toBe('factory_artifact_digest_mismatch');
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
    expect(artifactDigest(stored)).toBeTruthy();
  });
});

describe('exportSource / readArtifacts / recheck', () => {
  test('the default exporter reads the source Request AND its document locations through the production client, never the deployment host (Codex slice 1)', async () => {
    // Preview deployment: no DYNAMICS_URL in env, so anything that reached
    // DynamicsService would throw. Every Dataverse read must go through the
    // client created for TARGET_URLS.production.
    const LOC_ID = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
    const PARENT_ID = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
    const sourceRow = {
      akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 7,
    };
    const gets = [];
    const fakeClient = (resourceUrl) => ({
      baseUrl: `${resourceUrl}/api/data/v9.2`,
      async get(path) {
        gets.push({ resourceUrl, path });
        const ok = (body) => ({ ok: true, status: 200, body });
        if (path.startsWith('/akoya_requests?')) return ok({ value: [sourceRow] });
        if (path.startsWith(`/akoya_requests(${SOURCE_ID})`)) return ok({ akoya_requestid: SOURCE_ID, versionnumber: 7 });
        if (path.startsWith('/sharepointdocumentlocations?')) {
          return ok({ value: [{ sharepointdocumentlocationid: LOC_ID, relativeurl: '9000001_ROOT', _parentsiteorlocation_value: PARENT_ID }] });
        }
        if (path.startsWith(`/sharepointdocumentlocations(${PARENT_ID})`)) {
          return ok({ sharepointdocumentlocationid: PARENT_ID, relativeurl: 'akoya_request' });
        }
        throw new Error(`unexpected Dataverse read ${path}`);
      },
    });
    const pdf = Buffer.from('source-pdf');
    const graphMetadata = { id: 'graph-item-1', name: 'ProjectDescription.pdf', size: pdf.length, mimeType: 'application/pdf', eTag: 'etag-1', versionId: '1.0' };
    const graphCalls = { listFiles: [] };
    const sourceDependencies = {
      getSharePointTargetInfo: () => ({ key: 'akoyago-shared', scope: 'shared', registered: true, hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' }),
      listFiles: async (library, folder) => {
        graphCalls.listFiles.push({ library, folder });
        // An archive miss is accepted only as a 404 folder-not-found (isExpectedArchiveMiss).
        if (library !== 'akoya_request') throw Object.assign(new Error('folder not found'), { code: 'graph_folder_not_found', status: 404 });
        return [{ id: 'graph-item-1', name: 'ProjectDescription.pdf', folder: `${folder}/Phase I`, size: pdf.length, mimeType: 'application/pdf', lastModified: '2026-09-20T10:00:00Z' }];
      },
      getDriveId: async () => 'drive-1',
      clearGraphCaches: () => {},
      getFileMetadataById: async () => graphMetadata,
      downloadFile: async () => ({ buffer: pdf, filename: graphMetadata.name, mimeType: graphMetadata.mimeType, size: graphMetadata.size }),
    };
    const ledger = fakeLedger();
    const blobs = fakeBlob();
    const service = createAdminRunService({
      env: { TEST_REQUEST_FACTORY_FORM: 'on', FACTORY_BLOB_RW_TOKEN: 't', TEST_REQUEST_SANDBOX_LEDGER_URL: SANDBOX_LEDGER },
      deployment: 'preview',
      ledgerDbFactory: () => ledger.db,
      blob: blobs.blob,
      createClient: ({ resourceUrl }) => fakeClient(resourceUrl),
      getAccessToken: async () => 'fake-token',
      sourceDependencies,
    });

    const result = await service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });

    expect(result.draftId).toMatch(/^[0-9a-f-]{36}$/);
    const draft = JSON.parse([...blobs.objects.values()][0].text);
    expect(draft.documents).toHaveLength(1);
    // The bundle projection stores the folder relative to its bucket.
    expect(draft.documents[0]).toMatchObject({ name: 'ProjectDescription.pdf', library: 'akoya_request', folder: 'Phase I' });
    // Every Dataverse read, including both location reads, went to the production client.
    expect(gets.length).toBeGreaterThanOrEqual(4);
    expect(gets.every((g) => g.resourceUrl === PRODUCTION_URL)).toBe(true);
    expect(gets.some((g) => g.path.startsWith('/sharepointdocumentlocations?') && g.path.includes(SOURCE_ID))).toBe(true);
    expect(gets.some((g) => g.path.startsWith(`/sharepointdocumentlocations(${PARENT_ID})`))).toBe(true);
    // The dynamics bucket was listed; the archive probes were tried and their misses accepted.
    expect(graphCalls.listFiles.some((c) => c.library === 'akoya_request' && c.folder === '9000001_ROOT')).toBe(true);
    expect(graphCalls.listFiles.length).toBeGreaterThan(1);
  });

  test('export stores the bundle under a minted draft path and never returns bundle text', async () => {
    const h = harness({ deployment: 'preview' });
    const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(Object.keys(result).sort()).toEqual(['defaults', 'draftId', 'summary']);
    expect(result.defaults).toEqual({ fiscalYear: 'December 2026', meetingDate: '2026-12-01' });
    expect(JSON.stringify(result)).not.toContain('Synthetic purpose');
    expect(h.blobs.objects.has(draftPathname('sandbox', h.actorId, result.draftId))).toBe(true);
    expect(await code(h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '12ab' }))).toBe('factory_invalid_input');
  });

  test('readArtifacts returns both documents; a non-ready run with missing artifacts is an error', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const artifacts = await h.service.readArtifacts({ profileId: PROFILE, runId });
    expect(artifacts.cleanedUp).toBe(false);
    expect(artifacts.manifest.values.runId).toBe(runId);
    expect(artifacts.bundle.kind).toBeDefined();
    h.blobs.objects.clear();
    expect(await code(h.service.readArtifacts({ profileId: PROFILE, runId }))).toBe('factory_artifacts_missing');
  });

  test('recheck refuses a sandbox run', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    expect(await code(h.service.recheck({ profileId: PROFILE, runId: ids(h.actorId).runId }))).toBe('factory_run_not_production');
  });
});

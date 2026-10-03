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
import { createAdminRunService, diagnoseFactoryRun } from '../../lib/services/test-requests/admin-run-service.js';
import { runStatusChange as realRunStatusChange } from '../../lib/services/test-requests/status-change-runner.js';
import { deriveActorId, deriveRunIds } from '../../lib/services/test-requests/admin-run-identity.js';
import { artifactDigest, draftPathname, runPathname } from '../../lib/services/test-requests/factory-artifact-store.js';
import { SANDBOX_URL, PRODUCTION_URL, sha256 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle, PRE_SITE_SECTION_FIELDS } from '../../lib/services/test-requests/source-bundle.js';
import { PROPOSAL_CORE_KEYS } from '../../shared/config/prompts/pre-site-visit-proposal-core.js';
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
const CHANGE_ID = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
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
  const state = { failReserve, resources: [] };
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
      if (/FROM test_request_run_resources WHERE run_id/.test(text)) return { rows: state.resources.filter((r) => r.run_id === params[0]) };
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
    'akoya_requestid', 'akoya_title', 'akoya_purpose', 'wmkf_abstract', 'akoya_request', 'akoya_fiscalyear',
    TEST_REQUEST_FIXED_FIELDS.requestType, 'wmkf_meetingdate', TEST_REQUEST_FIXED_FIELDS.marker,
    TEST_REQUEST_FIXED_FIELDS.runId, TEST_REQUEST_FIXED_FIELDS.responseReminder, TEST_REQUEST_FIXED_FIELDS.reviewReminder,
  ];
  const typeOf = (field) => {
    if (field === 'akoya_request') return 'Money';
    if (field === 'akoya_purpose' || field === 'wmkf_abstract') return 'Memo';
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
    ...(field === 'wmkf_abstract' ? { maxLength: 30000 } : {}),
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
      wmkf_abstract: 'Applicant source abstract',
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 1,
    },
    documents: [],
    dataverseHost: PRODUCTION_HOSTS[0],
    exportedAt: new Date(exportedAt),
    applicantAbstract: 'Applicant source abstract',
  });
}

function harness({ deployment = 'preview', env = {}, preflightTarget = null, deps = {} } = {}) {
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
    runStatusChange: jest.fn(async () => ({ changeId: CHANGE_ID, sequence: 1, field: 'wmkf_phaseiistatus', after: 100000002 })),
    recheckStatusChange: jest.fn(async () => ({ sequence: 1, ok: true })),
    readLiveOptions: jest.fn(async (_client, field) => [{ value: 1, label: `option of ${field}` }]),
    readCurrentStatus: jest.fn(async () => ({ phase1: 100000001, phase2: null })),
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
    readSourceDisplay: async () => ({ title: 'Source title', applicant: 'Live University' }),
    readCast: spies.readCast,
    resolveProgramDirector: spies.resolveProgramDirector,
    advanceRun: spies.advanceRun,
    runStatusChange: spies.runStatusChange,
    recheckStatusChange: spies.recheckStatusChange,
    readLiveOptions: spies.readLiveOptions,
    readCurrentStatus: spies.readCurrentStatus,
    ...deps,
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

  test.each([2, 3, 4])('new Confirm refuses a v%d draft before writing run artifacts', async (version) => {
    const h = harness({
      deployment: 'preview',
      deps: {
        exportBundle: async ({ exportedAt }) => {
          const legacy = bundleAt(exportedAt);
          legacy.version = version;
          if (version < 4) {
            delete legacy.abstract;
            if (version === 3) legacy.reviewers = [];
          } else {
            legacy.reviewers = [];
            legacy.preSiteVisit = {
              requestDocumentId: 'cccccccc-0000-0000-0000-000000000001',
              sectionFields: Object.fromEntries(PRE_SITE_SECTION_FIELDS.map((field) => [field, 'section text'])),
              proposalCoreJson: {
                schemaVersion: 4,
                proposalCore: Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, 'core text'])),
                diagnostics: [],
              },
              personnel: { principalInvestigator: 'PI', coPrincipalInvestigators: [] },
            };
          }
          return legacy;
        },
      },
    });
    const draftId = await h.exportDraft();
    expect(await code(h.service.confirmRun(h.confirmArgs(draftId)))).toBe('factory_bundle_abstract_required');
    expect(h.ledger.rows.size).toBe(0);
    expect(h.blobs.calls.put.filter((call) => call.pathname.includes('/runs/'))).toHaveLength(0);
  });

  test('same-key Confirm returns an already-reserved run before requiring a new bundle version', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { source_request_number: '9000001' });
    const result = await h.service.confirmRun(h.confirmArgs('11111111-1111-4111-8111-111111111111'));
    expect(result.created).toBe(false);
    expect(result.run.runId).toBe(runId);
    expect(h.blobs.calls.get).toHaveLength(0);
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
      expect(await h.service.listRuns({ profileId: PROFILE })).toEqual({ runs: [], formEnabled: false, target: 'sandbox' });
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
    expect((await h.service.listRuns({ profileId: other })).runs).toEqual([]);
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
    expect(result).toMatchObject({
      outcome: 'ready', status: 'ready', destinationRequestNumber: '1004000', currentStep: 'verify', stepIndex: 0,
    });
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
      step: 'create_request', outcome: 'advanced', currentStep: null, stepIndex: null, status: 'creating', destinationRequestNumber: null, errorMessage: null,
    });
    expect(h.spies.advanceRun).toHaveBeenCalledTimes(1);
    const call = h.spies.advanceRun.mock.calls[0][0];
    expect(call.runId).toBe(runId);
    expect(call.manifest.values.runId).toBe(runId);
    expect(sha256(call.bundle)).toBe(call.manifest.source.bundleSha256);
    expect(call.deps.client.baseUrl).toContain(SANDBOX_URL);
    expect(call.options.leaseSeconds).toBe(300);
  });

  test('a stopped step logs its error text server-side; an advanced step logs nothing', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = harness({ deployment: 'preview' });
      await h.confirm();
      const { runId } = ids(h.actorId);
      await h.service.advance({ profileId: PROFILE, runId });
      expect(logged).not.toHaveBeenCalled();
      h.spies.advanceRun.mockResolvedValueOnce({
        step: 'create_request', outcome: 'needs_attention', run: { status: 'needs_attention' },
        errorMessage: 'single Request create failed (400): plugin said no',
      });
      const result = await h.service.advance({ profileId: PROFILE, runId });
      expect(result.errorMessage).toBe('single Request create failed (400): plugin said no');
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]).toEqual([
        'admin test-request run step stopped:', runId, 'create_request', 'needs_attention', 'single Request create failed (400): plugin said no',
      ]);
    } finally {
      logged.mockRestore();
    }
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
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', wmkf_abstract: 'Source abstract', versionnumber: 7,
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
    expect(Object.keys(result).sort()).toEqual(['defaults', 'draftId', 'source', 'summary']);
    expect(result.source).toEqual({ title: 'Source title', applicant: 'Live University' });
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

// ---- slice 2: cooperative deadlines and recovery cases -----------------------

describe('cooperative deadlines (slice 2)', () => {
  const LOC_ID = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
  const PARENT_ID = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
  const DOC_COUNT = 7;

  // The real default exporter with fakes, so the per-document hydrate checkpoint is exercised.
  function sevenDocumentService() {
    const sourceRow = {
      akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
      akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', wmkf_abstract: 'Source abstract', versionnumber: 7,
    };
    const fakeClient = (resourceUrl) => ({
      baseUrl: `${resourceUrl}/api/data/v9.2`,
      async get(path) {
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
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // The seven allowlisted source documents (admin-preview-service DOCUMENT_SPECS).
    const items = [
      ['Phase I', 'ProjectDescription.pdf'], ['Phase I', 'Biosketches.pdf'], ['Phase I', 'ProjectBudget.pdf'],
      ['Phase I', 'Project Budget spreadsheet.xlsx'], ['Reviewer Materials', 'Proposal_9000001.pdf'],
      ['AI Materials', 'ProposalNarrative_9000001.pdf'], ['AI Materials', 'ProposalBibliography_9000001.pdf'],
    ].map(([sub, name], i) => ({
      id: `item-${i + 1}`, sub, name, mimeType: name.endsWith('.xlsx') ? XLSX : 'application/pdf',
    }));
    expect(items).toHaveLength(DOC_COUNT);
    const metaFor = (id) => {
      const item = items.find((candidate) => candidate.id === id);
      return {
        id, name: item.name, size: pdf.length, mimeType: item.mimeType, eTag: `etag-${id}`, versionId: '1.0',
      };
    };
    const clock = { t: Date.now() };
    const downloads = [];
    const ledger = fakeLedger();
    const blobs = fakeBlob();
    const sourceDependencies = {
      getSharePointTargetInfo: () => ({ key: 'akoyago-shared', scope: 'shared', registered: true, hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' }),
      listFiles: async (library, folder) => {
        if (library !== 'akoya_request') throw Object.assign(new Error('folder not found'), { code: 'graph_folder_not_found', status: 404 });
        return items.map((item) => ({
          id: item.id, name: item.name, folder: `${folder}/${item.sub}`, size: pdf.length, mimeType: item.mimeType, lastModified: '2026-09-20T10:00:00Z',
        }));
      },
      getDriveId: async () => 'drive-1',
      clearGraphCaches: () => {},
      getFileMetadataById: async (_driveId, id) => metaFor(id),
      downloadFile: async (_driveId, id) => {
        downloads.push(id);
        if (downloads.length === 4 && clock.deadlineAt != null) clock.t = clock.deadlineAt + 1; // time runs out during the 4th hydrate
        return { buffer: pdf, filename: metaFor(id).name, mimeType: metaFor(id).mimeType, size: pdf.length };
      },
    };
    const service = createAdminRunService({
      env: { TEST_REQUEST_FACTORY_FORM: 'on', FACTORY_BLOB_RW_TOKEN: 't', TEST_REQUEST_SANDBOX_LEDGER_URL: SANDBOX_LEDGER },
      deployment: 'preview',
      ledgerDbFactory: () => ledger.db,
      blob: blobs.blob,
      createClient: ({ resourceUrl }) => fakeClient(resourceUrl),
      getAccessToken: async () => 'fake-token',
      sourceDependencies,
      now: () => clock.t,
    });
    return { service, clock, downloads, blobs };
  }

  test('an export whose time runs out during the fourth hydrate is refused: no draft, later documents not hydrated', async () => {
    const h = sevenDocumentService();
    h.clock.deadlineAt = h.clock.t + 100_000;
    const error = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001', deadlineAt: h.clock.deadlineAt }).catch((e) => e);
    expect(error.httpStatus).toBe(504);
    expect(error.code).toBe('factory_deadline_exceeded');
    expect(error.message).toMatch(/Nothing was started/);
    expect(h.downloads).toHaveLength(4);
    expect(h.blobs.objects.size).toBe(0);
    expect(h.blobs.calls.put).toHaveLength(0);
  });

  test('the same export within its deadline stores exactly one draft', async () => {
    const h = sevenDocumentService();
    const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001', deadlineAt: h.clock.t + 100_000 });
    expect(h.downloads).toHaveLength(DOC_COUNT);
    expect(h.blobs.objects.size).toBe(1);
    expect(h.blobs.objects.has(draftPathname('sandbox', deriveActorId(PROFILE), result.draftId))).toBe(true);
  });

  test('export refuses before starting, and before the draft write, when the deadline has passed', async () => {
    const h = harness({ deployment: 'preview' });
    expect(await code(h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001', deadlineAt: h.clock.t - 1 }))).toBe('factory_deadline_exceeded');
    expect(h.blobs.calls.put).toHaveLength(0);
    // The injected exporter consumes the clock: the deadline passes after it returns, before the put.
    const late = harness({ deployment: 'preview' });
    const deadlineAt = late.clock.t + 1000;
    const slow = createAdminRunService({
      env: { TEST_REQUEST_FACTORY_FORM: 'on', FACTORY_BLOB_RW_TOKEN: 't', TEST_REQUEST_SANDBOX_LEDGER_URL: SANDBOX_LEDGER },
      deployment: 'preview',
      ledgerDbFactory: () => late.ledger.db,
      blob: late.blobs.blob,
      now: () => late.clock.t,
      exportBundle: async ({ exportedAt }) => { late.clock.t += 5000; return bundleAt(exportedAt); },
    });
    expect(await code(slow.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001', deadlineAt }))).toBe('factory_deadline_exceeded');
    expect(late.blobs.calls.put).toHaveLength(0);
  });

  test('advance with under 150 s left is refused before advanceRun and any lease; with enough time it advances', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    const tooLate = await h.service.advance({ profileId: PROFILE, runId, deadlineAt: h.clock.t + 149_000 }).catch((e) => e);
    expect(tooLate.httpStatus).toBe(504);
    expect(tooLate.code).toBe('factory_deadline_exceeded');
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
    const ok = await h.service.advance({ profileId: PROFILE, runId, deadlineAt: h.clock.t + 150_000 });
    expect(ok.outcome).toBe('advanced');
    expect(h.spies.advanceRun).toHaveBeenCalledTimes(1);
  });

  test('a ready run still answers when the deadline has passed (no step to start)', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'ready' });
    expect((await h.service.advance({ profileId: PROFILE, runId, deadlineAt: h.clock.t - 1 })).outcome).toBe('ready');
  });

  test('confirmRun past its deadline is refused before any run-path write', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    const putsBefore = h.blobs.calls.put.length;
    const error = await h.service.confirmRun({ ...h.confirmArgs(draftId), deadlineAt: h.clock.t - 1 }).catch((e) => e);
    expect(error.code).toBe('factory_deadline_exceeded');
    expect(h.blobs.calls.put.slice(putsBefore).filter((c) => c.pathname.includes('/runs/'))).toHaveLength(0);
    expect(h.blobs.calls.put).toHaveLength(putsBefore);
    expect(h.ledger.rows.size).toBe(0);
    expect(h.spies.schemaCheck).not.toHaveBeenCalled();
  });

  test('no deadlineAt leaves behaviour unchanged', async () => {
    const h = harness({ deployment: 'preview' });
    const result = await h.confirm();
    expect(result.created).toBe(true);
    const { runId } = ids(h.actorId);
    expect((await h.service.advance({ profileId: PROFILE, runId })).outcome).toBe('advanced');
  });
});

describe('slice 2 recovery cases', () => {
  test('two overlapping Confirms with the same key reserve exactly one run and overwrite no artifact', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    const results = await Promise.allSettled([
      h.service.confirmRun(h.confirmArgs(draftId)),
      h.service.confirmRun(h.confirmArgs(draftId)),
    ]);
    expect(h.ledger.rows.size).toBe(1);
    const winners = results.filter((r) => r.status === 'fulfilled' && r.value.created === true);
    expect(winners).toHaveLength(1);
    for (const loser of results.filter((r) => !winners.includes(r))) {
      // The loser is refused at the create-only write, or is handed the winner's row.
      if (loser.status === 'rejected') expect(loser.reason.code).toBe('factory_artifact_exists');
      else expect(loser.value.created).toBe(false);
    }
    const { runId } = ids(h.actorId);
    const runPuts = h.blobs.calls.put.filter((c) => c.pathname.includes(runId));
    expect(runPuts.every((c) => !c.options.allowOverwrite)).toBe(true);
    expect(h.blobs.calls.del).toHaveLength(0);
  });

  test('a lost COMMIT response with the row present: the retry returns the row and touches no artifact', async () => {
    const h = harness({ deployment: 'preview' });
    const draftId = await h.exportDraft();
    await h.service.confirmRun(h.confirmArgs(draftId)); // committed; pretend the caller never saw the response
    const putsBefore = h.blobs.calls.put.length;
    const retry = await h.service.confirmRun(h.confirmArgs(draftId));
    expect(retry.created).toBe(false);
    expect(retry.run.runId).toBe(ids(h.actorId).runId);
    expect(h.blobs.calls.put).toHaveLength(putsBefore);
    expect(h.blobs.calls.del).toHaveLength(0);
    expect(h.ledger.rows.size).toBe(1);
  });

  test('a second lookup of the same source mints a new draftId and a new draft path', async () => {
    const h = harness({ deployment: 'preview' });
    const first = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    const second = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(second.draftId).not.toBe(first.draftId);
    expect(h.blobs.objects.has(draftPathname('sandbox', h.actorId, first.draftId))).toBe(true);
    expect(h.blobs.objects.has(draftPathname('sandbox', h.actorId, second.draftId))).toBe(true);
    expect(h.blobs.objects.size).toBe(2);
  });
});

// ---- slice 2b: status setter ---------------------------------------------------

describe('status setter service (slice 2b)', () => {
  const readyProduction = (extra = {}) => {
    const h = harness({ deployment: 'production', ...extra });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'ready' });
    return { h, runId };
  };
  const change = (h, runId, extra = {}) => h.service.changeStatus({
    profileId: PROFILE, runId, field: 'phase2', optionLabel: 'Recommended', deadlineAt: h.clock.t + 280_000, ...extra,
  });
  const runnerError = (errorCode, message = 'upstream detail: secret-host.example', extra = {}) => Object.assign(new Error(message), { code: errorCode, changeId: CHANGE_ID, sequence: 1, ...extra });

  test('statusOptions returns both fields live options, the journal and the run status, through a read client', async () => {
    const { h, runId } = readyProduction();
    const result = await h.service.statusOptions({ profileId: PROFILE, runId });
    expect(result).toEqual({
      runId,
      runStatus: 'ready',
      // Option 1 is not in the transition table, so the planner's verdict blocks it.
      options: {
        phase1: [{ value: 1, label: 'option of wmkf_phaseistatus', blocked: 'status_change_refused', effects: null }],
        phase2: [{ value: 1, label: 'option of wmkf_phaseiistatus', blocked: 'status_change_refused', effects: null }],
      },
      current: { phase1: 100000001, phase2: null },
      changes: [],
    });
    expect(h.spies.readCurrentStatus).toHaveBeenCalledWith(expect.anything(), '12121212-1212-4121-8121-121212121212');
    expect(h.createClientCalls.every((c) => !c.allowTestRequestMarkerWrites)).toBe(true);
  });

  test('statusOptions marks each option with the planner verdict for the current pair', async () => {
    const { h, runId } = readyProduction();
    h.spies.readCurrentStatus.mockResolvedValueOnce({ phase1: 100000003, phase2: 100000003 }); // Invited / Approved
    h.spies.readLiveOptions.mockImplementation(async (_client, field) => (field === 'wmkf_phaseiistatus'
      ? [{ value: 100000003, label: 'Approved' }, { value: 100000004, label: 'Recommended' }, { value: 100000001, label: 'Declined' }]
      : [{ value: 100000003, label: 'Invited' }]));
    const { options } = await h.service.statusOptions({ profileId: PROFILE, runId });
    const byLabel = Object.fromEntries(options.phase2.map((option) => [option.label, option.blocked]));
    // Approved is the current value; Recommended would create a payment and is not allowed from Approved; Declined is allowed.
    expect(byLabel).toEqual({ Approved: 'status_change_noop', Recommended: 'status_change_edge', Declined: null });
    expect(options.phase1[0].blocked).toBe('status_change_noop');
    // effects: null when blocked; an array of allowed classes (possibly empty) when not.
    const effectsByLabel = Object.fromEntries(options.phase2.map((option) => [option.label, option.effects]));
    expect(effectsByLabel.Approved).toBeNull();
    expect(effectsByLabel.Recommended).toBeNull();
    expect(Array.isArray(effectsByLabel.Declined)).toBe(true);
    expect(effectsByLabel.Declined.every((c) => ['emails', 'tracking', 'payments'].includes(c))).toBe(true);
  });

  test('S2: a run that is not ready has effects null on every option', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'prepared' });
    const { options } = await h.service.statusOptions({ profileId: PROFILE, runId });
    expect([...options.phase1, ...options.phase2].every((o) => o.effects === null && o.blocked === null)).toBe(true);
  });

  test('F7: a run that is not ready answers options and journal with current null and reads no Request', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'prepared' });
    const result = await h.service.statusOptions({ profileId: PROFILE, runId });
    expect(result.current).toBeNull();
    expect(result.runStatus).toBe('prepared');
    expect(result.options.phase1).toHaveLength(1);
    expect(result.changes).toEqual([]);
    expect(h.spies.readCurrentStatus).not.toHaveBeenCalled();
  });

  test('changeStatus calls the runner once with the run, the mapped Dataverse field, label and a deadline-bound completion, never rerun', async () => {
    const { h, runId } = readyProduction();
    const deadlineAt = h.clock.t + 280_000;
    const result = await change(h, runId, { deadlineAt });
    expect(result).toMatchObject({ outcome: 'complete', changeId: CHANGE_ID, sequence: 1 });
    expect(h.spies.runStatusChange).toHaveBeenCalledTimes(1);
    const call = h.spies.runStatusChange.mock.calls[0][0];
    expect(call).toMatchObject({ runId, field: 'wmkf_phaseiistatus', optionLabel: 'Recommended' });
    expect(call.completion.deadlineAt).toBe(deadlineAt - 30_000);
    expect(Object.hasOwn(call, 'rerun')).toBe(false);
    expect(call.client.allowTestRequestMarkerWrites).toBeUndefined();
  });

  test.each([
    ['status_change_jobs_open', 202, { outcome: 'jobs_open', code: 'status_change_jobs_open', message: 'The change was written. Background jobs on the Request are still finishing; check again.', changeId: CHANGE_ID }],
  ])('runner %s becomes a returned value', async (errorCode, _status, expected) => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(runnerError(errorCode));
    expect(await change(h, runId)).toEqual(expected);
  });

  test('in progress returns the owner abandon command and no upstream text', async () => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(runnerError('status_change_in_progress'));
    const result = await change(h, runId);
    expect(result).toEqual({
      outcome: 'in_progress', code: 'status_change_in_progress',
      message: 'This change is being sent, or was sent and its result is not yet known. Do not retry. If it never resolves, the owner closes it from the CLI after establishing that no sender is still running.',
      changeId: CHANGE_ID,
      abandonCommand: `node scripts/rehearse-test-request-sandbox.mjs --target=production --status-abandon=${runId} --change-id=${CHANGE_ID}`,
    });
  });

  test('an ambiguous send is unconfirmed and never carries the upstream error text', async () => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(runnerError('status_change_ambiguous', 'The status PATCH has no readable result (connect ECONNRESET secret-host.example)'));
    const result = await change(h, runId);
    expect(result).toEqual({
      outcome: 'unconfirmed', code: 'status_change_ambiguous',
      message: 'The change was sent but its result could not be read. Check again; do not start a different change.', changeId: CHANGE_ID,
    });
    expect(JSON.stringify(result)).not.toMatch(/ECONNRESET|secret-host/);
  });

  test.each([
    'status_change_noop', 'status_change_open', 'status_change_conflict', 'status_change_resume', 'status_change_effects',
    'status_change_edge', 'status_change_concurrent', 'status_change_refused',
  ])('runner %s is a 409 with the runner code and message', async (errorCode) => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(runnerError(errorCode, 'runner says no'));
    const error = await change(h, runId).catch((e) => e);
    expect(error).toMatchObject({ httpStatus: 409, code: errorCode, message: 'runner says no' });
  });

  test('a changeId makes the runner call resume-only; without one no resumeChangeId is passed; a malformed one is 400 before the runner', async () => {
    const { h, runId } = readyProduction();
    await change(h, runId, { changeId: CHANGE_ID.toUpperCase() });
    expect(h.spies.runStatusChange.mock.calls[0][0].resumeChangeId).toBe(CHANGE_ID);
    await change(h, runId);
    expect(h.spies.runStatusChange.mock.calls[1][0]).not.toHaveProperty('resumeChangeId');
    await expect(change(h, runId, { changeId: 'not-a-guid' })).rejects.toMatchObject({ httpStatus: 400, code: 'factory_invalid_input' });
    expect(h.spies.runStatusChange).toHaveBeenCalledTimes(2);
  });

  test('a replay is a 409 pointing at the owner CLI', async () => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(runnerError('status_change_replay', 'pass --rerun'));
    const error = await change(h, runId).catch((e) => e);
    expect(error).toMatchObject({ httpStatus: 409, code: 'status_change_replay' });
    expect(error.message).toBe('An earlier change to this status created, or may have created, a payment or status-tracking row on this Request. Repeating it needs the owner CLI (`--set-status … --rerun`) after inspection.');
  });

  test('a Postgres unique violation from planning is a 409 status_change_open', async () => {
    const { h, runId } = readyProduction();
    h.spies.runStatusChange.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    const error = await change(h, runId).catch((e) => e);
    expect(error).toMatchObject({ httpStatus: 409, code: 'status_change_open', message: 'Another status change on this run is already open; reload.' });
  });

  test('an unlisted error is rethrown unchanged (the route answers a generic 500)', async () => {
    const { h, runId } = readyProduction();
    const boom = new Error('Request read failed');
    h.spies.runStatusChange.mockRejectedValueOnce(boom);
    await expect(change(h, runId)).rejects.toBe(boom);
  });

  test('write switch off: changeStatus and statusRecheck are 503, statusOptions still answers', async () => {
    const { h, runId } = readyProduction({ env: { TEST_REQUEST_FACTORY_FORM: 'off' } });
    expect(await code(change(h, runId))).toBe('factory_form_disabled');
    expect(await code(h.service.statusRecheck({ profileId: PROFILE, runId }))).toBe('factory_form_disabled');
    await expect(h.service.statusOptions({ profileId: PROFILE, runId })).resolves.toMatchObject({ runStatus: 'ready' });
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
    expect(h.spies.recheckStatusChange).not.toHaveBeenCalled();
  });

  test('isolation off on production: changeStatus is 503 before the runner', async () => {
    const { h, runId } = readyProduction({ env: { TEST_REQUEST_ISOLATION: 'off' } });
    expect(await code(change(h, runId))).toBe('factory_isolation_off');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
  });

  test("another actor's run is 404 on all three", async () => {
    const { h, runId } = readyProduction();
    for (const call of [
      () => h.service.statusOptions({ profileId: 99, runId }),
      () => change(h, runId, { profileId: 99 }),
      () => h.service.statusRecheck({ profileId: 99, runId }),
    ]) expect(await code(call())).toBe('factory_run_not_found');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
    expect(h.spies.recheckStatusChange).not.toHaveBeenCalled();
  });

  test('a sandbox run is 409 on all three', async () => {
    const h = harness({ deployment: 'preview' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'ready' });
    for (const call of [
      () => h.service.statusOptions({ profileId: PROFILE, runId }),
      () => change(h, runId),
      () => h.service.statusRecheck({ profileId: PROFILE, runId }),
    ]) expect(await code(call())).toBe('factory_run_not_production');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
  });

  test('a run that is not ready is 409 before the runner is called', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'creating' });
    expect(await code(change(h, runId))).toBe('factory_run_not_ready');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
  });

  test('under 150 s of route time left is a 504 and the runner is not called; exactly 150 s is allowed', async () => {
    const { h, runId } = readyProduction();
    expect(await code(change(h, runId, { deadlineAt: h.clock.t + 149_999 }))).toBe('factory_deadline_exceeded');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
    await expect(change(h, runId, { deadlineAt: h.clock.t + 150_000 })).resolves.toMatchObject({ outcome: 'complete' });
  });

  test('field and label are validated before any ledger work', async () => {
    const { h, runId } = readyProduction();
    expect(await code(change(h, runId, { field: 'phase3' }))).toBe('factory_invalid_input');
    expect(await code(change(h, runId, { optionLabel: '  ' }))).toBe('factory_invalid_input');
    expect(h.spies.runStatusChange).not.toHaveBeenCalled();
  });

  test('statusRecheck passes through the runner result; a runner refusal is a 409', async () => {
    const { h, runId } = readyProduction();
    await expect(h.service.statusRecheck({ profileId: PROFILE, runId })).resolves.toEqual({ sequence: 1, ok: true });
    h.spies.recheckStatusChange.mockRejectedValueOnce(runnerError('status_change_refused', 'This run has no status change to recheck.'));
    expect(await h.service.statusRecheck({ profileId: PROFILE, runId }).catch((e) => ({ s: e.httpStatus, c: e.code }))).toEqual({ s: 409, c: 'status_change_refused' });
  });

  test('a second POST for a jobs_open change calls the runner again and the real runner sends no second PATCH', async () => {
    const PHASE2 = 'wmkf_phaseiistatus';
    const REQUEST_ID = '13131313-1313-4131-8131-131313131313';
    const state = {
      akoya_requestid: REQUEST_ID, wmkf_istestrequest: true, wmkf_testcreationrunid: null, wmkf_phaseistatus: null, wmkf_phaseiistatus: null,
      _wmkf_grantprogram_value: PROGRAM_ID, akoya_requeststatus: 'Pending', '@odata.etag': 'W/"100"',
    };
    const patches = [];
    let jobsDone = false;
    const rows = [];
    const move = (id, from, to, extra = {}) => {
      const row = rows.find((r) => r.changeId === id);
      if (!row || !from.includes(row.status)) return null;
      Object.assign(row, { status: to }, extra);
      return { ...row };
    };
    const memoryLedger = {
      getRun: async (id) => ({ runId: id, status: 'ready', destinationEnvironment: 'production', destinationRequestId: REQUEST_ID, sourceRequestId: SOURCE_ID }),
      listStatusChanges: async () => rows.map((r) => ({ ...r })),
      planStatusChange: async (input) => { const row = { ...input, sequence: 1, status: 'planned', dispatchedAt: null, effects: null }; rows.push(row); return { ...row }; },
      markStatusChangeDispatched: async ({ changeId }) => move(changeId, ['planned'], 'dispatched', { dispatchedAt: '2026-09-28T22:00:00Z' }),
      markStatusChangeApplied: async ({ changeId }) => move(changeId, ['dispatched', 'applied'], 'applied'),
      completeStatusChange: async ({ changeId, effects }) => move(changeId, ['applied'], 'complete', { effects }),
      markStatusChangeNeedsAttention: async ({ changeId, onlyIf }) => move(changeId, onlyIf ? [onlyIf] : ['planned', 'dispatched', 'applied'], 'needs_attention'),
    };
    const ok = (body) => ({ ok: true, status: 200, body });
    const client = {
      baseUrl: `${PRODUCTION_URL}/api/data/v9.2`,
      async get(raw) {
        const path = decodeURIComponent(raw);
        if (path.startsWith(`/akoya_requests(${REQUEST_ID})`)) return ok({ ...state, wmkf_testcreationrunid: currentRunId });
        if (path.startsWith(`/wmkf_grantprograms(${PROGRAM_ID})`)) return ok({ wmkf_name: 'Research' });
        if (path.includes(`LogicalName='${PHASE2}'`)) return ok({ GlobalOptionSet: { Options: [{ Value: 100000002, Label: { UserLocalizedLabel: { Label: 'Phase II Pending Committee Review' } } }] } });
        if (path.startsWith('/asyncoperations')) {
          return ok({ value: [{ asyncoperationid: '33333333-3333-4333-8333-333333333333', statecode: jobsDone ? 3 : 1, statuscode: jobsDone ? 30 : 10, createdon: '2026-09-28T22:00:05Z' }] });
        }
        if (/^\/(emails|akoya_goapplystatustrackings|akoya_requestpayments)/.test(path)) return ok({ value: [] });
        throw new Error(`unexpected path ${path}`);
      },
      async patchWithOptions(path, body, headers) {
        patches.push({ path, body, headers });
        Object.assign(state, body, { '@odata.etag': 'W/"101"' });
        return { ok: true, status: 204 };
      },
    };
    let currentRunId;
    let t = Date.now();
    const { h, runId } = readyProduction({
      deps: {
        runStatusChange: (args) => { currentRunId = args.runId; return realRunStatusChange({ ...args, client, ledger: memoryLedger }); },
        statusCompletion: { now: () => (t += 1000), sleep: async () => {}, pollMs: 1000, minQuietMs: 0 },
      },
    });
    const deadlineAt = () => h.clock.t + 280_000;
    const first = await change(h, runId, { deadlineAt: deadlineAt(), optionLabel: 'Phase II Pending Committee Review' });
    expect(first).toMatchObject({ outcome: 'jobs_open', code: 'status_change_jobs_open' });
    expect(patches).toHaveLength(1);
    jobsDone = true;
    h.clock.t = t; // the first wait used up its budget; the second POST arrives later with a fresh one
    const second = await change(h, runId, { deadlineAt: deadlineAt(), optionLabel: 'Phase II Pending Committee Review' });
    expect(second).toMatchObject({ outcome: 'complete', sequence: 1 });
    expect(patches).toHaveLength(1);
    expect(rows[0].status).toBe('complete');
  });
});

// ---- slice 3 Part 0: contract fixes the form relies on -----------------------

describe('slice 3 server contract', () => {
  const exporterFor = (rows, extra = {}) => {
    const ledger = fakeLedger();
    const blobs = fakeBlob();
    const service = createAdminRunService({
      env: { TEST_REQUEST_FACTORY_FORM: 'on', FACTORY_BLOB_RW_TOKEN: 't', TEST_REQUEST_SANDBOX_LEDGER_URL: SANDBOX_LEDGER },
      deployment: 'preview',
      ledgerDbFactory: () => ledger.db,
      blob: blobs.blob,
      createClient: () => ({ baseUrl: 'x', async get() { return { ok: true, status: 200, body: { value: rows, ...extra } }; } }),
      getAccessToken: async () => 'fake-token',
    });
    return service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
  };

  test('0.1 a source number with no row is 404 factory_source_not_found, never the generic 500', async () => {
    const error = await exporterFor([]).catch((e) => e);
    expect(error.httpStatus).toBe(404);
    expect(error.code).toBe('factory_source_not_found');
    expect(error.message).toBe('No Request has that number.');
  });

  test('0.1 two rows, or a next link, is 409 factory_source_ambiguous', async () => {
    const row = { akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', wmkf_abstract: null };
    const two = await exporterFor([row, { ...row, akoya_requestid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]).catch((e) => e);
    expect([two.httpStatus, two.code]).toEqual([409, 'factory_source_ambiguous']);
    const linked = await exporterFor([row], { '@odata.nextLink': 'https://x/next' }).catch((e) => e);
    expect([linked.httpStatus, linked.code]).toEqual([409, 'factory_source_ambiguous']);
  });

  test('0.2 a source with no usable cycle and no admin-supplied cycle is 400 factory_invalid_input with the form copy', async () => {
    const noCycle = (exportedAt) => buildSourceBundle({
      sourceRow: {
        akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
        akoya_request: 5000, akoya_fiscalyear: null, wmkf_meetingdate: null, wmkf_abstract: null, versionnumber: 1,
      },
      documents: [],
      dataverseHost: PRODUCTION_HOSTS[0],
      exportedAt: new Date(exportedAt),
      applicantAbstract: null,
    });
    const h = harness({ deployment: 'preview', deps: { exportBundle: async ({ exportedAt }) => noCycle(exportedAt) } });
    const exported = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(exported.defaults).toEqual({ fiscalYear: null, meetingDate: null });
    const error = await h.service.confirmRun(h.confirmArgs(exported.draftId)).catch((e) => e);
    expect([error.httpStatus, error.code]).toEqual([400, 'factory_invalid_input']);
    expect(error.message).toBe('A valid fiscal year and meeting date are required for this source.');
    expect(h.ledger.rows.size).toBe(0);
    const ok = await h.service.confirmRun(h.confirmArgs(exported.draftId, { fiscalYear: 'December 2026', meetingDate: '2026-12-01' }));
    expect(ok.created).toBe(true);
  });

  test('0.3 listRuns reports formEnabled and target, and still answers with the switch off', async () => {
    const on = harness({ deployment: 'production' });
    expect(await on.service.listRuns({ profileId: PROFILE })).toEqual({ runs: [], formEnabled: true, target: 'production' });
    const off = harness({ deployment: 'preview', env: { TEST_REQUEST_FACTORY_FORM: 'off' } });
    expect(await off.service.listRuns({ profileId: PROFILE })).toEqual({ runs: [], formEnabled: false, target: 'sandbox' });
  });

  test('0.4 every advance return carries currentStep and stepIndex from the run after the step', async () => {
    const h = harness({ deployment: 'preview' });
    await h.confirm();
    const { runId } = ids(h.actorId);
    h.spies.advanceRun.mockResolvedValueOnce({
      step: 'create_request', outcome: 'advanced', run: { status: 'creating', currentStep: 'correct_meeting_date', stepIndex: 2, destinationRequestNumber: null },
    });
    expect(await h.service.advance({ profileId: PROFILE, runId })).toMatchObject({ outcome: 'advanced', currentStep: 'correct_meeting_date', stepIndex: 2 });
    h.seedRun(runId, { status: 'retired', current_step: 'verify', step_index: 6 });
    expect(await h.service.advance({ profileId: PROFILE, runId })).toMatchObject({ outcome: 'not_advanced', currentStep: 'verify', stepIndex: 6 });
  });

  test('0.5 inspectRun returns foundationCapturedAt from the fence_source Foundation baseline, else null', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'creating' });
    expect((await h.service.inspectRun({ profileId: PROFILE, runId })).foundationCapturedAt).toBeNull();
    const resource = (step, kind, planned) => ({ run_id: runId, sequence: 1, step, resource_kind: kind, planned_identity: planned });
    h.ledger.state.resources.push(
      resource('verify', 'foundation_transition', { capturedAt: '2026-01-01T00:00:00.000Z' }),
      resource('fence_source', 'foundation_transition', { capturedAt: '2026-10-01T12:00:00.000Z' }),
    );
    const result = await h.service.inspectRun({ profileId: PROFILE, runId });
    expect(result.foundationCapturedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(result.resources).toHaveLength(2);
  });

  test('inspectRun reports a stale copy_file run as blocked/new-run using ledger evidence only', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, {
      status: 'needs_attention', current_step: 'copy_file', step_index: 4,
      needs_attention_reason: 'file_journal_unverified',
      bundle_exported_at: new Date(h.clock.t - 7 * HOUR).toISOString(),
    });
    h.ledger.state.resources.push({
      run_id: runId, sequence: 1, step: 'copy_file', resource_kind: 'sharepoint_file',
      outcome: 'failed', readback: { itemId: 'journaled-item' },
    });

    const result = await h.service.inspectRun({ profileId: PROFILE, runId });
    expect(result.diagnosis).toMatchObject({
      evidenceSource: 'run_ledger', currentStep: 'copy_file', bundleFreshness: 'expired',
      nextAction: 'new_run', unresolvedResourceCount: 1,
    });
    expect(result.diagnosis.message).toMatch(/do not retry/i);
    expect(result.diagnosis.message).toMatch(/does not repair or remove any partial Request/i);
    expect(JSON.stringify(result.diagnosis)).not.toContain('journaled-item');
    expect(h.blobs.calls.get).toHaveLength(0);
    expect(h.createClientCalls).toHaveLength(0);
    expect(h.spies.advanceRun).not.toHaveBeenCalled();
  });

  test('inspectRun waits for a live lease before interpreting stale bundle state', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, {
      status: 'creating', current_step: 'copy_file', step_index: 4,
      locked_until: new Date(h.clock.t + HOUR).toISOString(),
      bundle_exported_at: new Date(h.clock.t - 7 * HOUR).toISOString(),
    });
    const result = await h.service.inspectRun({ profileId: PROFILE, runId });
    expect(result.diagnosis).toMatchObject({ nextAction: 'wait', lease: 'active', bundleFreshness: 'unknown' });
    expect(h.blobs.calls.get).toHaveLength(0);
  });

  test('inspectRun offers readback evaluation for the exact journaled item only while the source window is fresh', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, {
      status: 'needs_attention', current_step: 'copy_file', step_index: 4,
      needs_attention_reason: 'file_journal_unverified',
      bundle_exported_at: new Date(h.clock.t - HOUR).toISOString(),
    });
    h.ledger.state.resources.push({
      run_id: runId, sequence: 1, step: 'copy_file', resource_kind: 'sharepoint_file',
      outcome: 'failed', readback: { itemId: 'journaled-item' },
    });
    const result = await h.service.inspectRun({ profileId: PROFILE, runId });
    expect(result.diagnosis).toMatchObject({ nextAction: 'readback_review', bundleFreshness: 'within_six_hour_window' });
    expect(result.diagnosis.message).toMatch(/Do not retry the upload/);
    expect(h.blobs.calls.get).toHaveLength(0);
    expect(h.createClientCalls).toHaveLength(0);
  });

  test('diagnosis recommends retry only for a fresh, unlocked Basic run with no dispatch marker', async () => {
    const h = harness({ deployment: 'production' });
    const { runId } = ids(h.actorId);
    h.seedRun(runId, { status: 'creating', current_step: 'create_request', step_index: 1 });
    h.ledger.state.resources.push({
      run_id: runId, sequence: 1, step: 'create_request', resource_kind: 'dataverse_request',
      outcome: 'planned', dispatched_at: null, readback: {},
    });
    const result = await h.service.inspectRun({ profileId: PROFILE, runId });
    expect(result.diagnosis.nextAction).toBe('retry');
    expect(result.diagnosis.message).toMatch(/independently check the saved artifacts/);
    expect(h.blobs.calls.get).toHaveLength(0);
    expect(h.createClientCalls).toHaveLength(0);
  });
});

describe('diagnoseFactoryRun fail-closed inputs', () => {
  const run = (extra = {}) => ({
    status: 'prepared', currentStep: 'fence_source', stepIndex: 0, recipe: 'basic',
    lockedUntil: null, bundleExportedAt: '2026-10-03T12:00:00.000Z', ...extra,
  });

  test('missing resource collection and non-finite clock never recommend retry', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    expect(diagnoseFactoryRun(run(), null, at).nextAction).toBe('operator_review');
    expect(diagnoseFactoryRun(run(), [], NaN).nextAction).toBe('operator_review');
  });

  test('unsupported recipes are not assessed and unknown recipes fail closed', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    expect(diagnoseFactoryRun(run({ recipe: 'reviews' }), [], at).nextAction).toBe('not_assessed');
    expect(diagnoseFactoryRun(run({ recipe: 'future_unknown_recipe' }), [], at).nextAction).toBe('operator_review');
  });

  test.each([
    ['upload attempt timestamp', { readback: { uploadAttemptedAt: '2026-10-03T12:01:00.000Z' } }],
    ['recorded item identity', { readback: { itemId: 'existing-item' } }],
    ['response status', { responseStatus: 204 }],
  ])('planned receipt carrying %s blocks retry even when dispatchedAt is null', (_label, extra) => {
    const result = diagnoseFactoryRun(run({ status: 'creating', currentStep: 'create_request', stepIndex: 1 }), [{
      outcome: 'planned', step: 'create_request', resourceKind: 'dataverse_request', dispatchedAt: null, ...extra,
    }], Date.parse('2026-10-03T12:02:00.000Z'));
    expect(result.nextAction).toBe('operator_review');
  });

  test('a reserved two-hour-old bundle remains inside the six-hour source window', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({ bundleExportedAt: new Date(at - 2 * HOUR).toISOString() }), [], at);
    expect(result).toMatchObject({ nextAction: 'retry', bundleFreshness: 'within_six_hour_window' });
  });

  test.each(['timeout', 'network', 'upstream_http (http 429)', 'upstream_http (http 503)'])(
    'known transient %s may retry with no write receipt left unresolved', (reason) => {
      const at = Date.parse('2026-10-03T12:02:00.000Z');
      const result = diagnoseFactoryRun(run({ status: 'needs_attention', needsAttentionReason: reason }), [], at);
      expect(result.nextAction).toBe('retry');
    },
  );

  test('known transient failure may retry with an undispatched planned receipt', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({ status: 'needs_attention', needsAttentionReason: 'timeout' }), [{
      outcome: 'planned', step: 'fence_source', resourceKind: 'foundation_transition', dispatchedAt: null, responseStatus: null, readback: {},
    }], at);
    expect(result.nextAction).toBe('retry');
  });

  test.each([
    ['upstream_http (http 400)', []],
    ['timeout', [{ outcome: 'planned', step: 'fence_source', resourceKind: 'foundation_transition', dispatchedAt: null, readback: { createAttemptedAt: '2026-10-03T12:01:00.000Z' } }]],
  ])('unknown or write-adjacent transient %s remains blocked', (reason, resources) => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({ status: 'needs_attention', needsAttentionReason: reason }), resources, at);
    expect(result.nextAction).toBe('operator_review');
  });

  test('completed prior-step receipts, including an old dispatch marker, do not block the current step', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({ status: 'creating', currentStep: 'correct_meeting_date', stepIndex: 2 }), [{
      step: 'create_request', resourceKind: 'dataverse_request', outcome: 'recovered',
      readback: { createAttemptedAt: '2026-10-03T12:01:00.000Z' },
    }], at);
    expect(result).toMatchObject({ nextAction: 'retry', unresolvedResourceCount: 0 });
  });

  test.each([
    ['Request GUID readback', { status: 'needs_attention', currentStep: 'create_request', stepIndex: 1, needsAttentionReason: 'ambiguous_create_outcome' }, 'dataverse_request', { createAttemptedAt: '2026-10-03T12:01:00.000Z' }, /read the reserved Request GUID first/],
    ['expired-lease Request GUID readback', { status: 'creating', currentStep: 'create_request', stepIndex: 1 }, 'dataverse_request', { createAttemptedAt: '2026-10-03T12:01:00.000Z' }, /read the reserved Request GUID first/],
    ['document-location readback', { status: 'needs_attention', currentStep: 'provision_location', stepIndex: 3, needsAttentionReason: 'location_readback_mismatch' }, 'dataverse_document_location', { locationCreateAttemptedAt: '2026-10-03T12:01:00.000Z' }, /read the Request locations first/],
  ])('%s remains eligible for its existing readback-first runner retry', (_label, runChanges, resourceKind, readback, message) => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run(runChanges), [{
      step: runChanges.currentStep, resourceKind, outcome: 'planned', readback,
    }], at);
    expect(result.nextAction).toBe('retry');
    expect(result.message).toMatch(message);
  });

  test('Basic verification failure may re-enter its read-only checks before ready', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({
      status: 'needs_attention', currentStep: 'verify', stepIndex: 6, needsAttentionReason: 'verification_failed',
    }), [{ step: 'verify', resourceKind: 'foundation_baseline', outcome: 'failed', readback: {} }], at);
    expect(result.nextAction).toBe('retry');
    expect(result.message).toMatch(/repeat its read-only source, Request and file checks/);
  });

  test('a create dispatch marker does not override an unrelated stopped reason', () => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({
      status: 'needs_attention', currentStep: 'create_request', stepIndex: 1, needsAttentionReason: 'manifest_digest_mismatch',
    }), [{
      step: 'create_request', resourceKind: 'dataverse_request', outcome: 'planned',
      readback: { createAttemptedAt: '2026-10-03T12:01:00.000Z' },
    }], at);
    expect(result.nextAction).toBe('operator_review');
  });

  test.each([
    ['unknown step', { step: 'future_step', resourceKind: 'dataverse_request', outcome: 'planned' }],
    ['future step', { step: 'verify', resourceKind: 'foundation_baseline', outcome: 'planned' }],
    ['unknown current-step kind', { step: 'create_request', resourceKind: 'future_kind', outcome: 'planned' }],
  ])('blocks %s evidence', (_label, receipt) => {
    const at = Date.parse('2026-10-03T12:02:00.000Z');
    const result = diagnoseFactoryRun(run({ status: 'creating', currentStep: 'create_request', stepIndex: 1 }), [receipt], at);
    expect(result.nextAction).toBe('operator_review');
  });
});

describe('S1: source display read', () => {
  const display = (extra = {}) => harness({ deployment: 'preview', deps: extra });

  test('exportSource returns the display title and applicant beside the summary, never in the stored bundle', async () => {
    const h = display();
    const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(result.source).toEqual({ title: 'Source title', applicant: 'Live University' });
    const stored = [...h.blobs.objects.values()][0].text;
    expect(stored).not.toContain('Live University');
  });

  test('a failed display read returns nulls and the lookup still succeeds', async () => {
    const h = display({ readSourceDisplay: async () => { throw new Error('boom'); } });
    const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(result.source).toEqual({ title: null, applicant: null });
    expect(result.draftId).toBeTruthy();
  });

  test('the default read uses the production client with annotations and maps the formatted applicant', async () => {
    const gets = [];
    const h = display({
      readSourceDisplay: undefined,
      createClient: ({ resourceUrl }) => ({
        baseUrl: resourceUrl,
        async get(path, headers) {
          gets.push({ resourceUrl, path, headers });
          return { ok: true, status: 200, body: { akoya_title: 'A title', '_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue': 'Some University' } };
        },
      }),
    });
    const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
    expect(result.source).toEqual({ title: 'A title', applicant: 'Some University' });
    expect(gets).toHaveLength(1);
    expect(gets[0].resourceUrl).toBe(PRODUCTION_URL);
    expect(gets[0].path).toContain(`/akoya_requests(${SOURCE_ID})`);
    expect(gets[0].headers.Prefer).toContain('include-annotations');
  });

  test('the default read answers nulls when the client read is not ok or throws', async () => {
    for (const get of [async () => ({ ok: false, status: 500, body: {} }), async () => { throw new Error('x'); }]) {
      const h = display({ readSourceDisplay: undefined, createClient: ({ resourceUrl }) => ({ baseUrl: resourceUrl, get }) });
      const result = await h.service.exportSource({ profileId: PROFILE, sourceRequestNumber: '9000001' });
      expect(result.source).toEqual({ title: null, applicant: null });
    }
  });
});

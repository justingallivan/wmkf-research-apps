/** @jest-environment node */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliActorId, createRunLedger } from '../../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../../lib/services/test-requests/run-ledger-db.js';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import {
  FOUNDATION_NAME,
  GOVERIFY_WORKFLOW,
  buildCloneManifest,
  foundationBaselineDigest,
  runPreflight,
  sha256,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle, readSourceBundle } from '../../lib/services/test-requests/source-bundle.js';

/**
 * Live-Postgres proof that the slice 5b runner (run-runner.js) drives the
 * REAL run ledger (run-ledger.js + migration 054) through every step and
 * resume path: every step, resource kind, system, outcome, reason code and
 * receipt value the runner sends must pass the ledger's pre-SQL validation
 * and the database CHECKs. Dataverse and Graph are in-memory fakes; this
 * never touches Dataverse, Graph, Vercel, or the repo's POSTGRES_URL.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL).
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the runner proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

const MIGRATION_PATH = path.join(process.cwd(), 'lib/db/migrations/054_test_request_runs.sql');

/** Fail loudly when the throwaway ledger schema predates the migration file (constraints are created only with the tables). */
async function assertLedgerSchemaCurrent(db, migrationSql) {
  const expected = [...migrationSql.matchAll(/CONSTRAINT\s+(\w+)/g)].map((m) => m[1]);
  const { rows } = await db.query(
    `SELECT conname FROM pg_constraint WHERE conrelid IN ('test_request_runs'::regclass, 'test_request_run_resources'::regclass)`,
  );
  const present = new Set(rows.map((row) => row.conname));
  const missing = expected.filter((name) => !present.has(name));
  const fn = await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'test_request_receipt_ok'`);
  const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const expectedBody = normalize(migrationSql.slice(migrationSql.indexOf('$receipt$') + 9, migrationSql.indexOf('$receipt$;')));
  const liveBody = normalize(fn.rows[0]?.prosrc);
  if (liveBody !== expectedBody) missing.push('test_request_receipt_ok(jsonb) body differs from the migration');
  if (missing.length) {
    throw new Error(`Throwaway ledger schema is stale (${missing.join(', ')}); drop test_request_run_resources, test_request_runs and test_request_receipt_ok(jsonb), then rerun.`);
  }
}
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APP_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DV_SITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PARENT_LOCATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ACTIVATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SOURCE_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const SOURCE_FOLDER = '1003222_E43AE6EA698FF11180766045BD018A07';
const PURPOSE = 'CONFIDENTIAL SOURCE PURPOSE TEXT for the runner proof';
const SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/akoyago';
const GRAPH_SITE_ID = 'appriver3651007194.sharepoint.com,11111111-2222-4333-8444-555555555555,66666666-7777-4888-8999-000000000000';
const DRIVE_ID = 'b!GQ6TSC-650adweD3-KAAAAAAAAAAAA';
// Graph item IDs in the ledger's exact `01` + 32 base32 shape.
const graphItemId = (prefix, n) => `01${prefix}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n]}`.padEnd(34, 'A');
const GRANT = 100000000;
const TARGET = Object.freeze({
  registered: true, key: 'akoyago-shared', siteUrl: SITE_URL, hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago',
});

function ok(body, status = 200) { return { ok: true, status, body }; }
function notFound() { return { ok: false, status: 404, text: 'Not Found', body: null }; }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }

const ATTRIBUTE_TYPES = {
  akoya_requestid: 'Uniqueidentifier', akoya_applicantid: 'Lookup', akoya_title: 'String', akoya_purpose: 'Memo',
  akoya_request: 'Money', akoya_fiscalyear: 'String', akoya_requesttype: 'Picklist', wmkf_meetingdate: 'DateOnly',
  wmkf_istestrequest: 'Boolean', wmkf_testcreationrunid: 'String', wmkf_respondreminderenabled: 'Boolean',
  wmkf_reviewduereminderenabled: 'Boolean',
};

const SOURCE_DOCS = [
  { kind: 'reviewerProposal', folder: `${SOURCE_FOLDER}/Reviewer Materials`, name: 'Proposal_1003222.pdf', bytes: Buffer.from('%PDF reviewer proposal bytes') },
  { kind: 'proposalNarrative', folder: `${SOURCE_FOLDER}/AI Materials`, name: 'ProposalNarrative_1003222.pdf', bytes: Buffer.from('%PDF proposal narrative bytes!') },
];

/** In-memory sandbox Dataverse + Graph with an event log shared with the ledger wrapper. */
function makeWorld(log) {
  const state = {
    requests: new Map(),
    locations: [],
    workflow: { statecode: 1, statuscode: 2, versionnumber: 500 },
    nextRequestNumber: 1000400,
    // Dataverse processing on create resets the meeting date (the live defect
    // the correction step exists for).
    createMeetingDateOverride: '2026-06-04',
    items: new Map(),
    nextItem: 1,
    counts: { requestPost: 0, locationPost: 0, requestPatch: 0, workflowPatch: 0, upload: 0, ensureFolder: 0 },
    hooks: {},
  };
  const event = (name) => log.push(name);
  SOURCE_DOCS.forEach((doc, index) => {
    const id = graphItemId('SRC', index);
    state.items.set(id, {
      id, name: doc.name, size: doc.bytes.length, mimeType: 'application/pdf', eTag: `"{0000000${index}-AAAA-4BBB-8CCC-DDDDDDDDDDDD},3"`,
      versionId: '3.0', folder: doc.folder, buffer: doc.bytes,
    });
  });
  const workflowRow = () => ({
    '@odata.etag': `W/"${state.workflow.versionnumber}"`,
    workflowid: GOVERIFY_WORKFLOW.definitionId, workflowidunique: GOVERIFY_WORKFLOW.definitionId, name: GOVERIFY_WORKFLOW.name,
    category: 0, type: 1, mode: 1, primaryentity: GOVERIFY_WORKFLOW.primaryEntity, statecode: state.workflow.statecode,
    statuscode: state.workflow.statuscode, componentstate: 0, triggeroncreate: true, versionnumber: state.workflow.versionnumber,
  });
  const requestRow = (row) => ({ ...row, '@odata.etag': `W/"${row.versionnumber}"` });

  async function get(requestPath) {
    const decoded = decodeURIComponent(requestPath);
    if (decoded.startsWith("/EntityDefinitions(LogicalName='akoya_request')")) {
      if (decoded.includes('ManyToOneRelationships')) return ok({ value: [{ ReferencedEntity: 'account' }] });
      if (decoded.includes('PicklistAttributeMetadata')) return ok({ OptionSet: { Options: [{ Value: GRANT, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } });
      if (decoded.includes('MoneyAttributeMetadata')) return ok({ MinValue: 0, MaxValue: 1e12 });
      if (decoded.includes('StringAttributeMetadata') || decoded.includes('MemoAttributeMetadata')) return ok({ MaxLength: 100000 });
      return ok({ value: Object.entries(ATTRIBUTE_TYPES).map(([LogicalName, AttributeType]) => ({ LogicalName, AttributeType, IsValidForCreate: true, RequiredLevel: { Value: 'None' } })) });
    }
    if (decoded.startsWith('/accounts')) return ok({ value: [{ accountid: ORG_ID, name: FOUNDATION_NAME, statecode: 0, versionnumber: 1, modifiedon: '2026-01-01T00:00:00Z' }] });
    if (decoded.startsWith('/sharepointsites')) return ok({ value: [{ sharepointsiteid: DV_SITE_ID, name: 'akoyaGO', absoluteurl: SITE_URL, relativeurl: null }] });
    if (decoded.startsWith(`/sharepointdocumentlocations(${PARENT_LOCATION_ID})`)) {
      return ok({ sharepointdocumentlocationid: PARENT_LOCATION_ID, name: 'Request', relativeurl: 'akoya_request', _parentsiteorlocation_value: DV_SITE_ID });
    }
    if (decoded.startsWith('/sharepointdocumentlocations?') && decoded.includes("relativeurl eq 'akoya_request'")) {
      return ok({ value: [{ sharepointdocumentlocationid: PARENT_LOCATION_ID, name: 'Request', relativeurl: 'akoya_request', _parentsiteorlocation_value: DV_SITE_ID }] });
    }
    if (decoded.startsWith('/sharepointdocumentlocations?') && decoded.includes('_regardingobjectid_value eq ')) {
      const id = decoded.match(/_regardingobjectid_value eq ([0-9a-f-]{36})/i)[1].toLowerCase();
      return ok({ value: state.locations.filter((row) => row.regarding === id).map(({ regarding, ...row }) => row) });
    }
    if (decoded.startsWith('/systemusers')) return ok({ value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] });
    if (decoded.startsWith('/contacts')) return ok({ value: [] });
    if (decoded.startsWith('/akoya_requestpayments') || decoded.startsWith('/emails')) return ok({ value: [] });
    const requestMatch = decoded.match(/^\/akoya_requests\(([0-9a-f-]{36})\)/i);
    if (requestMatch) {
      const row = state.requests.get(requestMatch[1].toLowerCase());
      return row ? ok(requestRow(row)) : notFound();
    }
    if (decoded.startsWith(`/workflows(${GOVERIFY_WORKFLOW.definitionId})`)) return ok(workflowRow());
    if (decoded.startsWith('/workflows?')) {
      const active = state.workflow.statecode === 1;
      return ok({ value: [{ workflowid: ACTIVATION_ID, name: GOVERIFY_WORKFLOW.name, type: 2, primaryentity: GOVERIFY_WORKFLOW.primaryEntity, statecode: active ? 1 : 0, statuscode: active ? 2 : 1, _parentworkflowid_value: GOVERIFY_WORKFLOW.definitionId }] });
    }
    throw new Error(`fake Dataverse: unexpected GET ${decoded}`);
  }

  async function patch(requestPath, body, headers) {
    const requestMatch = requestPath.match(/^\/akoya_requests\(([0-9a-f-]{36})\)$/i);
    if (requestMatch) {
      event('dispatch:request_patch');
      state.counts.requestPatch += 1;
      const row = state.requests.get(requestMatch[1].toLowerCase());
      if (headers?.['If-Match'] !== `W/"${row.versionnumber}"`) return { ok: false, status: 412, text: 'Precondition Failed' };
      Object.assign(row, body, { versionnumber: row.versionnumber + 1 });
      if (state.hooks.afterRequestPatch) state.hooks.afterRequestPatch();
      return ok(null, 204);
    }
    if (requestPath === `/workflows(${GOVERIFY_WORKFLOW.definitionId})`) {
      event(body.statecode === 0 ? 'dispatch:goverify_deactivate' : 'dispatch:goverify_restore');
      state.counts.workflowPatch += 1;
      if (body.statecode === 1 && state.hooks.failRestore) throw new Error('restore PATCH failed');
      Object.assign(state.workflow, body, { versionnumber: state.workflow.versionnumber + 1 });
      return ok(null, 204);
    }
    throw new Error(`fake Dataverse: unexpected PATCH ${requestPath}`);
  }

  async function postWithOptions(requestPath, body) {
    if (requestPath !== '/akoya_requests') throw new Error(`fake Dataverse: unexpected POST ${requestPath}`);
    event('dispatch:request_post');
    state.counts.requestPost += 1;
    if (state.hooks.requestPostRejects) return { ok: false, status: 500, text: 'plugin failure' };
    const id = body.akoya_requestid.toLowerCase();
    if (state.requests.has(id)) return { ok: false, status: 412, text: 'duplicate key' };
    const row = {
      akoya_requestid: id,
      akoya_requestnum: String(state.nextRequestNumber++),
      akoya_title: body.akoya_title, akoya_purpose: body.akoya_purpose ?? null, akoya_request: body.akoya_request ?? null,
      akoya_fiscalyear: body.akoya_fiscalyear, akoya_requesttype: body.akoya_requesttype,
      wmkf_meetingdate: state.createMeetingDateOverride ?? body.wmkf_meetingdate,
      wmkf_istestrequest: body.wmkf_istestrequest, wmkf_testcreationrunid: body.wmkf_testcreationrunid,
      wmkf_respondreminderenabled: body.wmkf_respondreminderenabled, wmkf_reviewduereminderenabled: body.wmkf_reviewduereminderenabled,
      akoya_requeststatus: null, wmkf_phaseiistatus: null, akoya_recommendedamount: null, akoya_originalgrantamount: null,
      akoya_submissionaccepted: false,
      _akoya_applicantid_value: body['akoya_applicantid@odata.bind'].match(/\(([^)]+)\)/)[1],
      _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, versionnumber: 7000,
    };
    state.requests.set(id, row);
    if (state.hooks.afterRequestPost) state.hooks.afterRequestPost();
    return ok(requestRow(row), 201);
  }

  async function post(requestPath, body) {
    if (requestPath !== '/sharepointdocumentlocations') throw new Error(`fake Dataverse: unexpected POST ${requestPath}`);
    event('dispatch:location_post');
    state.counts.locationPost += 1;
    const regarding = body['regardingobjectid_akoya_request@odata.bind'].match(/\(([^)]+)\)/)[1].toLowerCase();
    state.locations.push({
      regarding,
      sharepointdocumentlocationid: body.sharepointdocumentlocationid, name: body.name, relativeurl: body.relativeurl,
      absoluteurl: null, _parentsiteorlocation_value: PARENT_LOCATION_ID, _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
      createdon: new Date().toISOString(),
    });
    return ok({ sharepointdocumentlocationid: body.sharepointdocumentlocationid }, 201);
  }

  const client = {
    get,
    getWithOptions: (requestPath) => get(requestPath),
    patch,
    patchWithOptions: (requestPath, body, headers) => patch(requestPath, body, headers),
    post,
    postWithOptions,
  };

  const meta = ({ buffer, folder, ...rest }) => ({ ...rest });
  const graph = {
    clearGraphCaches: () => {},
    configuredSharePointTarget: () => TARGET,
    getSiteId: async () => GRAPH_SITE_ID,
    getDriveId: async () => DRIVE_ID,
    getFileMetadataById: async (driveId, itemId) => {
      if (state.hooks.destMetadataFails && !itemId.startsWith('01SRC')) throw new Error('Graph metadata read failed');
      const item = state.items.get(itemId);
      return item ? meta(item) : null;
    },
    downloadFile: async (driveId, itemId) => ({ buffer: state.items.get(itemId)?.buffer }),
    getFileMetadataByPath: async (library, folder, filename) => {
      const item = [...state.items.values()].find((row) => row.folder === folder && row.name === filename);
      return item ? meta(item) : null;
    },
    ensureFolderPath: async (library, folder) => {
      event('dispatch:ensure_folder');
      state.counts.ensureFolder += 1;
      return { id: graphItemId('FOLDER', folder.length % 26) };
    },
    uploadFile: async (library, folder, filename, content, mimeType, options) => {
      event('dispatch:upload');
      state.counts.upload += 1;
      if ([...state.items.values()].some((row) => row.folder === folder && row.name === filename)) throw httpError(409, 'nameAlreadyExists');
      const id = graphItemId('DEST', state.nextItem++);
      const item = {
        id, name: filename, size: content.length, mimeType, eTag: `"{1234567${state.nextItem}-AAAA-4BBB-8CCC-DDDDDDDDDDDD},1"`,
        versionId: '1.0', folder, buffer: Buffer.from(content),
      };
      state.items.set(id, item);
      await options.onItemCreated(meta(item));
      return meta(item);
    },
    listFiles: async (parentRelativeUrl, locationRelativeUrl) => [...state.items.values()]
      .filter((row) => row.folder.startsWith(locationRelativeUrl))
      .map((row) => ({ id: row.id, name: row.name, size: row.size, folder: row.folder })),
  };
  return { state, client, graph, sharePointTarget: () => TARGET };
}

function buildBundle() {
  return readSourceBundle(buildSourceBundle({
    sourceRow: {
      akoya_requestid: SOURCE_ID, akoya_requestnum: '1003222', akoya_requesttype: GRANT, akoya_purpose: PURPOSE,
      akoya_request: 250000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-03T00:00:00Z', versionnumber: 98622844,
    },
    documents: SOURCE_DOCS.map((doc, index) => ({
      id: `inv-${index}`, kind: doc.kind, library: 'akoya_request', folder: doc.folder, name: doc.name,
      driveId: DRIVE_ID, graphItemId: graphItemId('SRC', index),
      sharePointSite: { key: TARGET.key, hostname: TARGET.hostname, pathname: TARGET.pathname },
      size: doc.bytes.length, mimeType: 'application/pdf', eTag: `"{0000000${index}-AAAA-4BBB-8CCC-DDDDDDDDDDDD},3"`, versionId: '3.0',
      contentHash: crypto.createHash('sha256').update(doc.bytes).digest('hex'),
    })),
    dataverseHost: 'wmkf.crm.dynamics.com',
    exportedAt: new Date(Date.now() - 60_000),
  }));
}

/** Mirrors scripts/rehearse-test-request-sandbox.mjs runReserve's plan construction. */
function reservePlan(manifest, bundle) {
  return {
    runId: manifest.values.runId,
    recipe: manifest.recipe ?? 'basic',
    sourceDataverseHost: bundle.source.dataverseHost,
    sourceRequestId: manifest.source.requestId,
    sourceRequestNumber: manifest.source.requestNumber,
    sourceRevision: manifest.source.revision,
    bundleSha256: manifest.source.bundleSha256,
    bundleExportedAt: manifest.source.exportedAt,
    copyPolicyVersion: manifest.copyPolicy.version,
    copyPolicyDigest: manifest.copyPolicy.digest,
    // Mirrors runReserve: recipe is bound into the digest so a same-key
    // retry naming a different recipe conflicts (tested in the ledger pg suite).
    planDigest: sha256({ runId: manifest.values.runId, recipe: manifest.recipe ?? 'basic', createBodySha256: manifest.createBodySha256 }),
    createBodySha256: manifest.createBodySha256,
    destinationEnvironment: 'sandbox',
    destinationDataverseHost: new URL(manifest.target).hostname,
    destinationRequestId: manifest.values.requestId,
    destinationLocationId: manifest.values.locationId,
    expectedAppUserId: manifest.expectedAppUserId,
    expectedOrganizationId: manifest.expectedOrganization.accountid,
    expectedGraphSiteId: manifest.expectedGraphSiteId,
    expectedGraphDriveId: manifest.expectedGraphDriveId,
    fiscalYear: manifest.values.fiscalYear,
    meetingDate: manifest.values.meetingDate,
    testLabel: manifest.values.testLabel,
  };
}

describeIf('slice 5b runner against the live run ledger', () => {
  let db;
  let ledger;
  let log;
  const createdRunIds = [];
  const previousClientId = process.env.DYNAMICS_CLIENT_ID;

  beforeAll(async () => {
    process.env.DYNAMICS_CLIENT_ID = '12345678-1234-4234-8234-123456789012';
    db = pgLedgerDb(TEST_URL);
    const { rows } = await db.query(`SELECT to_regclass('public.test_request_runs') AS reg`);
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    if (!rows[0]?.reg) await db.query(migrationSql);
    await assertLedgerSchemaCurrent(db, migrationSql);
    const real = createRunLedger(db);
    // Record ledger writes into the same event log as the fake dispatches so
    // journal-before-dispatch ordering is asserted end to end.
    ledger = Object.fromEntries(Object.entries(real).map(([name, fn]) => [name, async (args, ...rest) => {
      const result = await fn(args, ...rest);
      if (name === 'journalPlannedResource') log.push(`journal:${args.resourceKind}`);
      if (name === 'recordResourceReadback' || name === 'recordResourceFailure') log.push(`${name}:${result?.resourceKind}:${args.outcome}`);
      return result;
    }]));
  });

  afterAll(async () => {
    if (createdRunIds.length) {
      await db.query('DELETE FROM test_request_run_resources WHERE run_id = ANY($1::uuid[])', [createdRunIds]);
      await db.query('DELETE FROM test_request_runs WHERE run_id = ANY($1::uuid[])', [createdRunIds]);
    }
    if (db?.end) await db.end();
    process.env.DYNAMICS_CLIENT_ID = previousClientId;
  });

  async function setup({ recipe = 'basic' } = {}) {
    log = [];
    const world = makeWorld(log);
    const preflight = await runPreflight(world.client, world.graph, world.sharePointTarget);
    const bundle = buildBundle();
    const source = bundle.source.request;
    const manifest = buildCloneManifest(preflight, {
      source, fiscalYear: source.akoya_fiscalyear, meetingDate: source.wmkf_meetingdate, testLabel: 'Runner proof', bundle, recipe,
    });
    const idempotencyKey = `runner-${crypto.randomBytes(4).toString('hex')}`;
    const { run } = await ledger.reserveRun({ actorId: cliActorId('runner-proof'), idempotencyKey, plan: reservePlan(manifest, bundle) });
    createdRunIds.push(run.runId);
    const advance = (options = {}) => advanceRun({
      runId: run.runId, ledger, manifest, bundle,
      deps: { client: world.client, graph: world.graph, sharePointTarget: world.sharePointTarget, observationOverrides: { observationMs: 0 } },
      options,
    });
    return { world, manifest, bundle, run, advance };
  }

  async function runUntil(advance, stopStep, options) {
    const results = [];
    for (let i = 0; i < 12; i += 1) {
      const result = await advance(options);
      results.push(result);
      if (result.outcome !== 'advanced' || result.run.currentStep === stopStep) break;
    }
    return results;
  }

  async function expireLease(runId) {
    await db.query("UPDATE test_request_runs SET locked_until = NOW() - interval '1 second' WHERE run_id = $1::uuid", [runId]);
  }

  it('drives every step to ready with GoVerify bypass, journaling each resource before its dispatch', async () => {
    const { world, run, advance } = await setup();
    const results = await runUntil(advance, null, { bypassGoverify: true });
    const summary = results.map((result) => `${result.step}:${result.outcome}`);
    expect(results.at(-1)).toMatchObject({ outcome: 'ready' });
    expect(summary).toEqual([
      'fence_source:advanced', 'create_request:advanced', 'correct_meeting_date:advanced', 'provision_location:advanced',
      'copy_file:advanced', 'copy_file:advanced', 'observe:advanced', 'verify:ready',
    ]);
    expect(world.state.counts).toMatchObject({ requestPost: 1, locationPost: 1, requestPatch: 1, workflowPatch: 2, upload: 2 });
    expect(world.state.workflow.statecode).toBe(1);

    const final = await ledger.getRun(run.runId);
    expect(final).toMatchObject({ status: 'ready', destinationRequestNumber: '1000400', leaseToken: null });
    const resources = await ledger.listRunResources(run.runId);
    expect(resources.map((row) => `${row.step}/${row.resourceKind}/${row.outcome}`)).toEqual([
      'create_request/dataverse_request/dispatched',
      'create_request/workflow_bypass/verified',
      'correct_meeting_date/dataverse_request_patch/verified',
      'provision_location/dataverse_document_location/verified',
      'copy_file/sharepoint_file/verified',
      'copy_file/sharepoint_file/verified',
    ]);
    expect(resources.filter((row) => row.step === 'copy_file').map((row) => row.readback.index)).toEqual([0, 1]);

    // Journal strictly before each dispatch.
    const first = (name) => log.indexOf(name);
    expect(first('journal:workflow_bypass')).toBeLessThan(first('dispatch:goverify_deactivate'));
    expect(first('journal:dataverse_request')).toBeLessThan(first('dispatch:request_post'));
    expect(first('journal:dataverse_request_patch')).toBeLessThan(first('dispatch:request_patch'));
    expect(first('journal:dataverse_document_location')).toBeLessThan(first('dispatch:ensure_folder'));
    expect(first('journal:dataverse_document_location')).toBeLessThan(first('dispatch:location_post'));
    expect(first('journal:sharepoint_file')).toBeLessThan(first('dispatch:upload'));

    // Nothing source-derived or message-shaped reached Postgres.
    const { rows } = await db.query(
      `SELECT (SELECT row_to_json(r)::text FROM test_request_runs r WHERE run_id = $1::uuid) AS run,
              (SELECT json_agg(x)::text FROM test_request_run_resources x WHERE run_id = $1::uuid) AS resources`,
      [run.runId],
    );
    const stored = `${rows[0].run}${rows[0].resources}`;
    expect(stored).not.toContain('CONFIDENTIAL');
    expect(stored).not.toContain('Runner proof');
    expect(stored).not.toMatch(/https?:\/\//);
  });

  it('slice 6a: an initial_assessment run advances past verify (recording the Foundation/Contact baseline digest) to seed_initial_assessment, then stops needs_attention there since 6a registers no IA step bodies', async () => {
    const { world, run, advance } = await setup({ recipe: 'initial_assessment' });
    const results = await runUntil(advance, null, { bypassGoverify: true });
    const summary = results.map((result) => `${result.step}:${result.outcome}`);
    expect(summary).toEqual([
      'fence_source:advanced', 'create_request:advanced', 'correct_meeting_date:advanced', 'provision_location:advanced',
      'copy_file:advanced', 'copy_file:advanced', 'observe:advanced', 'verify:advanced', 'seed_initial_assessment:needs_attention',
    ]);
    expect(results.at(-1)).toMatchObject({ outcome: 'needs_attention' });

    const final = await ledger.getRun(run.runId);
    expect(final).toMatchObject({
      recipe: 'initial_assessment', status: 'needs_attention', currentStep: 'seed_initial_assessment',
      needsAttentionReason: 'recipe_step_not_built', destinationRequestNumber: '1000400',
    });
    expect(world.state.counts.requestPost).toBe(1); // never markReady, never a second create

    const resources = await ledger.listRunResources(run.runId);
    const baseline = resources.find((row) => row.step === 'verify' && row.resourceKind === 'foundation_baseline');
    expect(baseline).toMatchObject({ outcome: 'verified' });
    expect(baseline.readback.foundationBaselineSha256).toMatch(/^[0-9a-f]{64}$/);

    // Nothing source-derived or message-shaped reached Postgres.
    const { rows } = await db.query(
      `SELECT (SELECT row_to_json(r)::text FROM test_request_runs r WHERE run_id = $1::uuid) AS run,
              (SELECT json_agg(x)::text FROM test_request_run_resources x WHERE run_id = $1::uuid) AS resources`,
      [run.runId],
    );
    const stored = `${rows[0].run}${rows[0].resources}`;
    expect(stored).not.toContain('CONFIDENTIAL');
    expect(stored).not.toContain('Runner proof');
    expect(stored).not.toMatch(/https?:\/\//);
  });

  // A verify attempt that recorded the baseline but lost its lease before
  // advancing: the retry must compare against that baseline, never record a
  // second one (which would accept a between-attempts change).
  async function recordPriorBaseline(run, digest) {
    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    const row = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'verify', resourceKind: 'foundation_baseline', system: 'dataverse', plannedIdentity: {},
    });
    await ledger.recordResourceReadback({
      resourceId: row.resourceId, runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      responseStatus: null, readback: { foundationBaselineSha256: digest }, outcome: 'verified',
    });
    await expireLease(run.runId);
  }

  it('slice 6a: a repeated initial_assessment verify reuses a matching recorded baseline instead of recording a second one', async () => {
    const { run, advance } = await setup({ recipe: 'initial_assessment' });
    await runUntil(advance, 'verify', { bypassGoverify: true });
    expect((await ledger.getRun(run.runId)).currentStep).toBe('verify');
    await recordPriorBaseline(run, foundationBaselineDigest({ accountid: ORG_ID, versionnumber: 1 }, []));

    expect(await advance()).toMatchObject({ step: 'verify', outcome: 'advanced' });
    const baselines = (await ledger.listRunResources(run.runId)).filter((row) => row.resourceKind === 'foundation_baseline');
    expect(baselines).toHaveLength(1);
  });

  it('slice 6a: a repeated initial_assessment verify stops when Foundation/Contact rows changed since the recorded baseline', async () => {
    const { run, advance } = await setup({ recipe: 'initial_assessment' });
    await runUntil(advance, 'verify', { bypassGoverify: true });
    // The world serves the Foundation account at versionnumber 1; a baseline
    // recorded at versionnumber 0 means it changed between the two attempts.
    await recordPriorBaseline(run, foundationBaselineDigest({ accountid: ORG_ID, versionnumber: 0 }, []));

    expect(await advance()).toMatchObject({ step: 'verify', outcome: 'needs_attention' });
    expect(await ledger.getRun(run.runId)).toMatchObject({
      status: 'needs_attention', currentStep: 'verify', needsAttentionReason: 'ia_verification_failed',
    });
    const baselines = (await ledger.listRunResources(run.runId)).filter((row) => row.resourceKind === 'foundation_baseline');
    expect(baselines).toHaveLength(1);
  });

  it('resumes a create whose response was lost: exact GUID recovered, never a second POST', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'create_request');
    world.state.hooks.afterRequestPost = () => { throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' }); };
    const lost = await advance();
    expect(lost).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
    world.state.hooks.afterRequestPost = null;
    const recovered = await advance();
    expect(recovered).toMatchObject({ step: 'create_request', outcome: 'advanced' });
    expect(recovered.run.destinationRequestNumber).toBe('1000400');
    expect(world.state.counts.requestPost).toBe(1);
    const resources = await ledger.listRunResources(run.runId);
    expect(resources.at(-1)).toMatchObject({ resourceKind: 'dataverse_request', outcome: 'recovered' });
    const rest = await runUntil(advance, null);
    expect(rest.at(-1).outcome).toBe('ready');
  });

  it('a preallocated GUID present but not owned is refused at fence_source and at create_request, never POSTed', async () => {
    const { world, manifest, run, advance } = await setup();
    world.state.requests.set(manifest.values.requestId, {
      akoya_requestid: manifest.values.requestId, wmkf_testcreationrunid: crypto.randomUUID(),
      _createdby_value: crypto.randomUUID(), _ownerid_value: crypto.randomUUID(), versionnumber: 1,
    });
    const fenced = await advance();
    expect(fenced.outcome).toBe('needs_attention');
    expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('preallocated_request_present');

    // Force the run past the fence to prove the create step's own refusal.
    await db.query("UPDATE test_request_runs SET current_step = 'create_request', step_index = 1 WHERE run_id = $1::uuid", [run.runId]);
    const refused = await advance();
    expect(refused.outcome).toBe('needs_attention');
    expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('preallocated_request_present_not_owned');
    expect(world.state.counts.requestPost).toBe(0);
  });

  it('an unverified GoVerify restore blocks the run even when the Request exists and is owned', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'create_request');
    world.state.hooks.failRestore = true;
    const failed = await advance({ bypassGoverify: true });
    expect(failed).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
    expect(world.state.counts.requestPost).toBe(1);
    const bypass = (await ledger.listRunResources(run.runId)).find((row) => row.resourceKind === 'workflow_bypass');
    expect(bypass.outcome).toBe('ambiguous');

    world.state.hooks.failRestore = false;
    const resumed = await advance({ bypassGoverify: true });
    expect(resumed).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
    expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('goverify_restore_unverified');
    expect(world.state.counts.requestPost).toBe(1);
    expect(world.state.counts.workflowPatch).toBe(2); // deactivate + one failed restore; never auto-resolved
  });

  it('process death between journal and dispatch, and between dispatch and readback, for each resource kind', async () => {
    const { world, manifest, run, advance } = await setup();
    await runUntil(advance, 'create_request');

    // create_request: died after journaling, before the POST.
    let claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse', plannedIdentity: { requestId: run.destinationRequestId },
    });
    await expireLease(run.runId);
    expect((await advance()).outcome).toBe('advanced'); // GUID absent -> the single POST
    expect(world.state.counts.requestPost).toBe(1);

    // correct_meeting_date: died after the PATCH committed, before readback.
    claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'correct_meeting_date', resourceKind: 'dataverse_request_patch', system: 'dataverse', plannedIdentity: { requestId: run.destinationRequestId },
    });
    const row = world.state.requests.get(manifest.values.requestId);
    Object.assign(row, { wmkf_meetingdate: manifest.values.meetingDate, versionnumber: row.versionnumber + 1 });
    await expireLease(run.runId);
    expect((await advance()).outcome).toBe('advanced');
    expect(world.state.counts.requestPatch).toBe(0); // state comparison, no second PATCH

    // provision_location: died after the location POST committed, before readback.
    claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'provision_location', resourceKind: 'dataverse_document_location', system: 'dataverse', plannedIdentity: { locationId: run.destinationLocationId },
    });
    await world.client.post('/sharepointdocumentlocations', {
      sharepointdocumentlocationid: manifest.values.locationId, name: 'Documents on Default Site 1',
      relativeurl: `${row.akoya_requestnum}_${manifest.values.requestId.replace(/-/g, '').toUpperCase()}`,
      'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${manifest.values.requestId})`,
    });
    await expireLease(run.runId);
    expect((await advance()).outcome).toBe('advanced');
    expect(world.state.counts.locationPost).toBe(1);
    expect((await ledger.listRunResources(run.runId)).at(-1)).toMatchObject({ resourceKind: 'dataverse_document_location', outcome: 'recovered' });

    // copy_file: died after the upload created the item and its ID was journaled, before verification.
    world.state.hooks.destMetadataFails = true;
    const died = await advance();
    expect(died).toMatchObject({ step: 'copy_file', outcome: 'needs_attention' });
    world.state.hooks.destMetadataFails = false;
    const refused = await advance();
    expect(refused).toMatchObject({ step: 'copy_file', outcome: 'needs_attention' });
    expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('file_journal_unverified');
    expect(world.state.counts.upload).toBe(1);
  });

  it('GoVerify bypass death: before the deactivation PATCH proceeds; after it, the run stops for manual recheck', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'create_request');
    const journalBypass = async (readback, outcome) => {
      const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
      const row = await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
        step: 'create_request', resourceKind: 'workflow_bypass', system: 'dataverse', plannedIdentity: { workflowId: GOVERIFY_WORKFLOW.definitionId },
      });
      if (readback) {
        await ledger.recordResourceReadback({
          resourceId: row.resourceId, runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
          readback, outcome,
        });
      }
      await expireLease(run.runId);
    };
    // Died after journaling intent, before the deactivation PATCH was attempted.
    await journalBypass({ workflowId: GOVERIFY_WORKFLOW.definitionId, deactivationAttemptedAt: new Date().toISOString() }, 'planned');
    // Died after the PATCH was attempted but before deactivation was verified.
    await journalBypass({
      workflowId: GOVERIFY_WORKFLOW.definitionId, deactivationAttemptedAt: new Date().toISOString(),
      deactivationPatchAttemptedAt: new Date().toISOString(),
    }, 'dispatched');
    const stopped = await advance({ bypassGoverify: true });
    expect(stopped.outcome).toBe('needs_attention');
    expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('goverify_restore_unverified');
    expect(world.state.counts).toMatchObject({ requestPost: 0, workflowPatch: 0 });
  });

  it('GoVerify bypass journaled but never dispatched does not block the create', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'create_request');
    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'create_request', resourceKind: 'workflow_bypass', system: 'dataverse', plannedIdentity: { workflowId: GOVERIFY_WORKFLOW.definitionId },
    });
    await expireLease(run.runId);
    expect((await advance({ bypassGoverify: true })).outcome).toBe('advanced');
    expect(world.state.counts).toMatchObject({ requestPost: 1, workflowPatch: 2 });
  });

  it('copy_file death after journaling, before the upload: the planned row is reused and exactly one item is created', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'copy_file');
    const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
    await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint', plannedIdentity: { index: 0 },
    });
    await expireLease(run.runId);
    const rest = await runUntil(advance, null);
    expect(rest.at(-1).outcome).toBe('ready');
    expect(world.state.counts.upload).toBe(2);
    const files = (await ledger.listRunResources(run.runId)).filter((row) => row.resourceKind === 'sharepoint_file');
    expect(files.map((row) => row.outcome)).toEqual(['verified', 'verified']);
  });

  it('dispatch-marker rule: an attempted POST, location POST or upload with nothing readable stops the run with zero dispatches', async () => {
    const attempt = async (run, spec, readback, outcome) => {
      const claimed = await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
      const resource = await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration, ...spec,
      });
      await ledger.recordResourceReadback({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
        responseStatus: null, readback, outcome,
      });
      await expireLease(run.runId);
    };

    // create_request: the earlier worker journaled createAttemptedAt and its POST never became readable.
    {
      const { world, run, advance } = await setup();
      await runUntil(advance, 'create_request');
      await attempt(run, {
        step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse', plannedIdentity: { requestId: run.destinationRequestId },
      }, { createAttemptedAt: new Date().toISOString() }, 'planned');
      const result = await advance({ bypassGoverify: true });
      expect(result).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
      const stopped = await ledger.getRun(run.runId);
      expect(stopped.needsAttentionReason).toBe('ambiguous_create_outcome');
      expect(stopped.lastError).toBe('ambiguous_create_outcome'); // recorded in the same fenced UPDATE
      expect(world.state.counts.requestPost).toBe(0);
      expect(world.state.counts.workflowPatch ?? 0).toBe(0);
    }

    // create_request: the POST itself returned a definitive error in an earlier
    // invocation (marker + response recorded, GUID still absent). Resume must not POST.
    {
      const { world, run, advance } = await setup();
      await runUntil(advance, 'create_request');
      world.state.hooks.requestPostRejects = true;
      const failed = await advance({ bypassGoverify: true });
      expect(failed).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
      world.state.hooks.requestPostRejects = false;
      expect(world.state.counts.requestPost).toBe(1);
      const rows = await ledger.listRunResources(run.runId);
      const createRow = rows.find((row) => row.resourceKind === 'dataverse_request');
      expect(createRow.readback.createAttemptedAt).toBeTruthy(); // survived the response write
      await ledger.claimLease({ runId: run.runId, expectedVersion: (await ledger.getRun(run.runId)).version });
      await expireLease(run.runId);
      const resumed = await advance({ bypassGoverify: true });
      expect(resumed).toMatchObject({ step: 'create_request', outcome: 'needs_attention' });
      expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('ambiguous_create_outcome');
      expect(world.state.counts.requestPost).toBe(1);
    }

    // provision_location: locationCreateAttemptedAt journaled, no location readable.
    {
      const { world, run, advance } = await setup();
      await runUntil(advance, 'provision_location');
      await attempt(run, {
        step: 'provision_location', resourceKind: 'dataverse_document_location', system: 'dataverse', plannedIdentity: { locationId: run.destinationLocationId },
      }, { locationCreateAttemptedAt: new Date().toISOString() }, 'dispatched');
      const result = await advance();
      expect(result).toMatchObject({ step: 'provision_location', outcome: 'needs_attention' });
      expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('location_readback_mismatch');
      expect(world.state.counts.locationPost).toBe(0);
    }

    // copy_file: uploadAttemptedAt journaled without an item id.
    {
      const { world, run, advance } = await setup();
      await runUntil(advance, 'copy_file');
      await attempt(run, {
        step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint', plannedIdentity: { index: 0 },
      }, { index: 0, uploadAttemptedAt: new Date().toISOString() }, 'dispatched');
      const result = await advance();
      expect(result).toMatchObject({ step: 'copy_file', outcome: 'needs_attention' });
      expect((await ledger.getRun(run.runId)).needsAttentionReason).toBe('file_ambiguous_unrecovered');
      expect(world.state.counts.upload).toBe(0);
    }
  });

  it('a meeting-date readback that does not match is never journaled as verified', async () => {
    const { world, run, advance } = await setup();
    await runUntil(advance, 'correct_meeting_date');
    world.state.hooks.afterRequestPatch = () => {
      const row = [...world.state.requests.values()][0];
      row.wmkf_meetingdate = '2026-01-01';
    };
    const result = await advance();
    expect(result.outcome).toBe('needs_attention');
    const patchRow = (await ledger.listRunResources(run.runId)).find((row) => row.resourceKind === 'dataverse_request_patch');
    expect(patchRow.outcome).not.toBe('verified');
  });
});

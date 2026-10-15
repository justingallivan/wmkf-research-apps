/** @jest-environment node */
/**
 * Opt-in service integration rehearsal against the registered Dataverse
 * Sandbox, its dedicated Factory Request folder, and a fresh local Postgres
 * database. The feature test is skipped in ordinary Jest runs. Never use this
 * as a production or hosted-route test.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

const transport = { client: null };
const mockNotificationCalls = [];
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => transport.client.query(
    strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''),
    values,
  ),
}));
jest.mock('../../lib/services/notification-service.js', () => ({
  __esModule: true,
  default: {
    notify: async (payload) => {
      mockNotificationCalls.push(payload);
      return { id: 'captured-notification' };
    },
  },
}));

const ENABLED = process.env.WRITEUP_REGENERATION_SANDBOX_EXECUTE === 'on';
const runIfEnabled = ENABLED ? test : test.skip;
const REPO_ROOT = path.resolve(process.cwd());
const REPORT_PATH = process.env.WRITEUP_REGENERATION_SANDBOX_REPORT || '';
const BUDGET_PATH = process.env.WRITEUP_REGENERATION_PROVIDER_BUDGET || '';
const FIXTURE_PATH = process.env.WRITEUP_REGENERATION_SANDBOX_MANIFEST || '';
const LEDGER_URL = process.env.WRITEUP_REGENERATION_LEDGER_URL || '';
const MIGRATION = fs.readFileSync(
  path.join(REPO_ROOT, 'lib/db/migrations/072_final_writeup_handoff_emails.sql'),
  'utf8',
);
const NO_REPO_PATH = (candidate) => {
  const relative = path.relative(REPO_ROOT, path.resolve(candidate));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};
const validGuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const opaqueIdentity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;

function privateJsonFile(file, label) {
  if (!path.isAbsolute(file) || !NO_REPO_PATH(file)) throw new Error(`${label} must be outside the repository.`);
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a regular mode-0600 file.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateFixture(fixture, sandboxHost) {
  if (fixture?.schemaVersion !== 1 || fixture?.target?.environment !== 'sandbox'
    || fixture.target.hostname !== sandboxHost) throw new Error('Fixture is not pinned to the configured registered Sandbox.');
  const request = fixture.request || {};
  const actors = fixture.actors || {};
  const sharePoint = fixture.sharePoint || {};
  const review = fixture.review || {};
  for (const [label, value] of Object.entries({
    request: request.id,
    program: request.programId,
    lead: request.leadProgramDirectorId,
    projectLeader: request.projectLeaderContactId,
    reviewingColleague: actors.reviewingColleagueId,
    leadActor: actors.leadProgramDirectorId,
    reviewerPerson: review.potentialReviewerId,
    reviewerSuggestion: review.suggestionId,
  })) {
    if (!validGuid(value)) throw new Error(`Fixture lacks a valid ${label} GUID.`);
  }
  if (!opaqueIdentity(sharePoint.siteId) || !opaqueIdentity(sharePoint.driveId)
    || !opaqueIdentity(sharePoint.library) || !opaqueIdentity(sharePoint.folderId)
    || !opaqueIdentity(sharePoint.writeupFolderId)) throw new Error('Fixture lacks verified SharePoint site, drive, library, or folder identities.');
  if (String(actors.leadProgramDirectorId).toLowerCase() !== String(request.leadProgramDirectorId).toLowerCase()
    || String(actors.leadProgramDirectorId).toLowerCase() === String(actors.reviewingColleagueId).toLowerCase()) {
    throw new Error('Fixture actor identities do not match the selected distinct staff accounts.');
  }
  if (request.status !== 'Phase II Pending' || review.accepted !== true || review.receivedAt != null || !review.etag) {
    throw new Error('Fixture Request or unreceived accepted reviewer is not in the reviewed starting state.');
  }
  if (!sharePoint.folderPath || sharePoint.folderPath.startsWith('/') || sharePoint.folderPath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Fixture does not contain a safe library-relative request folder path.');
  }
  const narrative = sharePoint.narrative || {};
  if (!opaqueIdentity(narrative.itemId) || !/^[a-f0-9]{64}$/i.test(narrative.sha256 || '') || Number(narrative.extractedChars) < 60) {
    throw new Error('Fixture narrative file was not verified from the dedicated Request folder.');
  }
  if (!sharePoint.writeupFolderPath || !sharePoint.writeupFolderPath.startsWith(`${sharePoint.folderPath}/`)) {
    throw new Error('Fixture generated-writeup folder is not nested under the verified Request folder.');
  }
  if (fixture.siteVisit?.synthetic !== true || !validGuid(fixture.siteVisit.activityId)
    || !fixture.siteVisit.etag || Date.parse(fixture.siteVisit.endUtc) >= Date.now()) {
    throw new Error('Fixture does not contain a verified, ended synthetic Site Visit.');
  }
  if (fixture.appDatabase?.container !== 'wmkf-writeup-regen-pg'
    || fixture.appDatabase.image !== 'postgres:16'
    || fixture.appDatabase.host !== '127.0.0.1'
    || fixture.appDatabase.port !== 55439
    || fixture.appDatabase.database !== 'writeup_regeneration_rehearsal'
    || !/^[a-f0-9]{8,16}$/i.test(fixture.appDatabase.containerIdPrefix || '')) {
    throw new Error('Fixture lacks the reviewed isolated local Postgres container fingerprint.');
  }
  return fixture;
}

function syncPause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function claimBudgetSlot(file) {
  const lockPath = `${file}.lock`;
  const deadline = Date.now() + 30_000;
  let locked = false;
  while (!locked) {
    try { fs.mkdirSync(lockPath, { mode: 0o700 }); locked = true; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('Provider budget lock is unavailable; stopping before provider request.');
      syncPause(20);
    }
  }
  try {
    let state = { schemaVersion: 1, limit: 3, used: 0 };
    if (fs.existsSync(file)) {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.schemaVersion !== 1 || state.limit !== 3 || !Number.isInteger(state.used) || state.used < 0) {
        throw new Error('Provider budget file is malformed; stopping before provider request.');
      }
    }
    state.used += 1;
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(state)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
    if (state.used > state.limit) throw new Error('The persistent application model-call budget of three has been reached.');
    return state.used;
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function installNetworkFence({ sandboxHost, sharePoint, fixture, occupiedNames }) {
  const originalFetch = globalThis.fetch;
  let permitBaselineEdit = false;
  let baselineEditUsed = false;
  const state = { providerRequests: 0, graphUploads: [], allowedRequestDocumentIds: new Set(), allowedFinalArtifactIds: new Set() };
  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('Network fence refused an invalid outbound URL.'); }
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (url.hostname === 'api.anthropic.com' || url.hostname === 'api.openai.com') {
      const allowedEndpoint = (url.hostname === 'api.anthropic.com' && url.pathname === '/v1/messages')
        || (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions');
      if (url.protocol !== 'https:' || !allowedEndpoint || method !== 'POST') {
        throw new Error('Network fence refused an unrecognized application model endpoint.');
      }
      state.providerRequests = claimBudgetSlot(BUDGET_PATH);
      return originalFetch(input, init);
    }
    if (url.hostname === 'login.microsoftonline.com') {
      const tenant = process.env.DYNAMICS_TENANT_ID;
      if (url.protocol !== 'https:' || method !== 'POST'
        || !tenant || url.pathname !== `/${tenant}/oauth2/v2.0/token`) {
        throw new Error('Network fence refused an unrecognized OAuth token request.');
      }
      return originalFetch(input, init);
    }
    if (url.hostname === sandboxHost) {
      if (url.protocol !== 'https:' || !url.pathname.startsWith('/api/data/v9.2/')) {
        throw new Error('Network fence refused an unrecognized Sandbox Dataverse request.');
      }
      if (!['GET', 'HEAD'].includes(method)) {
        assertDataverseWriteScope({ method, pathname: url.pathname, body: init.body ?? input?.body, fixture, state });
      }
      const response = await originalFetch(input, init);
      if (method === 'POST' && url.pathname.endsWith('/wmkf_requestdocuments')) {
        const headerId = (response.headers.get('OData-EntityId') || '').match(/wmkf_requestdocuments\(([^)]+)\)/i)?.[1];
        let bodyId = null;
        if (!headerId && response.ok) {
          const created = await response.clone().json().catch(() => null);
          bodyId = created?.wmkf_requestdocumentid || null;
        }
        const id = headerId || bodyId;
        if (id) state.allowedRequestDocumentIds.add(id.toLowerCase());
      }
      return response;
    }
    if (url.hostname === 'graph.microsoft.com') {
      if (url.protocol !== 'https:' || !url.pathname.startsWith('/v1.0/')) {
        throw new Error('Network fence refused an unrecognized Microsoft Graph request.');
      }
      if (!['GET', 'HEAD'].includes(method)) {
        if (method !== 'PUT') throw new Error('Network fence refused a non-upload SharePoint write.');
      const decodedPath = decodeURIComponent(url.pathname);
      const folderPrefix = `/v1.0/drives/${sharePoint.driveId}/root:/${sharePoint.writeupFolderPath}/`;
      if (!decodedPath.startsWith(folderPrefix) || !decodedPath.endsWith(':/content')) {
        throw new Error('Network fence refused a SharePoint write outside the pre-created fixture writeup folder.');
      }
      const filename = decodedPath.slice(folderPrefix.length, -':/content'.length);
      if (!filename || filename.includes('/')) throw new Error('Network fence refused a nested or unnamed SharePoint upload.');
      if (filename === sharePoint.baselineFilename) {
        if (!permitBaselineEdit || baselineEditUsed || url.searchParams.get('@microsoft.graph.conflictBehavior') !== 'replace') {
          throw new Error('Network fence refused a repeat or unapproved baseline edit.');
        }
        baselineEditUsed = true;
        permitBaselineEdit = false;
      } else {
        if (occupiedNames.has(filename)) throw new Error('Network fence refused an upload that could overwrite an existing file.');
        occupiedNames.add(filename);
      }
      state.graphUploads.push({ filename, driveId: sharePoint.driveId, method });
      }
      return originalFetch(input, init);
    }
    if (url.hostname === 'appriver3651007194.sharepoint.com') {
      const headers = new Headers(init.headers || input?.headers || {});
      if (url.protocol !== 'https:' || !['GET', 'HEAD'].includes(method) || headers.has('authorization')) {
        throw new Error('Network fence refused an unregistered SharePoint host or write.');
      }
      return originalFetch(input, { ...init, redirect: 'follow' });
    }
    throw new Error(`Network fence refused outbound host ${url.hostname}.`);
  };
  return {
    state,
    allowOneBaselineEdit(filename) {
      if (filename !== sharePoint.baselineFilename || baselineEditUsed || permitBaselineEdit) throw new Error('Baseline edit allowance is invalid.');
      permitBaselineEdit = true;
    },
    allowRequestDocument(id) { state.allowedRequestDocumentIds.add(String(id).toLowerCase()); },
    allowFinalArtifact(id) { state.allowedFinalArtifactIds.add(String(id).toLowerCase()); },
    restore() { globalThis.fetch = originalFetch; },
  };
}

function rawHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writeCheckpoint(file, state) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), ...state }, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}

function codeOf(error) {
  return error?.code || error?.body?.code || error?.name || 'unknown_error';
}

function summaryError(error, stage) {
  return Object.assign(new Error(`Sandbox rehearsal stopped at ${stage} (${codeOf(error)}).`), { cause: error });
}

function normalizedText(value) { return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function buildSyntheticAnswers(questions, affiliation) {
  const answers = {};
  for (const question of questions) {
    if (question.type === 'string') answers[question.key] = question.key === 'affiliation' ? affiliation : `Synthetic sandbox response for ${question.label}`;
    else if (question.type === 'picklist') {
      if (!Array.isArray(question.options) || question.options.length === 0) throw new Error('Live review question has no valid options.');
      answers[question.key] = question.options[0].value;
    } else if (question.type === 'multiselect') {
      answers[question.key] = question.options?.length ? [question.options[0].value] : [];
    } else if (question.type === 'richtext') answers[question.key] = `<p>Synthetic sandbox response for ${question.label}</p>`;
    else throw new Error('Live review question contains an unsupported answer type.');
  }
  return answers;
}

function assertDataverseWriteScope({ method, pathname, body, fixture, state }) {
  const allowedSets = new Set([
    'wmkf_requestdocuments', 'akoya_requests', 'wmkf_appreviewersuggestions',
    'wmkf_appreviewanswers', 'wmkf_finalwriteupreviewacknowledgements', 'wmkf_ai_runs',
  ]);
  const bodyText = typeof body === 'string' ? body : '';
  const targets = pathname.endsWith('/$batch')
    ? bodyText.split(/\r?\n--[^\r\n]+\r?\n/).flatMap((part) => {
      const match = /(?:^|\r?\n)(GET|POST|PATCH|DELETE)\s+(\S+)\s+HTTP\/1\.1\s*(?:\r?\n|$)/i.exec(part);
      if (!match) return [];
      const tail = part.slice(match.index + match[0].length);
      const bodyStart = tail.search(/\r?\n\r?\n/);
      const operationBody = bodyStart < 0 ? '' : tail.slice(bodyStart).replace(/^\r?\n\r?\n/, '').split(/\r?\n--/)[0];
      return [{ method: match[1].toUpperCase(), target: match[2], body: operationBody }];
    })
    : [{ method, target: pathname, body: bodyText }];
  if (!targets.length) throw new Error('Network fence refused an uninspectable Dataverse batch write.');
  for (const operation of targets) {
    const target = new URL(operation.target, 'https://sandbox.invalid');
    if (/\b(?:emails?|SendEmail|SendEmailFromTemplate|CreateAndSendNewEmail)\b/i.test(target.pathname)) {
      throw new Error('Network fence refused Dataverse email activity or send operations.');
    }
    const set = target.pathname.split('/').filter(Boolean).at(-1)?.split('(')[0];
    if (!allowedSets.has(set)) throw new Error('Network fence refused a Dataverse write outside the rehearsal entity allowlist.');
    const key = target.pathname.match(/\(([^)]*)\)/)?.[1]?.toLowerCase() || '';
    const allText = `${operation.target} ${operation.body || ''}`.toLowerCase();
    if (set === 'akoya_requests' && !key.includes(fixture.request.id.toLowerCase())) {
      throw new Error('Network fence refused a Request write outside the exact rehearsal Request.');
    }
    if (set === 'wmkf_appreviewersuggestions' && !key.includes(fixture.review.suggestionId.toLowerCase())) {
      throw new Error('Network fence refused a reviewer-suggestion write outside the exact fixture suggestion.');
    }
    if (set === 'wmkf_appreviewanswers' && !allText.includes(fixture.review.suggestionId.toLowerCase())) {
      throw new Error('Network fence refused reviewer-answer writes outside the exact fixture suggestion.');
    }
    if (set === 'wmkf_requestdocuments') {
      const knownDocument = Boolean(key) && state.allowedRequestDocumentIds.has(key);
      let requestBind = null;
      try { requestBind = JSON.parse(operation.body || '')['wmkf_Request@odata.bind']; } catch { /* not a JSON create body */ }
      const exactUnkeyedCreate = operation.method === 'POST' && !key
        && typeof requestBind === 'string'
        && requestBind.toLowerCase() === `/akoya_requests(${fixture.request.id})`.toLowerCase();
      if (!knownDocument && !exactUnkeyedCreate) {
        throw new Error('Network fence refused a Request Document write outside the rehearsal Request lineage.');
      }
    }
    if (set === 'wmkf_finalwriteupreviewacknowledgements'
      && ![...state.allowedFinalArtifactIds].some((id) => allText.includes(id))) {
      throw new Error('Network fence refused a Final acknowledgement write outside the current rehearsal Final.');
    }
    if (set === 'wmkf_ai_runs' && !allText.includes(fixture.request.id.toLowerCase())) {
      throw new Error('Network fence refused an Executor audit write outside the rehearsal Request.');
    }
  }
}

runIfEnabled('regenerate preserves the prior edited Word files through post-visit and group review', async () => {
  jest.setTimeout(30 * 60 * 1000);
  if (!FIXTURE_PATH || !BUDGET_PATH || !REPORT_PATH || !LEDGER_URL) throw new Error('Launcher paths are required.');
  if (!NO_REPO_PATH(REPORT_PATH) || !NO_REPO_PATH(BUDGET_PATH)) throw new Error('Evidence and model budget must be outside the repository.');
  const CHECKPOINT_PATH = `${REPORT_PATH}.checkpoint.json`;
  if (fs.existsSync(REPORT_PATH) || fs.existsSync(CHECKPOINT_PATH)) throw new Error('A prior evidence or checkpoint file exists; stop for fixture/service-row reconciliation before another run.');
  const fixture = privateJsonFile(FIXTURE_PATH, 'Fixture manifest');
  const budgetStat = fs.existsSync(BUDGET_PATH) ? fs.statSync(BUDGET_PATH) : null;
  if (budgetStat && (!budgetStat.isFile() || (budgetStat.mode & 0o077) !== 0)) throw new Error('Provider budget must be a private regular file.');
  let ledger;
  try { ledger = new URL(LEDGER_URL); } catch { throw new Error('Isolated local Postgres URL is invalid.'); }
  if (!['localhost', '127.0.0.1', '::1'].includes(ledger.hostname)) throw new Error('Refusing a nonlocal rehearsal Postgres host.');
  if (ledger.hostname !== fixture.appDatabase.host || Number(ledger.port) !== fixture.appDatabase.port
    || ledger.pathname.replace(/^\//, '') !== fixture.appDatabase.database) {
    throw new Error('Ledger URL does not exactly match the fixture’s isolated PostgreSQL fingerprint.');
  }
  if (process.env.VERCEL_ENV === 'production') throw new Error('Refusing to run from a production deployment environment.');

  const { SANDBOX_HOSTS } = await import('../../lib/dataverse/core/target-registry.js');
  const sandboxUrl = process.env.DYNAMICS_SANDBOX_URL || '';
  const sandboxHost = new URL(sandboxUrl).hostname;
  if (!SANDBOX_HOSTS.includes(sandboxHost)) throw new Error('DYNAMICS_SANDBOX_URL is not a registered Sandbox.');
  validateFixture(fixture, sandboxHost);
  // Override a shared local .env.production default only after the registered
  // Sandbox is confirmed, and remove every production-write escape hatch.
  process.env.DYNAMICS_URL = `https://${sandboxHost}`;
  process.env.DYNAMICS_SANDBOX_URL = `https://${sandboxHost}`;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
  delete process.env.DATAVERSE_ALLOW_PROD_READS;
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') throw new Error('Sandbox Dynamics impersonation must already be enabled.');
  if (process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY !== 'on'
    || process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY !== 'on'
    || process.env.FINAL_WRITEUP_SCHEMA_READY !== 'on'
    || process.env.FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY !== 'on') {
    throw new Error('Required Request Document, Site Visit, Final, or acknowledgement schema preflight is not enabled.');
  }
  process.env.FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS = JSON.stringify([fixture.request.programId]);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';

  const journal = {
    startedAt: new Date().toISOString(),
    target: 'registered-sandbox',
    assertions: [],
    emailCaptures: [],
    notificationCaptures: [],
    stages: {},
  };
  mockNotificationCalls.length = 0;
  let pgClient;
  let networkFence;
  let currentStage = 'initialize';
  const assert = (condition, label) => {
    if (!condition) throw new Error(`Rehearsal assertion failed: ${label}.`);
    journal.assertions.push(label);
  };
  try {
    pgClient = new Client({ connectionString: LEDGER_URL });
    await pgClient.connect();
    const serverIdentity = await pgClient.query('SELECT current_database() AS database');
    const actualDb = serverIdentity.rows[0];
    if (actualDb.database !== fixture.appDatabase.database) throw new Error('Connected PostgreSQL database does not match the reviewed isolated database fingerprint.');
    const container = spawnSync('docker', ['inspect', '--format', '{{.Id}} {{.Config.Image}}', fixture.appDatabase.container], { encoding: 'utf8' });
    if (container.status !== 0) throw new Error('Cannot verify the dedicated local PostgreSQL container identity.');
    const [containerId, image] = container.stdout.trim().split(/\s+/);
    if (!containerId?.startsWith(fixture.appDatabase.containerIdPrefix) || image !== fixture.appDatabase.image) {
      throw new Error('Running PostgreSQL container does not match the reviewed fixture fingerprint.');
    }
    const schema = `writeup_regen_${crypto.randomBytes(6).toString('hex')}`;
    await pgClient.query(`CREATE SCHEMA ${schema}`);
    await pgClient.query(`SET search_path TO ${schema}, public`);
    transport.client = pgClient;
    await pgClient.query(MIGRATION);
    journal.postgres = { host: ledger.hostname, schema, migration: '072_final_writeup_handoff_emails.sql' };

    const [preSite, transition, handoff, acknowledgements, { withDalContext }, { GraphService }, finalTransition] = await Promise.all([
      import('../../lib/services/pre-site-visit/artifact-service.js'),
      import('../../lib/services/pre-site-visit/site-visit-transition-service.js'),
      import('../../lib/services/final-writeup/handoff-email-service.js'),
      import('../../lib/dataverse/adapters/final-writeup-review-acknowledgement.js'),
      import('../../lib/dataverse/core/context.js'),
      import('../../lib/services/graph-service.js'),
      import('../../lib/services/final-writeup/transition-service.js'),
    ]);
    const { DEFAULT_DEPENDENCIES: ARTIFACT_DEPS } = await import('../../lib/services/pre-site-visit/artifact-dependencies.js');
    const { DEFAULT_DEPENDENCIES: FINAL_DEPS } = await import('../../lib/services/final-writeup/transition-dependencies.js');
    const { FINAL_WRITEUP_HANDOFF_EMAIL_DEPENDENCIES: HANDOFF_DEPS } = handoff;
    const { markFinalWriteupReviewed } = await import('../../lib/services/final-writeup/acknowledgement-service.js');
    const { REQUEST_DOCUMENT_LIFECYCLE_STATE, PRE_SITE_VISIT_CONTRACT } = await import('../../shared/config/requestDocument.js');
    const JSZip = (await import('jszip')).default;
    const mammoth = (await import('mammoth')).default;

    const capturedActivities = new Map();
    const handoffDeps = {
      ...HANDOFF_DEPS,
      createEmailActivity: async (payload) => {
        const activityid = crypto.randomUUID();
        const record = { activityid, statuscode: 1, payload };
        capturedActivities.set(activityid, record);
        journal.emailCaptures.push({ operation: 'createEmailActivity', activityid, payload });
        return activityid;
      },
      getEmailActivity: async (activityid) => {
        journal.emailCaptures.push({ operation: 'getEmailActivity', activityid });
        return capturedActivities.get(activityid) || null;
      },
      findEmailByCorrelation: async (correlationKey) => {
        journal.emailCaptures.push({ operation: 'findEmailByCorrelation', correlationKey });
        return [];
      },
      sendEmail: async (activityid, options) => {
        journal.emailCaptures.push({ operation: 'sendEmail-captured', activityid, options });
        const record = capturedActivities.get(activityid);
        if (!record) throw new Error('Captured email activity could not be resolved.');
        record.statuscode = 3;
      },
      notify: async (options) => {
        journal.notificationCaptures.push(options);
        return { id: crypto.randomUUID() };
      },
    };
    const request = await withDalContext('writeup-regeneration-rehearsal-read', () => ARTIFACT_DEPS.getRequest(fixture.request.id));
    assert(request?.akoya_requestid?.toLowerCase() === fixture.request.id.toLowerCase(), 'fixture Request readback identity');
    assert(request._wmkf_programdirector_value?.toLowerCase() === fixture.actors.leadProgramDirectorId.toLowerCase(), 'lead Program Director binding');
    assert(request._wmkf_projectleader_value?.toLowerCase() === fixture.request.projectLeaderContactId.toLowerCase(), 'project leader Contact binding');
    assert(request._wmkf_grantprogram_value?.toLowerCase() === fixture.request.programId.toLowerCase(), 'Grant Program binding');
    assert(request.akoya_requeststatus === fixture.request.status, 'Request status');
    const buckets = await withDalContext('writeup-regeneration-rehearsal-read', () => ARTIFACT_DEPS.getBuckets(
      request.akoya_requestid,
      request.akoya_requestnum,
      { requireResolvedParents: true, requireCompleteResults: true },
    ));
    assert(buckets.some((bucket) => bucket.source === 'dynamics' && bucket.library === fixture.sharePoint.library && bucket.folder === fixture.sharePoint.folderPath), 'Request SharePoint folder lineage');

    const occupiedNames = new Set();
    networkFence = installNetworkFence({ sandboxHost, sharePoint: fixture.sharePoint, fixture, occupiedNames });
    const requestFiles = await GraphService.listFiles(fixture.sharePoint.library, fixture.sharePoint.folderPath, { recursive: true, maxDepth: 3, maxFiles: 100 });
    assert(requestFiles.some((file) => file.id === fixture.sharePoint.narrative.itemId), 'synthetic narrative is present in the dedicated folder');
    const narrativeFile = await GraphService.downloadFile(fixture.sharePoint.driveId, fixture.sharePoint.narrative.itemId);
    assert(rawHash(narrativeFile.buffer) === fixture.sharePoint.narrative.sha256, 'narrative bytes match the guarded fixture readback');
    const writeupFiles = await GraphService.listFiles(fixture.sharePoint.library, fixture.sharePoint.writeupFolderPath, { maxFiles: 100 });
    for (const file of writeupFiles) occupiedNames.add(file.name);
    const artifactDependencies = {
      ...ARTIFACT_DEPS,
      stageGroupReviewHandoff: (args) => handoff.stageGroupReviewHandoff(args, handoffDeps),
      deliverGroupReviewHandoff: (args) => handoff.deliverGroupReviewHandoff(args, handoffDeps),
    };

    assert(fixture.sharePoint.writeupFolderPath === `${fixture.sharePoint.folderPath}/${PRE_SITE_VISIT_CONTRACT.relativeFolder}`, 'generated Word folder matches the governed Pre-Site relative path');
    const requestFolderParts = fixture.sharePoint.folderPath.split('/');
    const requestFolderName = requestFolderParts.pop();
    const requestFolderMeta = await GraphService.getFileMetadataByPath(
      fixture.sharePoint.library,
      requestFolderParts.join('/'),
      requestFolderName,
      { siteId: fixture.sharePoint.siteId, driveId: fixture.sharePoint.driveId },
    );
    const writeupFolderParts = PRE_SITE_VISIT_CONTRACT.relativeFolder.split('/');
    const writeupFolderName = writeupFolderParts.pop();
    const writeupFolderMeta = await GraphService.getFileMetadataByPath(
      fixture.sharePoint.library,
      [fixture.sharePoint.folderPath, ...writeupFolderParts].join('/'),
      writeupFolderName,
      { siteId: fixture.sharePoint.siteId, driveId: fixture.sharePoint.driveId },
    );
    assert(requestFolderMeta?.id === fixture.sharePoint.folderId && requestFolderMeta?.parentReference?.driveId === fixture.sharePoint.driveId, 'Request folder Graph identity readback');
    assert(writeupFolderMeta?.id === fixture.sharePoint.writeupFolderId && writeupFolderMeta?.parentReference?.driveId === fixture.sharePoint.driveId, 'writeup folder Graph identity readback');

    currentStage = 'initial-no-review-input';
    const before = await withDalContext('writeup-regeneration-rehearsal-inputs', () => ARTIFACT_DEPS.loadInputs({ requestId: fixture.request.id }));
    assert(!before.context.documentFields.refereeSection, 'initial input has no Reviews paragraph');
    const beforeStatus = await withDalContext('writeup-regeneration-rehearsal-status', () => preSite.getPreSiteVisitArtifactStatus({ requestId: fixture.request.id }, artifactDependencies));
    assert(!beforeStatus.currentArtifact, 'Factory Request has no prior Pre-Site artifact');
    const { getManualReviewEntryForm, submitManualReviewEntry } = await import('../../lib/services/review-manager/manual-review-entry-service.js');
    const reviewForm = await withDalContext('writeup-regeneration-rehearsal-review-form-preflight', () => getManualReviewEntryForm({ suggestionId: fixture.review.suggestionId }));
    assert(reviewForm?.questions?.length > 0 && reviewForm.setVersion, 'current review form is available before model calls');
    const syntheticAnswers = buildSyntheticAnswers(reviewForm.questions, reviewForm.affiliation || 'Synthetic Sandbox Research Group');
    const { validateReviewSubmission } = await import('../../lib/external/build-review-submission.js');
    const reviewValidation = validateReviewSubmission(syntheticAnswers, reviewForm.questions);
    assert(reviewValidation.ok, 'synthetic review answers pass current-question-set submit validation before model calls');

    currentStage = 'initial-generation';
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'initial-generation-started', requestId: fixture.request.id,
      providerBudgetPath: BUDGET_PATH, expectedArtifactId: null,
    });
    const initial = await withDalContext('writeup-regeneration-rehearsal-generate', () => preSite.generatePreSiteVisitArtifact({
      requestId: fixture.request.id,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
      runSource: 'Vercel Test',
    }, artifactDependencies));
    const initialArtifact = initial.artifact;
    writeCheckpoint(CHECKPOINT_PATH, { stage: 'initial-generated', requestId: fixture.request.id, initialArtifactId: initialArtifact.artifactId });
    networkFence.allowRequestDocument(initialArtifact.artifactId);
    fixture.sharePoint.baselineFilename = initialArtifact?.file?.name || null;
    if (!fixture.sharePoint.baselineFilename) throw new Error('Initial artifact has no verified SharePoint filename.');
    assert(initialArtifact?.file?.itemId && initialArtifact.file.driveId === fixture.sharePoint.driveId, 'initial Word artifact has a stable fixture-drive identity');
    assert(initialArtifact.warnings.some((warning) => warning.code === 'referee_section_manual'), 'initial artifact warns that Reviews was not composed');
    assert(networkFence.state.graphUploads.some((upload) => upload.filename === initialArtifact.file.name), 'initial generated name was new and uploaded');
    occupiedNames.add(initialArtifact.file.name);
    const baseline = await GraphService.downloadFile(initialArtifact.file.driveId, initialArtifact.file.itemId);
    const initialDocxText = (await mammoth.extractRawText({ buffer: baseline.buffer })).value;
    assert(!normalizedText(initialDocxText).includes('synthetic sandbox response'), 'initial document contains no reviewer submission text');
    const oldInitialHash = rawHash(baseline.buffer);
    journal.stages.initial = { lifecycle: 'draft', warning: 'referee_section_manual', rawHash: oldInitialHash };

    // Put one unmistakable edit in only the newly generated fixture baseline.
    // The replacement itself is fenced to its exact unique Request folder/name.
    currentStage = 'baseline-staff-edit';
    const marker = `STAFF EDIT PRESERVATION CHECK ${crypto.randomUUID()}`;
    const baselineZip = await JSZip.loadAsync(baseline.buffer);
    const documentPart = baselineZip.file('word/document.xml');
    assert(Boolean(documentPart), 'baseline DOCX has the main document part');
    const documentXml = await documentPart.async('string');
    baselineZip.file('word/document.xml', documentXml.replace('</w:body>', `<w:p><w:r><w:t xml:space="preserve">${marker}</w:t></w:r></w:p></w:body>`));
    const editedBaseline = await baselineZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    networkFence.allowOneBaselineEdit(initialArtifact.file.name);
    const editedFile = await GraphService.uploadFile(fixture.sharePoint.library, fixture.sharePoint.writeupFolderPath, initialArtifact.file.name,
      editedBaseline, PRE_SITE_VISIT_CONTRACT.contentType, {
        conflictBehavior: 'replace', siteId: fixture.sharePoint.siteId, driveId: fixture.sharePoint.driveId,
      });
    assert(editedFile.id === initialArtifact.file.itemId, 'staff edit remains on the original item identity');
    const editedBaselineReadback = await GraphService.downloadFile(editedFile.driveId, editedFile.id);
    assert(rawHash(editedBaselineReadback.buffer) === rawHash(editedBaseline), 'unique staff edit marker is read back from the baseline item');
    assert(normalizedText((await mammoth.extractRawText({ buffer: editedBaselineReadback.buffer })).value).includes(normalizedText(marker)), 'edited baseline DOCX contains the unique marker');

    currentStage = 'post-presentation-promotion';
    const promoted = await withDalContext('writeup-regeneration-rehearsal-promote', () => transition.startSiteVisitStage({
      requestId: fixture.request.id,
      expectedArtifactId: initialArtifact.artifactId,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
    }));
    assert(promoted.artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, 'initial Word file promoted to Site Visit workspace');

    currentStage = 'supported-manual-review-submission';
    const submitted = await withDalContext('writeup-regeneration-rehearsal-review-submit', () => submitManualReviewEntry({
      suggestionId: fixture.review.suggestionId,
      answers: syntheticAnswers,
      setVersion: reviewForm.setVersion,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
    }));
    const reviewedInputs = await withDalContext('writeup-regeneration-rehearsal-inputs', () => ARTIFACT_DEPS.loadInputs({ requestId: fixture.request.id }));
    assert(Boolean(reviewedInputs.context.documentFields.refereeSection?.text), 'default input loader composes the submitted review');
    assert(reviewedInputs.context.documentFields.refereeSection.names?.length > 0, 'default input loader resolves the submitted reviewer identity');
    const reviewText = reviewedInputs.context.documentFields.refereeSection.text;
    journal.stages.review = { receivedAt: submitted.receivedAt, questionCount: reviewForm.questions.length, composed: true };

    let failedUpload = false;
    const postVisitDeps = {
      ...artifactDependencies,
      uploadFile: (...args) => {
        if (!failedUpload) { failedUpload = true; throw Object.assign(new Error('synthetic pre-Graph upload interruption'), { code: 'rehearsal_upload_interrupted' }); }
        return ARTIFACT_DEPS.uploadFile(...args);
      },
    };
    const postVisitOperationId = crypto.randomUUID();
    currentStage = 'post-visit-regeneration-upload-retry';
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'post-visit-regeneration-started', requestId: fixture.request.id,
      initialArtifactId: initialArtifact.artifactId, postVisitOperationId,
      expectedArtifactId: initialArtifact.artifactId,
    });
    const firstAttempt = await withDalContext('writeup-regeneration-rehearsal-regenerate', () => preSite.generatePreSiteVisitArtifact({
      requestId: fixture.request.id,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
      generationMode: 'regenerate',
      regeneration: { expectedArtifactId: initialArtifact.artifactId, clientOperationId: postVisitOperationId },
    }, postVisitDeps)).then(() => null, (error) => error);
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'post-visit-output-frozen-after-upload-interruption', requestId: fixture.request.id,
      initialArtifactId: initialArtifact.artifactId, postVisitOperationId,
      errorCode: codeOf(firstAttempt), providerRequests: networkFence.state.providerRequests,
    });
    assert(codeOf(firstAttempt) === 'rehearsal_upload_interrupted', 'injected upload interruption occurs before Graph');
    const providerCountAfterFrozenOutput = networkFence.state.providerRequests;
    const regenerated = await withDalContext('writeup-regeneration-rehearsal-regenerate-retry', () => preSite.generatePreSiteVisitArtifact({
      requestId: fixture.request.id,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
      generationMode: 'regenerate',
      regeneration: { expectedArtifactId: initialArtifact.artifactId, clientOperationId: postVisitOperationId },
    }, { ...artifactDependencies, uploadFile: ARTIFACT_DEPS.uploadFile }));
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'post-visit-regenerated', requestId: fixture.request.id,
      initialArtifactId: initialArtifact.artifactId, postVisitArtifactId: regenerated.artifact.artifactId,
      postVisitOperationId,
    });
    networkFence.allowRequestDocument(regenerated.artifact.artifactId);
    assert(networkFence.state.providerRequests === providerCountAfterFrozenOutput, 'same frozen output retries without another model request');
    assert(regenerated.artifact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, 'post-visit successor remains in the Site Visit stage');
    assert(!regenerated.artifact.warnings.some((warning) => warning.code === 'referee_section_manual'), 'post-visit successor clears the missing-Reviews warning');
    const regeneratedBuffer = await GraphService.downloadFile(regenerated.artifact.file.driveId, regenerated.artifact.file.itemId);
    const regeneratedText = (await mammoth.extractRawText({ buffer: regeneratedBuffer.buffer })).value;
    assert(normalizedText(regeneratedText).includes(normalizedText(reviewText)), 'rendered replacement DOCX contains the live Reviews paragraph');
    assert(!normalizedText(regeneratedText).includes(normalizedText(marker)), 'regenerated DOCX does not carry the prior staff edit');
    const preservedEditedItem = await GraphService.downloadFile(initialArtifact.file.driveId, initialArtifact.file.itemId);
    assert(rawHash(preservedEditedItem.buffer) === rawHash(editedBaseline), 'edited prior Word item bytes remain unchanged and accessible');
    const afterPost = await withDalContext('writeup-regeneration-rehearsal-status', () => preSite.getPreSiteVisitArtifactStatus({ requestId: fixture.request.id }, artifactDependencies));
    assert(afterPost.previousVersions.some((item) => item.artifactId === initialArtifact.artifactId), 'post-visit Previous versions retains the edited predecessor');
    journal.stages.postVisit = { lifecycle: 'review', warningCleared: true, reviewsTextPresent: true, markerAbsent: true, previousLinkPresent: true };

    currentStage = 'group-review-handoff';
    const staged = await withDalContext('writeup-regeneration-rehearsal-handoff-stage', () => handoff.stageGroupReviewHandoff({
      requestId: fixture.request.id,
      sourceDocumentId: regenerated.artifact.artifactId,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
    }, handoffDeps));
    assert(['staged', 'already_staged'].includes(staged.status), 'group-review email intent is staged in the isolated SQL schema');
    const startedFinal = await withDalContext('writeup-regeneration-rehearsal-final-start', () => finalTransition.startFinalWriteup({
      requestId: fixture.request.id,
      expectedArtifactId: regenerated.artifact.artifactId,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
    }, FINAL_DEPS));
    networkFence.allowRequestDocument(startedFinal.artifact.artifactId);
    networkFence.allowFinalArtifact(startedFinal.artifact.artifactId);
    assert(startedFinal.artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, 'Final Writeup entered group review');
    const initialHandoff = await withDalContext('writeup-regeneration-rehearsal-handoff-deliver', () => handoff.deliverGroupReviewHandoff({ sourceDocumentId: regenerated.artifact.artifactId }, handoffDeps));
    assert(initialHandoff.status === 'sent', 'group-review notice was captured without delivery');
    const firstFinalBuffer = await GraphService.downloadFile(startedFinal.artifact.file.driveId, startedFinal.artifact.file.itemId);
    const oldFinalHash = rawHash(firstFinalBuffer.buffer);
    const reviewAck = await withDalContext('writeup-regeneration-rehearsal-acknowledge', () => markFinalWriteupReviewed({
      requestId: fixture.request.id,
      expectedFinalArtifactId: startedFinal.artifact.artifactId,
      actingUserSystemId: fixture.actors.reviewingColleagueId,
    }));
    assert(reviewAck?.personalState === 'reviewed', 'John’s acknowledgement recorded on the current Final');
    const oldAckRows = await acknowledgements.findByFinalDocument(startedFinal.artifact.artifactId);
    assert(oldAckRows.records.some((row) => row._wmkf_reviewer_value?.toLowerCase() === fixture.actors.reviewingColleagueId.toLowerCase()), 'old Final retains John’s acknowledgement');

    currentStage = 'group-review-regeneration';
    const oldFinalId = startedFinal.artifact.artifactId;
    const groupOperationId = crypto.randomUUID();
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'group-review-regeneration-started', requestId: fixture.request.id,
      postVisitArtifactId: regenerated.artifact.artifactId, oldFinalId,
      groupOperationId, expectedArtifactId: regenerated.artifact.artifactId,
      expectedFinalArtifactId: oldFinalId,
    });
    const groupResult = await withDalContext('writeup-regeneration-rehearsal-group-regenerate', () => preSite.generatePreSiteVisitArtifact({
      requestId: fixture.request.id,
      actingUserSystemId: fixture.actors.leadProgramDirectorId,
      generationMode: 'regenerate',
      regeneration: {
        expectedArtifactId: regenerated.artifact.artifactId,
        expectedFinalArtifactId: oldFinalId,
        clientOperationId: groupOperationId,
      },
    }, artifactDependencies));
    writeCheckpoint(CHECKPOINT_PATH, {
      stage: 'group-review-regenerated', requestId: fixture.request.id,
      postVisitArtifactId: regenerated.artifact.artifactId, oldFinalId,
      newArtifactId: groupResult.artifact.artifactId, groupOperationId,
    });
    networkFence.allowRequestDocument(groupResult.artifact.artifactId);
    assert(groupResult.artifact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, 'group-review successor remains in group review');
    const finalStatus = await withDalContext('writeup-regeneration-rehearsal-final-read', () => finalTransition.getFinalWriteupStatus({
      requestId: fixture.request.id, writeupViewer: { systemUserId: fixture.actors.leadProgramDirectorId },
    }, FINAL_DEPS));
    assert(finalStatus.phase === 'group-review' && finalStatus.artifact?.sourceArtifactId === groupResult.artifact.artifactId, 'new paired Final is current in group review');
    const nextFinalId = finalStatus.artifact.artifactId;
    const newAckRows = await acknowledgements.findByFinalDocument(nextFinalId);
    assert(!newAckRows.records.some((row) => row._wmkf_reviewer_value?.toLowerCase() === fixture.actors.reviewingColleagueId.toLowerCase()), 'new Final has no inherited acknowledgement');
    const preservedOldFinal = await GraphService.downloadFile(startedFinal.artifact.file.driveId, startedFinal.artifact.file.itemId);
    assert(rawHash(preservedOldFinal.buffer) === oldFinalHash, 'acknowledged old Final bytes remain unchanged');
    const newFinalBuffer = await GraphService.downloadFile(finalStatus.artifact.file.driveId, finalStatus.artifact.file.itemId);
    const newFinalText = (await mammoth.extractRawText({ buffer: newFinalBuffer.buffer })).value;
    assert(normalizedText(newFinalText).includes(normalizedText(reviewText)), 'group-review successor preserves the submitted Reviews paragraph');
    assert(!normalizedText(newFinalText).includes(normalizedText(marker)), 'group-review successor does not carry the old staff edit');
    const finalPost = await withDalContext('writeup-regeneration-rehearsal-status', () => preSite.getPreSiteVisitArtifactStatus({ requestId: fixture.request.id }, artifactDependencies));
    assert(finalPost.previousVersions.some((item) => item.artifactId === regenerated.artifact.artifactId), 'group-review Previous versions retains its predecessor');
    assert(journal.emailCaptures.some((entry) => entry.operation === 'sendEmail-captured'), 'email transport was captured');
    journal.notificationCaptures.push(...mockNotificationCalls);
    assert(journal.notificationCaptures.every((item) => item), 'NotificationService was captured');
    assert(networkFence.state.providerRequests <= 3, 'persistent application provider-request budget');
    assert(networkFence.state.graphUploads.every((upload) => upload.driveId === fixture.sharePoint.driveId), 'all Word uploads stayed in the dedicated request drive');
    journal.stages.groupReview = { oldAcknowledgementRetained: true, newAcknowledgementAbsent: true, oldBytesPreserved: true, replacementNoticeCaptured: true, lifecycle: 'group-review' };
    journal.completedAt = new Date().toISOString();
    journal.providerRequests = networkFence.state.providerRequests;
    journal.uploadCount = networkFence.state.graphUploads.length;
    journal.emailCaptures = journal.emailCaptures.map((entry) => ({ ...entry, payload: entry.payload ? { ...entry.payload, body: '[captured privately]' } : undefined }));
    fs.writeFileSync(REPORT_PATH, JSON.stringify(journal, null, 2), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    journal.failedAt = currentStage;
    journal.errorCode = codeOf(error);
    journal.completedAt = new Date().toISOString();
    journal.emailCaptures = journal.emailCaptures.map((entry) => ({
      ...entry,
      payload: entry.payload ? { ...entry.payload, body: '[captured privately]' } : undefined,
    }));
    journal.notificationCaptures = [...journal.notificationCaptures, ...mockNotificationCalls]
      .map((entry) => ({ type: entry?.type, severity: entry?.severity, operation: entry?.operation || undefined }));
    try {
      const descriptor = fs.openSync(REPORT_PATH, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(journal, null, 2));
      fs.closeSync(descriptor);
    } catch { /* Preserve an existing evidence file; never overwrite it. */ }
    throw summaryError(error, currentStage);
  } finally {
    networkFence?.restore();
    transport.client = null;
    if (pgClient) await pgClient.end();
  }
}, 30 * 60 * 1000);

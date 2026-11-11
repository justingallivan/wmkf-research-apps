/** Scoped operator runner for one reviewed Sandbox trial. No Request writes.
 * Run expiry after 24 hours to purge due source/response content, and again
 * after seven days to purge due configuration/result/audit content. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire, registerHooks } = require('node:module');
const root = path.resolve(__dirname, '..');
const candidatePath = path.join(root, 'docs/plans/EXPERTISE_SANDBOX_1000339_CANDIDATE_2026-11-11.json');
const candidateDigest = '5060ea160f58ec90ab54736e40180cbddb61d8073089faa930e1cb8eb3d44679';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const req = createRequire(path.join(root, 'package.json'));
const LEDGER_HOST = 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech';
const LEDGER_DATABASE = 'neondb';
function fetchUrl(input) {
  if (typeof input !== 'string') throw new Error('Only string fetch URLs are allowed');
  return new URL(input);
}
function checkLedgerBinding(ledger) {
  if (!/^[a-f0-9]{64}$/.test(ledger?.databaseIdentity || '') || ledger.hostname !== LEDGER_HOST
    || ledger.database !== LEDGER_DATABASE) throw new Error('Ledger binding invalid');
}
function checkDatabaseUrl(value, ledger) {
  checkLedgerBinding(ledger);
  const url = new URL(value);
  const keys = [...url.searchParams.keys()];
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== ledger.hostname
    || url.pathname !== `/${ledger.database}` || (url.port && url.port !== '5432') || url.hash
    || keys.some(key => !['sslmode', 'channel_binding'].includes(key))
    || new Set(keys).size !== keys.length) throw new Error('Database target mismatch');
}
function reserveAuditIntent(state, runId) {
  if (state.auditRunId || typeof runId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(runId)) {
    throw new Error('Audit outcome needs reconciliation');
  }
  state.auditRunId = runId;
}
function allowedRead(url, method) {
  return ['GET', 'HEAD'].includes(method) && ['https://graph.microsoft.com',
    'https://orgd9e66399.crm.dynamics.com', 'https://appriver3651007194.sharepoint.com'].includes(url.origin);
}
function providerIntent(url, method, mode, body, posts) {
  return mode === 'tick' && method === 'POST' && url.origin === 'https://api.anthropic.com'
    && url.pathname === '/v1/messages' && body?.model === 'claude-sonnet-4-6'
    && body?.max_tokens === 4096 && posts === 0;
}
function checkGuards() {
  const testLedger = { databaseIdentity: 'a'.repeat(64), hostname: LEDGER_HOST, database: LEDGER_DATABASE };
  const validUrl = `postgresql://fixture:fixture@${LEDGER_HOST}/${LEDGER_DATABASE}?sslmode=require`;
  checkDatabaseUrl(validUrl, testLedger);
  for (const bad of [`${validUrl}&host=other`, `${validUrl}&port=9999`, `${validUrl}&dbname=other`, validUrl.replace(LEDGER_HOST, 'other.example')]) {
    let denied = false; try { checkDatabaseUrl(bad, testLedger); } catch { denied = true; }
    if (!denied) throw new Error('Database guard self-test failed');
  }
  let requestDenied = false; try { fetchUrl(new Request('https://graph.microsoft.com/v1.0/me', { method: 'POST' })); } catch { requestDenied = true; }
  if (!requestDenied) throw new Error('Request object guard self-test failed');
  const auditState = {}; const runId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  reserveAuditIntent(auditState, runId);
  let retryDenied = false; try { reserveAuditIntent(auditState, runId); } catch { retryDenied = true; }
  if (!retryDenied || auditState.auditRunId !== runId) throw new Error('Audit retry guard self-test failed');
  const provider = new URL('https://api.anthropic.com/v1/messages');
  const good = { model: 'claude-sonnet-4-6', max_tokens: 4096 };
  if (!providerIntent(provider, 'POST', 'tick', good, 0)
    || providerIntent(provider, 'POST', 'tick', good, 1)
    || providerIntent(provider, 'POST', 'tick', { ...good, max_tokens: 4095 }, 0)
    || providerIntent(new URL('https://other.example/v1/messages'), 'POST', 'tick', good, 0)
    || providerIntent(provider, 'POST', 'preflight', good, 0)
    || providerIntent(provider, 'POST', 'recover', good, 0)
    || allowedRead(new URL('https://wmkf.crm.dynamics.com/api/data/v9.2/'), 'GET')
    || allowedRead(new URL('https://graph.microsoft.com/v1.0/me'), 'POST')
    || !allowedRead(new URL('https://graph.microsoft.com/v1.0/me'), 'GET')) throw new Error('Guard self-test failed');
  return { guards: 'passed', providerLimit: 1 };
}
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.js`, context);
    throw error;
  }
} });

function checkCandidate() {
  const bytes = fs.readFileSync(candidatePath);
  if (sha256(bytes) !== candidateDigest) throw new Error('Candidate digest mismatch');
  const candidate = JSON.parse(bytes);
  const { hashProfile, parseExecutionSpec } = req('./lib/services/prompt-jobs/profile.js');
  const { validateTaskCapability } = req('./lib/services/prompt-jobs/capabilities.js');
  const { prepareContextSnapshot, composeProfileTask } = req('./lib/services/prompt-jobs/context.js');
  const { buildRecommendationsSnapshot, validateRecommendationsOutput } = req('./lib/services/expertise-finder/recommendations-contract.js');
  const roster = req('./lib/services/expertise-finder/roster-contract.cjs');
  if (hashProfile(candidate.profile) !== candidate.profileHash) throw new Error('Profile hash mismatch');
  const task = candidate.task;
  const row = { wmkf_ai_promptid: crypto.randomUUID(), wmkf_ai_promptname: task.name,
    wmkf_promptversion: 1, wmkf_ai_systemprompt: task.systemPrompt, wmkf_ai_promptbody: task.body,
    wmkf_ai_promptvariables: task.variables, wmkf_ai_promptoutputschema: task.outputSchema,
    wmkf_ai_model: task.model, wmkf_ai_maxtokens: task.maxTokens, wmkf_ai_temperature: task.temperature };
  parseExecutionSpec(row);
  validateTaskCapability(row, null, { definitionOnly: true });
  const requestId = crypto.randomUUID();
  const scope = { environment: 'test', authorizationScope: `expertise-fixture:${crypto.randomUUID()}`, requestId };
  const profileGuid = crypto.randomUUID();
  const userGuid = crypto.randomUUID();
  const built = buildRecommendationsSnapshot({ complete: true, users: [{ userGuid, disabled: false }], profiles: [{
    ...Object.fromEntries(roster.TEXT.map(key => [key, null])), profile_guid: profileGuid, etag: 'W/"1"',
    name: 'Synthetic Lead', role_type: 'Research Program Staff', is_active: true, lead_pd_eligible: true,
    dataverse_user_id: userGuid, dataverse_contact_id: null, expertise: 'Synthetic physics',
  }] });
  const nonceSecret = 'offline synthetic secret for candidate verification only';
  const snapshot = prepareContextSnapshot({ scope, profile: candidate.profile, nonceSecret,
    documents: [{ role: 'proposal', id: 'synthetic', version: '1', sha256: 'a'.repeat(64),
      extractionVersion: 'fixture-v1', text: 'Synthetic physics proposal.' }],
    records: [built.rosterRecord], rosterSnapshot: built.snapshot });
  const composed = composeProfileTask({ promptRow: row, profile: candidate.profile, snapshot, scope, nonceSecret });
  validateRecommendationsOutput({ proposal_summary: {}, staff_assignment: { primary: null, secondary: null },
    staff_consultation: [], consultant_overlap: [], board_interest: [], expertise_gaps: { has_gaps: false, description: null },
    conflicts: [] }, composed.rosterContext);
  return { candidateDigest, profileHash: candidate.profileHash, compiler: 'passed', outputContract: 'passed' };
}

// Initialization creates only local private state. It does not read environment
// files, establish a network connection, or authorize publication/admission.
function readPrivateJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) {
    throw new Error('Private binding file permissions are invalid');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function initialize(directory) {
  checkCandidate();
  if (!path.isAbsolute(directory) || !directory.startsWith('/private/tmp/')) throw new Error('Private state directory must be under /private/tmp');
  fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700
    || fs.realpathSync(directory) !== directory) throw new Error('Private state directory is invalid');
  const binding = readPrivateJson('/private/tmp/wmkf-expertise-sandbox-staff-binding-20261111.json');
  const ledger = readPrivateJson('/private/tmp/wmkf-expertise-sandbox-ledger-binding-20261111.json');
  checkLedgerBinding(ledger);
  const guid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
  if (binding.profileId !== 2 || !['systemUserId','azureId','applicationId'].every(key => guid.test(binding[key]))) throw new Error('Private bindings are invalid');
  const receiptPath = '/private/tmp/wmkf-proposal-copy.5w03zboq/copy-receipt.jsonl';
  if (sha256(fs.readFileSync(receiptPath)) !== 'e0930521c06f282a08cb9da3096e97b682e9284d41bc92496582cd568382462c') {
    throw new Error('Copied source receipt changed');
  }
  const state = { version: 1, candidateDigest, requestId: '63dab4af-178f-4bbc-b24d-3ccbaf74cbfc',
    profileId: binding.profileId, systemUserId: binding.systemUserId, azureId: binding.azureId,
    applicationId: binding.applicationId, databaseIdentity: ledger.databaseIdentity, ledgerHostname: ledger.hostname, ledgerDatabase: ledger.database,
    scopeId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), promptId: crypto.randomUUID(),
    profilePublicationId: crypto.randomUUID(), nonceSecret: crypto.randomBytes(32).toString('hex'),
    sourceProof: null, providerPosts: 0 };
  const fd = fs.openSync(path.join(directory, 'state.json'), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dirFd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  return { initialized: true, sourceProof: 'pending' };
}

// The only network-capable preparatory operation is read-only. It observes the
// current governed source and checks it against the approved copy journal.
async function prepareSource(directory) {
  // Libraries can log remote response bodies and source paths on errors.
  console.log = console.warn = console.error = () => {};
  const dirStat = fs.lstatSync(directory);
  if (!path.isAbsolute(directory) || !directory.startsWith('/private/tmp/') || fs.realpathSync(directory) !== directory
    || !dirStat.isDirectory() || dirStat.uid !== process.getuid() || (dirStat.mode & 0o777) !== 0o700) throw new Error('Invalid state directory');
  const lockPath = path.join(directory, 'lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  try {
    const statePath = path.join(directory, 'state.json');
    const state = readPrivateJson(statePath);
    if (state.version !== 1 || state.candidateDigest !== candidateDigest || state.requestId !== '63dab4af-178f-4bbc-b24d-3ccbaf74cbfc') throw new Error('Invalid trial state');
    checkCandidate();
    const journalBytes = fs.readFileSync('/private/tmp/wmkf-proposal-copy.5w03zboq/copy-receipt.jsonl');
    if (sha256(journalBytes) !== 'e0930521c06f282a08cb9da3096e97b682e9284d41bc92496582cd568382462c') throw new Error('Copy receipt changed');
    const journal = journalBytes.toString('utf8').trim().split('\n').map(JSON.parse);
    const intent = journal.find(x => x.kind === 'intent');
    const created = journal.find(x => x.kind === 'file-created');
    const verified = journal.find(x => x.kind === 'governed-source-verified');
    if (!intent || !created || !verified || intent.requestId !== state.requestId || verified.requestId !== state.requestId
      || intent.sha256 !== 'd7e31d37ed2163e29ade2bf878720af34582bcf10e7c8252a223c3dd79a20c44'
      || verified.sha256 !== intent.sha256 || created.sha256 !== intent.sha256 || intent.bytes !== 1311649
      || verified.bytes !== intent.bytes || created.size !== intent.bytes || verified.complete !== true
      || created.id !== verified.id || created.eTag !== verified.eTag || created.siteId !== intent.siteId
      || created.driveId !== intent.driveId || created.name !== intent.filename) throw new Error('Invalid copy receipt');
    if (process.env.NODE_OPTIONS || process.env.VERCEL !== undefined || process.env.VERCEL_ENV !== undefined) throw new Error('Unexpected local configuration');
    const dotenv = req('dotenv');
    const env = dotenv.parse(fs.readFileSync('/Users/gallivan/.local/share/wmkf-roster/full-import-20261110/full.env'));
    for (const key of Object.keys(process.env)) if (/^(DYNAMICS_|DATAVERSE_|SHAREPOINT_|EXPERTISE_RECOMMENDATIONS_)/.test(key)) delete process.env[key];
    for (const key of ['DYNAMICS_URL','DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET']) {
      if (!env[key]) throw new Error('Required Sandbox configuration missing');
      process.env[key] = env[key];
    }
    process.env.SHAREPOINT_SITE_URL = env.SHAREPOINT_SITE_URL || 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';
    if (process.env.DYNAMICS_URL !== 'https://orgd9e66399.crm.dynamics.com' || process.env.DYNAMICS_CLIENT_ID !== state.applicationId
      || process.env.SHAREPOINT_SITE_URL !== 'https://appriver3651007194.sharepoint.com/sites/akoyaGO') throw new Error('Sandbox target mismatch');
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'on'; process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false'; process.env.NODE_ENV = 'development';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = fetchUrl(input);
      const method = (options.method || 'GET').toUpperCase();
      const token = method === 'POST' && url.origin === 'https://login.microsoftonline.com'
        && url.pathname === `/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
      if (token) {
        const body = new URLSearchParams(options.body);
        if (body.get('grant_type') !== 'client_credentials' || body.get('client_id') !== state.applicationId
          || !['https://graph.microsoft.com/.default','https://orgd9e66399.crm.dynamics.com/.default'].includes(body.get('scope'))) throw new Error('Unexpected token scope');
      } else if (!allowedRead(url, method)) throw new Error('Read-only network guard blocked request');
      return originalFetch(input, { ...options, redirect: 'manual' });
    };
    const { withDalContext } = req('./lib/dataverse/core/context.js');
    const { GraphService } = req('./lib/services/graph-service.js');
    const { createRecommendationsProposalSource } = req('./lib/services/prompt-jobs/proposal-source.js');
    const { SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, sandboxRecommendationSourceProof } = req('./lib/services/prompt-jobs/context.js');
    const { canonical } = req('./lib/services/prompt-jobs/profile.js');
    const captures = [];
    const source = createRecommendationsProposalSource({ getFileMetadataByPath: async (library, folder, filename) => {
      const metadata = await GraphService.getFileMetadataByPath(library, folder, filename);
      if (metadata) captures.push({ library, folder, filename, metadata });
      return metadata;
    } });
    const observation = await withDalContext('expertise-sandbox-read-only-source-check', () => source.observe({
      requestId: state.requestId, version: SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, siteId: intent.siteId, driveId: intent.driveId,
    }));
    if (captures.length !== 2 || canonical(captures[0]) !== canonical(captures[1])) throw new Error('Source metadata changed');
    const { library, folder, filename, metadata } = captures[0];
    if (metadata.id !== created.id || metadata.siteId !== intent.siteId || metadata.driveId !== intent.driveId
      || metadata.name !== intent.filename || metadata.size !== intent.bytes || metadata.eTag !== verified.eTag
      || metadata.versionId !== verified.versionId) throw new Error('Source does not match copy receipt');
    const identity = { requestId: state.requestId, library, folder, filename, siteId: metadata.siteId,
      driveId: metadata.driveId, itemId: metadata.id };
    const doc = observation.documents?.[0];
    if (observation.requestId !== state.requestId || observation.version !== SANDBOX_RECOMMENDATIONS_SOURCE_VERSION
      || observation.complete !== true || observation.targetHost !== 'orgd9e66399.crm.dynamics.com'
      || observation.documents?.length !== 1 || doc.id !== sha256(canonical(identity)) || doc.sha256 !== intent.sha256
      || doc.version !== canonical([metadata.versionId, metadata.eTag]) || doc.role !== 'proposal') throw new Error('Source observation mismatch');
    const proof = sandboxRecommendationSourceProof('orgd9e66399.crm.dynamics.com', ['proposal'], observation.documents);
    const pin = { siteId: intent.siteId, driveId: intent.driveId, hash: proof.hash };
    if (state.sourceProof && canonical(state.sourceProof) !== canonical(pin)) throw new Error('Previously pinned source changed');
    if (!state.sourceProof) {
      state.sourceProof = pin;
      const next = path.join(directory, 'state.next');
      const fd = fs.openSync(next, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(next, statePath);
      const dfd = fs.openSync(directory, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    }
    return { sourceVerified: true, livePublicationEnabled: false };
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

async function liveStage(mode, directory) {
  console.log = console.warn = console.error = () => {};
  const stat = fs.lstatSync(directory);
  if (!path.isAbsolute(directory) || !directory.startsWith('/private/tmp/') || fs.realpathSync(directory) !== directory
    || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error('Invalid state directory');
  const lockPath = path.join(directory, 'lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  try {
    const statePath = path.join(directory, 'state.json');
    const state = readPrivateJson(statePath);
    const staff = readPrivateJson('/private/tmp/wmkf-expertise-sandbox-staff-binding-20261111.json');
    const ledger = readPrivateJson('/private/tmp/wmkf-expertise-sandbox-ledger-binding-20261111.json');
    checkLedgerBinding(ledger);
    if (state.version !== 1 || state.candidateDigest !== candidateDigest || state.requestId !== '63dab4af-178f-4bbc-b24d-3ccbaf74cbfc'
      || state.ledgerHostname !== ledger.hostname || state.ledgerDatabase !== ledger.database || state.profileId !== 2 || ['systemUserId','azureId','applicationId'].some(k => state[k] !== staff[k])
      || state.databaseIdentity !== ledger.databaseIdentity || !state.sourceProof || !Number.isInteger(state.providerPosts)
      || state.providerPosts < 0 || state.providerPosts > 1) throw new Error('Trial state mismatch');
    checkCandidate();
    const candidate = JSON.parse(fs.readFileSync(candidatePath));
    const { canonical } = req('./lib/services/prompt-jobs/profile.js');
    const task = candidate.task;
    const row = { wmkf_ai_promptid: state.promptId, wmkf_ai_promptname: task.name, wmkf_ai_systemprompt: task.systemPrompt,
      wmkf_ai_promptbody: task.body, wmkf_ai_promptvariables: task.variables, wmkf_ai_promptoutputschema: task.outputSchema,
      wmkf_ai_model: task.model, wmkf_ai_temperature: task.temperature, wmkf_ai_maxtokens: task.maxTokens, wmkf_promptversion: 1 };
    const save = () => {
      const next = path.join(directory, 'state.next');
      const fd = fs.openSync(next, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(next, statePath);
      const dfd = fs.openSync(directory, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    };
    if (process.env.NODE_OPTIONS || process.env.VERCEL !== undefined || process.env.VERCEL_ENV !== undefined) throw new Error('Unexpected local configuration');
    const dotenv = req('dotenv');
    const sandbox = dotenv.parse(fs.readFileSync('/Users/gallivan/.local/share/wmkf-roster/full-import-20261110/full.env'));
    const app = dotenv.parse(fs.readFileSync('/Users/gallivan/Code/WMKF_Apps/.env.local'));
    for (const key of Object.keys(process.env)) if (/^(DYNAMICS_|DATAVERSE_|SHAREPOINT_|EXPERTISE_RECOMMENDATIONS_|POSTGRES_|CLAUDE_|PROMPT_JOB_)/.test(key)) delete process.env[key];
    for (const key of ['DYNAMICS_URL','DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET']) {
      if (!sandbox[key]) throw new Error('Sandbox configuration missing'); process.env[key] = sandbox[key];
    }
    process.env.SHAREPOINT_SITE_URL = sandbox.SHAREPOINT_SITE_URL || 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';
    if (!app.POSTGRES_URL || !app.CLAUDE_API_KEY) throw new Error('Application configuration missing');
    checkDatabaseUrl(app.POSTGRES_URL, ledger);
    process.env.POSTGRES_URL = app.POSTGRES_URL; process.env.CLAUDE_API_KEY = app.CLAUDE_API_KEY;
    if (process.env.DYNAMICS_URL !== 'https://orgd9e66399.crm.dynamics.com' || process.env.DYNAMICS_CLIENT_ID !== state.applicationId
      || process.env.SHAREPOINT_SITE_URL !== 'https://appriver3651007194.sharepoint.com/sites/akoyaGO') throw new Error('Sandbox target mismatch');
    Object.assign(process.env, { DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_TARGET_INTERLOCK: 'on', DYNAMICS_IMPERSONATION_ENABLED: 'false',
      NODE_ENV: 'development', PROMPT_JOB_NONCE_SECRET: state.nonceSecret, EXPERTISE_RECOMMENDATIONS_TRIAL: 'on',
      EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS: JSON.stringify({ requestId: state.requestId, profileId: state.profileId,
        systemUserId: state.systemUserId, azureId: state.azureId, applicationId: state.applicationId, scopeId: state.scopeId,
        idempotencyKey: state.idempotencyKey, promptId: state.promptId, promptHash: sha256(canonical(row)), profileHash: candidate.profileHash,
        sourceSiteId: state.sourceProof.siteId, sourceDriveId: state.sourceProof.driveId, sourceHash: state.sourceProof.hash,
        databaseIdentity: state.databaseIdentity }) });
    const originalFetch = globalThis.fetch;
    let allowedAuditRunId = null;
    globalThis.fetch = async (input, options = {}) => {
      const url = fetchUrl(input);
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'POST' && url.origin === 'https://login.microsoftonline.com'
        && url.pathname === `/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`) {
        const body = new URLSearchParams(options.body);
        if (body.get('grant_type') !== 'client_credentials' || body.get('client_id') !== state.applicationId
          || !['https://graph.microsoft.com/.default','https://orgd9e66399.crm.dynamics.com/.default'].includes(body.get('scope'))) throw new Error('Token scope rejected');
        return originalFetch(input, { ...options, redirect: 'manual' });
      }
      if (allowedRead(url, method)) return originalFetch(input, { ...options, redirect: 'manual' });
      let body; try { body = JSON.parse(options.body); } catch { throw new Error('Unexpected network request'); }
      const headers = new Headers(options.headers);
      if (headers.has('MSCRMCallerID') || headers.has('CallerObjectId')) throw new Error('Unexpected impersonation');
      let intent;
      if (mode === 'publish' && method === 'POST' && url.origin === 'https://orgd9e66399.crm.dynamics.com'
        && url.pathname === '/api/data/v9.2/wmkf_appsystemsettings') {
        const value = JSON.parse(body.wmkf_settingvalue);
        if (Object.keys(body).sort().join(',') !== 'wmkf_settingkey,wmkf_settingvalue'
          || body.wmkf_settingkey !== `executor.profiles.${candidate.profile.key}.v000001`
          || Object.keys(value).sort().join(',') !== 'profile,publishedAt,requestId,schemaVersion,sha256'
          || value.schemaVersion !== 1 || canonical(value.profile) !== canonical(candidate.profile)
          || value.sha256 !== candidate.profileHash || value.requestId !== state.profilePublicationId
          || !Number.isFinite(Date.parse(value.publishedAt)) || state.profileWriteIntent) throw new Error('Profile write rejected');
        state.profileWriteIntent = true; intent = 'profile';
      } else if (mode === 'publish' && method === 'POST' && url.origin === 'https://orgd9e66399.crm.dynamics.com'
        && url.pathname === '/api/data/v9.2/wmkf_ai_prompts') {
        if (canonical(body) !== canonical({ ...row, wmkf_ai_iscurrent: true, wmkf_ai_promptstatus: 682090001 })
          || state.promptWriteIntent) throw new Error('Prompt write rejected');
        state.promptWriteIntent = true; intent = 'prompt';
      } else if (providerIntent(url, method, mode, body, state.providerPosts)) {
        state.providerPosts = 1; intent = 'provider';
      } else if (mode === 'tick' && method === 'POST' && url.origin === 'https://orgd9e66399.crm.dynamics.com'
        && url.pathname === '/api/data/v9.2/wmkf_ai_runs') {
        const auditKeys = ['wmkf_ai_runid','wmkf_ai_status','wmkf_ai_runsource','wmkf_ai_model','wmkf_ai_Prompt@odata.bind',
          'wmkf_ai_promptversion','wmkf_ai_Request@odata.bind','wmkf_ai_promptoverridden','wmkf_ai_notes'];
        if (Object.keys(body).length !== auditKeys.length || Object.keys(body).some(key => !auditKeys.includes(key))
          || ![682090000,682090001].includes(body.wmkf_ai_status) || body.wmkf_ai_runsource !== 682090002
          || body.wmkf_ai_model !== task.model || body.wmkf_ai_promptversion !== 1 || body.wmkf_ai_promptoverridden !== false
          || typeof body.wmkf_ai_notes !== 'string' || !/^profiled=true; outcome=(completed|failed); code=(none|profile_inputs_changed_after_dispatch|profile_checkpoint_mismatch|profile_response_too_large|profile_response_model_mismatch|profile_execution_failed|claude_output_refused|claude_output_truncated|claude_context_window_exceeded|claude_output_incomplete|claude_output_empty|claude_output_invalid_json|claude_output_missing_field|claude_output_schema_invalid|profile_output_invalid); stopReason=(end_turn|refusal|max_tokens|model_context_window_exceeded|unknown)$/.test(body.wmkf_ai_notes)
          || !allowedAuditRunId || body.wmkf_ai_runid !== allowedAuditRunId || body['wmkf_ai_Request@odata.bind'] !== `/akoya_requests(${state.requestId})`
          || body['wmkf_ai_Prompt@odata.bind'] !== `/wmkf_ai_prompts(${state.promptId})` || body.wmkf_ai_rawoutput != null
          || body.wmkf_ai_promptoverride != null) throw new Error('Audit scope rejected');
        reserveAuditIntent(state, allowedAuditRunId);
        allowedAuditRunId = null; intent = 'audit';
      } else throw new Error('Network write rejected');
      state.lastWriteIntent = intent; save();
      return originalFetch(input, { ...options, redirect: 'manual' });
    };
    const { withDalContext } = req('./lib/dataverse/core/context.js');
    const { createPromptJobStore } = req('./lib/services/prompt-jobs/store.js');
    const { db } = req('@vercel/postgres');
    const store = createPromptJobStore(db);
    const policy = req('./lib/services/prompt-jobs/recommendations-sandbox-policy.js').readRecommendationsTrialPolicy();
    if (!policy) throw new Error('Trial policy rejected');
    await store.verifySandboxRecommendationDatabase();
    const owner = { environment: policy.environment, principalKey: policy.principalKey, authorizationScope: policy.authorizationScope, requestId: policy.requestId };
    const actor = { profileId: state.profileId, systemUserId: state.systemUserId, azureId: state.azureId };
    const { verifyRecommendationsStaffActor } = req('./lib/services/prompt-jobs/staff-recommendations-service.js');
    if (['publish','preflight','admit','inspect'].includes(mode) && !await withDalContext('sandbox-trial-readiness', () => verifyRecommendationsStaffActor(actor, () => true))) throw new Error('Staff authorization failed');
    return await withDalContext('sandbox-trial-operator', async () => {
      const trial = req('./lib/services/prompt-jobs/sandbox-recommendations-trial.js');
      if (mode === 'publish') {
        const { createRecommendationsProposalSource } = req('./lib/services/prompt-jobs/proposal-source.js');
        const { SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, sandboxRecommendationSourceProof } = req('./lib/services/prompt-jobs/context.js');
        const observed = await createRecommendationsProposalSource().observe({ requestId: state.requestId,
          version: SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, siteId: state.sourceProof.siteId, driveId: state.sourceProof.driveId });
        if (observed.requestId !== state.requestId || observed.complete !== true || observed.targetHost !== 'orgd9e66399.crm.dynamics.com'
          || sandboxRecommendationSourceProof(observed.targetHost, ['proposal'], observed.documents).hash !== state.sourceProof.hash) throw new Error('Source changed');
        const profiles = req('./lib/services/admin/prompt-profiles-service.js');
        const aiPrompt = req('./lib/dataverse/adapters/ai-prompt.js');
        const before = await profiles.getPromptProfiles();
        const found = before.profiles.filter(x => x.profile.key === candidate.profile.key);
        if (!found.length) {
          if (state.profileWriteIntent) throw new Error('Profile publication needs reconciliation');
          await profiles.publishPromptProfile({ profile: candidate.profile, expectedVersion: 0, requestId: state.profilePublicationId });
        } else if (found.length !== 1 || found[0].sha256 !== candidate.profileHash || found[0].requestId !== state.profilePublicationId
          || canonical(found[0].profile) !== canonical(candidate.profile)) throw new Error('Profile conflict');
        const verifiedProfiles = (await profiles.getPromptProfiles()).profiles.filter(x => x.profile.key === candidate.profile.key);
        if (verifiedProfiles.length !== 1 || verifiedProfiles[0].sha256 !== candidate.profileHash
          || verifiedProfiles[0].requestId !== state.profilePublicationId
          || canonical(verifiedProfiles[0].profile) !== canonical(candidate.profile)) throw new Error('Profile readback mismatch');
        const versions = (await aiPrompt.listVersions(task.name)).records || [];
        if (!versions.length) {
          if (state.promptWriteIntent) throw new Error('Prompt publication needs reconciliation');
          await aiPrompt.create({ ...row, wmkf_ai_iscurrent: true, wmkf_ai_promptstatus: 682090001 });
        } else if (versions.length !== 1 || versions[0].wmkf_ai_promptid !== state.promptId) throw new Error('Prompt conflict');
        const actual = await aiPrompt.getExecutorPromptById(state.promptId, 'https://orgd9e66399.crm.dynamics.com');
        if (canonical({ ...actual, wmkf_ai_systemprompt: actual.wmkf_ai_systemprompt ?? '' }) !== canonical(row)
          || ((await aiPrompt.listVersions(task.name)).records || []).length !== 1) throw new Error('Prompt readback mismatch');
        return { stage: 'published' };
      }
      if (mode === 'preflight') return { stage: 'preflight', budget: await trial.preflightSandboxRecommendationTrial() };
      if (mode === 'admit') {
        const result = await trial.admitSandboxRecommendationTrial();
        if (state.jobId && state.jobId !== result.jobId) throw new Error('Job mismatch');
        state.jobId = result.jobId; save(); return { stage: 'admitted', replayed: result.replayed };
      }
      if (!state.jobId) throw new Error('Missing job receipt');
      const views = await store.listJobs({ ...owner, limit: 2 });
      if (views.length !== 1 || views[0].job.id !== state.jobId || views[0].job.idempotency_key !== state.idempotencyKey) throw new Error('Job scope mismatch');
      if (mode === 'tick' || mode === 'recover') {
        const audit = async ({ runId, payload, job }) => {
          const { DynamicsService } = req('./lib/services/dynamics-service.js');
          const users = await DynamicsService.queryRecords('systemusers', { select: 'systemuserid,applicationid,isdisabled',
            filter: `applicationid eq ${state.applicationId}`, top: 2 });
          const appUsers = users.records || [];
          if (appUsers.length !== 1 || appUsers[0].applicationid !== state.applicationId || appUsers[0].isdisabled !== false) throw new Error('Backend actor unavailable');
          const fresh = await store.listJobs({ ...owner, limit: 2 });
          if (job.id !== state.jobId || fresh.length !== 1 || fresh[0].job.id !== state.jobId
            || fresh[0].job.idempotency_key !== state.idempotencyKey
            || fresh[0].attempts.filter(a => a.audit_run_id === runId && a.audit_state === 'dispatching').length !== 1) throw new Error('Audit attempt mismatch');
          allowedAuditRunId = runId;
          const auditAdapter = req('./lib/dataverse/adapters/ai-run.js');
          await auditAdapter.create({ ...payload, wmkf_ai_runid: runId });
          const check = await auditAdapter.getByIdWithSelect(runId, 'wmkf_ai_runid,_wmkf_ai_prompt_value,_wmkf_ai_request_value,_createdby_value,_createdonbehalfby_value,wmkf_ai_rawoutput,wmkf_ai_promptoverride,wmkf_ai_status,wmkf_ai_runsource,wmkf_ai_model,wmkf_ai_promptversion,wmkf_ai_promptoverridden,wmkf_ai_notes');
          if (check.wmkf_ai_runid !== runId || check._wmkf_ai_prompt_value !== state.promptId || check._wmkf_ai_request_value !== state.requestId
            || check._createdby_value !== appUsers[0].systemuserid || check._createdonbehalfby_value != null || check.wmkf_ai_rawoutput != null || check.wmkf_ai_promptoverride != null
            || ['wmkf_ai_status','wmkf_ai_runsource','wmkf_ai_model','wmkf_ai_promptversion','wmkf_ai_promptoverridden','wmkf_ai_notes'].some(key => check[key] !== payload[key])) throw new Error('Audit readback mismatch');
        };
        return await trial.advanceSandboxRecommendationTrial({ recoverResponse: mode === 'recover' }, { audit });
      }
      if (mode === 'inspect') {
        const result = await store.readValidatedSandboxRecommendations({ ...owner, jobId: state.jobId });
        const file = path.join(directory, 'validated-result.json');
        if (result?.results?.some(item => item.status === 'available')) {
          const fd = fs.openSync(file, 'wx', 0o600);
          try { fs.writeFileSync(fd, JSON.stringify(result)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        return { stage: 'inspected', validation: 'stored-contract', currentFreshness: 'not-checked', httpE2e: false, resultAvailable: Boolean(result?.results?.some(item => item.status === 'available')), providerPosts: state.providerPosts,
          taskStates: views[0].tasks.map(x => x.state), auditStates: views[0].attempts.map(x => x.audit_state) };
      }
      if (mode === 'expire') {
        const sourceExpiry = new Date(views[0].job.source_expires_at).getTime();
        if (!Number.isFinite(sourceExpiry) || Date.now() < sourceExpiry) throw new Error('Source not expired');
        delete process.env.EXPERTISE_RECOMMENDATIONS_TRIAL_ACCESS; delete process.env.EXPERTISE_RECOMMENDATIONS_TRIAL;
        const expired = await store.expireSandboxRecommendationContent({ ...owner, jobId: state.jobId, databaseIdentity: state.databaseIdentity });
        return { stage: 'expired', expired };
      }
      throw new Error('Unknown stage');
    });
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

async function main() {
  let result;
  if (process.argv.length === 3 && process.argv[2] === 'offline-check') result = checkCandidate();
  else if (process.argv.length === 3 && process.argv[2] === 'guard-test') result = checkGuards();
  else if (process.argv.length === 4 && process.argv[2] === 'init') result = initialize(process.argv[3]);
  else if (process.argv.length === 4 && process.argv[2] === 'prepare') result = await prepareSource(process.argv[3]);
  else if (process.argv.length === 4 && ['publish','preflight','admit','tick','recover','inspect','expire'].includes(process.argv[2])) result = await liveStage(process.argv[2], process.argv[3]);
  else throw new Error('Invalid trial stage');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
main().catch(() => { process.stderr.write('STOP: trial stage failed\n'); process.exitCode = 1; });

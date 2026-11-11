/** Offline candidate check only. All live stages deliberately fail closed pending review. */
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
  const guid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
  if (binding.profileId !== 2 || !['systemUserId','azureId','applicationId'].every(key => guid.test(binding[key]))
    || !/^[a-f0-9]{64}$/.test(ledger.databaseIdentity)) throw new Error('Private bindings are invalid');
  const receiptPath = '/private/tmp/wmkf-proposal-copy.5w03zboq/copy-receipt.jsonl';
  if (sha256(fs.readFileSync(receiptPath)) !== 'e0930521c06f282a08cb9da3096e97b682e9284d41bc92496582cd568382462c') {
    throw new Error('Copied source receipt changed');
  }
  const state = { version: 1, candidateDigest, requestId: '63dab4af-178f-4bbc-b24d-3ccbaf74cbfc',
    profileId: binding.profileId, systemUserId: binding.systemUserId, azureId: binding.azureId,
    applicationId: binding.applicationId, databaseIdentity: ledger.databaseIdentity,
    scopeId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), promptId: crypto.randomUUID(),
    profilePublicationId: crypto.randomUUID(), nonceSecret: crypto.randomBytes(32).toString('hex'),
    sourceProof: null, providerPosts: 0 };
  const fd = fs.openSync(path.join(directory, 'state.json'), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dirFd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  return { initialized: true, sourceProof: 'pending', liveStages: 'disabled' };
}

// The only network-capable preparatory operation is read-only. It observes the
// current governed source and checks it against the approved copy journal.
async function prepareSource(directory) {
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
    if (fs.existsSync(path.join(root, '.env.local')) || process.env.VERCEL || process.env.VERCEL_ENV) throw new Error('Unexpected local configuration');
    const dotenv = req('dotenv');
    const env = dotenv.parse(fs.readFileSync('/Users/gallivan/.local/share/wmkf-roster/full-import-20261110/full.env'));
    for (const key of Object.keys(process.env)) if (/^(DYNAMICS_|DATAVERSE_|SHAREPOINT_|EXPERTISE_RECOMMENDATIONS_)/.test(key)) delete process.env[key];
    for (const key of ['DYNAMICS_URL','DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','SHAREPOINT_SITE_URL']) {
      if (!env[key]) throw new Error('Required Sandbox configuration missing');
      process.env[key] = env[key];
    }
    if (process.env.DYNAMICS_URL !== 'https://orgd9e66399.crm.dynamics.com' || process.env.DYNAMICS_CLIENT_ID !== state.applicationId
      || process.env.SHAREPOINT_SITE_URL !== 'https://appriver3651007194.sharepoint.com/sites/akoyaGO') throw new Error('Sandbox target mismatch');
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'on'; process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false'; process.env.NODE_ENV = 'development';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (options.method || 'GET').toUpperCase();
      const token = method === 'POST' && url.origin === 'https://login.microsoftonline.com'
        && url.pathname === `/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
      if (token) {
        const body = new URLSearchParams(options.body);
        if (body.get('grant_type') !== 'client_credentials' || body.get('client_id') !== state.applicationId
          || !['https://graph.microsoft.com/.default','https://orgd9e66399.crm.dynamics.com/.default'].includes(body.get('scope'))) throw new Error('Unexpected token scope');
      } else if (!['GET','HEAD'].includes(method) || !['https://graph.microsoft.com','https://orgd9e66399.crm.dynamics.com',
        'https://appriver3651007194.sharepoint.com'].includes(url.origin)) throw new Error('Read-only network guard blocked request');
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
    if (observation.documents?.length !== 1 || doc.id !== sha256(canonical(identity)) || doc.sha256 !== intent.sha256
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

async function main() {
  let result;
  if (process.argv.length === 3 && process.argv[2] === 'offline-check') result = checkCandidate();
  else if (process.argv.length === 4 && process.argv[2] === 'init') result = initialize(process.argv[3]);
  else if (process.argv.length === 4 && process.argv[2] === 'prepare') result = await prepareSource(process.argv[3]);
  else throw new Error('Only offline-check, private init and read-only prepare are implemented; publication and execution are disabled');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
main().catch(() => { process.stderr.write('STOP: trial stage failed\n'); process.exitCode = 1; });

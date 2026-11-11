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

try {
  let result;
  if (process.argv.length === 3 && process.argv[2] === 'offline-check') result = checkCandidate();
  else if (process.argv.length === 4 && process.argv[2] === 'init') result = initialize(process.argv[3]);
  else throw new Error('Only offline-check and private init are implemented; all live stages are disabled');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`STOP: ${error.message}\n`);
  process.exitCode = 1;
}

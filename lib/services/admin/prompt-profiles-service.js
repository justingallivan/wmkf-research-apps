/**
 * Superuser shared-document profile publication and sample-only task preview.
 * Immutable Dataverse settings revisions are resolved by exact key/revision/hash;
 * malformed or duplicate storage fails closed. Callers establish trusted DAL.
 * No model execution, document retrieval, Request writes, or latest-pin fallback.
 */
import { randomBytes } from 'crypto';
import { createSettingStrict, listSettingsWithMetaStrict } from '../settings-service';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid';
import { validatePromptTemplatePair } from '../../utils/prompt-validators';
import { canonical, exact, hashProfile, parseExecutionSpec, sha256, validateProfile, PROFILE_LIMITS } from '../prompt-jobs/profile';
import { composeProfileTask, prepareContextSnapshot } from '../prompt-jobs/context';
import { SYNTHETIC_MAX_OUTPUT_TOKENS, validateSyntheticTask, getSyntheticTaskCapabilities } from '../prompt-jobs/capabilities';

const PREFIX = 'executor.profiles.';
const MAX_REVISION = 999999;
const dependencies = { createSettingStrict, listSettingsWithMetaStrict, now: () => new Date() };
function fail(message, code = 'invalid_shared_task', httpStatus = 400) {
  return new ServiceHttpError(message, { httpStatus, code, body: { status: code, code, error: message } });
}
function keyFor(profile) { return `${PREFIX}${profile.key}.v${String(profile.revision).padStart(6, '0')}`; }
function checkedProfile(profile) {
  try { validateProfile(profile); } catch (error) { throw fail(error.message, 'invalid_profile'); }
  if (profile.revision > MAX_REVISION) throw fail('Profile revision space is exhausted.', 'invalid_profile');
  return profile;
}
async function publications(deps) {
  const settings = await deps.listSettingsWithMetaStrict(PREFIX, { rejectDuplicates: true });
  const rows = [];
  for (const [key, meta] of Object.entries(settings)) {
    try {
      const row = JSON.parse(meta.value);
      exact(row, ['schemaVersion', 'profile', 'sha256', 'requestId', 'publishedAt'], 'profile publication');
      checkedProfile(row.profile);
      if (row.schemaVersion !== 1 || keyFor(row.profile) !== key || hashProfile(row.profile) !== row.sha256
          || !isGuid(row.requestId) || typeof row.publishedAt !== 'string' || !Number.isFinite(Date.parse(row.publishedAt))) throw new Error('invalid envelope');
      rows.push(row);
    } catch { throw fail('Stored profile revisions are invalid. Resolve storage before publishing.', 'profile_storage_invalid', 409); }
  }
  return rows.sort((a, b) => a.profile.key.localeCompare(b.profile.key) || a.profile.revision - b.profile.revision);
}
export async function getPromptProfiles(deps = dependencies) {
  return { profiles: await publications(deps), tasks: getSyntheticTaskCapabilities(), maxOutputTokens: SYNTHETIC_MAX_OUTPUT_TOKENS, profileLimits: PROFILE_LIMITS };
}
function findReplay(rows, requestId, profile) {
  const found = rows.filter(row => row.requestId.toLowerCase() === requestId);
  if (!found.length) return null;
  if (found.length !== 1 || canonical(found[0].profile) !== canonical(profile)) throw fail('This request ID was used for a different profile publication.', 'idempotency_key_reuse', 409);
  return found[0];
}
export async function publishPromptProfile({ profile, expectedVersion, requestId, profileId = null }, deps = dependencies) {
  checkedProfile(profile);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || profile.revision !== expectedVersion + 1) throw fail('The new revision must follow expectedVersion.', 'invalid_expected_version');
  if (!isGuid(requestId)) throw fail('A UUID requestId is required.', 'invalid_request_id');
  const id = requestId.toLowerCase();
  const before = await publications(deps);
  const replay = findReplay(before, id, profile);
  if (replay) return { status: 'already_published', publication: replay };
  const latest = Math.max(0, ...before.filter(row => row.profile.key === profile.key).map(row => row.profile.revision));
  if (latest !== expectedVersion) throw fail('This profile changed. Reload its revisions before publishing.', 'version_conflict', 409);
  const publication = { schemaVersion: 1, profile, sha256: hashProfile(profile), requestId: id, publishedAt: deps.now().toISOString() };
  const serialized = canonical(publication);
  if (serialized.length > 100000 || Buffer.byteLength(serialized) > 100000) throw fail('Encoded profile exceeds the settings storage limit.', 'invalid_profile');
  try { await deps.createSettingStrict(keyFor(profile), serialized, profileId); }
  catch (error) {
    // A lost reply may already have committed. Exact readback is the only success proof.
    const after = await publications(deps);
    const committed = findReplay(after, id, profile);
    if (committed) return { status: 'already_published', publication: committed };
    if (error.code === 'setting_exists' || [409, 412].includes(error.status)) throw fail('Another publication won this revision. Reload before publishing.', 'version_conflict', 409);
    throw error;
  }
  const after = await publications(deps);
  const verified = findReplay(after, id, profile);
  if (!verified) throw fail('Publication could not be verified. Retry the same request.', 'profile_verification_failed', 503);
  return { status: 'completed', publication: verified };
}
async function resolveProfile(reference, deps) {
  const matches = (await publications(deps)).filter(row => row.profile.key === reference.key && row.profile.revision === reference.revision);
  if (matches.length !== 1 || matches[0].sha256 !== reference.sha256) throw fail('The pinned profile is missing or has changed. Select a verified published revision.', 'profile_pin_mismatch', 409);
  return matches[0].profile;
}
function taskRow(task) {
  return {
    wmkf_ai_promptname: task.name, wmkf_ai_promptbody: task.body,
    wmkf_ai_systemprompt: task.systemPrompt, wmkf_ai_promptvariables: task.variables,
    wmkf_ai_promptoutputschema: task.outputSchema, wmkf_ai_model: task.model,
    wmkf_ai_maxtokens: task.maxTokens, wmkf_ai_temperature: 0,
  };
}
/** Validate exactly what the frozen Executor consumes, without executing it. */
export async function previewSharedTask({ task }, deps = dependencies) {
  let spec;
  const row = taskRow(task || {});
  try {
    spec = parseExecutionSpec(row);
    if (!spec) throw new Error('A shared-document execution contract is required.');
    exact(spec.outputSchema, ['parseMode', 'outputs'], 'output schema');
    spec.outputSchema.outputs.forEach(output => exact(output, ['name', 'target', 'maxWords', 'maxChars'], 'output'));
    validateSyntheticTask(row, { environment: 'test' });
    const textValidation = validatePromptTemplatePair(task.name, { systemPrompt: task.systemPrompt, body: task.body, declaredVars: spec.variables.filter(d => d.source.kind === 'frozen_record').map(d => d.name) });
    if (!textValidation.valid) throw new Error(textValidation.issues.join(' '));
    if (!Number.isInteger(task.maxTokens) || task.maxTokens < 1 || task.maxTokens > SYNTHETIC_MAX_OUTPUT_TOKENS) throw new Error(`Output budget must be 1..${SYNTHETIC_MAX_OUTPUT_TOKENS} tokens.`);
  } catch (error) { throw fail(error.message); }
  const profile = await resolveProfile(spec.profile, deps);
  const scope = { environment: 'test', authorizationScope: 'admin-fabricated-preview', requestId: '00000000-0000-4000-8000-000000000001' };
  const nonceSecret = randomBytes(32).toString('hex');
  const documents = profile.documentRoles.map(role => ({ role, id: `sample-${role}`, version: 'sample-v1', sha256: sha256(`sample-${role}`), text: `Fabricated ${role} document for Admin preview. No applicant material is loaded.`, extractionVersion: 'sample-v1' }));
  const records = profile.recordNames.map(name => ({ name, present: true, value: `Sample ${name}`, provenance: 'fabricated Admin preview' }));
  try {
    const snapshot = prepareContextSnapshot({ scope, profile, documents, records, nonceSecret });
    const composed = composeProfileTask({ promptRow: row, scope, profile, snapshot, nonceSecret });
    return { sampleOnly: true, preview: { system: composed.system, documentBlock: composed.userContent[0].text, taskSuffix: composed.userContent[1].text, prefixHash: composed.prefixHash } };
  } catch (error) { throw fail(error.message); }
}
/** Gate both new and changed profile tasks; ordinary legacy publications pass unchanged. */
export async function validateSharedTaskPublication({ name, payload, priorRow, expectedVersion, requestId, creating = false }, deps = dependencies) {
  let priorSpec; let spec;
  try {
    priorSpec = priorRow ? parseExecutionSpec(priorRow) : null;
    spec = parseExecutionSpec(taskRow({ name, ...payload }));
  } catch (error) { throw fail(error.message); }
  if (!spec && !priorSpec) {
    if (getSyntheticTaskCapabilities().some(task => task.name === name)) throw fail('Reserved shared-task names require the shared-document execution contract.');
    return false;
  }
  if (!spec || (priorRow && !priorSpec)) throw fail('Existing prompt execution modes cannot be converted. Create a new registered task name.');
  if (!isGuid(requestId) || (!creating && (!Number.isInteger(expectedVersion) || expectedVersion < 1))) throw fail('Shared tasks require a UUID requestId and the loaded version.', 'invalid_input');
  await previewSharedTask({ task: { name, ...payload } }, deps);
  if (payload.temperature == null) payload.temperature = 0;
  if (!Number.isFinite(payload.temperature) || payload.temperature < 0 || payload.temperature > 1) throw fail('Shared tasks require a temperature from 0 through 1.');
  return true;
}

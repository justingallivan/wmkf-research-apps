/** Server-side pure preparation: caller must authorize all source data independently. */
import crypto from 'crypto';
import { wrapUntrustedContent, buildUntrustedContentPreamble } from '../../utils/ai-payload-boundary.js';
import { isGuid } from '../../utils/guid.js';
import { rosterMatchSchema } from '../expertise-finder/roster-match-validation.js';
import { rebuildRecommendationsRosterBlock } from '../expertise-finder/recommendations-contract.js';
import { RECOMMENDATIONS_SANDBOX_HOST } from './recommendations-sandbox-policy.js';
import { EXPERTISE_RESULT_CONTRACT, EXPERTISE_TASK_KEY, getTaskCapability, isExpertiseFixtureScope, isExpertiseSandboxContextScope } from './capabilities.js';
import { canonical, exact, hashProfile, MAX_PROFILE_SNAPSHOT_BYTES, parseExecutionSpec, sha256, validName } from './profile.js';

const HASH = /^[a-f0-9]{64}$/;
export const RECOMMENDATIONS_SOURCE_PROOF_VERSION = 'fixture-documents-v1';
export const SANDBOX_RECOMMENDATIONS_SOURCE_VERSION = 'ai-materials-combined-pdf-v1';
const ROSTER_OUTPUT_CONTRACT = JSON.stringify({ resultContract: EXPERTISE_RESULT_CONTRACT, modelOutput: rosterMatchSchema });
function secret(value) { if (typeof value !== 'string' || Buffer.byteLength(value) < 32) throw new Error('nonce secret must contain at least 32 bytes'); }
function text(value, label, max = 1024) { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) throw new Error(`${label}: invalid text`); }
function validateScope(scope) {
  exact(scope, ['environment','authorizationScope','requestId'], 'scope');
  text(scope.environment, 'environment', 128); text(scope.authorizationScope, 'authorizationScope', 1024);
  if (!isGuid(scope.requestId)) throw new Error('scope: invalid requestId');
}
function digest(secretValue, label, value) { return crypto.createHmac('sha256', secretValue).update(label).update('\0').update(canonical(value)).digest('hex'); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function clone(value) { return JSON.parse(canonical(value)); }
function snapshotTooLarge() {
  const error = new Error('Profiled snapshot exceeds its byte limit');
  error.code = 'snapshot_too_large';
  throw error;
}
function validateInputs(profile, documents, records) {
  if (!Array.isArray(documents) || documents.length !== profile.documentRoles.length || documents.length > profile.limits.maxDocuments) throw new Error('documents: invalid count');
  let total = 0; const roles = new Set();
  for (const d of documents) {
    exact(d, ['role','id','version','sha256','text','extractionVersion','components'], 'document');
    if (!profile.documentRoles.includes(d.role) || roles.has(d.role)) throw new Error('document: missing or duplicate role');
    roles.add(d.role); text(d.id, 'document id'); text(d.version, 'document version'); text(d.extractionVersion, 'extraction version');
    if (!HASH.test(d.sha256 || '') || (typeof d.text !== 'string' || !d.text.trim())) throw new Error('document: invalid hash or text');
    const size = Buffer.byteLength(d.text); total += size;
    if (size > profile.limits.maxDocumentBytes) snapshotTooLarge();
    if (d.components !== undefined) {
      if (!Array.isArray(d.components) || !d.components.length || d.components.length > 32) throw new Error('document: invalid components');
      for (const c of d.components) { exact(c, ['id','version','sha256'], 'component'); text(c.id, 'component id'); text(c.version, 'component version'); if (!HASH.test(c.sha256 || '')) throw new Error('component: invalid hash'); }
    }
  }
  if (total > profile.limits.maxTotalDocumentBytes) snapshotTooLarge();
  if (!Array.isArray(records) || records.length !== profile.recordNames.length) throw new Error('records: invalid count');
  const names = new Set();
  for (const r of records) {
    exact(r, ['name','present','value','provenance'], 'record');
    if (!profile.recordNames.includes(r.name) || names.has(r.name) || typeof r.present !== 'boolean' || (r.present ? typeof r.value !== 'string' : r.value !== null)) throw new Error('record: invalid entry');
    names.add(r.name); text(r.provenance, 'record provenance');
    if (Buffer.byteLength(canonical(r)) > profile.limits.maxRecordBytes) snapshotTooLarge();
  }
}
function sourceHash(value) { return typeof value === 'string' && value.length === 64 && HASH.test(value); }

export function isRecommendationSourceProof(proof) {
  try { exact(proof, ['version','hash'], 'recommendations source proof'); }
  catch { return false; }
  return proof.version === RECOMMENDATIONS_SOURCE_PROOF_VERSION && sourceHash(proof.hash);
}

/** Fixture identity only. The full snapshot seal separately protects document text. */
export function recommendationSourceProof(documentRoles, documents) {
  if (!Array.isArray(documentRoles) || !documentRoles.length || documentRoles.length > 16
    || documentRoles.some(role => !validName(role)) || new Set(documentRoles).size !== documentRoles.length
    || !Array.isArray(documents) || documents.length !== documentRoles.length) throw new Error('invalid recommendation source projection');
  const byRole = new Map();
  for (const d of documents) {
    exact(d, ['role','id','version','sha256','extractionVersion','components'], 'recommendation source document');
    if (!documentRoles.includes(d.role) || byRole.has(d.role) || !sourceHash(d.sha256)) throw new Error('invalid recommendation source identity');
    text(d.id, 'source id'); text(d.version, 'source version'); text(d.extractionVersion, 'source extraction version');
    if (d.components !== undefined) {
      if (!Array.isArray(d.components) || !d.components.length || d.components.length > 32) throw new Error('invalid recommendation source components');
      for (const part of d.components) {
        exact(part, ['id','version','sha256'], 'recommendation source component');
        text(part.id, 'source component id'); text(part.version, 'source component version');
        if (!sourceHash(part.sha256)) throw new Error('invalid recommendation source component hash');
      }
    }
    byRole.set(d.role, d);
  }
  const ordered = documentRoles.map(role => byRole.get(role));
  return { version: RECOMMENDATIONS_SOURCE_PROOF_VERSION, hash: sha256(canonical(ordered)) };
}

export function recommendationSnapshotSourceProof(documentRoles, documents, targetHost) {
  const metadata = documents.map(({role,id,version,sha256,extractionVersion,components}) => ({
    role,id,version,sha256,extractionVersion,...(components === undefined ? {} : {components}),
  }));
  return targetHost ? sandboxRecommendationSourceProof(targetHost, documentRoles, metadata) : recommendationSourceProof(documentRoles, metadata);
}

/** Versioned proof of the single same-target Sandbox proposal source. */
export function isSandboxRecommendationSourceProof(proof) {
  try { exact(proof, ['version', 'targetHost', 'hash'], 'sandbox recommendations source proof'); }
  catch { return false; }
  return proof.version === SANDBOX_RECOMMENDATIONS_SOURCE_VERSION
    && proof.targetHost === RECOMMENDATIONS_SANDBOX_HOST && sourceHash(proof.hash);
}

export function sandboxRecommendationSourceProof(targetHost, documentRoles, documents) {
  if (targetHost !== RECOMMENDATIONS_SANDBOX_HOST || documentRoles.length !== 1 || documentRoles[0] !== 'proposal') {
    throw new Error('invalid sandbox recommendation source');
  }
  const { hash: documentsHash } = recommendationSourceProof(documentRoles, documents);
  return { version: SANDBOX_RECOMMENDATIONS_SOURCE_VERSION, targetHost, hash: sha256(canonical({ targetHost, documentsHash })) };
}

function wrap(value, nonce, label) {
  return wrapUntrustedContent({text: value, source:'prompt-jobs.context', dataClass:'proposal_text', maxChars:Math.max(1, value.length), nonce, label}).text;
}
function checkRosterRecord(scope, records, rosterSnapshot) {
  const trialSnapshot = scope.environment === 'local-sandbox' && isExpertiseSandboxContextScope(scope);
  if ((!isExpertiseFixtureScope(scope) && !trialSnapshot) || records.length !== 1 || records[0].name !== 'roster_block' || !records[0].present) {
    throw Object.assign(new Error('snapshot: roster context requires an expertise scope and record'), {code:'expertise_roster_snapshot_invalid'});
  }
  const rosterBlock = rebuildRecommendationsRosterBlock(rosterSnapshot);
  if (records[0].value !== rosterBlock || records[0].provenance !== `${rosterSnapshot.contractVersion}:${rosterSnapshot.manifest.rosterHash}`) {
    throw Object.assign(new Error('snapshot: visible roster differs from private roster'), {code:'expertise_roster_snapshot_invalid'});
  }
}
export function prepareContextSnapshot({scope, profile, documents, records, nonceSecret, rosterSnapshot}) {
  secret(nonceSecret); validateScope(scope); const profileHash = hashProfile(profile); validateInputs(profile, documents, records);
  const version = rosterSnapshot === undefined ? 1 : 2;
  if (version === 2) checkRosterRecord(scope, records, rosterSnapshot);
  const orderedDocuments = profile.documentRoles.map(role => clone(documents.find(d => d.role === role)));
  const orderedRecords = profile.recordNames.map(name => clone(records.find(r => r.name === name)));
  const documentHash = sha256(canonical(orderedDocuments.map(d => ({...d, textHash:sha256(d.text)}))));
  const nonce = digest(nonceSecret, 'document-nonce-v1', {scope,documentHash,wrapperVersion:profile.wrapperVersion}).slice(0,24);
  const protectedDocumentBlock = wrap(canonical(orderedDocuments), nonce, 'documents');
  const snapshot = {version, scope:clone(scope), profileHash, documents:orderedDocuments, records:orderedRecords, documentHash, protectedDocumentBlock,
    ...(version === 2 ? {rosterSnapshot:clone(rosterSnapshot)} : {})};
  const sealed = {...snapshot, integrity:digest(nonceSecret, `snapshot-integrity-v${version}`, snapshot)};
  if (Buffer.byteLength(canonical(sealed)) > MAX_PROFILE_SNAPSHOT_BYTES) snapshotTooLarge();
  return freeze(sealed);
}
export function verifyContextSnapshot({scope, profile, snapshot, nonceSecret}) {
  secret(nonceSecret); validateScope(scope);
  const typed = snapshot?.version === 2;
  exact(snapshot, ['version','scope','profileHash','documents','records','documentHash','protectedDocumentBlock','integrity', ...(typed ? ['rosterSnapshot'] : [])], 'snapshot');
  if ((!typed && snapshot.version !== 1) || !HASH.test(snapshot.integrity || '') || canonical(scope) !== canonical(snapshot.scope) || snapshot.profileHash !== hashProfile(profile)) throw new Error('snapshot: scope or profile mismatch');
  const expected = prepareContextSnapshot({scope,profile,documents:snapshot.documents,records:snapshot.records,nonceSecret,rosterSnapshot:snapshot.rosterSnapshot});
  if (canonical(snapshot) !== canonical(expected)) throw new Error('snapshot: integrity mismatch');
  return freeze(clone(expected));
}
export function composeProfileTask({promptRow, profile, snapshot, scope, nonceSecret}) {
  const spec = parseExecutionSpec(promptRow);
  if (!spec || spec.profile.key !== profile.key || spec.profile.revision !== profile.revision || spec.profile.sha256 !== hashProfile(profile)) throw new Error('execution: profile mismatch');
  const checked = verifyContextSnapshot({scope,profile,snapshot,nonceSecret});
  const typed = spec.contractVersion === 2;
  const capability = getTaskCapability(promptRow.wmkf_ai_promptname);
  if (checked.version !== (typed ? 2 : 1) || (typed && (promptRow.wmkf_ai_promptname !== EXPERTISE_TASK_KEY
    || spec.resultContract !== capability.resultContract || spec.compilerVersion !== capability.compilerVersion))) {
    throw new Error('execution: snapshot version does not match task contract');
  }
  const declarations = spec.variables.filter(d => d.source.kind === 'frozen_record');
  for (const d of declarations) {
    const record = checked.records.find(r => r.name === d.name);
    if (!record || (d.required && !record.present)) throw new Error(`execution: missing record ${d.name}`);
  }
  const recordData = declarations.map(d => checked.records.find(r => r.name === d.name));
  const recordNonce = digest(nonceSecret, 'record-nonce-v1', {scope, records:recordData, wrapperVersion:profile.wrapperVersion}).slice(0,24);
  const placeholders = [...promptRow.wmkf_ai_promptbody.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1].trim());
  if (/\{\{|\}\}/.test(promptRow.wmkf_ai_promptbody.replace(/\{\{[^{}]+\}\}/g, '')) || placeholders.some(name => !validName(name) || !declarations.some(d => d.name === name))) throw new Error('execution: undeclared placeholder');
  if (declarations.some(d => !placeholders.includes(d.name))) throw new Error('execution: declared record placeholder missing');
  if (typed && (placeholders.length !== 1 || placeholders[0] !== 'roster_block')) throw new Error('execution: roster block must occur exactly once');
  const body = promptRow.wmkf_ai_promptbody.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
    const r = recordData.find(item => item.name === name.trim());
    return typed ? wrap(r.value, recordNonce, 'roster_block') : wrap(canonical(r), recordNonce, 'structured record');
  });
  const system = `${buildUntrustedContentPreamble([], {trustedTaskSuffix:true})}\n\n${profile.sharedInstructions}\n\nStructured record values are authoritative over document inference. A missing record is explicitly missing; do not infer its value from documents.`;
  const protectedRecords = typed ? '' : `${wrap(canonical(recordData), recordNonce, 'structured records')}\n\n`;
  const outputContract = typed ? ROSTER_OUTPUT_CONTRACT : canonical(spec.outputSchema);
  const suffix = `${protectedRecords}TASK INSTRUCTIONS:\n${body}\n\nOUTPUT CONTRACT:\n${outputContract}`;
  const rosterContext = typed ? {snapshot:checked.rosterSnapshot,rosterBlock:recordData[0].value} : null;
  return {system, body, userContent:[{type:'text',text:checked.protectedDocumentBlock,cache_control:{type:'ephemeral'}},{type:'text',text:suffix}],
    prefixHash:sha256(canonical({system,document:checked.protectedDocumentBlock})), ...(rosterContext ? {rosterContext} : {})};
}

/** Server-side pure preparation: caller must authorize all source data independently. */
import crypto from 'crypto';
import { wrapUntrustedContent, buildUntrustedContentPreamble } from '../../utils/ai-payload-boundary.js';
import { isGuid } from '../../utils/guid.js';
import { canonical, exact, hashProfile, parseExecutionSpec, sha256, validName } from './profile.js';

const HASH = /^[a-f0-9]{64}$/;
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
function validateInputs(profile, documents, records) {
  if (!Array.isArray(documents) || documents.length !== profile.documentRoles.length || documents.length > profile.limits.maxDocuments) throw new Error('documents: invalid count');
  let total = 0; const roles = new Set();
  for (const d of documents) {
    exact(d, ['role','id','version','sha256','text','extractionVersion','components'], 'document');
    if (!profile.documentRoles.includes(d.role) || roles.has(d.role)) throw new Error('document: missing or duplicate role');
    roles.add(d.role); text(d.id, 'document id'); text(d.version, 'document version'); text(d.extractionVersion, 'extraction version');
    if (!HASH.test(d.sha256 || '') || (typeof d.text !== 'string' || !d.text.trim())) throw new Error('document: invalid hash or text');
    const size = Buffer.byteLength(d.text); total += size;
    if (size > profile.limits.maxDocumentBytes) throw new Error('document: oversize');
    if (d.components !== undefined) {
      if (!Array.isArray(d.components) || !d.components.length || d.components.length > 32) throw new Error('document: invalid components');
      for (const c of d.components) { exact(c, ['id','version','sha256'], 'component'); text(c.id, 'component id'); text(c.version, 'component version'); if (!HASH.test(c.sha256 || '')) throw new Error('component: invalid hash'); }
    }
  }
  if (total > profile.limits.maxTotalDocumentBytes) throw new Error('documents: oversize');
  if (!Array.isArray(records) || records.length !== profile.recordNames.length) throw new Error('records: invalid count');
  const names = new Set();
  for (const r of records) {
    exact(r, ['name','present','value','provenance'], 'record');
    if (!profile.recordNames.includes(r.name) || names.has(r.name) || typeof r.present !== 'boolean' || (r.present ? typeof r.value !== 'string' : r.value !== null)) throw new Error('record: invalid entry');
    names.add(r.name); text(r.provenance, 'record provenance');
    if (Buffer.byteLength(canonical(r)) > profile.limits.maxRecordBytes) throw new Error('record: oversize');
  }
}
function wrap(value, nonce, label) {
  return wrapUntrustedContent({text: value, source:'prompt-jobs.context', dataClass:'proposal_text', maxChars:Math.max(1, value.length), nonce, label}).text;
}
export function prepareContextSnapshot({scope, profile, documents, records, nonceSecret}) {
  secret(nonceSecret); validateScope(scope); const profileHash = hashProfile(profile); validateInputs(profile, documents, records);
  const orderedDocuments = profile.documentRoles.map(role => clone(documents.find(d => d.role === role)));
  const orderedRecords = profile.recordNames.map(name => clone(records.find(r => r.name === name)));
  const documentHash = sha256(canonical(orderedDocuments.map(d => ({...d, textHash:sha256(d.text)}))));
  const nonce = digest(nonceSecret, 'document-nonce-v1', {scope,documentHash,wrapperVersion:profile.wrapperVersion}).slice(0,24);
  const protectedDocumentBlock = wrap(canonical(orderedDocuments), nonce, 'documents');
  const snapshot = {version:1, scope:clone(scope), profileHash, documents:orderedDocuments, records:orderedRecords, documentHash, protectedDocumentBlock};
  return freeze({...snapshot, integrity:digest(nonceSecret, 'snapshot-integrity-v1', snapshot)});
}
export function verifyContextSnapshot({scope, profile, snapshot, nonceSecret}) {
  secret(nonceSecret); validateScope(scope);
  exact(snapshot, ['version','scope','profileHash','documents','records','documentHash','protectedDocumentBlock','integrity'], 'snapshot');
  if (snapshot.version !== 1 || !HASH.test(snapshot.integrity || '') || canonical(scope) !== canonical(snapshot.scope) || snapshot.profileHash !== hashProfile(profile)) throw new Error('snapshot: scope or profile mismatch');
  const expected = prepareContextSnapshot({scope,profile,documents:snapshot.documents,records:snapshot.records,nonceSecret});
  if (canonical(snapshot) !== canonical(expected)) throw new Error('snapshot: integrity mismatch');
  return freeze(clone(expected));
}
export function composeProfileTask({promptRow, profile, snapshot, scope, nonceSecret}) {
  const spec = parseExecutionSpec(promptRow);
  if (!spec || spec.profile.key !== profile.key || spec.profile.revision !== profile.revision || spec.profile.sha256 !== hashProfile(profile)) throw new Error('execution: profile mismatch');
  const checked = verifyContextSnapshot({scope,profile,snapshot,nonceSecret});
  const declarations = spec.variables.filter(d => d.source.kind === 'frozen_record');
  for (const d of declarations) {
    const record = checked.records.find(r => r.name === d.name);
    if (!record || (d.required && !record.present)) throw new Error(`execution: missing record ${d.name}`);
  }
  const recordData = declarations.map(d => checked.records.find(r => r.name === d.name));
  const recordNonce = digest(nonceSecret, 'record-nonce-v1', {scope, records:recordData, wrapperVersion:profile.wrapperVersion}).slice(0,24);
  const protectedRecords = wrap(canonical(recordData), recordNonce, 'structured records');
  const placeholders = [...promptRow.wmkf_ai_promptbody.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1].trim());
  if (/\{\{|\}\}/.test(promptRow.wmkf_ai_promptbody.replace(/\{\{[^{}]+\}\}/g, '')) || placeholders.some(name => !validName(name) || !declarations.some(d => d.name === name))) throw new Error('execution: undeclared placeholder');
  if (declarations.some(d => !placeholders.includes(d.name))) throw new Error('execution: declared record placeholder missing');
  const body = promptRow.wmkf_ai_promptbody.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
    const r = recordData.find(item => item.name === name.trim());
    return wrap(canonical(r), recordNonce, 'structured record');
  });
  const system = `${buildUntrustedContentPreamble([], {trustedTaskSuffix:true})}\n\n${profile.sharedInstructions}\n\nStructured record values are authoritative over document inference. A missing record is explicitly missing; do not infer its value from documents.`;
  const suffix = `${protectedRecords}\n\nTASK INSTRUCTIONS:\n${body}\n\nOUTPUT CONTRACT:\n${canonical(spec.outputSchema)}`;
  return {system, body, userContent:[{type:'text',text:checked.protectedDocumentBlock,cache_control:{type:'ephemeral'}},{type:'text',text:suffix}], prefixHash:sha256(canonical({system,document:checked.protectedDocumentBlock}))};
}

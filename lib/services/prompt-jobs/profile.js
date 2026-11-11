/** Pure, fail-closed contract for opt-in shared-document prompt profiles. */
import crypto from 'crypto';
import { isReviewedModel, resolveModelWithCapabilities } from '../model-resolver.js';

const NAME = /^[a-z][a-z0-9_\-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
export function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}: expected object`);
  for (const key of Object.keys(value)) if (!keys.includes(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${label}: unexpected field ${key}`);
}
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  exact(value, Object.keys(value || {}), 'canonical JSON');
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export function validName(value) { return typeof value === 'string' && NAME.test(value) && !['constructor', 'prototype', '__proto__'].includes(value); }
function parseField(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}: expected JSON string`);
  try { return JSON.parse(value); } catch { throw new Error(`${label}: invalid JSON`); }
}
function names(values, label, required) {
  if (!Array.isArray(values) || (required && !values.length) || values.length > 16 || values.some(x => !validName(x)) || new Set(values).size !== values.length) throw new Error(`${label}: invalid names`);
}
export function validateProfile(profile) {
  exact(profile, ['key','revision','wrapperVersion','sharedInstructions','documentRoles','recordNames','limits'], 'profile');
  if (!validName(profile.key) || !Number.isSafeInteger(profile.revision) || profile.revision < 1 || profile.wrapperVersion !== 1 || typeof profile.sharedInstructions !== 'string' || !profile.sharedInstructions.trim() || profile.sharedInstructions.length > 16000 || /\{\{/.test(profile.sharedInstructions)) throw new Error('profile: invalid identity or instructions');
  names(profile.documentRoles, 'documentRoles', true); names(profile.recordNames, 'recordNames', false);
  exact(profile.limits, ['maxDocuments','maxDocumentBytes','maxTotalDocumentBytes','maxRecordBytes'], 'limits');
  for (const [key, max] of Object.entries({maxDocuments:16,maxDocumentBytes:2000000,maxTotalDocumentBytes:4000000,maxRecordBytes:64000})) if (!Number.isSafeInteger(profile.limits[key]) || profile.limits[key] < 1 || profile.limits[key] > max) throw new Error(`limits: invalid ${key}`);
  if (profile.documentRoles.length > profile.limits.maxDocuments) throw new Error('profile: document roles exceed limit');
  return profile;
}
export function hashProfile(profile) { validateProfile(profile); return sha256(canonical(profile)); }
export function parseExecutionSpec(promptRow) {
  if (promptRow?.wmkf_ai_promptvariables == null || promptRow.wmkf_ai_promptvariables === '') return null;
  const metadata = parseField(promptRow.wmkf_ai_promptvariables, 'variables');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('variables: expected object');
  if (!Object.hasOwn(metadata, 'execution')) {
    if (Array.isArray(metadata.variables) && metadata.variables.some(d => ['prepared_context','frozen_record'].includes(d?.source?.kind))) throw new Error('execution: marker required');
    return null;
  }
  exact(metadata, ['execution','variables'], 'variables');
  const e = metadata.execution;
  exact(e, ['contractVersion','mode','profile'], 'execution');
  if (e.contractVersion !== 1 || e.mode !== 'shared-document-task') throw new Error('execution: unsupported contract');
  exact(e.profile, ['key','revision','sha256'], 'profile reference');
  if (!validName(e.profile.key) || !Number.isSafeInteger(e.profile.revision) || e.profile.revision < 1 || !HASH.test(e.profile.sha256 || '')) throw new Error('execution: invalid profile reference');
  if (!Array.isArray(metadata.variables) || !metadata.variables.length || metadata.variables.length > 17) throw new Error('execution: invalid declarations');
  let prepared = 0; const seen = new Set();
  for (const d of metadata.variables) {
    exact(d, ['name','source','required'], 'declaration'); exact(d.source, ['kind'], 'source');
    if (!validName(d.name) || seen.has(d.name) || typeof d.required !== 'boolean' || !['prepared_context','frozen_record'].includes(d.source.kind)) throw new Error('execution: invalid declaration');
    seen.add(d.name);
    if (d.source.kind === 'prepared_context') { prepared++; if (!d.required) throw new Error('execution: context must be required'); }
  }
  if (prepared !== 1) throw new Error('execution: exactly one prepared context required');
  if (promptRow.wmkf_ai_systemprompt !== '' || typeof promptRow.wmkf_ai_promptbody !== 'string' || !promptRow.wmkf_ai_promptbody.trim() || promptRow.wmkf_ai_promptbody.length > 32000) throw new Error('execution: invalid prompt text');
  const model = promptRow.wmkf_ai_model;
  if (typeof model !== 'string' || !isReviewedModel(model) || resolveModelWithCapabilities(model).capabilities.provider !== 'anthropic') throw new Error('execution: model must be reviewed Anthropic');
  const outputSchema = parseField(promptRow.wmkf_ai_promptoutputschema, 'output schema');
  if (!['raw','json'].includes(outputSchema.parseMode) || !Array.isArray(outputSchema.outputs) || !outputSchema.outputs.length || (outputSchema.parseMode === 'raw' && outputSchema.outputs.length !== 1)) throw new Error('execution: invalid output schema');
  const outputNames = new Set();
  for (const output of outputSchema.outputs) {
    if (!validName(output.name) || outputNames.has(output.name) || !output.target || output.target.kind !== 'none' || Object.keys(output.target).length !== 1) throw new Error('execution: invalid output target');
    outputNames.add(output.name);
    for (const key of ['maxWords','maxChars']) if (output[key] !== undefined && (!Number.isSafeInteger(output[key]) || output[key] < 1 || output[key] > 100000)) throw new Error('execution: invalid output limit');
  }
  return { ...e, variables: metadata.variables, outputSchema };
}
export function validateProfileOutput(parsed, outputSchema) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(outputSchema?.outputs)) throw new Error('output: expected parsed object');
  for (const output of outputSchema.outputs) {
    const value = parsed[output.name];
    if ((output.maxWords !== undefined || output.maxChars !== undefined) && typeof value !== 'string') throw new Error(`output: ${output.name} must be text`);
    if (output.maxChars !== undefined && value.length > output.maxChars) throw new Error(`output: ${output.name} exceeds maxChars`);
    if (output.maxWords !== undefined && (value.trim() ? value.trim().split(/\s+/u).length : 0) > output.maxWords) throw new Error(`output: ${output.name} exceeds maxWords`);
  }
  return parsed;
}

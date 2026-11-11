/** Closed task capabilities. Proposal tasks retain drafts; no Request field mapping is enabled. */
import { exact, parseExecutionSpec } from './profile.js';
import { isGuid } from '../../utils/guid.js';
import { RECOMMENDATIONS_CONTRACT_VERSION as EXPERTISE_RESULT_CONTRACT } from '../expertise-finder/recommendations-contract.js';
import { rosterMatchSchema } from '../expertise-finder/roster-match-validation.js';

// Conservative trial budget. The exact checkpoint byte check still handles
// anomalous provider replies without treating a received response as unknown.
export const SYNTHETIC_MAX_OUTPUT_TOKENS = 1536;
export const EXPERTISE_TASK_KEY = 'expertise.recommendations';
export { EXPERTISE_RESULT_CONTRACT };
const EXPERTISE_FIXTURE_SCOPE = 'expertise-fixture:';
const EXPERTISE_APP_PRINCIPAL_PREFIX = 'app:';
export const EXPERTISE_SANDBOX_SCOPE_PREFIX = 'expertise-recommendations:';
const RECOMMENDATIONS_RESULT_FIELDS = {
  ...rosterMatchSchema.fields,
  roster_contract: {type: 'string'},
  roster_warnings: {type: 'array'},
  no_lead_recommendation: {type: 'boolean'},
};
const textCapability = fields => Object.freeze({ ...fields, maxOutputTokens: SYNTHETIC_MAX_OUTPUT_TOKENS });

const TASKS = Object.freeze({
  'synthetic.executive-summary': textCapability({ kind: 'synthetic', outputName: 'summary', destinationField: 'fixture_summary', maxWords: 200 }),
  'synthetic.methodology': textCapability({ kind: 'synthetic', outputName: 'methodology', destinationField: 'fixture_methodology', maxChars: 12000 }),
  'proposal.executive-summary': textCapability({ kind: 'proposal', outputName: 'summary', destinationField: null, maxWords: 200 }),
  'proposal.methodology': textCapability({ kind: 'proposal', outputName: 'methodology', destinationField: null, maxChars: 12000 }),
  [EXPERTISE_TASK_KEY]: Object.freeze({ kind: 'expertise-fixture', outputName: 'recommendations', destinationField: null,
    resultContract: EXPERTISE_RESULT_CONTRACT, compilerVersion: 1, maxOutputTokens: 4096 }),
});

export const PROPOSAL_TASK_KEYS = Object.freeze(['proposal.executive-summary', 'proposal.methodology']);
export const PROPOSAL_ENVIRONMENTS = Object.freeze(['local-production', 'local-sandbox', 'preview-sandbox']);
export function getTaskCapability(name) { return Object.hasOwn(TASKS, name) ? TASKS[name] : null; }
export function isExpertiseFixtureScope(scope) {
  const value = scope?.authorizationScope;
  if (scope?.environment !== 'test' || typeof value !== 'string' || !value.startsWith(EXPERTISE_FIXTURE_SCOPE)) return false;
  const id = value.slice(EXPERTISE_FIXTURE_SCOPE.length);
  return isGuid(id) && id === id.toLowerCase();
}
/** Fixture machine ownership is separate from a staff reader's identity. */
export function isExpertiseMachineScope(scope) {
  const owner = scope?.principalKey;
  return isExpertiseFixtureScope(scope) && scope.authorizationScope.length === EXPERTISE_FIXTURE_SCOPE.length + 36
    && typeof owner === 'string' && owner === owner.trim() && owner.startsWith(EXPERTISE_APP_PRINCIPAL_PREFIX) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,195}$/.test(owner.slice(EXPERTISE_APP_PRINCIPAL_PREFIX.length));
}
/** Read scope only. Admission and Executor task enablement remain fixture-only. */
export function isExpertiseSandboxReadScope(scope) {
  if (!['local-sandbox', 'preview-sandbox'].includes(scope?.environment)) return false;
  const { principalKey, authorizationScope } = scope;
  if (typeof principalKey !== 'string' || !principalKey.startsWith(EXPERTISE_APP_PRINCIPAL_PREFIX)
    || typeof authorizationScope !== 'string' || !authorizationScope.startsWith(EXPERTISE_SANDBOX_SCOPE_PREFIX)) return false;
  return [principalKey.slice(EXPERTISE_APP_PRINCIPAL_PREFIX.length), authorizationScope.slice(EXPERTISE_SANDBOX_SCOPE_PREFIX.length)]
    .every(id => isGuid(id) && id.length === 36 && id === id.toLowerCase());
}
export function isTaskEnabled(name, scope) {
  const capability = getTaskCapability(name);
  if (capability?.kind === 'synthetic') return scope?.environment === 'test' && !isExpertiseFixtureScope(scope);
  if (capability?.kind === 'expertise-fixture') return isExpertiseFixtureScope(scope);
  const trialId = scope?.authorizationScope?.startsWith('proposal-trial:') ? scope.authorizationScope.slice(15) : null;
  return capability?.kind === 'proposal' && PROPOSAL_ENVIRONMENTS.includes(scope?.environment)
    && isGuid(trialId) && trialId === trialId.toLowerCase();
}
export function getTaskCapabilities() {
  return Object.entries(TASKS).filter(([, cap]) => !cap.resultContract)
    .map(([name, {kind,outputName,maxWords,maxChars}]) => ({
      name, kind, outputName, ...(maxWords ? {maxWords} : {}), ...(maxChars ? {maxChars} : {}),
    }));
}

export function getSyntheticTaskCapabilities() {
  return Object.entries(TASKS).filter(([, cap]) => cap.kind === 'synthetic').map(([name, {outputName, maxWords, maxChars}]) => ({
    name, outputName, ...(maxWords ? {maxWords} : {}), ...(maxChars ? {maxChars} : {}),
  }));
}

export function validateTaskCapability(promptRow, scope, { definitionOnly = false } = {}) {
  const capability = getTaskCapability(promptRow?.wmkf_ai_promptname);
  if (!capability || (!definitionOnly && !isTaskEnabled(promptRow?.wmkf_ai_promptname, scope))) {
    throw new Error('prompt job task is not enabled for this environment');
  }
  const spec = parseExecutionSpec(promptRow);
  const output = spec?.outputSchema.outputs[0];
  if (!spec || spec.outputSchema.outputs.length !== 1 || output.name !== capability.outputName) {
    throw new Error('prompt job output does not match capability');
  }
  const records = spec.variables.filter(v => v.source.kind === 'frozen_record');
  if (capability.resultContract) {
    exact(spec.outputSchema, ['parseMode', 'outputs'], 'recommendations output schema');
    exact(output, ['name', 'target'], 'recommendations output');
    if (spec.contractVersion !== 2 || spec.resultContract !== capability.resultContract
      || spec.compilerVersion !== capability.compilerVersion || spec.outputSchema.parseMode !== 'json'
      || records.length !== 1 || records[0].name !== 'roster_block' || records[0].required !== true) {
      throw new Error('prompt job recommendations contract does not match capability');
    }
  } else if (spec.contractVersion !== 1) {
    throw new Error('prompt job text contract does not match capability');
  }
  if (capability.kind === 'proposal' && (records.length !== 1 || records[0].name !== 'pi_name' || records[0].required !== true)) {
    throw new Error('proposal tasks require the stored PI name');
  }
  if (!Number.isSafeInteger(promptRow.wmkf_ai_maxtokens) || promptRow.wmkf_ai_maxtokens < 1
    || promptRow.wmkf_ai_maxtokens > capability.maxOutputTokens) {
    throw new Error('prompt job output token budget exceeds capability');
  }
  const temperature = promptRow.wmkf_ai_temperature;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error('prompt job temperature is outside the supported range');
  }
  for (const key of ['maxWords', 'maxChars']) {
    if (capability[key] && (!Number.isSafeInteger(output[key]) || output[key] > capability[key])) {
      throw new Error('prompt job output limit exceeds capability');
    }
  }
  return { ...capability, spec };
}

/** Retained compatibility gate for synthetic-only callers. */
export function validateSyntheticTask(promptRow, scope) {
  if (getTaskCapability(promptRow?.wmkf_ai_promptname)?.kind !== 'synthetic') throw new Error('not a synthetic task');
  return validateTaskCapability(promptRow, scope);
}

/** Enforce the ledger format at the worker, store and read boundaries. */
export function validateTaskResult(taskKey, value) {
  const capability = getTaskCapability(taskKey);
  if (!capability) throw new Error('prompt job result task is unknown');
  if (!capability.resultContract) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('prompt job result must be text');
    return;
  }
  exact(value, ['contractVersion', 'result'], 'typed prompt job result');
  if (value.contractVersion !== capability.resultContract) throw new Error('prompt job result contract mismatch');
  // The Executor checks domain eligibility against the sealed roster. Storage
  // and later reads also require the closed canonical top-level representation.
  exact(value.result, Object.keys(RECOMMENDATIONS_RESULT_FIELDS), 'recommendations result');
  for (const [name, schema] of Object.entries(RECOMMENDATIONS_RESULT_FIELDS)) {
    const field = value.result[name];
    const type = Array.isArray(field) ? 'array' : typeof field;
    if (type !== schema.type) throw new Error(`recommendations result ${name} has an invalid type`);
    if (type === 'object') exact(field, Object.keys(schema.fields), `recommendations result ${name}`);
  }
}

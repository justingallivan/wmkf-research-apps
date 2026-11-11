/** Closed task capabilities. Proposal tasks retain drafts; no Request field mapping is enabled. */
import { parseExecutionSpec } from './profile.js';
import { isGuid } from '../../utils/guid.js';

// Conservative trial budget. The exact checkpoint byte check still handles
// anomalous provider replies without treating a received response as unknown.
export const SYNTHETIC_MAX_OUTPUT_TOKENS = 1536;

const TASKS = Object.freeze({
  'synthetic.executive-summary': Object.freeze({ kind: 'synthetic', outputName: 'summary', destinationField: 'fixture_summary', maxWords: 200 }),
  'synthetic.methodology': Object.freeze({ kind: 'synthetic', outputName: 'methodology', destinationField: 'fixture_methodology', maxChars: 12000 }),
  'proposal.executive-summary': Object.freeze({ kind: 'proposal', outputName: 'summary', destinationField: null, maxWords: 200 }),
  'proposal.methodology': Object.freeze({ kind: 'proposal', outputName: 'methodology', destinationField: null, maxChars: 12000 }),
});

export const PROPOSAL_TASK_KEYS = Object.freeze(['proposal.executive-summary', 'proposal.methodology']);
export const PROPOSAL_ENVIRONMENTS = Object.freeze(['local-production', 'local-sandbox', 'preview-sandbox']);
export function getTaskCapability(name) { return Object.hasOwn(TASKS, name) ? TASKS[name] : null; }
export function isTaskEnabled(name, scope) {
  const capability = getTaskCapability(name);
  if (capability?.kind === 'synthetic') return scope?.environment === 'test';
  const trialId = scope?.authorizationScope?.startsWith('proposal-trial:') ? scope.authorizationScope.slice(15) : null;
  return capability?.kind === 'proposal' && PROPOSAL_ENVIRONMENTS.includes(scope?.environment)
    && isGuid(trialId) && trialId === trialId.toLowerCase();
}
export function getTaskCapabilities() {
  return Object.entries(TASKS).map(([name, {kind,outputName,maxWords,maxChars}]) => ({
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
  if (capability.kind === 'proposal' && (records.length !== 1 || records[0].name !== 'pi_name' || records[0].required !== true)) {
    throw new Error('proposal tasks require the stored PI name');
  }
  if (!Number.isSafeInteger(promptRow.wmkf_ai_maxtokens) || promptRow.wmkf_ai_maxtokens < 1
    || promptRow.wmkf_ai_maxtokens > SYNTHETIC_MAX_OUTPUT_TOKENS) {
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

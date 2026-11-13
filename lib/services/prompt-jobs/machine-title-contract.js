/** Code-owned Short Title pilot definition. These helpers do not authorize or publish it. */
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '../../../shared/config/prompts/grantee-title.js';
import { LEGACY_TITLE_FIELD, titleDestinationTarget } from './machine-destination.js';
import { isGuid } from '../../utils/guid.js';
import { canonical, hashProfile, MACHINE_TITLE_PROFILE_KEY, PROFILE_LIMITS, validateProfile } from './profile.js';

export const MACHINE_TITLE_TASK = 'preflight.short-title';
export const MACHINE_TITLE_FIELD = LEGACY_TITLE_FIELD;
export const MACHINE_TITLE_MODEL = 'claude-sonnet-5-5';
export const MACHINE_TITLE_RECORD_NAMES = Object.freeze(['source_title', 'source_abstract']);
export const MACHINE_TITLE_OUTPUT = 'edited_title';
export const MACHINE_TITLE_MAX_CHARS = 2000;
export const MACHINE_TITLE_MAX_TOKENS = 4096;

const SCOPE_PREFIX = 'pa-short-title:';
const VARIABLES = [
  { name: 'proposal_context', source: { kind: 'prepared_context' }, required: true },
  ...MACHINE_TITLE_RECORD_NAMES.map(name => ({ name, source: { kind: 'frozen_record' }, required: true })),
];
const OUTPUT_SCHEMA = {
  parseMode: 'raw', outputs: [{ name: MACHINE_TITLE_OUTPUT, target: { kind: 'none' }, maxChars: MACHINE_TITLE_MAX_CHARS }],
};

export function machineTitleScope(scope) {
  const value = scope?.authorizationScope;
  if (!['local-sandbox', 'preview-sandbox', 'test-sandbox'].includes(scope?.environment)
    || typeof value !== 'string' || !value.startsWith(SCOPE_PREFIX)) return false;
  const id = value.slice(SCOPE_PREFIX.length);
  return id.length === 36 && id === id.toLowerCase() && isGuid(id);
}

export function validateMachineTitleProfile(profile) {
  validateProfile(profile);
  if (profile.key !== MACHINE_TITLE_PROFILE_KEY || profile.sharedInstructions !== SYSTEM_PROMPT || profile.documentRoles.length !== 0
    || canonical(profile.recordNames) !== canonical(MACHINE_TITLE_RECORD_NAMES)) {
    throw new Error('Short Title requires the pinned record-only profile');
  }
  return profile;
}

export function validateMachineTitleSpec(promptRow, spec) {
  titleDestinationTarget(spec.outputSchema.outputs[0]?.target);
  const comparison = { ...spec.outputSchema, outputs: spec.outputSchema.outputs.map(o => ({ ...o, target: { kind: 'none' } })) };
  if (promptRow.wmkf_ai_promptbody !== USER_PROMPT_TEMPLATE || promptRow.wmkf_ai_model !== MACHINE_TITLE_MODEL
    || ![null, ''].includes(promptRow.wmkf_ai_systemprompt) || promptRow.wmkf_ai_temperature !== 0
    || spec.profile.key !== MACHINE_TITLE_PROFILE_KEY || canonical(spec.variables) !== canonical(VARIABLES)
    || canonical(comparison) !== canonical(OUTPUT_SCHEMA)) {
    throw new Error('Short Title prompt does not match its capability');
  }
}

export function buildMachineTitleDefinition({ revision = 1, destinationField } = {}) {
  const outputSchema = destinationField === undefined ? OUTPUT_SCHEMA : { ...OUTPUT_SCHEMA, outputs: OUTPUT_SCHEMA.outputs.map(o => ({ ...o, target: { kind: 'akoya_request', field: destinationField } })) };
  titleDestinationTarget(outputSchema.outputs[0].target);
  const profile = {
    key: MACHINE_TITLE_PROFILE_KEY, revision, wrapperVersion: 1, sharedInstructions: SYSTEM_PROMPT,
    documentRoles: [], recordNames: [...MACHINE_TITLE_RECORD_NAMES],
    limits: { maxDocuments: 1, maxDocumentBytes: 1, maxTotalDocumentBytes: 1, maxRecordBytes: PROFILE_LIMITS.maxRecordBytes },
  };
  return {
    profile,
    task: {
      name: MACHINE_TITLE_TASK, body: USER_PROMPT_TEMPLATE, systemPrompt: '',
      variables: JSON.stringify({
        execution: { contractVersion: 1, mode: 'shared-document-task', profile: { key: profile.key, revision, sha256: hashProfile(profile) } },
        variables: VARIABLES,
      }),
      outputSchema: JSON.stringify(outputSchema), model: MACHINE_TITLE_MODEL, maxTokens: MACHINE_TITLE_MAX_TOKENS, temperature: 0,
    },
  };
}

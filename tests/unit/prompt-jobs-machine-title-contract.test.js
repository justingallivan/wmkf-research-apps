/** @jest-environment node */
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/grantee-title.js';
import { isTaskEnabled, validateTaskCapability, validateTaskResult } from '../../lib/services/prompt-jobs/capabilities.js';
import { composeProfileTask, prepareContextSnapshot } from '../../lib/services/prompt-jobs/context.js';
import {
  buildMachineTitleDefinition, MACHINE_TITLE_FIELD, MACHINE_TITLE_TASK, machineTitleScope, validateMachineTitleProfile,
} from '../../lib/services/prompt-jobs/machine-title-contract.js';
import { hashProfile, validateProfile } from '../../lib/services/prompt-jobs/profile.js';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope = { environment: 'test-sandbox', authorizationScope: 'pa-short-title:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestId };
const nonceSecret = 'offline fixture nonce of at least 32 bytes';
const { profile, task } = buildMachineTitleDefinition();
const promptRow = {
  wmkf_ai_promptname: task.name, wmkf_ai_promptbody: task.body, wmkf_ai_systemprompt: task.systemPrompt,
  wmkf_ai_promptvariables: task.variables, wmkf_ai_promptoutputschema: task.outputSchema,
  wmkf_ai_model: task.model, wmkf_ai_maxtokens: task.maxTokens, wmkf_ai_temperature: task.temperature,
};
const records = [
  { name: 'source_title', value: 'TITLE_CANARY', provenance: 'akoya_request.akoya_title', present: true },
  { name: 'source_abstract', value: 'ABSTRACT_CANARY', provenance: 'akoya_request.wmkf_abstract', present: true },
];

test('proposes an isolated pinned Short Title definition with the original instruction and body bytes', () => {
  expect(task).toMatchObject({ name: MACHINE_TITLE_TASK, body: USER_PROMPT_TEMPLATE, systemPrompt: '', model: 'claude-sonnet-5-5', maxTokens: 4096 });
  expect(profile.sharedInstructions).toBe(SYSTEM_PROMPT);
  expect(profile).toMatchObject({ documentRoles: [], recordNames: ['source_title', 'source_abstract'] });
  expect(validateMachineTitleProfile(profile)).toBe(profile);
  const capability = validateTaskCapability(promptRow, scope);
  expect(capability).toMatchObject({ kind: 'machine-title', outputName: 'edited_title', destinationField: MACHINE_TITLE_FIELD });
  expect(capability.spec.profile.sha256).toBe(hashProfile(profile));
});

test.each(['local-sandbox', 'preview-sandbox', 'test-sandbox'])('enables title shape only in the explicit machine scope in %s', environment => {
  expect(machineTitleScope({ ...scope, environment })).toBe(true);
  expect(isTaskEnabled(MACHINE_TITLE_TASK, { ...scope, environment })).toBe(true);
});

test.each([
  { environment: 'local-production' }, { environment: 'production' }, { environment: 'test' },
  { authorizationScope: 'proposal-trial:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { authorizationScope: 'pa-short-title:BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB' },
  { authorizationScope: 'pa-short-title:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb ' },
])('rejects a foreign title environment or scope %j', patch => {
  expect(isTaskEnabled(MACHINE_TITLE_TASK, { ...scope, ...patch })).toBe(false);
});

test.each([
  { wmkf_ai_promptbody: 'Different wording {{source_title}} {{source_abstract}}' },
  { wmkf_ai_model: 'claude-sonnet-4-6' },
  { wmkf_ai_maxtokens: 4097 },
  { wmkf_ai_temperature: 0.2 },
  { wmkf_ai_systemprompt: 'Caller supplied instructions' },
  { wmkf_ai_promptoutputschema: task.outputSchema.replace('"maxChars":2000', '"maxChars":1999') },
  { wmkf_ai_promptvariables: task.variables.replace('"required":true}', '"required":false}') },
  { wmkf_ai_promptvariables: task.variables.replace('"source_abstract"', '"unrelated_record"') },
])('rejects changed Short Title task metadata %j', patch => {
  expect(() => validateTaskCapability({ ...promptRow, ...patch }, scope)).toThrow();
});

test('seals and wraps the real records with no document and rejects an empty profile', () => {
  expect(() => validateProfile({ ...profile, recordNames: [] })).toThrow('at least one input');
  expect(() => validateProfile({ ...profile, key: 'other-records' })).toThrow('reserved for Short Title');
  const snapshot = prepareContextSnapshot({ scope, profile, nonceSecret, documents: [], records });
  const { system, userContent } = composeProfileTask({ promptRow, scope, profile, nonceSecret, snapshot });
  expect(snapshot.documents).toEqual([]);
  expect(system).toContain(SYSTEM_PROMPT);
  expect(system).not.toContain('_CANARY');
  expect(userContent[0].text).toContain('[]');
  expect(userContent[0].text).not.toContain('_CANARY');
  expect(userContent[1].text).toContain('TITLE_CANARY');
  expect(userContent[1].text).toContain('ABSTRACT_CANARY');
  expect(() => validateMachineTitleProfile({ ...profile, sharedInstructions: 'different wording' })).toThrow('record-only profile');
  expect(() => validateMachineTitleProfile({ ...profile, documentRoles: ['fake'] })).toThrow('record-only profile');
});

test('fails closed when a record exceeds the encoded snapshot budget', () => {
  expect(() => prepareContextSnapshot({
    scope, profile, nonceSecret, documents: [],
    records: [records[0], { ...records[1], value: '\u0800'.repeat(22000) }],
  })).toThrow('snapshot exceeds');
});

test.each([' refusal ', 'To do', 'To test.','To test\nMore', 'To study\u2028More', 'To ' + 'x'.repeat(2000), null])(
  'rejects a noncanonical persisted title %j', value => {
    expect(() => validateTaskResult(MACHINE_TITLE_TASK, value)).toThrow('canonical one-line objective');
  },
);

test('accepts a short canonical persisted title', () => {
  expect(() => validateTaskResult(MACHINE_TITLE_TASK, 'To study')).not.toThrow();
});

test('a proposal task cannot compose with the reserved record-only profile', () => {
  const proposalScope = { ...scope, environment: 'local-sandbox', authorizationScope: 'proposal-trial:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const metadata = JSON.parse(task.variables);
  metadata.variables = [metadata.variables[0], { ...metadata.variables[1], name: 'pi_name' }];
  const proposal = {
    ...promptRow, wmkf_ai_promptname: 'proposal.executive-summary', wmkf_ai_promptbody: 'Summarize the proposal for {{pi_name}}.',
    wmkf_ai_maxtokens: 1000,
    wmkf_ai_promptvariables: JSON.stringify(metadata),
    wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', target: { kind: 'none' }, maxWords: 200 }] }),
  };
  expect(validateTaskCapability(proposal, proposalScope)).toMatchObject({ kind: 'proposal' });
  expect(() => validateTaskCapability(proposal, proposalScope, { profile })).toThrow('requires a document profile');
  const snapshot = prepareContextSnapshot({ scope: proposalScope, profile, nonceSecret, documents: [], records });
  expect(() => composeProfileTask({ promptRow: proposal, scope: proposalScope, profile, nonceSecret, snapshot }))
    .toThrow('requires a document profile');
});

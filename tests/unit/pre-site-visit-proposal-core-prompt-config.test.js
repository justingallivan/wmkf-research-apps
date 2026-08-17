/**
 * Pins the local draft contract for the Pre-Site Visit proposal-core prompt.
 * Publishing to Dataverse and executing Claude are separately approved steps.
 */

import { validateAiJson } from '../../lib/utils/ai-output-schema';
import * as promptConfig from '../../shared/config/prompts/pre-site-visit-proposal-core';
import {
  PROMPT_NAME,
  SYSTEM_PROMPT,
  USER_PROMPT_TEMPLATE,
  PROMPT_VARIABLES,
  PROPOSAL_CORE_KEYS,
  PROMPT_OUTPUT_SCHEMA,
} from '../../shared/config/prompts/pre-site-visit-proposal-core';

const sampleProposalCore = Object.fromEntries(
  PROPOSAL_CORE_KEYS.map((key) => [key, `${key} content`]),
);

test('declares bounded untrusted inputs for request context and narrative', () => {
  expect(PROMPT_NAME).toBe('pre-site-visit.proposal-core.generate');
  expect(PROMPT_VARIABLES.variables.map((variable) => variable.name)).toEqual([
    'request_context_json',
    'proposal_text',
  ]);

  const requestContext = PROMPT_VARIABLES.variables[0];
  expect(requestContext).toMatchObject({
    source: { kind: 'override' },
    dataClass: 'crm_record_text',
    maxChars: 25000,
    untrusted: true,
  });

  const proposalText = PROMPT_VARIABLES.variables[1];
  expect(proposalText).toMatchObject({
    source: { kind: 'override' },
    dataClass: 'proposal_text',
    maxChars: 100000,
    untrusted: true,
  });

  expect(USER_PROMPT_TEMPLATE).toContain('{{request_context_json}}');
  expect(USER_PROMPT_TEMPLATE).toContain('{{proposal_text}}');
});

test('keeps Dataverse personnel authoritative without assuming affiliations', () => {
  expect(SYSTEM_PROMPT).toContain('Use every personnel name and role exactly as supplied');
  expect(SYSTEM_PROMPT).toContain('The applicant institution is not automatically the affiliation of every investigator');
  expect(SYSTEM_PROMPT).toContain('Otherwise omit it');
  expect(SYSTEM_PROMPT).toContain('personnelDetails: One paragraph total');
  expect(SYSTEM_PROMPT).toContain('Do not insert paragraph breaks between people');
  expect(SYSTEM_PROMPT).not.toContain('One short paragraph per person');
  expect(SYSTEM_PROMPT).not.toContain('<u>');
});

test('leaves runtime model selection to the governed prompt row', () => {
  expect(promptConfig).not.toHaveProperty('MODEL_TIER');
  expect(promptConfig).not.toHaveProperty('TEMPERATURE');
  expect(promptConfig).not.toHaveProperty('MAX_TOKENS');
});

test('returns one strict pass-through proposalCore object', () => {
  expect(PROMPT_OUTPUT_SCHEMA).toMatchObject({
    generationMode: 'native-json-schema',
    parseMode: 'json',
    rawOutputRetention: 'full',
    outputs: [
      {
        name: 'proposalCore',
        type: 'object',
        target: { kind: 'none' },
      },
    ],
  });
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.required).toEqual(['proposalCore']);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.additionalProperties).toBe(false);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.proposalCore.required).toEqual(PROPOSAL_CORE_KEYS);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.proposalCore.additionalProperties).toBe(false);
});

test('local validation accepts the exact eight-section shape', () => {
  const result = validateAiJson(
    { proposalCore: sampleProposalCore },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );

  expect(result).toEqual({
    ok: true,
    value: { proposalCore: sampleProposalCore },
  });
});

test('local validation rejects missing and injected sections', () => {
  const missing = { ...sampleProposalCore };
  delete missing.personnelDetails;
  const missingResult = validateAiJson(
    { proposalCore: missing },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  expect(missingResult.ok).toBe(false);
  expect(missingResult.errors).toContain('$.proposalCore.personnelDetails: required.');

  const injectedResult = validateAiJson(
    {
      proposalCore: {
        ...sampleProposalCore,
        staffRecommendation: 'Fund it.',
      },
    },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  expect(injectedResult.ok).toBe(false);
  expect(injectedResult.errors).toContain('$.proposalCore: unexpected key "staffRecommendation".');
});

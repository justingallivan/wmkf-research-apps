/**
 * Pins the tracked bootstrap/recovery contract for the governed Pre-Site Visit
 * proposal-core prompt.
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
  REQUIRED_SYSTEM_ASSERTIONS,
} from '../../shared/config/prompts/pre-site-visit-proposal-core';

const sampleProposalCore = Object.fromEntries(
  PROPOSAL_CORE_KEYS.map((key) => [key, `${key} content`]),
);

test('declares bounded untrusted inputs for context and narrative only', () => {
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
  expect(USER_PROMPT_TEMPLATE).not.toMatch(/bibliograph/i);
});

test('keeps Dataverse personnel authoritative without assuming affiliations', () => {
  expect(SYSTEM_PROMPT).toContain('Use every personnel name and role exactly as supplied');
  expect(SYSTEM_PROMPT).toContain('The applicant institution is not automatically the affiliation of every investigator');
  expect(SYSTEM_PROMPT).toContain('Otherwise omit it');
  expect(SYSTEM_PROMPT).toContain('personnelDetails: One paragraph of approximately 140-180 words');
  expect(SYSTEM_PROMPT).toContain('personnelOverview: One concise paragraph');
  expect(SYSTEM_PROMPT).toContain('Do not insert paragraph breaks between people');
  expect(SYSTEM_PROMPT).toContain('Do not include academic degrees or degree credentials');
  expect(SYSTEM_PROMPT).toContain('Use only the abbreviations PI and co-PI');
  expect(SYSTEM_PROMPT).toContain('backgroundAndImpact and detailedMethodology should normally fit together on one Word page');
  expect(SYSTEM_PROMPT).toContain('approximately 500-600 words combined');
  expect(SYSTEM_PROMPT).not.toMatch(/bibliograph/i);
  expect(SYSTEM_PROMPT).not.toContain('One short paragraph per person');
  expect(SYSTEM_PROMPT).not.toContain('title, department, degree');
  expect(SYSTEM_PROMPT).not.toContain('<u>');
});

test('exports the load-bearing caller assertions', () => {
  expect(REQUIRED_SYSTEM_ASSERTIONS).toEqual([
    expect.stringContaining('Use every personnel name and role exactly as supplied'),
    expect.stringContaining('applicant institution is not automatically the affiliation'),
    expect.stringContaining('Do not include academic degrees or degree credentials'),
    expect.stringContaining('Use only the abbreviations PI and co-PI'),
    expect.stringContaining('should normally fit together on one Word page'),
  ]);
  for (const assertion of REQUIRED_SYSTEM_ASSERTIONS) {
    expect(SYSTEM_PROMPT).toContain(assertion);
  }
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

test('enforces the overview-page length ceilings in native and local schemas', () => {
  const expected = {
    executiveSummary: 700,
    impactOverview: 420,
    methodologyOverview: 500,
    personnelOverview: 520,
    keckFundingRationale: 480,
  };
  for (const [field, maxLength] of Object.entries(expected)) {
    expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.proposalCore.properties[field].maxLength)
      .toBe(maxLength);
    expect(PROMPT_OUTPUT_SCHEMA.validationSchema.fields.proposalCore.fields[field].maxLength)
      .toBe(maxLength);
  }
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

test.each(['personnelOverview', 'personnelDetails'])(
  'local validation rejects multiple paragraphs in %s',
  (field) => {
    const result = validateAiJson(
      {
        proposalCore: {
          ...sampleProposalCore,
          [field]: 'First paragraph.\n\nSecond paragraph.',
        },
      },
      PROMPT_OUTPUT_SCHEMA.validationSchema,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`$.proposalCore.${field}: contains a forbidden text pattern.`);
  },
);

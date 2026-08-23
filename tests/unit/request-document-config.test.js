import schema from '../../lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_DISTRIBUTION_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  requestDocumentLabel,
} from '../../shared/config/requestDocument.js';
import {
  INITIAL_ASSESSMENT_PROMPT_OUTPUT_SCHEMA,
  INITIAL_ASSESSMENT_PROMPT_VARIABLES,
  INITIAL_ASSESSMENT_REQUIRED_OUTPUTS,
} from '../../shared/config/prompts/initial-assessment.js';

function schemaOptions(schemaName) {
  const attribute = schema.attributes.find((candidate) => candidate.schemaName === schemaName);
  return Object.fromEntries(attribute.options.map((option) => [option.value, option.label]));
}

it.each([
  ['wmkf_ArtifactType', REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_ARTIFACT_LABEL],
  ['wmkf_OperationStatus', REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_OPERATION_LABEL],
  ['wmkf_LifecycleState', REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_LIFECYCLE_LABEL],
])('%s schema options stay in exact parity with shared config', (schemaName, values, labels) => {
  const options = schemaOptions(schemaName);
  expect(Object.keys(options).map(Number).sort()).toEqual(Object.values(values).sort());
  expect(options).toEqual(Object.fromEntries(
    Object.entries(labels).map(([value, label]) => [Number(value), label]),
  ));
});

it('fails closed on an unknown registry value', () => {
  expect(requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, 999999999)).toBeNull();
  expect(requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, null)).toBeNull();
});

it('recognizes only the exact frozen-distribution producer namespace', () => {
  expect(isPreSiteDistributionSnapshot({
    wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx`,
  })).toBe(true);
  expect(isPreSiteDistributionSnapshot({
    wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-pdf`,
  })).toBe(true);
  expect(isPreSiteDistributionSnapshot({ wmkf_producer: PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix }))
    .toBe(false);
  expect(isPreSiteDistributionSnapshot({
    wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-unknown`,
  })).toBe(false);
  expect(isPreSiteDistributionSnapshot({ wmkf_producer: `x-${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx` }))
    .toBe(false);
  expect(isPreSiteDistributionSnapshot({})).toBe(false);
});

it('pins the Initial Assessment proposal text as a bounded untrusted override', () => {
  expect(INITIAL_ASSESSMENT_PROMPT_VARIABLES).toEqual({
    variables: [{
      name: 'proposal_text',
      source: { kind: 'override' },
      required: true,
      cacheable: true,
      placement: 'user',
      dataClass: 'proposal_text',
      maxChars: 100000,
      untrusted: true,
    }],
  });
  expect(INITIAL_ASSESSMENT_PROMPT_OUTPUT_SCHEMA).toMatchObject({
    parseMode: 'json',
    jsonSchema: {
      additionalProperties: false,
      required: INITIAL_ASSESSMENT_REQUIRED_OUTPUTS,
    },
    rawOutputRetention: 'hash',
  });
  expect(INITIAL_ASSESSMENT_REQUIRED_OUTPUTS).not.toContain('foundation_opportunity');
});

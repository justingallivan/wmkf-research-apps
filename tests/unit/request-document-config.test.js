import schema from '../../lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json';
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  requestDocumentLabel,
} from '../../shared/config/requestDocument.js';

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

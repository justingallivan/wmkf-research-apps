/**
 * Governed request-document registry constants.
 *
 * Numeric values mirror the local option sets on wmkf_requestdocument in
 * lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json.
 * Unknown values must remain unknown; consumers fail closed instead of guessing
 * a lifecycle or artifact label.
 */

export const REQUEST_DOCUMENT_ARTIFACT_TYPE = Object.freeze({
  INITIAL_ASSESSMENT: 100000000,
  PRE_SITE_VISIT: 100000001,
  FINAL_WRITEUP: 100000002,
  APPLICANT_SLIDES: 100000003,
  OTHER_APPLICANT_MATERIALS: 100000004,
  RECORDING: 100000005,
  TRANSCRIPT: 100000006,
  TRANSCRIPT_SUMMARY: 100000007,
});

export const REQUEST_DOCUMENT_ARTIFACT_LABEL = Object.freeze({
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT]: 'Initial Assessment',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT]: 'Pre Site Visit',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP]: 'Final Writeup',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES]: 'Applicant Slides',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS]: 'Other Applicant Materials',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING]: 'Recording',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT]: 'Transcript',
  [REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY]: 'Transcript Summary',
});

export const REQUEST_DOCUMENT_OPERATION_STATUS = Object.freeze({
  GENERATING: 100000000,
  READY: 100000001,
  FAILED: 100000002,
});

export const REQUEST_DOCUMENT_OPERATION_LABEL = Object.freeze({
  [REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING]: 'Generating',
  [REQUEST_DOCUMENT_OPERATION_STATUS.READY]: 'Ready',
  [REQUEST_DOCUMENT_OPERATION_STATUS.FAILED]: 'Failed',
});

export const REQUEST_DOCUMENT_LIFECYCLE_STATE = Object.freeze({
  DRAFT: 100000000,
  REVIEW: 100000001,
  BOARD_READY: 100000002,
  SUPERSEDED: 100000003,
  FINAL: 100000004,
});

export const REQUEST_DOCUMENT_LIFECYCLE_LABEL = Object.freeze({
  [REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT]: 'Draft',
  [REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW]: 'Review',
  [REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY]: 'Board Ready',
  [REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED]: 'Superseded',
  [REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL]: 'Final',
});

export const INITIAL_ASSESSMENT_CONTRACT = Object.freeze({
  artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  promptName: 'initial-assessment.generate',
  promptVersion: 1,
  templateId: 'initial-assessment-standard-business-brief',
  templateVersion: '1.0.0',
  relativeFolder: 'Artifacts/Initial Assessment',
  producer: 'request-workbench',
});

export const PRE_SITE_VISIT_CONTRACT = Object.freeze({
  artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  promptName: 'pre-site-visit.proposal-core.generate',
  templateId: 'phase-ii-pre-site-visit',
  templateVersion: '2',
  relativeFolder: 'Artifacts/Pre-Site Visit',
  producer: 'request-workbench',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

export function requestDocumentLabel(map, value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && Object.prototype.hasOwnProperty.call(map, numeric)
    ? map[numeric]
    : null;
}

export function isKnownRequestDocumentValue(map, value) {
  return requestDocumentLabel(map, value) !== null;
}

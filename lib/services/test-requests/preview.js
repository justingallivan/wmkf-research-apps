/**
 * Composes the pure request-field and file-plan compilers for the Basic clone
 * preview. Trusted server state and browser choices are separate arguments.
 * Any blocker strips the nested actionable request/file payloads; preview-only
 * values remain available under `preview`. This is deliberately not an
 * executor and cannot perform writes.
 */

import { compileTestRequestDraft } from './policy.js';
import { compileBasicCloneFilePlan } from './file-plan.js';

const TRUSTED_INPUT_KEYS = new Set([
  'destinationRequestNumber',
  'filePolicy',
  'metadata',
  'requestId',
  'runId',
  'sourceDocuments',
  'sourceRequest',
  'sourceRequestNumber',
  'testOrganizationId',
]);
const REQUESTED_INPUT_KEYS = new Set([
  'fiscalYear',
  'meetingDate',
  'recipe',
  'requestType',
  'selectedDocumentIds',
  'testLabel',
]);

function invalidInputBlockers(input, allowedKeys, scope) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ code: 'PREVIEW_INPUT_INVALID', detail: `${scope} preview input must be an object.` }];
  }
  return Object.keys(input)
    .filter(key => !allowedKeys.has(key))
    .map(field => ({ code: 'PREVIEW_INPUT_INVALID', field, detail: `Unknown ${scope} preview input key.` }));
}

export function compileBasicTestRequestPreview(trustedInput = {}, requestedInput = {}) {
  const previewBlockers = [
    ...invalidInputBlockers(trustedInput, TRUSTED_INPUT_KEYS, 'trusted'),
    ...invalidInputBlockers(requestedInput, REQUESTED_INPUT_KEYS, 'browser'),
  ];
  const safeTrusted = trustedInput && typeof trustedInput === 'object' && !Array.isArray(trustedInput)
    ? trustedInput : {};
  const safeRequested = requestedInput && typeof requestedInput === 'object' && !Array.isArray(requestedInput)
    ? requestedInput : {};
  const rawRequestPlan = compileTestRequestDraft({
    recipe: safeRequested.recipe,
    sourceRequest: safeTrusted.sourceRequest,
    testLabel: safeRequested.testLabel,
    fiscalYear: safeRequested.fiscalYear,
    meetingDate: safeRequested.meetingDate,
    metadata: safeTrusted.metadata,
    requestId: safeTrusted.requestId,
    requestType: safeRequested.requestType,
    runId: safeTrusted.runId,
    testOrganizationId: safeTrusted.testOrganizationId,
  });
  const rawFilePlan = compileBasicCloneFilePlan({
    destinationRequestNumber: safeTrusted.destinationRequestNumber,
    filePolicy: safeTrusted.filePolicy,
    sourceDocuments: safeTrusted.sourceDocuments,
    sourceRequestNumber: safeTrusted.sourceRequestNumber,
  }, {
    selectedDocumentIds: safeRequested.selectedDocumentIds,
  });
  const blockers = [
    ...previewBlockers.map(item => ({ ...item, scope: 'preview' })),
    ...rawRequestPlan.blockers.map(item => ({ ...item, scope: 'request' })),
    ...rawFilePlan.blockers.map(item => ({ ...item, scope: 'files' })),
  ];
  const planReady = blockers.length === 0;
  const requestPlan = {
    ...rawRequestPlan,
    createBody: planReady ? rawRequestPlan.createBody : null,
  };
  const filePlan = {
    ...rawFilePlan,
    planReady: planReady && rawFilePlan.planReady,
    plannedFiles: planReady ? rawFilePlan.plannedFiles : [],
  };

  return {
    blockers,
    disclosures: rawFilePlan.disclosures,
    executionReady: false,
    filePlan,
    planReady,
    preview: {
      files: rawFilePlan.previewFiles,
      requestBody: rawRequestPlan.createBody,
    },
    requestPlan,
  };
}

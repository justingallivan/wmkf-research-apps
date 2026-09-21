/**
 * Composes the pure request-field and file-plan compilers for the Basic clone
 * preview. This is deliberately not an executor and cannot perform writes.
 */

import { compileTestRequestDraft } from './policy.js';
import { compileBasicCloneFilePlan } from './file-plan.js';

const INPUT_KEYS = new Set(['draftInput', 'fileInput']);

function invalidInputBlockers(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ code: 'PREVIEW_INPUT_INVALID', detail: 'Preview input must be an object.' }];
  }
  return Object.keys(input)
    .filter(key => !INPUT_KEYS.has(key))
    .map(field => ({ code: 'PREVIEW_INPUT_INVALID', field, detail: 'Unknown preview input key.' }));
}

export function compileBasicTestRequestPreview(input = {}) {
  const previewBlockers = invalidInputBlockers(input);
  const requestPlan = compileTestRequestDraft(input?.draftInput);
  const filePlan = compileBasicCloneFilePlan(input?.fileInput);
  const blockers = [
    ...previewBlockers.map(item => ({ ...item, scope: 'preview' })),
    ...requestPlan.blockers.map(item => ({ ...item, scope: 'request' })),
    ...filePlan.blockers.map(item => ({ ...item, scope: 'files' })),
  ];

  return {
    blockers,
    disclosures: filePlan.disclosures,
    executionReady: false,
    filePlan,
    planReady: blockers.length === 0,
    requestPlan,
  };
}

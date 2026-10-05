/**
 * Exact request identity for the owner-run Staff Deliberations Factory test.
 * This predicate is never used by public routes or the scheduled cron path.
 */
import { isGuid } from '../../utils/guid.js';

const sameGuid = (left, right) => isGuid(left) && isGuid(right)
  && String(left).toLowerCase() === String(right).toLowerCase();

export function createFactoryPreparationTestScope(requestId, factoryRun) {
  if (!isGuid(requestId) || !isGuid(factoryRun?.runId)
    || !isGuid(factoryRun?.destinationRequestId) || !isGuid(factoryRun?.expectedAppUserId)
    || factoryRun.status !== 'ready'
    || factoryRun.destinationEnvironment !== 'production'
    || factoryRun.recipe !== 'basic'
    || !sameGuid(factoryRun.destinationRequestId, requestId)) {
    throw Object.assign(new Error('A ready production Basic Factory run bound to this exact request is required.'), {
      code: 'factory_preparation_test_run_mismatch',
    });
  }
  return Object.freeze({
    requestId: String(requestId).toLowerCase(),
    runId: String(factoryRun.runId).toLowerCase(),
    expectedAppUserId: String(factoryRun.expectedAppUserId).toLowerCase(),
  });
}

export function isFactoryPreparationTestRequest(request, scope) {
  return Boolean(scope && isGuid(scope.requestId) && isGuid(scope.runId)
    && isGuid(scope.expectedAppUserId)
    && sameGuid(request?.akoya_requestid, scope.requestId)
    && request?.wmkf_istestrequest === true
    && sameGuid(request?.wmkf_testcreationrunid, scope.runId)
    && sameGuid(request?._createdby_value, scope.expectedAppUserId)
    && sameGuid(request?._ownerid_value, scope.expectedAppUserId));
}

'use strict';

const REQUEST_ID = 'c1284ae7-ec6a-5b4e-b85c-a06facb72dcd';
const REQUEST_NUMBER = '1003312';
const RUN_ID = '7fed99e1-6c7e-50ff-bac7-380240bde32f';
const ENTITY_SET = 'wmkf_sitevisits';
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'wmkf_istestrequest', 'wmkf_testcreationrunid'];
const { GUID_RE: GUID } = require('../../lib/utils/guid.js');

function assertProbeArgs({ target, targetSpecified, execute, activityId, expectedState, fenceMode = 'end' }) {
  if (target !== 'prod' || targetSpecified !== true) {
    throw new Error('Site Visit end-fence proof requires explicit --target=prod.');
  }
  if (typeof activityId !== 'string' || !GUID.test(activityId)) throw new Error('--activity-id=<GUID> is required.');
  if (!['active', 'completed'].includes(expectedState)) throw new Error('--expected-state=active|completed is required.');
  if (!['end', 'status'].includes(fenceMode)) throw new Error('--fence=end|status is required.');
}

function assertProductionProbePreflight({
  env = process.env,
  productionHosts = [],
  now = new Date(),
  requireWriteAck = false,
} = {}) {
  const deployment = env.VERCEL_ENV === 'production' ? 'production'
    : env.VERCEL_ENV === 'preview' ? 'preview'
      : env.NODE_ENV === 'test' ? 'test' : 'local';
  if (deployment !== 'local' || env.NODE_ENV === 'production') throw new Error('Production Site Visit proof must run from a local operator process.');
  if (env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK=on is required.');
  if (env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('DATAVERSE_ALLOW_PROD_READS=yes is required.');
  let target;
  try { target = new URL(env.DYNAMICS_URL); } catch { throw new Error('DYNAMICS_URL must resolve to the tracked production Dataverse host.'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.port
    || !['', '/'].includes(target.pathname) || !productionHosts.includes(target.hostname.toLowerCase())) {
    throw new Error('DYNAMICS_URL must resolve to a tracked production Dataverse host.');
  }
  if (requireWriteAck) {
    const match = typeof env.DATAVERSE_PROD_WRITE_ACK === 'string'
      ? env.DATAVERSE_PROD_WRITE_ACK.match(/^(.*)\s+(\d{4}-\d{2}-\d{2})$/)
      : null;
    const todayUtc = new Date(now).toISOString().slice(0, 10);
    if (!match || !match[1].trim() || match[2] !== todayUtc) {
      throw new Error('A non-empty, same-UTC-day DATAVERSE_PROD_WRITE_ACK is required for the production write.');
    }
  }
  return { deployment, targetHost: target.hostname.toLowerCase(), writeAckRequired: requireWriteAck };
}

function optionLabel(option) {
  return option?.Label?.UserLocalizedLabel?.Label || option?.Label?.LocalizedLabels?.[0]?.Label || '';
}

function normalizeChoiceMetadata(stateMetadata, statusMetadata) {
  const states = stateMetadata?.OptionSet?.Options;
  const statuses = statusMetadata?.OptionSet?.Options;
  if (!Array.isArray(states) || !states.length || !Array.isArray(statuses) || !statuses.length) {
    throw new Error('Live state/status choice metadata is missing; refusing to guess Site Visit state codes.');
  }
  const stateMap = new Map();
  for (const option of states) {
    const value = Number(option?.Value);
    const label = optionLabel(option).trim();
    if (!Number.isInteger(value) || !label) throw new Error('Malformed Site Visit state option metadata.');
    stateMap.set(value, label);
  }
  const statusMap = new Map();
  for (const option of statuses) {
    const value = Number(option?.Value);
    const state = Number(option?.State);
    const label = optionLabel(option).trim();
    if (!Number.isInteger(value) || !Number.isInteger(state) || !label || !stateMap.has(state)) {
      throw new Error('Malformed Site Visit status option metadata.');
    }
    statusMap.set(value, { stateCode: state, label });
  }
  const labelForState = (code) => stateMap.get(Number(code)) || null;
  const labelForStatus = (code, stateCode) => {
    const option = statusMap.get(Number(code));
    return option && option.stateCode === Number(stateCode) ? option.label : null;
  };
  const matchesExpectedState = (code, expected) => {
    const label = labelForState(code);
    return label ? (expected === 'completed' ? /^completed$/i.test(label) : /^(open|active)$/i.test(label)) : false;
  };
  return { labelForState, labelForStatus, matchesExpectedState };
}

function sameInstant(leftValue, rightValue) {
  const left = Date.parse(leftValue);
  const right = Date.parse(rightValue);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function assertRequestIdentity(request) {
  if (!request
    || String(request.akoya_requestid).toLowerCase() !== REQUEST_ID
    || String(request.akoya_requestnum) !== REQUEST_NUMBER
    || request.wmkf_istestrequest !== true
    || String(request.wmkf_testcreationrunid || '').toLowerCase() !== RUN_ID) {
    throw new Error(`Pinned TEST Factory request ${REQUEST_NUMBER} or run identity does not match.`);
  }
}

function assertBoundEvent(event, activityId) {
  if (!event
    || String(event.activityid).toLowerCase() !== activityId.toLowerCase()
    || String(event._regardingobjectid_value || '').toLowerCase() !== REQUEST_ID
    || !event._etag) {
    throw new Error('Site Visit is not bound to the pinned test request or lacks an ETag.');
  }
  if (!event.scheduledend || !Number.isFinite(Date.parse(event.scheduledend))) {
    throw new Error('Site Visit scheduledend is missing or invalid.');
  }
}

function validateActivitySet(records, { activityId, expectedState, choices }) {
  if (!Array.isArray(records)) throw new Error('Site Visit read did not return a record list.');
  const classified = records.map((row) => {
    const stateLabel = choices.labelForState(row.statecode);
    const statusLabel = choices.labelForStatus(row.statuscode, row.statecode);
    if (!stateLabel || !statusLabel) {
      throw new Error(`Unknown Site Visit state/status pair on activity ${row.activityid || '(missing id)'}; refusing to classify.`);
    }
    return { ...row, stateLabel, statusLabel };
  });
  const expectedRows = classified.filter((row) => choices.matchesExpectedState(row.statecode, expectedState));
  if (expectedRows.length !== 1 || String(expectedRows[0]?.activityid).toLowerCase() !== activityId.toLowerCase()) {
    throw new Error(`Expected exactly one ${expectedState} Site Visit for request ${REQUEST_NUMBER}, and it must be --activity-id; found ${expectedRows.length}.`);
  }
  return expectedRows[0];
}

function buildConditionalPatch(activityId, event, etag, fenceMode = 'end') {
  if (!GUID.test(activityId) || !event || !etag || !['end', 'status'].includes(fenceMode)) {
    throw new Error('A validated activity id, event snapshot, ETag, and fence mode are required.');
  }
  if (fenceMode === 'end') {
    if (!event.scheduledend) throw new Error('A validated scheduled end is required for the end fence.');
    return [{ method: 'PATCH', entitySet: ENTITY_SET, key: activityId, body: { scheduledend: event.scheduledend }, ifMatch: etag }];
  }
  const stateCode = Number(event.statecode);
  const statusCode = Number(event.statuscode);
  if (event.statecode === null || event.statecode === undefined
    || event.statuscode === null || event.statuscode === undefined
    || !Number.isInteger(stateCode) || !Number.isInteger(statusCode)) {
    throw new Error('Exact integer statecode and statuscode values are required for the status fence.');
  }
  return [{ method: 'PATCH', entitySet: ENTITY_SET, key: activityId, body: { statecode: stateCode, statuscode: statusCode }, ifMatch: etag }];
}

function errorStatus(error) {
  return Number(error?.status ?? error?.httpStatus ?? error?.response?.status);
}

async function runSiteVisitEndFenceProbe({ target, targetSpecified, execute, activityId, expectedState, fenceMode = 'end' }, deps) {
  assertProbeArgs({ target, targetSpecified, execute, activityId, expectedState, fenceMode });
  const preflight = assertProductionProbePreflight({
    env: deps?.env, productionHosts: deps?.productionHosts, now: deps?.now, requireWriteAck: execute === true,
  });
  if (!deps || typeof deps.withDalContext !== 'function') throw new Error('Trusted Dataverse context dependency is required.');
  return deps.withDalContext('probe-site-visit-end-fence', async () => {
    if (deps.testIsolationEnabled !== true) throw new Error('TEST_REQUEST_ISOLATION=on is required for this marked-request probe.');
    const request = await deps.getRequest(REQUEST_ID, { select: REQUEST_SELECT });
    assertRequestIdentity(request);
    const choices = normalizeChoiceMetadata(
      await deps.getChoiceMetadata('statecode'),
      await deps.getChoiceMetadata('statuscode'),
    );
    const listed = await deps.findVisits([REQUEST_ID]);
    if (listed?.capped || listed?.hasMore) throw new Error('Site Visit enumeration was capped; refusing an incomplete uniqueness check.');
    const listedEvent = validateActivitySet(listed?.records, { activityId, expectedState, choices });
    assertBoundEvent(listedEvent, activityId);
    const before = await deps.getVisit(activityId);
    assertBoundEvent(before, activityId);
    if (String(before._regardingobjectid_value).toLowerCase() !== String(listedEvent._regardingobjectid_value).toLowerCase()
      || !sameInstant(before.scheduledend, listedEvent.scheduledend)
      || Number(before.statecode) !== Number(listedEvent.statecode)
      || Number(before.statuscode) !== Number(listedEvent.statuscode)
      || before._etag !== listedEvent._etag) {
      throw new Error('The targeted Site Visit changed between enumeration and exact read; retry after reconciliation.');
    }
    if (!choices.matchesExpectedState(before.statecode, expectedState)) {
      throw new Error(`Expected ${expectedState}, read ${choices.labelForState(before.statecode)}.`);
    }
    const report = {
      target, requestNumber: REQUEST_NUMBER, activityId, expectedState, fenceMode,
      actualState: choices.labelForState(before.statecode),
      actualStatus: choices.labelForStatus(before.statuscode, before.statecode),
      scheduledEnd: before.scheduledend, preflight,
    };
    if (!execute) {
      return { ...report, sameValuePatch: 'not-run; read-only invocation', staleEtagStatus: null, writes: 0, cleanup: 'none; retained test activity' };
    }

    assertProductionProbePreflight({
      env: deps?.env, productionHosts: deps?.productionHosts, now: deps?.now, requireWriteAck: true,
    });
    const patch = buildConditionalPatch(activityId, before, before._etag, fenceMode);
    const commit = await deps.runChangeset(patch);
    if (commit?.ok !== true || !Array.isArray(commit.operations) || commit.operations.length !== 1
      || commit.operations.some((operation) => Number(operation.status) < 200 || Number(operation.status) >= 300)) {
      throw new Error('Site Visit same-value changeset did not return a confirmed one-operation success.');
    }
    const after = await deps.getVisit(activityId);
    assertBoundEvent(after, activityId);
    if (!sameInstant(after.scheduledend, before.scheduledend)
      || Number(after.statecode) !== Number(before.statecode)
      || Number(after.statuscode) !== Number(before.statuscode)
      || String(after._regardingobjectid_value).toLowerCase() !== REQUEST_ID
      || after._etag === before._etag) {
      throw new Error('Same-value PATCH readback changed business fields or did not advance the ETag; stale-ETag proof is inconclusive.');
    }

    assertProductionProbePreflight({
      env: deps?.env, productionHosts: deps?.productionHosts, now: deps?.now, requireWriteAck: true,
    });
    let staleStatus = null;
    try {
      await deps.runChangeset(buildConditionalPatch(activityId, before, before._etag, fenceMode));
    } catch (error) {
      staleStatus = errorStatus(error);
      if (staleStatus !== 412) throw error;
    }
    if (staleStatus !== 412) throw new Error(`Expected stale Site Visit ETag to reject with 412; got ${staleStatus || 'no error'}.`);
    const afterStale = await deps.getVisit(activityId);
    assertBoundEvent(afterStale, activityId);
    if (afterStale._etag !== after._etag
      || !sameInstant(afterStale.scheduledend, after.scheduledend)
      || Number(afterStale.statecode) !== Number(after.statecode)
      || Number(afterStale.statuscode) !== Number(after.statuscode)) {
      throw new Error('Stale ETag attempt did not leave the Site Visit unchanged.');
    }
    return {
      ...report, sameValuePatch: 'confirmed',
      staleEtagStatus: staleStatus, staleAttemptReadback: 'unchanged',
      writes: 1, cleanup: 'none; retained test activity',
    };
  });
}

module.exports = {
  REQUEST_ID,
  REQUEST_NUMBER,
  RUN_ID,
  REQUEST_SELECT,
  assertProductionProbePreflight,
  assertProbeArgs,
  normalizeChoiceMetadata,
  buildConditionalPatch,
  validateActivitySet,
  runSiteVisitEndFenceProbe,
};

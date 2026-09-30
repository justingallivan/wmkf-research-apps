/** Owner-run, one-write Potential Reviewer 1 operation after a verified cast suggestion. */
import { bodyOrThrow, guidEqual } from './basic-clone-steps.js';
import { fenceCastSlotClient } from './production-write-fence.js';

const SLOT_FIELDS = [1, 2, 3, 4, 5].map((n) => `_wmkf_potentialreviewer${n}_value`);
const REQUEST_SELECT = ['akoya_requestid', 'wmkf_istestrequest', 'wmkf_testcreationrunid', ...SLOT_FIELDS].join(',');
const ETAG = /^W\/"[0-9]{1,20}"$/;

function refusal(message, code = 'cast_slot_refused') {
  return Object.assign(new Error(message), { code });
}

async function readRequest(client, requestId) {
  const row = bodyOrThrow('cast slot Request read', await client.get(`/akoya_requests(${requestId})?$select=${REQUEST_SELECT}`));
  if (!guidEqual(row.akoya_requestid, requestId) || !ETAG.test(String(row['@odata.etag'] || ''))) {
    throw refusal('The Request ID or concrete ETag could not be verified.');
  }
  return {
    etag: row['@odata.etag'], marker: row.wmkf_istestrequest,
    runId: row.wmkf_testcreationrunid,
    slots: SLOT_FIELDS.map((field) => row[field] || null),
  };
}

function exactRun(row, runId) {
  return row.marker === true && guidEqual(row.runId, runId);
}

function sameSlot(a, b) {
  return a == null ? b == null : guidEqual(a, b);
}

function readbackMatches(row, { runId, personId, beforeSlots }) {
  return exactRun(row, runId) && sameSlot(row.slots[0], personId)
    && [1, 2, 3, 4].every((index) => sameSlot(row.slots[index], beforeSlots[index]));
}

async function stop(ledger, ids, code, detail, readback = null) {
  await ledger.markCastSlotNeedsAttention({ ...ids, failureCode: code, error: detail, readback });
  throw refusal(`Cast slot needs attention: ${detail}.`, `cast_slot_${code}`);
}

async function readNavigationProperty(client) {
  // A separate live relationship read is required; do not infer the nav name
  // from the lookup column or a prior environment's metadata.
  const filter = "ReferencingAttribute eq 'wmkf_potentialreviewer1' and ReferencedEntity eq 'wmkf_potentialreviewers'";
  const path = `/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName&$filter=${encodeURIComponent(filter)}`;
  const response = bodyOrThrow('Potential Reviewer 1 relationship metadata', await client.get(path));
  if (response['@odata.nextLink'] || !Array.isArray(response.value) || response.value.length !== 1) {
    throw refusal('Potential Reviewer 1 relationship metadata is unavailable or ambiguous.', 'cast_slot_metadata_unavailable');
  }
  const relationship = response.value[0];
  const nav = relationship.ReferencingEntityNavigationPropertyName;
  if (relationship.ReferencingAttribute !== 'wmkf_potentialreviewer1'
    || relationship.ReferencedEntity !== 'wmkf_potentialreviewers'
    || !/^[A-Za-z][A-Za-z0-9_]{1,100}$/.test(String(nav || ''))) {
    throw refusal('Potential Reviewer 1 relationship metadata did not match the expected lookup.', 'cast_slot_metadata_unavailable');
  }
  return nav;
}

async function assertReady(client, ledger, runId) {
  const run = await ledger.getRun(runId);
  if (!run || run.destinationEnvironment !== 'production' || run.status !== 'ready') {
    throw refusal('Only a ready production test Request run may bind the cast slot.');
  }
  const member = (await ledger.listCastMembers({ environment: 'production' })).find((item) => item.role === 'suggested_reviewer');
  if (!member || member.status !== 'verified') throw refusal('The suggested reviewer cast member is not verified.');
  const binding = await ledger.getCastBinding({ runId, memberId: member.memberId });
  if (!binding || binding.status !== 'verified') throw refusal('The cast suggestion has not been verified.');
  const person = bodyOrThrow('cast slot person read', await client.get(
    `/wmkf_potentialreviewerses(${member.memberId})?$select=wmkf_potentialreviewersid,statecode,wmkf_issyntheticreviewer`,
  ));
  if (!guidEqual(person.wmkf_potentialreviewersid, member.memberId)
    || person.statecode !== 0 || person.wmkf_issyntheticreviewer !== true) {
    throw refusal('The exact cast reviewer is unavailable or no longer marked synthetic.');
  }
  return { run, member };
}

/** Read-only operator preview; the confirmed command re-reads every fact. */
export async function inspectCastSlotBinding({ client, ledger, runId }) {
  const { run, member } = await assertReady(client, ledger, runId);
  const request = await readRequest(client, run.destinationRequestId);
  if (!exactRun(request, runId)) throw refusal('The Request marker or run ID does not match this run.');
  const journal = await ledger.getCastSlotBinding({ runId, memberId: member.memberId });
  const slot1Matches = sameSlot(request.slots[0], member.memberId);
  return {
    runId,
    requestId: run.destinationRequestId,
    personId: member.memberId,
    requestEtag: request.etag,
    slots: request.slots,
    journalStatus: journal?.status || 'absent',
    outcome: journal?.status === 'needs_attention' ? 'needs_attention'
      : slot1Matches ? 'already_bound' : request.slots.some(Boolean) ? 'occupied' : 'empty',
  };
}

/** Confirmation names the exact Request, then the runner re-reads and fences it. */
export async function runConfirmedCastSlotBinding({ client, ledger, runId, confirmedRequestId }) {
  const preview = await inspectCastSlotBinding({ client, ledger, runId });
  if (!guidEqual(confirmedRequestId, preview.requestId)) {
    throw refusal('The confirmation does not name this run\'s exact Request.', 'cast_slot_confirmation_mismatch');
  }
  return runCastSlotBinding({ client, ledger, runId });
}

/** One invocation either verifies without a write, sends one PATCH, or stops for inspection. */
export async function runCastSlotBinding({ client, ledger, runId }) {
  const { run, member } = await assertReady(client, ledger, runId);
  const ids = { runId, memberId: member.memberId };
  const requestId = run.destinationRequestId;
  const personId = member.memberId;
  let operation = await ledger.getCastSlotBinding(ids);
  if (operation && (!guidEqual(operation.expectedRequestId, requestId)
    || !guidEqual(operation.expectedPersonId, personId))) {
    throw refusal('The slot journal names a different Request or person; inspect it.', 'cast_slot_ledger_conflict');
  }
  if (operation?.status === 'needs_attention') {
    throw refusal('The slot journal needs inspection before another attempt.', 'cast_slot_needs_attention');
  }
  const current = await readRequest(client, requestId);
  if (!exactRun(current, runId)) {
    if (operation) await stop(ledger, ids, 'request_drift', 'The Request marker or run ID changed', current);
    throw refusal('The Request marker or run ID does not match this run.');
  }
  if (operation?.status === 'verified') {
    if (!readbackMatches(current, { runId, personId, beforeSlots: operation.afterSlots })) {
      throw refusal('The verified cast slot has drifted; inspect it.', 'cast_slot_drifted');
    }
    return { status: 'verified', provenance: operation.provenance, alreadyVerified: true };
  }
  if (operation?.status === 'dispatched') {
    if (readbackMatches(current, { runId, personId, beforeSlots: operation.beforeSlots })) {
      operation = await ledger.markCastSlotVerified({ ...ids, provenance: 'observed_after_ambiguous_dispatch', readback: current });
      if (!operation) throw refusal('The slot journal refused recovery.');
      return { status: 'verified', provenance: operation.provenance };
    }
    await stop(ledger, ids, 'ambiguous_dispatch', 'A prior slot PATCH may have landed but the exact expected state is absent', current);
  }
  if (!operation) {
    operation = await ledger.planCastSlotBinding({ ...ids, requestId });
    if (!operation) throw refusal('The ledger refused a slot row without a verified suggestion and ready Request.');
  }
  // Planned means no PATCH was sent. Refresh the snapshot on every resume.
  operation = await ledger.recordCastSlotSnapshot({ ...ids, etag: current.etag, slots: current.slots });
  if (!operation) throw refusal('The slot journal refused its occupancy snapshot.');

  if (sameSlot(current.slots[0], personId)) {
    const confirmed = await readRequest(client, requestId);
    if (!readbackMatches(confirmed, { runId, personId, beforeSlots: current.slots })) {
      await stop(ledger, ids, 'readback_mismatch', 'The hand-set cast slot changed during verification', confirmed);
    }
    operation = await ledger.markCastSlotVerified({ ...ids, provenance: 'observed_preexisting', readback: confirmed });
    if (!operation) throw refusal('The slot journal refused observed verification.');
    return { status: 'verified', provenance: operation.provenance };
  }
  if (current.slots.some(Boolean)) {
    await stop(ledger, ids, 'occupied_slot', 'At least one Potential Reviewer slot was occupied', current);
  }
  let nav;
  try {
    nav = await readNavigationProperty(client);
  } catch {
    // No PATCH has been dispatched. Keep the planned journal retriable so a
    // transient metadata read failure can be resolved by a fresh snapshot.
    throw refusal('Potential Reviewer 1 relationship metadata could not be verified.', 'cast_slot_metadata_unavailable');
  }
  const fenced = fenceCastSlotClient(client, {
    destinationRequestId: requestId, sourceRequestId: run.sourceRequestId,
    personId, navigationProperty: nav, etag: current.etag,
  });
  operation = await ledger.markCastSlotDispatched(ids);
  if (!operation) throw refusal('The ledger refused dispatch; no PATCH was sent.');

  let response = null;
  let ambiguous = false;
  try {
    response = await fenced.patchWithOptions(
      `/akoya_requests(${requestId})`,
      { [`${nav}@odata.bind`]: `/wmkf_potentialreviewerses(${personId})` },
      { 'If-Match': current.etag },
    );
  } catch {
    ambiguous = true;
  }
  // Never resend after dispatch, including a 412 and a lost response.
  const readback = await readRequest(client, requestId);
  if (readbackMatches(readback, { runId, personId, beforeSlots: current.slots })) {
    if (readback.etag === current.etag) {
      await stop(ledger, ids, 'readback_mismatch', 'The cast slot changed without a new Request row version', readback);
    }
    const provenance = response?.status === 412 ? 'observed_after_conflict'
      : ambiguous || !response?.ok ? 'observed_after_ambiguous_dispatch' : 'confirmed_patch';
    operation = await ledger.markCastSlotVerified({ ...ids, provenance, readback });
    if (!operation) throw refusal('The slot journal refused verification.');
    return { status: 'verified', provenance };
  }
  const code = response?.status === 412 ? 'etag_conflict'
    : ambiguous || !response?.ok ? 'ambiguous_dispatch' : 'readback_mismatch';
  await stop(ledger, ids, code, 'The Request did not read back with the exact cast slot and unchanged other slots', readback);
}

/** SERVER/CLI ONLY, unwired synthetic-test client. Port is trusted authenticated
 * transport, never request input. It must pin the test target, page completely,
 * authorize independently and POST only the shared Action. No token/provider/
 * HTTP handling here. Caller persists prepared state BEFORE attempt; recovery
 * uses the identical request and actor tuple, never a replacement UUID.
 */
const { validateRequest, validateActor, validateReceipt, guid, etag } = require('./publication-contract');
const { inspectJson, canonicalPreimage } = require('./json-contract');
const { hashSnapshot, verifyReceiptBinding, validateFreshPublication } = require('./fingerprint');
const { validateDefinition } = require('./definition-schema');
const { POLICY_ARTIFACT } = require('./template-policy');
const ORG = '3d52a072-b138-ef11-8e4b-000d3a106422';
const KEY = 'pr553.rehearsal.publication';
function requireValue(ok, code) { if (!ok) throw new Error(code); }
function frozenCopy(value) { inspectJson(value); const result = JSON.parse(JSON.stringify(value)); const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } }; freeze(result); return result; }
const equal = (a,b) => canonicalPreimage(a) === canonicalPreimage(b);
function state(value) {
  const result = frozenCopy(value);
  requireValue(Object.keys(result).length === 3 && result.stateVersion === 1 && validateRequest(result.request).valid && validateActor(result.expectedActor).valid && result.expectedActor.organizationId === ORG && result.request.promptKey === KEY && result.request.expectedHeadRevision === '0' && result.request.expectedCurrent === null, 'invalid_first_publication_state');
  return result;
}
function prepare(observationValue, actorValue, requestId) {
  const observation=frozenCopy(observationValue), actor=frozenCopy(actorValue), draft=observation.draft;
  requireValue(validateActor(actor).valid && actor.organizationId===ORG && observation.organizationId===ORG && observation.complete===true && observation.head===null && Array.isArray(observation.rows) && observation.rows.length===1, 'first_publication_observation_required');
  requireValue(draft && guid(draft.id) && etag(draft.etag) && draft.status===682090000 && draft.version===null && draft.isCurrent===false && observation.rows[0].id===draft.id && equal(observation.rows[0],{id:draft.id,name:KEY,status:682090000,version:null,isCurrent:false,etag:draft.etag}), 'first_publication_draft_required');
  requireValue(draft.snapshot?.definition?.name===KEY && draft.snapshot.definitionFormatVersion===1 && validateDefinition(draft.snapshot.definition).valid, 'invalid_first_publication_definition');
  const catalog={title:null,description:null,groupKey:null,sectionKey:null,usedBy:null,usageCategory:null};
  const baseline={schemaVersion:1,current:null,catalog,headRevision:'0'};
  requireValue(equal(draft.metadataBaseline,baseline),'first_publication_baseline_mismatch');
  const request={contractVersion:1,definitionFormatVersion:1,policyRevision:POLICY_ARTIFACT.policy.policyVersion,policyArtifactHash:POLICY_ARTIFACT.hash,requestId,operation:'publish',promptKey:KEY,draftId:draft.id,draftEtag:draft.etag,expectedHeadRevision:'0',expectedCurrent:null,metadataBaseline:baseline,snapshotHash:hashSnapshot(draft.snapshot).hash};
  requireValue(validateFreshPublication(request,draft.snapshot).valid,'invalid_fresh_first_publication');
  return state({stateVersion:1,request,expectedActor:actor});
}
function verifyReadback(receipt, readback) {
  requireValue(validateReceipt(receipt).valid && receipt.actor.organizationId===ORG && receipt.request.promptKey===KEY && readback?.organizationId===ORG && readback.promptKey===KEY && readback.complete===true && Array.isArray(readback.rows), 'incomplete_first_publication_readback');
  requireValue(readback.rows.length===1,'unexpected_first_publication_history');
  const row=readback.rows[0];
  requireValue(row.id===receipt.published.id && row.name===KEY && row.version===receipt.published.version && row.status===682090001 && row.isCurrent===true && row.snapshot?.definition?.name===KEY && etag(row.etag) && hashSnapshot(row.snapshot).hash===receipt.request.snapshotHash,'first_publication_readback_drift');
  requireValue(readback.head?.promptId===row.id && readback.head.version===row.version && readback.head.revision===receipt.headRevision,'first_publication_head_drift');
  return true;
}
async function attempt(value, port, { recoverOnly=false }={}) {
  const prepared=state(value);
  const actor=frozenCopy(await port.authorize());
  requireValue(validateActor(actor).valid && equal(actor,prepared.expectedActor),'first_publication_actor_changed');
  let postAttempted=false;
  const unknown=reason=>({status:'unknown',reason,postAttempted,state:prepared});
  let receipt;
  try { receipt=await port.readReceipt(prepared.request.requestId); }
  catch { return unknown('receipt_read_unavailable'); }
  if (receipt===null) {
    if (recoverOnly) return unknown('receipt_not_observed');
    let rejection=null;postAttempted=true;
    try { await port.publish(prepared.request); }
    catch (error) {
      // Only a trusted adapter's explicit server-rejection classification can
      // distinguish a definite denial from transport uncertainty. Never return
      // raw server/exception text, which can contain credentials or prompt data.
      const known=['publication_disabled','policy_changed','publisher_not_authorized','publication_actor_not_bound','publication_conflict','invalid_publication_request','invalid_publication_contract'];
      if(error?.definitiveRejection===true&&known.includes(error.code))rejection=error.code;
    }
    try { receipt=await port.readReceipt(prepared.request.requestId); }
    catch { return unknown('receipt_read_unavailable'); }
    if (receipt===null) return rejection?{status:'rejected',reason:rejection,postAttempted,state:prepared}:unknown('receipt_not_observed');
  }
  receipt=frozenCopy(receipt);
  requireValue(verifyReceiptBinding(receipt,prepared.request,actor),'first_publication_receipt_binding_mismatch');
  try { const readback=frozenCopy(await port.readPublicationState(KEY)); verifyReadback(receipt,readback); return {status:'publication-and-readback-verified',receipt,postAttempted,state:prepared}; }
  catch { return {status:'receipt-confirmed-readback-unverified',receipt,postAttempted,state:prepared}; }
}
module.exports={prepare,state,attempt,verifyReadback};

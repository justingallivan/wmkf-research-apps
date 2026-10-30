/** SERVER ONLY, unwired transaction reference core. The trusted server port must
 * authorize against execution context, use one target, enforce IsInTransaction,
 * page ALL inventory, implement conditional SDK writes and atomically roll back
 * EVERY thrown error. Never implement with sequential HTTP writes or catch a
 * fault and continue inside a Dataverse transaction. No tenant proof is implied.
 */
const { createHash } = require('node:crypto');
const { inspectJson, canonicalPreimage, owns } = require('./json-contract');
const { validateRequest, validateActor, validateSnapshot, validateReceipt, incrementRevision, guid, etag, revision, guarded, catalog } = require('./publication-contract');
const { positive } = require('./definition-schema');
const { POLICY_ARTIFACT, matchesPolicy } = require('./template-policy');
const { requiresBudgetFence, validateControl } = require('./budget-coordination');
const { publicationFingerprint, verifyReceiptBinding, validateFreshPublication } = require('./fingerprint');
const DRAFT = 682090000, PUBLISHED = 682090001, RETIRED = 682090002;
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function copy(v) { inspectJson(v); return freeze(JSON.parse(JSON.stringify(v))); }
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => owns(v, k));
const equal = (a, b) => canonicalPreimage(a) === canonicalPreimage(b);
function headKey(promptKey) { return createHash('sha256').update(promptKey, 'utf8').digest('hex'); }
function assertHead(h, request) {
  if (!exact(h, ['keyHash','key','originalKey','revision','etag','highWaterVersion','current'])
      || h.keyHash !== headKey(request.promptKey) || h.key !== request.promptKey || h.originalKey !== request.promptKey
      || !revision(h.revision) || !etag(h.etag) || !Number.isInteger(h.highWaterVersion) || h.highWaterVersion < 0 || h.highWaterVersion > 2147483647
      || (h.current !== null && (!exact(h.current, ['id','version']) || !guid(h.current.id) || !positive(h.current.version) || h.current.version > h.highWaterVersion))) fail('invalid_publication_head');
  if (h.revision !== request.expectedHeadRevision || !equal(h.current, request.expectedCurrent === null ? null : { id: request.expectedCurrent.id, version: request.expectedCurrent.version })) fail('publication_conflict');
}
function inventory(value, request, head) {
  if (!exact(value, ['complete','rows']) || value.complete !== true || !Array.isArray(value.rows) || value.rows.length > 10000) fail('incomplete_publication_inventory');
  const ids = new Set(), versions = new Set();
  for (const row of value.rows) {
    if (!exact(row, ['id','name','version','etag','status','isCurrent','catalog']) || !guid(row.id) || !etag(row.etag)
        || row.name !== request.promptKey || ![DRAFT,PUBLISHED,RETIRED].includes(row.status) || typeof row.isCurrent !== 'boolean'
        || (row.status === DRAFT ? !(row.version === null || positive(row.version)) : !positive(row.version))
        || (row.isCurrent && row.status !== PUBLISHED) || !guarded(row.catalog, catalog).valid) fail('invalid_publication_inventory');
    if (ids.has(row.id) || (row.version !== null && versions.has(row.version))) fail('duplicate_publication_history');
    ids.add(row.id); if (row.version !== null) versions.add(row.version);
  }
  const current = value.rows.filter(r => r.isCurrent);
  if (request.expectedCurrent === null ? current.length !== 0 : (current.length !== 1 || !equal({id:current[0].id,version:current[0].version,etag:current[0].etag}, request.expectedCurrent))) fail('publication_conflict');
  if (request.expectedCurrent === null && value.rows.some(r => r.status !== DRAFT)) fail('legacy_lifecycle_recovery_required');
  if (current.length && !equal(current[0].catalog, request.metadataBaseline.catalog)) fail('catalog_baseline_conflict');
  if ([...versions].some(v => v > head.highWaterVersion)) fail('uninitialized_publication_head');
  const draft = value.rows.find(r => r.id === request.draftId);
  if (!draft || draft.status !== DRAFT || draft.isCurrent || draft.version !== null || draft.etag !== request.draftEtag) fail('publication_conflict');
  return draft;
}
async function replay(port, request, actor) {
  // A read error is UNKNOWN, never absence. No new UUID or retry is created.
  const stored = await port.readReceipt(request.requestId);
  if (stored === null) return null;
  const receipt = copy(stored);
  if (!verifyReceiptBinding(receipt, request, actor)) fail('publication_request_id_reused');
  return receipt;
}
/** Port methods are server dependencies, NOT request fields. withTransaction
 * resolves only after COMMIT; every callback result before then is provisional.
 * Return only the immutable committed receipt. Read refreshed state separately.
 */
async function publish(requestValue, server) {
  const request = copy(requestValue);
  if (!validateRequest(request).valid) fail('invalid_publication_request');
  const actor = copy(await server.authorize());
  if (!validateActor(actor).valid) fail('invalid_publication_actor');
  const prior = await replay(server, request, actor);
  if (prior) return { receipt: prior, replayed: true };
  try {
    return await server.withTransaction(async tx => {
      if (tx.isInTransaction !== true) fail('publication_transaction_required');
      const concurrent = await replay(tx, request, actor);
      if (concurrent) return { receipt: concurrent, replayed: true };
      if (!matchesPolicy({ policyVersion: request.policyRevision, policyArtifactHash: request.policyArtifactHash })) fail('policy_changed');
      let budget = null;
      if (requiresBudgetFence(request.promptKey)) {
        const control = copy(await tx.readBudgetControl());
        validateControl(control);
        const fencedBudget = copy(await tx.fenceBudget({ expectedEtag:control.etag, expectedRevision:control.revision, nextRevision:incrementRevision(control.revision), policyRevision:POLICY_ARTIFACT.policy.policyVersion, policyArtifactHash:POLICY_ARTIFACT.hash }));
        validateControl({...fencedBudget,revision:control.revision});
        if (fencedBudget.revision !== incrementRevision(control.revision) || fencedBudget.etag === control.etag
            || fencedBudget.policyRevision !== POLICY_ARTIFACT.policy.policyVersion || fencedBudget.policyArtifactHash !== POLICY_ARTIFACT.hash) fail('invalid_budget_fence_result');
        budget = { control, state:copy(await tx.readBudgetState()) };
      }
      let head = copy(await tx.readHead(headKey(request.promptKey)));
      if (head === null) {
        if (request.expectedHeadRevision !== '0' || request.expectedCurrent !== null) fail('publication_conflict');
        // Must be create-only under an ACTIVE unique index. Historical names
        // without a seeded high-water head subsequently reject and roll back.
        head = copy(await tx.createHead({keyHash:headKey(request.promptKey),key:request.promptKey,originalKey:request.promptKey,revision:'0',highWaterVersion:0,current:null}));
      }
      assertHead(head, request);
      if (head.highWaterVersion === 2147483647) fail('publication_version_exhausted');
      const nextRevision = incrementRevision(head.revision);
      const fenced = copy(await tx.fenceHead({ keyHash:head.keyHash, expectedEtag:head.etag, expectedRevision:head.revision, nextRevision }));
      // Adapter must return the fenced row's actual updated version, unchanged
      // identity/current/high-water. Never refresh the ORIGINAL precondition.
      assertHead({...fenced,revision:head.revision}, request);
      if (fenced.revision !== nextRevision || fenced.highWaterVersion !== head.highWaterVersion || fenced.etag === head.etag) fail('invalid_head_fence_result');
      const rows = copy(await tx.readInventory(request.promptKey));
      const draftRow = inventory(rows, request, head);
      const draft = copy(await tx.readDraft(request.draftId));
      if (!exact(draft, ['id','name','version','etag','status','isCurrent','snapshot','metadataBaseline']) || draft.id !== draftRow.id || draft.name !== draftRow.name
          || draft.etag !== draftRow.etag || draft.version !== null || draft.status !== DRAFT || draft.isCurrent !== false
          || !validateSnapshot(draft.snapshot).valid || !equal(draft.snapshot.catalog, draftRow.catalog)) fail('publication_conflict');
      if (!equal(draft.metadataBaseline, request.metadataBaseline)) fail('draft_baseline_reconciliation_required');
      const validation = validateFreshPublication(request, draft.snapshot, budget);
      if (!validation.valid) { const e = new Error('invalid_publication_snapshot'); e.code = 'invalid_publication_snapshot'; e.errors = validation.errors; throw e; }
      // Port must strictly validate any required new/changed assignments against
      // the live group catalog, and coordinate removals with referencing writes.
      if (await tx.validateCatalogAssignments({catalog:draft.snapshot.catalog,baseline:request.metadataBaseline.catalog,firstPublication:request.expectedCurrent===null}) !== true) fail('invalid_catalog_assignment');
      const version = head.highWaterVersion + 1;
      const publishedAt = await tx.now();
      const published = copy(await tx.promoteDraft({id:draft.id,expectedEtag:draft.etag,version,publishedAt,clearMetadataBaseline:true}));
      if (request.expectedCurrent !== null) await tx.clearPrevious({id:request.expectedCurrent.id,expectedEtag:request.expectedCurrent.etag});
      await tx.finishHead({keyHash:head.keyHash,expectedEtag:fenced.etag,revision:nextRevision,current:{id:draft.id,version},highWaterVersion:version});
      const receipt = copy({receiptVersion:1,fingerprintVersion:1,request,actor,requestFingerprint:publicationFingerprint(request,actor).hash,published,headRevision:nextRevision,publishedAt});
      if (!validateReceipt(receipt).valid || published.version !== version) fail('invalid_publication_result');
      await tx.createReceipt(receipt); // Create-only, immutable, same transaction.
      return { receipt, replayed:false };
    });
  } catch (error) {
    // OUTSIDE the aborted/unknown transaction, including uniqueness/CAS faults.
    // A racing winner may have committed after either earlier receipt lookup.
    try {
      const committed = await replay(server, request, actor);
      if (committed) return {receipt:committed,replayed:true};
    } catch (lookup) {
      if (lookup.code === 'publication_request_id_reused') throw lookup;
      fail('publication_outcome_unknown');
    }
    throw error;
  }
}
module.exports = { publish, headKey };

/** Create-only import orchestration. Callers supply a guarded target store and an
 * atomic bridge transaction. No credentials, schema provisioning, update/delete,
 * consumer cutover, or inferred identity. Inputs are copied before the first await.
 */
const {planImport, fingerprint} = require('./expertise-roster-import-plan.cjs');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function check(value, message) { if (!value) throw Error(message); }
function sameProfile(profile, row) {
  check(profile && GUID.test(profile.profileGuid), 'Invalid target profile identity');
  for (const [key, value] of Object.entries(row.values)) {
    check(Object.hasOwn(profile.values, key) && profile.values[key] === value,
      `Keyed profile differs at ${key}; reconcile without overwrite`);
  }
}
async function executeImport(input, store) {
  const {source, mapping, reviewedPlan} = structuredClone(input);
  check(reviewedPlan && !reviewedPlan.blocked, 'A nonblocked reviewed plan is required');
  check(reviewedPlan.sourceHash === fingerprint(source) && reviewedPlan.mappingHash === fingerprint(mapping), 'Reviewed inputs changed');
  check(reviewedPlan.targetHost === store.targetHost && mapping.targetHost === store.targetHost, 'Target binding mismatch');
  const floor = source.sequenceHighWater;
  check(Number.isSafeInteger(floor) && floor >= Math.max(0, ...source.rows.map(r => r.id)) && floor < 2147483647, 'Captured source sequence high-water required');
  // The fresh complete census catches collisions and intervening edits before writes.
  const plan = planImport(source, await store.readTarget(), mapping, [store.targetHost]);
  check(!plan.blocked, 'Fresh target conflicts with the reviewed import');
  const projection = rows => rows.map(r => ({legacyId:r.legacyId, creationKey:r.creationKey, values:r.values, excluded:r.action==='exclude'}));
  check(fingerprint(projection(plan.rows)) === fingerprint(projection(reviewedPlan.rows)), 'Reviewed execution payload changed');
  const warnings = rows => rows.map(r => ({key:r.creationKey, warnings:r.warnings}));
  check(fingerprint(warnings(plan.rows)) === fingerprint(warnings(reviewedPlan.rows)), 'Target warnings changed; review a fresh plan');
  await store.preflight(plan);
  const result = {version:1, targetHost:store.targetHost, datasetId:source.datasetId,
    sourceHash:plan.sourceHash, mappingHash:plan.mappingHash, success:false, bridgeCommitted:false, rows:[]};
  let currentKey = null;
  try {
    await store.bridgeTransaction(floor, async bridge => {
      // Reserve ALL legacy identities before allocating numbers for new people.
      for (const row of plan.rows) if (row.legacyId !== null) await bridge.ensureIdentity(row.legacyId);
      for (const row of plan.rows) {
        currentKey = row.creationKey;
        const bound = row.legacyId === null ? null : await bridge.lookup(row.legacyId, store.targetHost);
        if (row.action === 'exclude') {
          check(!bound, 'Excluded identity already has a binding; reconcile without deletion');
          result.rows.push({creationKey:row.creationKey, legacyId:row.legacyId, rosterId:row.legacyId, status:'identity-only'});
          continue;
        }
        let profile = await store.findByKey(row.creationKey);
        check(!bound || profile?.profileGuid === bound, 'Existing numeric identity has a conflicting target binding');
        if (!profile) {
          try { await store.create(row.values); }
          catch (error) {
            // A lost response or competing create may have committed. Never PATCH.
            profile = await store.findByKey(row.creationKey);
            if (!profile) throw error;
          }
          profile = profile || await store.findByKey(row.creationKey);
        }
        sameProfile(profile, row);
        const rosterId = await bridge.bind(row.legacyId, store.targetHost, profile.profileGuid);
        result.rows.push({creationKey:row.creationKey, legacyId:row.legacyId, rosterId,
          profileGuid:profile.profileGuid, status:'bound'});
      }
    });
    result.success = true; result.bridgeCommitted = true;
  } catch (error) {
    // The SQL transaction rolls back as a unit; Dataverse creates are retained.
    // Retrying the unchanged manifest recovers them by creation key.
    for (const row of result.rows) { row.status = row.profileGuid ? 'profile-retained-bridge-unconfirmed' : 'identity-unconfirmed'; row.rosterId = null; }
    result.failure = {creationKey:currentKey, message:error.message, retry:'Replay unchanged inputs; keyed-value or binding conflicts require reconciliation.'};
  }
  return result;
}
module.exports = {executeImport, sameProfile};

/** Sequential, resumable import. No locks, mirrored roster, or automatic rollback.
 * Each receipt identifies its source ID/key. A row succeeds only after readback AND
 * numeric binding. A lost create response is recovered by the immutable key.
 */
async function executeImport(plan, store, { apply = false } = {}) {
  if (plan.blocked) throw new Error('Import is blocked; resolve every planner error before writing.');
  const receipt = { datasetId: plan.datasetId, targetHost: plan.targetHost, sourceHash: plan.sourceHash, mappingHash: plan.mappingHash, rows: [] };
  if (!apply) return { ...receipt, verified: false, dryRun: true };
  // Preserve excluded IDs too, including every feedback reference. Advance once
  // before any additions allocate from the existing roster sequence.
  await store.prepareIdentities(plan.rows.filter(r => r.legacyId != null).map(r => r.legacyId));
  for (const row of plan.rows) {
    const result = { legacyId: row.legacyId, creationKey: row.creationKey, status: 'failed' };
    try {
      if (row.action === 'exclude') {
        result.status = 'excluded';
      } else {
        let profile = await store.byKey(row.creationKey);
        if (!profile) {
          try { await store.create(row.values); }
          catch (error) { profile = await store.byKey(row.creationKey); if (!profile) throw error; }
          profile = profile || await store.byKey(row.creationKey);
        }
        if (!profile) throw new Error('Create outcome unconfirmed; retry this dataset.');
        for (const [key, value] of Object.entries(row.values)) {
          if (!Object.hasOwn(profile.values, key) || profile.values[key] !== value) throw new Error(`Readback differs at ${key}; no overwrite attempted.`);
        }
        result.profileGuid = profile.profileGuid;
        result.rosterId = await store.bind(row.legacyId, profile.profileGuid, row.creationKey);
        result.status = 'verified';
      }
    } catch (error) { result.error = String(error.message || 'Row could not be verified.').slice(0, 1000); result.errorCode = error.code || error.dataverseCode || null; result.httpStatus = error.status || null; }
    receipt.rows.push(result);
    // Durable private receipt after every completed row; not merely an end count.
    await store.saveReceipt(receipt);
  }
  receipt.verified = receipt.rows.every(r => ['verified', 'excluded'].includes(r.status));
  await store.saveReceipt(receipt);
  return receipt;
}
module.exports = { executeImport };

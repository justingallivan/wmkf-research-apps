/** Staff-facing evidence labels shared by both screens and their exports.
 * Never turn heuristic name scores or unknown/legacy evidence into identity proof.
 */
function integrityIdentityLabel(match) {
  if (match?.matchingVersion !== 2) return 'Earlier matching rules · identity not established';
  if (match.identityStatus !== 'unverified') return 'Identity unverified';
  const labels = {
    exact_name: 'Exact name match',
    compatible_initials: 'Initials match',
    recognized_variant: 'Name variant',
    ambiguous_name: 'Possible namesake',
  };
  return Object.hasOwn(labels, match.nameEvidence)
    ? `${labels[match.nameEvidence]} · identity unverified` : 'Identity unverified';
}

function integrityDatasetUnverified(dataset) {
  if (dataset === undefined || dataset === null) return false; // legacy runs
  if (dataset.status === 'unrecorded') return !['unmanaged', 'unpublished'].includes(dataset.state);
  return dataset.status !== 'recorded' || !/^[1-9]\d*$/.test(dataset.generation)
    || !/^[a-f0-9]{64}$/.test(dataset.checksum)
    || !Number.isFinite(Date.parse(dataset.publishedAt)) || !Number.isFinite(Date.parse(dataset.lastCheckedAt));
}

function integrityIncomplete(result) {
  if (integrityDatasetUnverified(result?.sources?.retraction_watch?.dataset)) return true;
  return ['retraction_watch', 'pubpeer', 'news'].some((key) => (
    result?.sources?.[key]?.searched !== true || Boolean(result.sources[key].error)
  ));
}

function integritySourceLabel(source) {
  if (!source || source.searched !== true || source.error || integrityDatasetUnverified(source.dataset)) return 'Incomplete source';
  return source.hasConcerns ? 'Flagged for human review' : 'No concerns reported';
}

function integrityResultLabel(result) {
  if (integrityIncomplete(result)) return 'Incomplete screen';
  return result?.hasConcerns ? 'Items for human review' : 'No concerns reported';
}

function integrityRetentionLabel(match) {
  const provenance = match?.retentionProvenance;
  return provenance?.kind === 'retained_legacy_record'
    ? `Retained from prior corpus (record ${provenance.recordId}) · ID absent from upstream feed · notice verified ${provenance.reviewedAt} · ${provenance.noticeUrl}` : '';
}

function integrityDatasetLabel(dataset, now = Date.now()) {
  if (integrityDatasetUnverified(dataset)) return 'Dataset version could not be verified.';
  if (dataset?.status !== 'recorded' || !dataset.generation || !dataset.checksum
    || !Number.isFinite(Date.parse(dataset.publishedAt)) || !Number.isFinite(Date.parse(dataset.lastCheckedAt))) return 'Dataset version not recorded.';
  const stale = now - Date.parse(dataset.lastCheckedAt) > 45 * 24 * 60 * 60 * 1000;
  return `Dataset ${dataset.generation} (upstream ${dataset.checksum.slice(0, 12)}) · published ${dataset.publishedAt.slice(0, 10)} · checked ${dataset.lastCheckedAt.slice(0, 10)}${dataset.retainedRecords?.length ? ` · ${dataset.sourceRowCount} upstream + ${dataset.retainedRecords.length} retained legacy records` : ''}${stale ? ' · Freshness warning: last successful check is over 45 days old.' : ''}`;
}

module.exports = { integrityIdentityLabel, integrityIncomplete, integritySourceLabel, integrityResultLabel, integrityDatasetLabel, integrityDatasetUnverified, integrityRetentionLabel };

/** Corpus publication metadata for the screening generation fence.
 * Table absent/unpublished is an explicit legacy provenance state. Query or
 * metadata errors are unverified, not proof of a stable publication generation.
 */
async function readRetractionDataset(sql) {
  try {
    const table = await sql`SELECT to_regclass('retraction_dataset')::text AS relation`;
    if (table.rows?.[0]?.relation === null) return { status: 'unrecorded', state: 'unmanaged' };
    if (typeof table.rows?.[0]?.relation !== 'string') return { status: 'unverified' };
    const result = await sql`SELECT generation,source_url,source_checksum,published_at,last_checked_at,row_count,source_row_count,retained_records,format_version FROM retraction_dataset WHERE singleton_id=1`;
    if (!result.rows?.length) return { status: 'unrecorded', state: 'unpublished' };
    const row = result.rows[0];
    if (!row.published_at || !row.last_checked_at || typeof row.source_url !== 'string' || !row.source_url) return { status: 'unverified' };
    const retained = row.retained_records;
    if (!Number.isSafeInteger(row.source_row_count) || row.source_row_count < 1 || !Array.isArray(retained)
      || row.row_count !== row.source_row_count + retained.length
      || retained.some(item => !item || item.kind !== 'retained_legacy_record' || typeof item.recordId !== 'string'
        || !/^[a-f0-9]{64}$/.test(item.recordSha256) || !/^[a-f0-9]{64}$/.test(item.backupSha256)
        || !/^https:\/\//.test(item.noticeUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedAt))) return { status: 'unverified' };
    const generation = String(row.generation);
    const publishedAt = new Date(row.published_at).toISOString();
    const lastCheckedAt = new Date(row.last_checked_at).toISOString();
    if (!/^[1-9]\d*$/.test(generation) || !/^[a-f0-9]{64}$/.test(row.source_checksum)
      || row.format_version !== 1 || !Number.isSafeInteger(row.row_count) || row.row_count < 1) return { status: 'unverified' };
    return { status: 'recorded', generation, checksum: row.source_checksum, sourceUrl: row.source_url,
      publishedAt, lastCheckedAt, rowCount: row.row_count, sourceRowCount: row.source_row_count, retainedRecords: retained };
  } catch { return { status: 'unverified' }; }
}
function sameRetractionDataset(before, after) {
  if (!before || !after) return false;
  if (before.status === 'unrecorded' && after.status === 'unrecorded') {
    return ['unmanaged', 'unpublished'].includes(before.state) && before.state === after.state;
  }
  if (before.status !== 'recorded' || after.status !== 'recorded') return false;
  return /^[1-9]\d*$/.test(before.generation) && /^[a-f0-9]{64}$/.test(before.checksum)
    && before.generation === after.generation && before.checksum === after.checksum;
}

module.exports = { readRetractionDataset, sameRetractionDataset };

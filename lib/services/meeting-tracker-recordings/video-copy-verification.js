/** Pure verification for filling missing metadata on an already finalized Zoom copy. No I/O or writes. */
export function needsVideoCopyVerification(row) {
  return row?.state === 'copied' && (!row.recording_start || !row.recording_end || !row.sharepoint_quickxor_hash);
}

/**
 * Prove the original receipt still identifies the current SharePoint content and Zoom file.
 * SharePoint may change an eTag for metadata alone; an unchanged, recorded content version is also valid.
 * Existing timestamps/hashes must agree. Never replace conflicting evidence with today's values.
 */
export function verifiedVideoCopyMetadata(row, meeting, item) {
  const refuse = () => { throw new Error('zoom_video_verification_failed'); };
  const size = Number(row?.declared_size);
  if (!row || row.state !== 'copied' || row.intent_state !== 'finalized' || row.intent_origin !== 'zoom_copy'
    || !row.request_document_id || row.request_document_id !== row.intent_request_document_id
    || !row.sharepoint_drive_id || !row.sharepoint_item_id
    || row.sharepoint_drive_id !== row.candidate_drive_id || row.sharepoint_item_id !== row.candidate_item_id
    || !Number.isSafeInteger(size) || size < 1 || Number(row.candidate_size) !== size) refuse();
  const files = (meeting?.recording_files || []).filter(file => file.id === row.zoom_file_id);
  const file = files[0];
  if (meeting?.uuid !== row.zoom_meeting_uuid || meeting?.host_id !== row.zoom_host_id || files.length !== 1
    || file.status !== 'completed' || String(file.file_extension).toUpperCase() !== 'MP4'
    || file.recording_type !== row.zoom_recording_type || Number(file.file_size) !== size) refuse();
  const start = Date.parse(file.recording_start);
  const end = Date.parse(file.recording_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start
    || (row.recording_start != null && new Date(row.recording_start).getTime() !== start)
    || (row.recording_end != null && new Date(row.recording_end).getTime() !== end)) refuse();
  const sameVersion = Boolean(row.candidate_version_id && item?.versionId === row.candidate_version_id);
  const sameEtag = Boolean(row.candidate_etag && item?.eTag === row.candidate_etag);
  if (!item || item.id !== row.sharepoint_item_id || item.driveId !== row.sharepoint_drive_id
    || Number(item.size) !== size || (!sameVersion && !sameEtag)
    || typeof item.quickXorHash !== 'string' || !item.quickXorHash || item.quickXorHash.length > 100
    || (row.sharepoint_quickxor_hash && row.sharepoint_quickxor_hash !== item.quickXorHash)) refuse();
  return { recordingStart: new Date(start).toISOString(), recordingEnd: new Date(end).toISOString(), quickXorHash: item.quickXorHash };
}

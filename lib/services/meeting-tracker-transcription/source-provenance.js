/**
 * Content-free transcript source identity (bundle v6). Pure validation/projection:
 * no I/O, identity inference, timestamp repair or audio/video synchronization proof.
 * Frozen at publication and carried unchanged through label/boundary corrections.
 */
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const id = (x, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
function fail() { const e = new TypeError('invalid_source_provenance'); e.code = 'invalid_source_provenance'; throw e; }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) || !Number.isFinite(Date.parse(x))) fail();
  return new Date(x).toISOString();
}

export function normalizeRecordingFile(value, type) {
  if (!exact(value, ['fileId','recordingType','bytes','recordingStart','recordingEnd','sha256'])
    || !id(value.fileId) || value.recordingType !== type || !positive(value.bytes) || !SHA.test(value.sha256 || '')) fail();
  const recordingStart = instant(value.recordingStart), recordingEnd = instant(value.recordingEnd);
  if (recordingEnd < recordingStart) fail();
  return { fileId: value.fileId, recordingType: type, bytes: value.bytes, recordingStart, recordingEnd, sha256: value.sha256 };
}

/** Import capture is complete before start dispatch; it contains no download URLs. */
export function normalizeRecordingCapture(value) {
  if (!exact(value, ['version','audioOnlyFileCount','audioFile','transcriptFile']) || value.version !== 1 || !positive(value.audioOnlyFileCount)) fail();
  return { version: 1, audioOnlyFileCount: value.audioOnlyFileCount,
    audioFile: normalizeRecordingFile(value.audioFile, 'audio_only'),
    transcriptFile: value.transcriptFile === null ? null : normalizeRecordingFile(value.transcriptFile, 'audio_transcript') };
}

export function normalizeSourceProvenance(value) {
  if (value == null) return null;
  if (!exact(value, ['version','sourceId','kind','audioSha256','audioBytes','audioDurationMs','zoom'])
    || value.version !== 1 || !UUID.test(value.sourceId || '') || !['zoom','upload'].includes(value.kind)
    || !SHA.test(value.audioSha256 || '') || !positive(value.audioBytes) || !positive(value.audioDurationMs)) fail();
  let zoom = null;
  if (value.kind === 'upload') { if (value.zoom !== null) fail(); }
  else {
    const z = value.zoom;
    if (!exact(z, ['importId','meetingUuid','hostId','audioOnlyFileCount','audioFile','transcriptFile'])
      || !UUID.test(z.importId || '') || !id(z.meetingUuid) || !id(z.hostId, 100)) fail();
    const capture = normalizeRecordingCapture({ version: 1, audioOnlyFileCount: z.audioOnlyFileCount, audioFile: z.audioFile, transcriptFile: z.transcriptFile });
    if (capture.audioFile.sha256 !== value.audioSha256 || capture.audioFile.bytes !== value.audioBytes) fail();
    zoom = { importId: z.importId.toLowerCase(), meetingUuid: z.meetingUuid, hostId: z.hostId,
      audioOnlyFileCount: capture.audioOnlyFileCount, audioFile: capture.audioFile, transcriptFile: capture.transcriptFile };
  }
  const normalized = { version: 1, sourceId: value.sourceId.toLowerCase(), kind: value.kind,
    audioSha256: value.audioSha256, audioBytes: value.audioBytes, audioDurationMs: value.audioDurationMs, zoom };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 8192) fail();
  return normalized;
}

export function sameSourceProvenance(a, b) {
  try { return JSON.stringify(normalizeSourceProvenance(a)) === JSON.stringify(normalizeSourceProvenance(b)); }
  catch { return false; }
}

/** Only server-loaded, request/visit-scoped job and import rows may enter here. */
export function provenanceFromJob(job, imported) {
  if (imported && !imported.selected_recording_files) return null; // historical import: never invent origin
  if (!job?.audio_sha256 || !job?.verified_bytes || !job?.audio_duration_ms) return null;
  const capture = imported ? normalizeRecordingCapture(imported.selected_recording_files) : null;
  if (capture?.transcriptFile && capture.transcriptFile.sha256 !== job.zoom_transcript_sha256) fail();
  return normalizeSourceProvenance({ version: 1, sourceId: job.id, kind: imported ? 'zoom' : 'upload',
    audioSha256: job.audio_sha256, audioBytes: Number(job.verified_bytes), audioDurationMs: Number(job.audio_duration_ms),
    zoom: imported ? { importId: imported.id, meetingUuid: imported.zoom_meeting_uuid, hostId: imported.zoom_host_id,
      audioOnlyFileCount: capture.audioOnlyFileCount, audioFile: capture.audioFile, transcriptFile: capture.transcriptFile } : null });
}

/** Server-only projection of a validated current binding; not an authorization gate. */
export function resolveSourceProvenance(value) {
  try {
    const provenance = normalizeSourceProvenance(value);
    return provenance ? { status: provenance.kind === 'zoom' ? 'verified_zoom' : 'upload', provenance }
      : { status: 'legacy_unknown', provenance: null };
  } catch { return { status: 'invalid', provenance: null }; }
}

/**
 * "Upload updated file" for one Applicant materials slot: a coordinator
 * uploads a file the PI sent, whatever the collection's state
 * (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.4).
 * Bytes go browser-direct to private staging, then staff-finalize scans,
 * stores, and registers them inline; the page must stay open until it ends.
 */
import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { siteVisitMaterialsScanRejectionMessage } from '../../utils/site-visit-materials-scan-rejection';

const MEBIBYTE = 1024 * 1024;

const REASON_MESSAGE = {
  extension_not_allowed: 'That file type is not accepted for this item.',
  file_too_large: 'The file is larger than the upload limit.',
  slot_busy: 'Another upload for this item is still being saved. Try again once it finishes.',
  processing_busy: 'Another large upload is being processed. Wait a moment and try again.',
  staff_actor_unavailable: 'Your account is not linked to a Dynamics user, so the upload cannot be recorded. Contact an administrator.',
  scan_timeout: 'The security scan did not finish in time. Try again.',
  scan_busy: 'The security scanner is busy. Wait a few minutes and try again.',
  scan_unavailable: 'The security scanner is unavailable. Try again shortly.',
  replay_ambiguous: 'This upload needs an administrator to reconcile it before it can be saved.',
};

export default function StaffMaterialUpload({ requestId, slot, label, disabled = false, onUploaded }) {
  const [phase, setPhase] = useState(null);
  const [percent, setPercent] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setPhase(null);
    setPercent(null);
    setError(null);
    return () => { generationRef.current += 1; };
  }, [requestId, slot]);

  const base = `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`;

  const fail = (generation, reason, fallback, extra = {}) => {
    if (generation !== generationRef.current) return;
    setPhase(null);
    setPercent(null);
    if (reason === 'scan_infected') { setError(siteVisitMaterialsScanRejectionMessage(extra.scanRejection)); return; }
    if (reason === 'file_too_large' && Number.isFinite(extra.maxMb)) { setError(`The file is larger than the ${extra.maxMb} MB upload limit.`); return; }
    setError(REASON_MESSAGE[reason] || fallback);
  };

  const upload = async (file) => {
    if (!file) return;
    const generation = ++generationRef.current;
    setError(null);
    setPercent(null);
    setPhase('Preparing…');
    try {
      const token = await requestEnvelope(`${base}/staff-upload-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { slot, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size },
        tolerantBody: true,
      });
      if (generation !== generationRef.current) return;
      if (!token.ok) { fail(generation, token.data?.reason, 'The upload could not start.', token.data || {}); return; }

      const { put } = await import('@vercel/blob/client');
      if (generation !== generationRef.current) return;
      setPhase('Uploading…');
      try {
        await put(token.data.pathname, file, {
          access: 'private',
          token: token.data.clientToken,
          contentType: token.data.contentType,
          multipart: file.size > 60 * MEBIBYTE,
          onUploadProgress: (event) => {
            if (generation !== generationRef.current) return;
            const value = Number(event?.percentage);
            setPercent(Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : null);
          },
        });
      } catch {
        fail(generation, null, 'The file could not be uploaded. Check your connection and try again.');
        return;
      }
      if (generation !== generationRef.current) return;
      setPercent(null);
      setPhase('Checking and saving the file. Keep this page open…');
      const saved = await requestEnvelope(`${base}/staff-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { stagingId: token.data.stagingId, slot },
        tolerantBody: true,
      });
      if (generation !== generationRef.current) return;
      if (!saved.ok) { fail(generation, saved.data?.reason, 'The file could not be saved. Try again.', saved.data || {}); return; }
      setPhase(null);
      onUploaded?.(saved.data);
    } catch {
      fail(generation, null, 'The upload could not be completed. Try again.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const busy = Boolean(phase);
  return (
    <div className="text-right">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={`${label}: choose a file`}
        disabled={disabled || busy}
        onChange={(event) => { void upload(event.target.files?.[0]); }}
        data-testid={`staff-upload-input-${slot}`}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50"
      >
        {label}
      </button>
      {busy && <p className="mt-1 text-xs text-blue-800" role="status">{phase}{percent !== null ? ` ${percent}%` : ''}</p>}
      {error && <p className="mt-1 text-xs text-red-800" role="alert">{error}</p>}
    </div>
  );
}

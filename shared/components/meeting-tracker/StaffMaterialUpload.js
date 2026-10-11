/**
 * "Upload updated file" for one Applicant materials slot: a coordinator
 * uploads a file the PI sent, whatever the collection's state
 * (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.4).
 * Bytes go browser-direct to private staging, then staff-finalize scans,
 * stores, and registers them inline; the page must stay open until it ends.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '../Layout';
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

// Same rule as the applicant page: a 4xx other than 409/429 means the server
// rejected this staged upload for good; anything else (5xx, 409, 429, a lost
// response) may have partly succeeded, so Retry re-finalizes the SAME staging
// row. Its generation key reuses the registry row it may already have created
// and finishes retiring the previous file, instead of uploading another copy.
function isTerminalFinalize(status) {
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 409 && status !== 429;
}

// `showTrigger={false}` hides the button so a row menu can start the upload through the ref's `open()` (Site Visit
// redesign §3.2); progress, errors and Retry still show here either way.
function StaffMaterialUpload({ requestId, slot, label, disabled = false, onUploaded, showTrigger = true, onBlockedChange }, ref) {
  const [phase, setPhase] = useState(null);
  const [percent, setPercent] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const inputRef = useRef(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setPhase(null);
    setPercent(null);
    setError(null);
    setPending(null);
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

  const finalize = async (staged, generation) => {
    setError(null);
    setPercent(null);
    setPhase('Checking and saving the file. Keep this page open…');
    let saved;
    try {
      saved = await requestEnvelope(`${base}/staff-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { stagingId: staged.stagingId, slot: staged.slot },
        tolerantBody: true,
      });
    } catch {
      // The response was lost; the server may have saved the file. Keep the staging id.
      fail(generation, null, 'The result could not be confirmed. Press Retry to finish saving this file.');
      return;
    }
    if (generation !== generationRef.current) return;
    if (saved.ok) {
      setPending(null);
      setPhase(null);
      onUploaded?.(saved.data);
      return;
    }
    if (isTerminalFinalize(saved.status)) setPending(null);
    fail(generation, saved.data?.reason,
      isTerminalFinalize(saved.status) ? 'The file could not be saved.' : 'The file could not be saved yet. Press Retry to finish saving it.',
      saved.data || {});
  };

  const retry = () => {
    if (!pending) return;
    void finalize(pending, ++generationRef.current);
  };

  const upload = async (file) => {
    if (!file || pending) return;
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
      const staged = { stagingId: token.data.stagingId, slot };
      setPending(staged);
      await finalize(staged, generation);
    } catch {
      fail(generation, null, 'The upload could not be completed. Try again.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const busy = Boolean(phase);
  const blocked = disabled || busy || Boolean(pending);
  useImperativeHandle(ref, () => ({ open: () => { if (!blocked) inputRef.current?.click(); } }), [blocked]);
  // A row menu that starts this upload mirrors whether it can (an unfinished earlier file blocks another).
  useEffect(() => { onBlockedChange?.(blocked); }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    // Fixed width so progress and error text wrap inside the control instead of
    // widening the row's action column and pushing "Open file" sideways.
    // Same element in every state (only its class changes), so the input and Retry state survive a re-render.
    <div className={showTrigger || busy || error || pending ? 'w-44 text-right' : 'text-right'}>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={`${label}: choose a file`}
        disabled={disabled || busy || Boolean(pending)}
        onChange={(event) => { void upload(event.target.files?.[0]); }}
        data-testid={`staff-upload-input-${slot}`}
      />
      {showTrigger && (
        <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => inputRef.current?.click()}>
          {label}
        </Button>
      )}
      {busy && <p className="mt-1 text-xs text-blue-800" role="status">{phase}{percent !== null ? ` ${percent}%` : ''}</p>}
      {error && <p className="mt-1 text-xs text-red-800" role="alert">{error}</p>}
      {pending && !busy && <p className="mt-1 text-xs text-gray-700">Press Retry to finish saving the earlier file first.</p>}
      {pending && !busy && (
        <button
          type="button"
          disabled={disabled}
          onClick={retry}
          className="mt-1 text-xs font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900 disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default forwardRef(StaffMaterialUpload);

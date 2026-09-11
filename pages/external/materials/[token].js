/**
 * Applicant materials contributor page (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16).
 * Token-authed, not user-authed. The PI or liaison sees the checklist for the
 * site visit, uploads one file per item directly to the private staging
 * store, and the server files it. The page never sees SharePoint identity.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED } from '../../../shared/config/siteVisitMaterials';

const REASON_MESSAGE = {
  no_token: 'This link is missing its access token.',
  malformed: 'This link is malformed.',
  invalid_signature: 'This link is invalid.',
  invalid_claim: 'This link is invalid.',
  expired: 'This link has expired. Please contact the Foundation if you still need to send materials.',
  closed: 'This collection has closed. Please contact the Foundation if you still need to send materials.',
  not_found: 'This page is not available.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
};
const UPLOAD_MESSAGE = {
  file_too_large: 'That file is larger than the upload limit.',
  extension_not_allowed: 'That file type is not accepted for this item.',
  signature_mismatch: 'That file does not match its extension. Please export it again and retry.',
  empty_file: 'That file is empty.',
  scan_infected: 'That file failed the malware scan and was not accepted.',
  scan_unavailable: 'The file could not be scanned right now. Please try again in a few minutes.',
  scan_misconfigured: 'Uploads are temporarily unavailable while the file scanner is repaired.',
  content_type_not_allowed: 'That file type is not accepted.',
  staging_unavailable: 'Uploads are unavailable right now. Please try again shortly.',
  staged_upload_missing: 'The upload did not complete. Please try again.',
  finalize_in_progress: 'That upload is still being processed. Please wait a moment.',
  slot_busy: 'Another upload for this item is being processed. Please wait a moment and retry.',
  replay_ambiguous: 'This upload needs staff attention before it can be finalized.',
  cap_unavailable: 'The upload limit is unavailable right now. Please try again shortly.',
};

function pendingStorageKey(token, slot) {
  return `site-visit-materials:pending:${token}:${slot}`;
}

function readPendingUpload(token, slot) {
  try {
    const raw = window.sessionStorage.getItem(pendingStorageKey(token, slot));
    const value = raw ? JSON.parse(raw) : null;
    return value?.slot === slot && typeof value?.stagingId === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writePendingUpload(token, slot, value) {
  try {
    window.sessionStorage.setItem(pendingStorageKey(token, slot), JSON.stringify(value));
  } catch {
    // A blocked/full storage area must not prevent an in-page retry.
  }
}

function removePendingUpload(token, slot) {
  try {
    window.sessionStorage.removeItem(pendingStorageKey(token, slot));
  } catch {
    // The in-memory state still clears for this page load.
  }
}

function formatDate(iso) {
  const date = new Date(iso || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

function Shell({ title, children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <Head><title>{title}</title></Head>
      <main className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">W. M. Keck Foundation</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function SlotUploader({ token, slot, label, required, received, maxMb, disabled, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setPending(readPendingUpload(token, slot)), 0);
    return () => window.clearTimeout(timer);
  }, [token, slot]);

  const finalize = async (pendingUpload) => {
    setBusy(true);
    setError(null);
    setProgress('Checking the file…');
    try {
      const finalizeRes = await fetch(`/api/external/materials/${encodeURIComponent(token)}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagingId: pendingUpload.stagingId, slot }),
      });
      const result = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        if (finalizeRes.status >= 400 && finalizeRes.status < 500 && finalizeRes.status !== 409) {
          removePendingUpload(token, slot);
          setPending(null);
        }
        setError(UPLOAD_MESSAGE[result.reason] || REASON_MESSAGE[result.reason] || 'The file could not be saved.');
        return;
      }
      removePendingUpload(token, slot);
      setPending(null);
      await onDone?.();
    } catch {
      // Network failures retain the exact staging id so Retry never mints a
      // second upload or loses the server's replay/candidate state.
      setError('The file could not be saved. Please retry this same upload.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const chooseDifferentFile = async (file) => {
    if (!file) return;
    removePendingUpload(token, slot);
    setPending(null);
    setError(null);
    await upload(file);
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress('Preparing…');
    try {
      const tokenRes = await fetch(`/api/external/materials/${encodeURIComponent(token)}/upload-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) throw new Error(UPLOAD_MESSAGE[tokenData.reason] || REASON_MESSAGE[tokenData.reason] || 'The upload could not start.');
      setProgress('Uploading…');
      const { put } = await import('@vercel/blob/client');
      await put(tokenData.pathname, file, { access: 'private', token: tokenData.clientToken, contentType: tokenData.contentType });
      const nextPending = { stagingId: tokenData.stagingId, slot };
      writePendingUpload(token, slot, nextPending);
      setPending(nextPending);
      await finalize(nextPending);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900">{label}{required ? '' : <span className="ml-2 text-xs font-normal text-gray-500">optional</span>}</p>
          <p className="mt-1 text-sm text-gray-600">
            {received ? `Received ${formatDate(received.receivedAt)} · ${received.filename}` : 'Not yet received'}
          </p>
          {progress && <p className="mt-1 text-sm text-blue-800" role="status">{progress}</p>}
          {error && <p className="mt-1 text-sm text-red-700" role="alert">{error}</p>}
        </div>
        {!disabled && pending && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className={`rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 ${busy ? 'opacity-50' : ''}`}
              onClick={() => { void finalize(pending); }}
            >
              {busy ? 'Working…' : 'Retry'}
            </button>
            <label className={`cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 ${busy ? 'opacity-50' : ''}`}>
              Choose a different file
              <input type="file" className="sr-only" disabled={busy} aria-label={`${label} different file`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void chooseDifferentFile(file); }} />
            </label>
          </div>
        )}
        {!disabled && !pending && (
          <label className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold ${received ? 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50' : 'bg-gray-900 text-white hover:bg-gray-800'} ${busy ? 'opacity-50' : ''}`}>
            {busy ? 'Working…' : received ? 'Replace file' : 'Choose file'}
            <input type="file" className="sr-only" disabled={busy} aria-label={`${label} file`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
          </label>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">Up to {maxMb} MB.</p>
    </li>
  );
}

export default function MaterialsContributorPage() {
  const router = useRouter();
  const { token } = router.query;
  const [state, setState] = useState({ status: 'loading' });

  const load = async () => {
    try {
      const res = await fetch(`/api/external/materials/${encodeURIComponent(token)}/context`);
      const data = await res.json().catch(() => ({ ok: false, reason: 'server_error' }));
      setState(data.ok ? { status: 'ok', data } : { status: 'error', reason: data.reason });
    } catch {
      setState({ status: 'error', reason: 'server_error' });
    }
  };

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/external/materials/${encodeURIComponent(token)}/context`);
        const data = await res.json().catch(() => ({ ok: false, reason: 'server_error' }));
        if (!cancelled) setState(data.ok ? { status: 'ok', data } : { status: 'error', reason: data.reason });
      } catch {
        if (!cancelled) setState({ status: 'error', reason: 'server_error' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') return <Shell title="Site visit materials"><p className="mt-4 text-gray-600">Loading…</p></Shell>;
  if (state.status === 'error') return <Shell title="Site visit materials"><p className="mt-4 text-gray-800">{REASON_MESSAGE[state.reason] || 'This link cannot be opened.'}</p></Shell>;

  const { data } = state;
  const allRequiredIn = data.checklist.filter((item) => item.required).every((item) => item.received);
  return (
    <Shell title={data.institution ? `Site visit materials · ${data.institution}` : 'Site visit materials'}>
      {data.proposalTitle && <p className="mt-1 text-lg text-gray-700">{data.proposalTitle}</p>}
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-800">
        {data.closed ? (
          <p>This collection has closed. Thank you for the materials you sent.</p>
        ) : (
          <>
            <p>Please upload the items below by <span className="font-medium">{formatDate(data.dueAt)}</span>.</p>
            {allRequiredIn && <p className="mt-2 font-medium text-green-800" role="status">Every required item has been received. Thank you.</p>}
            {data.outOfSync && <p className="mt-2 text-amber-800" role="status">The PDF and the source presentation were updated at different times. If you changed one, please replace the other too so they match.</p>}
          </>
        )}
      </section>
      <ul className="mt-6 space-y-3">
        {data.checklist.map((item) => (
          <SlotUploader key={item.key} token={token} slot={item.key} label={item.label} required={item.required} received={item.received} maxMb={data.maxMb} disabled={data.closed} onDone={load} />
        ))}
        {SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED && (
          <SlotUploader key="other" token={token} slot="other" label="Anything else you would like the Foundation to have" required={false} received={null} maxMb={data.maxMb} disabled={data.closed} onDone={load} />
        )}
      </ul>
      {data.other?.length > 0 && (
        <section className="mt-6 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900">Other files received</h2>
          <ul className="mt-2 list-disc pl-5">{data.other.map((file) => <li key={`${file.filename}-${file.receivedAt}`}>{file.filename} · {formatDate(file.receivedAt)}</li>)}</ul>
        </section>
      )}
      {data.supportEmail && (
        <p className="mt-6 text-sm text-gray-600">
          Need help? Email <a className="text-blue-800 underline" href={`mailto:${data.supportEmail}?subject=${encodeURIComponent(`Site visit materials — ${data.proposalTitle || data.institution || ''}`)}`}>{data.supportEmail}</a>.
        </p>
      )}
    </Shell>
  );
}

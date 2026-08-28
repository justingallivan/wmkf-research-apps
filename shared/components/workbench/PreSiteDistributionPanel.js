import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';

const DEFAULT_BODY = 'Please find the Site Visit materials attached.';
const EMPTY_LIST = Object.freeze([]);
const STALE_PREVIEW_CODES = new Set([
  'distribution_stale_source',
  'distribution_material_stale',
  'distribution_site_visit_stale',
  'distribution_preview_changed',
]);

function newOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
    + `-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function downloadUrl(webUrl) {
  if (!webUrl) return null;
  try {
    const url = new URL(webUrl);
    url.searchParams.set('download', '1');
    return url.toString();
  } catch {
    return `${webUrl}${webUrl.includes('?') ? '&' : '?'}download=1`;
  }
}

// Presentation split (S466): a preview whose send was refused because the
// underlying source/materials/schedule changed is a dead draft, not a failure
// demanding action — it renders as quiet "Superseded". Red is reserved for
// sends that actually failed. One guard (Codex S466): the email activity is
// created only AFTER the staleness checks, so a stale-coded attempt WITHOUT a
// Dynamics activity provably never reached Dynamics — but one WITH an activity
// may have transported before its outcome was lost, and a later stale failure
// overwrites that error code. Those render as "Send outcome unconfirmed" so
// staff verify the activity before sending a new copy (duplicate-send risk).
function attemptPresentation(attempt) {
  if (attempt.transportAccepted) {
    return { label: 'Sent', pillClass: 'bg-green-100 text-green-800', superseded: false, unconfirmed: false };
  }
  if (attempt.lastError) {
    if (STALE_PREVIEW_CODES.has(attempt.lastErrorCode)) {
      if (attempt.dynamicsEmailId) {
        return { label: 'Send outcome unconfirmed', pillClass: 'bg-amber-100 text-amber-800', superseded: false, unconfirmed: true };
      }
      return { label: 'Superseded', pillClass: 'bg-gray-100 text-gray-600', superseded: true, unconfirmed: false };
    }
    return { label: 'Failed', pillClass: 'bg-red-100 text-red-800', superseded: false, unconfirmed: false };
  }
  if (attempt.state === 'prepared') {
    return { label: 'Preview ready — not sent', pillClass: 'bg-gray-100 text-gray-700', superseded: false, unconfirmed: false };
  }
  if (attempt.state === 'preparing') {
    return { label: 'Preparing', pillClass: 'bg-gray-100 text-gray-700', superseded: false, unconfirmed: false };
  }
  return { label: 'Sending', pillClass: 'bg-gray-100 text-gray-700', superseded: false, unconfirmed: false };
}

export default function PreSiteDistributionPanel({
  requestId,
  requestNumber,
  sourceArtifact,
  siteVisit = null,
  materials = EMPTY_LIST,
  suggestedTo = EMPTY_LIST,
  suggestedCc = EMPTY_LIST,
  onHistory = null,
  // Once the current document's materials have gone out, composing another
  // send is a secondary action: the composer folds behind a closed disclosure
  // instead of presenting as the stage's main job (owner, S466).
  collapsed = false,
}) {
  const [form, setForm] = useState({
    attachmentMode: 'pdf',
    to: '',
    cc: '',
    subject: `Site Visit materials${requestNumber ? ` — ${requestNumber}` : ''}`,
    bodyText: DEFAULT_BODY,
    includeCalendar: false,
    siteVisitId: null,
    selectedMaterialIds: [],
  });
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const sequence = useRef(0);
  const controllerRef = useRef(null);

  const loadHistory = useCallback(async (id, signal, expectedSequence) => {
    const response = await fetch(
      `/api/workbench/pre-site-visit/distribution/history?requestId=${encodeURIComponent(id)}`,
      { signal },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Email history could not be loaded.');
    if (sequence.current !== expectedSequence || id !== requestId) return;
    setHistory(body.attempts || []);
    setHistoryError(null);
    onHistory?.({
      attempts: body.attempts || [],
      currentSourceEverSent: body.currentSourceEverSent === true,
    });
  }, [requestId, onHistory]);

  useEffect(() => {
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (requestId) {
      loadHistory(requestId, controller.signal, currentSequence).catch((loadError) => {
        if (loadError?.name !== 'AbortError'
          && sequence.current === currentSequence
          && requestId) setHistoryError(loadError.message);
      });
    }
    return () => {
      sequence.current += 1;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [requestId, loadHistory]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      to: current.to.trim() ? current.to : suggestedTo.join(', '),
      cc: current.cc.trim() ? current.cc : suggestedCc.join(', '),
      // Calendar attachments have no UI since S466 (owner: unused); the form
      // pins the calendar off while the server contract stays intact.
      siteVisitId: siteVisit?.activityId || null,
      includeCalendar: false,
      selectedMaterialIds: current.selectedMaterialIds.filter((id) => (
        materials.some((material) => material.artifactId === id)
      )),
    }));
  }, [materials, siteVisit?.activityId, suggestedCc, suggestedTo]);

  const edit = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
  };

  const prepare = async () => {
    if (!requestId || !sourceArtifact?.artifactId || preparing || sending) return;
    const id = requestId;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPreparing(true);
    setError(null);
    setNotice(null);
    setConfirmed(false);
    try {
      const response = await fetch('/api/workbench/pre-site-visit/distribution/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          expectedArtifactId: sourceArtifact.artifactId,
          operationId: newOperationId(),
          ...form,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (body.inProgress) throw new Error(body.error || 'Preview preparation is already in progress.');
      if (!response.ok) throw new Error(body.error || `Preview preparation failed (${response.status})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setPreview(body.attempt || null);
    } catch (prepareError) {
      if (prepareError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) setError(prepareError.message);
    } finally {
      if (sequence.current === currentSequence && id === requestId) {
        setPreparing(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const send = async () => {
    if (!preview?.operationId || !preview.previewHash || !confirmed || notice || preparing || sending) return;
    const id = requestId;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/workbench/pre-site-visit/distribution/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          operationId: preview.operationId,
          previewHash: preview.previewHash,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (body.inProgress) throw new Error(body.error || 'This exact send is already in progress.');
      if (!response.ok && STALE_PREVIEW_CODES.has(body.code)) {
        if (sequence.current === currentSequence && id === requestId) {
          setPreview(null);
          setConfirmed(false);
          setNotice('This preview is out of date because the visit details or materials changed. Create a new preview, review it, and then send.');
        }
        return;
      }
      if (!response.ok) throw new Error(body.error || `Send failed (${response.status})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setPreview(body.attempt || preview);
      setConfirmed(false);
      setNotice(null);
      await loadHistory(id, controller.signal, currentSequence);
    } catch (sendError) {
      if (sendError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) setError(sendError.message);
    } finally {
      if (sequence.current === currentSequence && id === requestId) {
        setSending(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const composerBody = (
    <>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-800">Document attachment</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {[
              ['docx', 'Word document'],
              ['pdf', 'PDF'],
              ['both', 'Word and PDF'],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="distribution-attachment-mode"
                  value={value}
                  checked={form.attachmentMode === value}
                  onChange={() => edit({ attachmentMode: value })}
                  disabled={preparing || sending}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {materials.length > 0 && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-gray-800">Include links to materials</legend>
            <div className="mt-2 space-y-2">
              {materials.map((material) => (
                <label key={material.artifactId} className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.selectedMaterialIds.includes(material.artifactId)}
                    onChange={(event) => edit({
                      selectedMaterialIds: event.target.checked
                        ? [...form.selectedMaterialIds, material.artifactId]
                        : form.selectedMaterialIds.filter((id) => id !== material.artifactId),
                    })}
                    disabled={preparing || sending}
                    className="mt-0.5"
                  />
                  <span title={material.filename}>{material.artifactTypeLabel}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="distribution-to" className="block text-sm font-medium text-gray-800">To</label>
            <textarea
              id="distribution-to"
              rows={2}
              value={form.to}
              onChange={(event) => edit({ to: event.target.value })}
              placeholder="One or more known addresses, separated by commas or new lines"
              disabled={preparing || sending}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="distribution-cc" className="block text-sm font-medium text-gray-800">Cc</label>
            <textarea
              id="distribution-cc"
              rows={2}
              value={form.cc}
              onChange={(event) => edit({ cc: event.target.value })}
              placeholder="Optional"
              disabled={preparing || sending}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="distribution-subject" className="block text-sm font-medium text-gray-800">Subject</label>
          <input
            id="distribution-subject"
            value={form.subject}
            onChange={(event) => edit({ subject: event.target.value })}
            disabled={preparing || sending}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-4">
          <label htmlFor="distribution-body" className="block text-sm font-medium text-gray-800">Message</label>
          <textarea
            id="distribution-body"
            rows={5}
            value={form.bodyText}
            onChange={(event) => edit({ bodyText: event.target.value })}
            disabled={preparing || sending}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={prepare}
          disabled={preparing || sending || !form.to.trim() || !form.subject.trim() || !form.bodyText.trim()}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {preparing ? 'Creating preview…' : preview ? 'Create new preview' : 'Create preview'}
        </button>
        {notice && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" aria-live="polite">
            {notice}
          </div>
        )}

        {preview && (
          <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="font-semibold text-gray-900">Email preview</h4>
            <dl className="mt-3 space-y-2 text-sm text-gray-700">
              <div><dt className="inline font-medium">To:</dt> <dd className="inline">{preview.to.join(', ')}</dd></div>
              {preview.cc.length > 0 && <div><dt className="inline font-medium">Cc:</dt> <dd className="inline">{preview.cc.join(', ')}</dd></div>}
              <div><dt className="inline font-medium">Subject:</dt> <dd className="inline">{preview.subject}</dd></div>
              <div><dt className="inline font-medium">Snapshot source:</dt> <dd className="inline">Word version {preview.sourceVersionId}; later edits are not included</dd></div>
              <div>
                <dt className="font-medium">Message:</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded border border-blue-100 bg-white p-3">{preview.bodyText}</dd>
              </div>
              <div>
                <dt className="font-medium">Attachments:</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {preview.attachments.map((file) => (
                    file.webUrl ? (
                      <a
                        key={file.kind}
                        href={downloadUrl(file.webUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-blue-300 bg-white px-3 py-1 font-medium text-blue-900 underline"
                      >
                        {file.filename} ({Math.max(1, Math.round(file.size / 1024))} KB)
                      </a>
                    ) : (
                      <span key={file.kind} className="rounded border border-blue-300 bg-white px-3 py-1 font-medium text-blue-900">
                        {file.filename} ({Math.max(1, Math.round(file.size / 1024))} KB)
                      </span>
                    )
                  ))}
                </dd>
              </div>
              {preview.materialLinks?.length > 0 && (
                <div>
                  <dt className="font-medium">Material links:</dt>
                  <dd className="mt-1">
                    <ul className="list-disc pl-5">
                      {preview.materialLinks.map((material) => (
                        <li key={material.artifactId} title={material.filename}>{material.artifactTypeLabel}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            {preview.transportAccepted ? (
              <p className="mt-4 text-sm font-medium text-green-800">
                Sent — Dynamics accepted this exact email for transport. This receipt does not assert inbox delivery.
              </p>
            ) : (
              <>
                <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={preparing || sending}
                    className="mt-0.5"
                  />
                  I reviewed the recipients, message, material links, and attachment{preview.attachments.length === 1 ? '' : 's'} shown above.
                </label>
                <button
                  type="button"
                  onClick={send}
                  disabled={!confirmed || preparing || sending}
                  className="mt-3 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send email'}
                </button>
              </>
            )}
          </div>
        )}
    </>
  );

  return (
    <>
      <Card hover={false}>
        {collapsed ? (
          <details>
            <summary className="cursor-pointer select-none text-base font-semibold text-gray-900">
              Send materials again
            </summary>
            <p className="mt-1 text-sm text-gray-600">
              Materials for this document have already been sent — see Email history below.
              Sending again creates a new fixed preview and a separate email.
            </p>
            <div className="mt-2">{composerBody}</div>
          </details>
        ) : (
          <>
            <h3 className="text-base font-semibold text-gray-900">Send Site Visit materials</h3>
            <p className="mt-1 text-sm text-gray-600">
              Create a fixed preview, review the recipients and attachments, then send through Dynamics.
            </p>
            {composerBody}
          </>
        )}
      </Card>

      <Card hover={false}>
        <details>
          <summary className="cursor-pointer select-none text-base font-semibold text-gray-900">
            Email history{history.length > 0 ? ` (${history.length})` : ''}
          </summary>
        {historyError && <p className="mt-2 text-sm text-red-700">{historyError}</p>}
        {!historyError && history.length === 0 && (
          <p className="mt-2 text-sm text-gray-600">No email previews have been created for this request.</p>
        )}
        {history.length > 0 && (
          <ul className="mt-3 space-y-3">
            {history.map((attempt) => {
              const presentation = attemptPresentation(attempt);
              return (
                <li key={attempt.operationId} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{attempt.subject}</p>
                      <p className="mt-1">To: {attempt.to.join(', ')}</p>
                      {attempt.cc.length > 0 && <p>Cc: {attempt.cc.join(', ')}</p>}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${presentation.pillClass}`}>
                      {presentation.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {new Date(attempt.createdAt).toLocaleString()}
                    {attempt.attachments.length > 0 ? ` · ${attempt.attachments.map((file) => file.kind.toUpperCase()).join(' + ')}` : ''}
                    {attempt.materialLinks?.length > 0 ? ` · ${attempt.materialLinks.length} material link${attempt.materialLinks.length === 1 ? '' : 's'}` : ''}
                  </p>
                  {attempt.sourceFreshness === 'changed' && !presentation.superseded && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      The working Word document has changed since this frozen preview.
                    </p>
                  )}
                  {presentation.superseded && (
                    <p className="mt-1 text-xs text-gray-500">
                      This preview went stale before it was sent — the visit details or materials changed.
                    </p>
                  )}
                  {presentation.unconfirmed && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      A send was started for this preview but its outcome was never confirmed, and the
                      preview has since gone stale. Check the Dynamics activity under Details before
                      sending a new copy — the original email may have gone out.
                    </p>
                  )}
                  {attempt.lastError && !presentation.superseded && !presentation.unconfirmed && (
                    <p className="mt-1 text-red-700">{attempt.lastError}</p>
                  )}
                  {(attempt.dynamicsEmailId || attempt.sourceVersionId) && (
                    <details className="mt-1 text-xs text-gray-500">
                      <summary className="cursor-pointer select-none">Details</summary>
                      {attempt.dynamicsEmailId && <p className="mt-1">Dynamics activity: {attempt.dynamicsEmailId}</p>}
                      {attempt.sourceVersionId && <p>Word version: {attempt.sourceVersionId}</p>}
                      <p>Operation: {attempt.operationId}</p>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        </details>
      </Card>
    </>
  );
}

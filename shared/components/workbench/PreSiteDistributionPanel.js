import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';

const DEFAULT_BODY = 'Please find the frozen Pre-Site Visit materials attached.';
const EMPTY_LIST = Object.freeze([]);

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

function stateLabel(attempt) {
  if (attempt.transportAccepted) return 'Accepted by Dynamics';
  if (attempt.lastError) return 'Needs retry';
  if (attempt.state === 'prepared') return 'Prepared';
  if (attempt.state === 'preparing') return 'Preparing';
  return 'Sending';
}

export default function PreSiteDistributionPanel({
  requestId,
  requestNumber,
  sourceArtifact,
  siteVisit = null,
  materials = EMPTY_LIST,
  suggestedTo = EMPTY_LIST,
  suggestedCc = EMPTY_LIST,
}) {
  const [form, setForm] = useState({
    attachmentMode: 'pdf',
    to: '',
    cc: '',
    subject: `Pre-Site Visit materials${requestNumber ? ` — ${requestNumber}` : ''}`,
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
    if (!response.ok) throw new Error(body.error || 'Distribution history could not be loaded.');
    if (sequence.current !== expectedSequence || id !== requestId) return;
    setHistory(body.attempts || []);
    setHistoryError(null);
  }, [requestId]);

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
      siteVisitId: siteVisit?.activityId || null,
      includeCalendar: siteVisit?.activityId ? current.includeCalendar : false,
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
    if (!preview?.operationId || !preview.previewHash || !confirmed || sending) return;
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
      if (!response.ok) throw new Error(body.error || `Send failed (${response.status})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setPreview(body.attempt || preview);
      setConfirmed(false);
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

  return (
    <>
      <Card hover={false}>
        <h3 className="text-base font-semibold text-gray-900">Send frozen materials</h3>
        <p className="mt-1 text-sm text-gray-600">
          Create an exact retained snapshot, confirm the recipients and email, then send through Dynamics.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-800">Attach</legend>
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

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-800">Calendar and links</legend>
          <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.includeCalendar}
              onChange={(event) => edit({ includeCalendar: event.target.checked })}
              disabled={preparing || sending || !siteVisit?.activityId}
              className="mt-0.5"
            />
            <span>
              Attach the saved Site Visit as an informational add-to-calendar event.
              It does not request an RSVP or provide reliable update/cancellation handling.
            </span>
          </label>
          {!siteVisit?.activityId && (
            <p className="mt-1 text-xs text-amber-700">Save Visit logistics above before adding the calendar.</p>
          )}
          {materials.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-gray-800">Link to governed materials</p>
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
                  <span>{material.filename} <span className="text-gray-500">— {material.artifactTypeLabel}</span></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

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
          {preparing ? 'Freezing files…' : preview ? 'Prepare new preview' : 'Freeze and preview'}
        </button>

        {preview && (
          <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="font-semibold text-gray-900">Exact send preview</h4>
            <dl className="mt-3 space-y-2 text-sm text-gray-700">
              <div><dt className="inline font-medium">To:</dt> <dd className="inline">{preview.to.join(', ')}</dd></div>
              {preview.cc.length > 0 && <div><dt className="inline font-medium">Cc:</dt> <dd className="inline">{preview.cc.join(', ')}</dd></div>}
              <div><dt className="inline font-medium">Subject:</dt> <dd className="inline">{preview.subject}</dd></div>
              <div><dt className="inline font-medium">Frozen source:</dt> <dd className="inline">Word version {preview.sourceVersionId}</dd></div>
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
                        <li key={material.artifactId}>{material.filename} — {material.artifactTypeLabel}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            {preview.transportAccepted ? (
              <p className="mt-4 text-sm font-medium text-green-800">
                Dynamics accepted this exact email for transport. This receipt does not assert inbox delivery.
              </p>
            ) : (
              <>
                <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={sending}
                    className="mt-0.5"
                  />
                  I confirmed the exact recipients, message, material links, and attachment{preview.attachments.length === 1 ? '' : 's'} shown above.
                </label>
                <button
                  type="button"
                  onClick={send}
                  disabled={!confirmed || sending}
                  className="mt-3 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send exact preview'}
                </button>
              </>
            )}
          </div>
        )}
      </Card>

      <Card hover={false}>
        <h3 className="text-base font-semibold text-gray-900">Distribution history</h3>
        {historyError && <p className="mt-2 text-sm text-red-700">{historyError}</p>}
        {!historyError && history.length === 0 && (
          <p className="mt-2 text-sm text-gray-600">No frozen distributions have been prepared for this request.</p>
        )}
        {history.length > 0 && (
          <ul className="mt-3 space-y-3">
            {history.map((attempt) => (
              <li key={attempt.operationId} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">{attempt.subject}</p>
                    <p className="mt-1">To: {attempt.to.join(', ')}</p>
                    {attempt.cc.length > 0 && <p>Cc: {attempt.cc.join(', ')}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${attempt.transportAccepted ? 'bg-green-100 text-green-800' : attempt.lastError ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>
                    {stateLabel(attempt)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {new Date(attempt.createdAt).toLocaleString()}
                  {attempt.attachments.length > 0 ? ` · ${attempt.attachments.map((file) => file.kind.toUpperCase()).join(' + ')}` : ''}
                  {attempt.materialLinks?.length > 0 ? ` · ${attempt.materialLinks.length} material link${attempt.materialLinks.length === 1 ? '' : 's'}` : ''}
                  {attempt.dynamicsEmailId ? ` · Dynamics ${attempt.dynamicsEmailId}` : ''}
                </p>
                {attempt.sourceFreshness === 'changed' && (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    The working Word document has changed since this frozen preview.
                  </p>
                )}
                {attempt.lastError && <p className="mt-1 text-red-700">{attempt.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

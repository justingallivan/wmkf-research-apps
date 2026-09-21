/**
 * Applicant materials collection card on the tracker's visit page
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, PR 1). The PC starts the
 * collection, sees each checklist item as received or missing, waives an
 * item, sends the invitation again or a reminder naming the missing items,
 * and confirms the files open. Files themselves arrive through the
 * applicant's contributor link (PR 2) and show on the briefing page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { Button } from '../Layout';
import EmailSendFeedback from '../EmailSendFeedback';
import MaterialsEmailModal from './MaterialsEmailModal';

function formatDate(iso) {
  const date = new Date(iso || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

function formatDateTime(iso) {
  const date = new Date(iso || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
}

const STATE_COPY = {
  missing: 'Waiting on the applicant.',
  received: 'Every required item is in. Confirm the files open, then the collection is ready.',
  ready: 'Ready. The files open on the briefing page.',
  closed: 'Closed. The contributor link has expired.',
};

export default function SiteVisitMaterialsCard({ requestId, requestNumber }) {
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [emailFeedback, setEmailFeedback] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [composerAction, setComposerAction] = useState(null);
  const generationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    if (!requestId) return;
    const generation = generationRef.current;
    const loadGeneration = ++loadGenerationRef.current;
    setLoading(true);
    try {
      const { ok: resOk, status: resStatus, data: body } = await requestEnvelope(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, { tolerantBody: true });
      if (!mountedRef.current || generation !== generationRef.current || loadGeneration !== loadGenerationRef.current) return;
      if (resStatus === 503) { setUnavailable(true); return; }
      if (!resOk) throw new Error(body.error || 'The materials collection could not be loaded.');
      setCollection(body.collection || null);
      setError(null);
    } catch (loadError) {
      if (mountedRef.current && generation === generationRef.current && loadGeneration === loadGenerationRef.current) setError(`${loadError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      if (mountedRef.current && generation === generationRef.current && loadGeneration === loadGenerationRef.current) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    generationRef.current += 1;
    setCollection(null);
    setUnavailable(false);
    setError(null);
    setEmailFeedback(null);
    setBusy(false);
    setNotice(null);
    setCopied(false);
    setComposerAction(null);
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action, extra = {}, successNotice = null) => {
    const generation = generationRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    setEmailFeedback(null);
    try {
      const { ok: resOk, data: body } = await requestEnvelope(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { action, ...extra },
        tolerantBody: true,
      });
      if (!resOk) {
        const actionError = new Error(body.error || 'The materials collection could not be updated.');
        actionError.outcome = body.outcome || 'failed';
        throw actionError;
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (body.outcome === 'uncertain') {
        setEmailFeedback({ outcome: 'uncertain', detail: body.error });
        await load();
        return;
      }
      setCollection(body.collection || null);
      if (action === 'create' && body.invitationSent === false) {
        setEmailFeedback(body.invitationOutcome === 'uncertain'
          ? { outcome: 'uncertain', detail: 'The collection was created. Dynamics may have accepted the invitation, but the result could not be confirmed. Check the recipient before sending again.' }
          : { outcome: 'failed', detail: 'The collection was created, but the invitation email was not sent. You can try Send invitation again.' });
      } else if (action === 'create' || action === 'invite' || action === 'remind') {
        setEmailFeedback({ outcome: 'sent' });
      } else if (successNotice) {
        setNotice(successNotice);
      }
    } catch (actionError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (['create', 'invite', 'remind'].includes(action)) {
        const outcome = actionError.outcome === 'failed' ? 'failed' : 'uncertain';
        setEmailFeedback({
          outcome,
          detail: outcome === 'uncertain'
            ? `${actionError.message} Check the recipient before sending again.`
            : `${actionError.message} Please try again. If the problem continues, contact an administrator.`,
        });
      } else {
        setError(`${actionError.message} Please try again. If the problem continues, contact an administrator.`);
      }
    } finally {
      if (mountedRef.current && generation === generationRef.current) setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(collection.contributorUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (unavailable) return null;

  const contacts = collection ? ['pi', 'liaison'].map((role) => collection.contacts?.[role]).filter(Boolean) : [];

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm" data-testid="site-visit-materials-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Applicant materials</h2>
          <p className="mt-1 text-sm text-gray-600">
            {collection
              ? STATE_COPY[collection.state]
              : 'Ask the applicant for the presentation, its source file, and participant bios. They upload through one link; the files appear on the briefing page.'}
          </p>
        </div>
        {!loading && !collection && (
          <Button type="button" loading={busy} onClick={() => setComposerAction('create')}>Request materials</Button>
        )}
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{notice}</div>}
      {emailFeedback && <EmailSendFeedback className="mt-4" status={emailFeedback.outcome} message={emailFeedback.detail} />}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {collection && (
        <>
          <dl className="mt-4 grid gap-3 text-sm text-gray-800 md:grid-cols-3">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Due</dt><dd className={collection.overdue ? 'mt-1 font-medium text-amber-800' : 'mt-1'}>{formatDate(collection.dueAt)}{collection.overdue ? ' · overdue' : ''}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Link open until</dt><dd className="mt-1">{formatDate(collection.closesAt)}</dd></div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sent to</dt>
              <dd className="mt-1">
                {contacts.length ? contacts.map((person) => `${person.name || person.email}${person.email ? ` (${person.email})` : ''}`).join(', ') : 'No contacts on file'}
                {collection.invitedAt ? ` · invited ${formatDateTime(collection.invitedAt)}` : ' · invitation not sent'}
                {collection.lastReminderAt ? ` · reminded ${formatDateTime(collection.lastReminderAt)}` : ''}
              </dd>
            </div>
          </dl>

          <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {collection.checklist.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className={item.waived ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}>{item.label}</p>
                  <p className="text-xs text-gray-500">
                    {item.received ? `Received ${formatDateTime(item.received.receivedAt)} · ${item.received.filename}` : item.waived ? 'Waived' : 'Missing'}
                  </p>
                </div>
                {collection.state !== 'closed' && !item.received && (
                  <button type="button" disabled={busy} onClick={() => act('waive', { key: item.key, waived: !item.waived })} className="text-xs font-semibold text-gray-600 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50">
                    {item.waived ? 'Require again' : 'Waive'}
                  </button>
                )}
              </li>
            ))}
            {collection.other.map((file) => (
              <li key={file.artifactId} className="px-4 py-3 text-sm"><p className="font-medium text-gray-900">Other: {file.filename}</p><p className="text-xs text-gray-500">Received {formatDateTime(file.receivedAt)}</p></li>
            ))}
          </ul>

          {collection.state !== 'closed' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {collection.contributorUrl && (
                <button type="button" onClick={copyLink} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">{copied ? 'Copied' : 'Copy contributor link'}</button>
              )}
              <button type="button" disabled={busy} onClick={() => setComposerAction('invite')} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                {collection.invitedAt ? 'Send invitation again' : 'Send invitation'}
              </button>
              {collection.state === 'missing' && (
                <button type="button" disabled={busy} onClick={() => setComposerAction('remind')} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">Send reminder</button>
              )}
              {collection.state === 'received' && (
                <Button type="button" loading={busy} onClick={() => act('ready', {}, 'Marked ready.')}>Confirm the files open</Button>
              )}
            </div>
          )}
        </>
      )}
      {!loading && !collection && requestNumber && <p className="mt-3 text-xs text-gray-500">Files are named from #{requestNumber} automatically.</p>}
      {composerAction && <MaterialsEmailModal requestId={requestId} action={composerAction} onClose={() => setComposerAction(null)} onSent={(result) => { const explicit = ['sent', 'failed', 'uncertain'].includes(result?.outcome) ? result.outcome : null; if (explicit) setEmailFeedback({ outcome: explicit, detail: explicit === 'failed' ? (result.error || 'The email was not sent.') : explicit === 'uncertain' ? 'The email result could not be confirmed. Check the recipient before trying again.' : undefined }); else if (result?.invitationSent === false) setEmailFeedback({ outcome: result.invitationOutcome === 'uncertain' ? 'uncertain' : 'failed', detail: result.invitationOutcome === 'uncertain' ? 'The invitation result could not be confirmed.' : 'The invitation email was not sent.' }); else if (result?.success === true && result.collection) setEmailFeedback({ outcome: 'sent' }); else setEmailFeedback({ outcome: 'uncertain', detail: 'The email result could not be confirmed. Check the recipient before trying again.' }); void load(); }} />}
    </section>
  );
}

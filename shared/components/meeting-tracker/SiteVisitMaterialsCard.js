/**
 * Applicant materials collection card on the tracker's visit page
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, PR 1). The PC starts the
 * collection, sees each checklist item as received or missing, waives an
 * item, sends the invitation again or a reminder naming the missing items,
 * and confirms the files open. Files arrive through the applicant's
 * contributor link (PR 2), or a coordinator uploads a file the PI sent, in any
 * collection state and including waived items (staff replacement plan §3.4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { Button } from '../Layout';
import EmailSendFeedback from '../EmailSendFeedback';
import MaterialsEmailModal from './MaterialsEmailModal';
import StaffMaterialUpload from './StaffMaterialUpload';
import ArtifactRow from './ArtifactRow';
import OverflowMenu from '../workbench/OverflowMenu';
import { SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED } from '../../config/siteVisitMaterials';
import { siteVisitMaterialsScanRejectionMessage, siteVisitMaterialsScanRejectionReason } from '../../utils/site-visit-materials-scan-rejection';

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
  processing: 'Upload received. We’re checking and saving the file.',
  needs_attention: 'An upload needs coordinator attention before it can be replaced.',
  received: 'Every required item is in. Confirm the files open, then the collection is ready.',
  ready: 'Ready. The files open on the briefing page.',
  closed: 'Closed. The contributor link has expired.',
};

const ACTIVE_UPLOAD_STATUSES = new Set(['queued', 'processing']);
const BLOCKING_UPLOAD_STATUSES = new Set(['queued', 'processing', 'needs_attention']);

function uploadJobsForSlot(collection, slot) {
  return Array.isArray(collection?.uploadJobs) ? collection.uploadJobs.filter((job) => job?.slot === slot) : [];
}

// The https link to a received file, or null; the row's name becomes the link (Site Visit redesign §3.2).
function safeFileUrl(file) {
  if (typeof file?.webUrl !== 'string') return null;
  try {
    const url = new URL(file.webUrl);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function UploadJobNotice({ jobs, programCoordinator }) {
  if (!jobs.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {jobs.map((job) => {
        if (ACTIVE_UPLOAD_STATUSES.has(job.status)) {
          return <p key={job.jobId} className="text-xs text-blue-800" role="status">Upload received. We’re checking and saving the file.</p>;
        }
        if (job.status === 'needs_attention') {
          const name = typeof programCoordinator?.name === 'string' ? programCoordinator.name.trim() : '';
          const email = typeof programCoordinator?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(programCoordinator.email.trim()) ? programCoordinator.email.trim() : '';
          return <div key={job.jobId} className="text-xs text-amber-900" role="alert"><p>Needs coordinator attention before replacement is safe{name ? ` · ${name}` : ''}{email ? <> · <a className="underline" href={`mailto:${encodeURIComponent(email)}`}>{email}</a></> : ''}</p>{job.errorCode === 'infected' && <p className="mt-1">{siteVisitMaterialsScanRejectionReason(job.scanRejection)}</p>}</div>;
        }
        if (job.status === 'failed') return <div key={job.jobId} className="text-xs text-amber-900" role="status"><p>The new upload could not be saved. The previously received file remains on record.</p>{job.errorCode === 'infected' && <p className="mt-1">{siteVisitMaterialsScanRejectionMessage(job.scanRejection)}</p>}</div>;
        return null;
      })}
    </div>
  );
}

export default function SiteVisitMaterialsCard({ requestId, requestNumber, onStatusChange }) {
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [emailFeedback, setEmailFeedback] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
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
      setLoadFailed(false);
      setError(null);
    } catch (loadError) {
      if (mountedRef.current && generation === generationRef.current && loadGeneration === loadGenerationRef.current) setLoadFailed(true);
      if (mountedRef.current && generation === generationRef.current && loadGeneration === loadGenerationRef.current) setError(`${loadError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      if (mountedRef.current && generation === generationRef.current && loadGeneration === loadGenerationRef.current) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    generationRef.current += 1;
    setCollection(null);
    setUnavailable(false);
    setLoadFailed(false);
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

  const uploadRefs = useRef({});
  const [blockedUploads, setBlockedUploads] = useState({});
  const setUploadBlocked = useCallback((slot, blocked) => {
    setBlockedUploads((current) => (Boolean(current[slot]) === blocked ? current : { ...current, [slot]: blocked }));
  }, []);

  const seenEmails = new Set();
  const contacts = collection ? ['pi', 'liaison'].map((role) => collection.contacts?.[role]).filter((person) => {
    const email = String(person?.email || '').trim().toLowerCase();
    if (!email || seenEmails.has(email)) return false;
    seenEmails.add(email);
    return true;
  }) : [];
  // liaisonStatus is recorded by the current resolution: 'none' is a confirmed
  // absence (PI-only send); a legacy snapshot without it is unverified.
  const liaisonStatus = collection?.contacts?.liaisonStatus;
  const liaisonNote = !collection ? ''
    : liaisonStatus === 'none' ? ' · No institution Liaison'
      : !liaisonStatus ? ' · Liaison not verified'
        : !collection.contacts?.liaison?.email ? ' · Liaison email missing from saved recipients' : '';
  const uploadJobs = Array.isArray(collection?.uploadJobs) ? collection.uploadJobs : [];
  const processingCount = Number.isSafeInteger(collection?.processingCount)
    ? collection.processingCount
    : uploadJobs.filter((job) => ACTIVE_UPLOAD_STATUSES.has(job?.status)).length;
  const attentionCount = Number.isSafeInteger(collection?.attentionCount)
    ? collection.attentionCount
    : uploadJobs.filter((job) => job?.status === 'needs_attention').length;
  const hasBlockingJobs = processingCount > 0 || attentionCount > 0
    || uploadJobs.some((job) => BLOCKING_UPLOAD_STATUSES.has(job?.status));
  // One state key drives the heading copy and the page header's status chip, so the two cannot disagree.
  const collectionStateKey = collection?.state === 'closed' ? 'closed'
    : attentionCount > 0 || collection?.state === 'needs_attention' ? 'needs_attention'
      : processingCount > 0 || collection?.state === 'processing' ? 'processing'
        : STATE_COPY[collection?.state] ? collection.state : null;
  const collectionStateCopy = STATE_COPY[collectionStateKey] || 'Materials status is unavailable.';
  const reportedKey = unavailable || loadFailed ? 'unavailable' : loading && !collection ? null
    : !collection || (collectionStateKey === 'missing' && !collection.invitedAt) ? 'not_requested'
      : collectionStateKey || 'unavailable';
  const reportedOverdue = collection?.overdue === true;
  useEffect(() => {
    if (onStatusChange && reportedKey) onStatusChange({ key: reportedKey, overdue: reportedOverdue });
  }, [onStatusChange, reportedKey, reportedOverdue]);
  if (unavailable) return null;

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm" data-testid="site-visit-materials-card">
      {/* One heading line: title, state phrase, the next step as the one inline action, the rest in a menu. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-gray-900">Applicant materials</h2>
          <p className="mt-1 text-sm text-gray-600">
            {collection
              ? collectionStateCopy
              : 'Ask the applicant for the presentation, its source file, and participant bios. They upload through one link; the files appear on the briefing page.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && !collection && (
            <Button type="button" loading={busy} onClick={() => setComposerAction('create')}>Request materials</Button>
          )}
          {collection && collection.state === 'missing' && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setComposerAction('remind')}>Send reminder</Button>
          )}
          {collection && collection.state === 'received' && !hasBlockingJobs && (
            <Button type="button" size="sm" loading={busy} onClick={() => act('ready', {}, 'Marked ready.')}>Confirm the files open</Button>
          )}
          {collection && (
            <OverflowMenu label="More actions for applicant materials" items={[
              collection.state !== 'closed' && collection.contributorUrl && { key: 'copy', label: copied ? 'Copied' : 'Copy contributor link', onSelect: copyLink },
              collection.state !== 'closed' && { key: 'invite', label: collection.invitedAt ? 'Send invitation again' : 'Send invitation', disabled: busy, onSelect: () => setComposerAction('invite') },
              SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED && { key: 'other', label: 'Add other file', disabled: busy || Boolean(blockedUploads.other), onSelect: () => uploadRefs.current.other?.open() },
            ]} />
          )}
        </div>
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{notice}</div>}
      {collection?.uploadStatusUnavailable && <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Upload processing status is temporarily unavailable. Refresh this page to check again.</div>}
      {emailFeedback && <EmailSendFeedback className="mt-4" status={emailFeedback.outcome} message={emailFeedback.detail} />}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {collection && (
        <>
          <p className="mt-3 text-sm text-gray-700" data-testid="materials-metadata">
            <span className={collection.overdue ? 'font-medium text-amber-800' : ''}>Due {formatDate(collection.dueAt)}{collection.overdue ? ' · overdue' : ''}</span>
            <span className="text-gray-400"> · </span>Link open until {formatDate(collection.closesAt)}
            <span className="text-gray-400"> · </span>Sent to {contacts.length ? contacts.map((person) => `${person.name || person.email}${person.email ? ` (${person.email})` : ''}`).join(', ') : 'No contacts on file'}
            {liaisonNote}
            {collection.invitedAt ? ` · invited ${formatDateTime(collection.invitedAt)}` : ' · invitation not sent'}
            {collection.lastReminderAt ? ` · reminded ${formatDateTime(collection.lastReminderAt)}` : ''}
          </p>

          <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-200">
            {collection.checklist.map((item) => {
              const jobs = uploadJobsForSlot(collection, item.key);
              const replacing = jobs.some((job) => BLOCKING_UPLOAD_STATUSES.has(job.status));
              const uploadDisabled = busy || replacing;
              const status = item.received
                ? (replacing ? { tone: 'gray', label: 'Replacing…' } : { tone: 'green', label: 'Received' })
                : item.waived ? { tone: 'gray', label: 'Waived' }
                  : { tone: collection.overdue ? 'amber' : 'gray', label: 'Missing' };
              const detail = item.received
                ? `${replacing ? 'Previously received ' : ''}${formatDateTime(item.received.receivedAt)} · ${item.received.filename}${item.received.uploadedByStaff ? ' · staff upload' : ''}${item.waived ? ' · waived' : ''}`
                : null;
              const canWaive = collection.state !== 'closed' && !item.received;
              const uploader = (
                <StaffMaterialUpload
                  ref={(node) => { uploadRefs.current[item.key] = node; }}
                  requestId={requestId}
                  slot={item.key}
                  label={item.received ? 'Upload updated file' : 'Upload file'}
                  disabled={uploadDisabled}
                  showTrigger={!item.received}
                  onBlockedChange={(blocked) => setUploadBlocked(item.key, blocked)}
                  onUploaded={() => { setNotice(`${item.label} saved.`); void load(); }}
                />
              );
              return (
                <ArtifactRow key={item.key} testId={`materials-row-${item.key}`} name={item.label} href={safeFileUrl(item.received)}
                  status={status} detail={detail}
                  // One position for the uploader in every state, so a missing-to-received refresh never remounts it
                  // and drops an unfinished upload's Retry (Codex review, commit 5).
                  action={uploader}
                  menuItems={[
                    item.received && { key: 'replace', label: 'Upload updated file', disabled: uploadDisabled || Boolean(blockedUploads[item.key]), onSelect: () => uploadRefs.current[item.key]?.open() },
                    canWaive && { key: 'waive', label: item.waived ? 'Require again' : 'Waive', disabled: busy, onSelect: () => act('waive', { key: item.key, waived: !item.waived }) },
                  ]}>
                  <UploadJobNotice jobs={jobs} programCoordinator={collection.programCoordinator} />
                </ArtifactRow>
              );
            })}
            {collection.other.map((file) => (
              <ArtifactRow key={file.artifactId} testId="materials-row-other-file" name={`Other: ${file.filename}`} href={safeFileUrl(file)}
                status={{ tone: 'green', label: 'Received' }}
                detail={`${formatDateTime(file.receivedAt)}${file.uploadedByStaff ? ' · staff upload' : ''}`} />
            ))}
            {uploadJobs.filter((job) => job.slot === 'other').map((job) => (
              <li key={job.jobId} className="py-3 text-sm">
                <p className="font-medium text-gray-900">Other: {job.filename || 'Additional material'}</p>
                <UploadJobNotice jobs={[job]} programCoordinator={collection.programCoordinator} />
              </li>
            ))}
          </ul>
          {SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED && (
            <StaffMaterialUpload ref={(node) => { uploadRefs.current.other = node; }} requestId={requestId} slot="other" label="Add other file" disabled={busy} showTrigger={false}
              onBlockedChange={(blocked) => setUploadBlocked('other', blocked)}
              onUploaded={() => { setNotice('Additional file saved.'); void load(); }} />
          )}
          {collection.state === 'received' && hasBlockingJobs && (
            <p className="mt-3 text-sm text-amber-900" role="status">Confirm readiness after every upload is finished and any attention item is resolved.</p>
          )}
        </>
      )}
      {!loading && !collection && requestNumber && <p className="mt-3 text-xs text-gray-500">Files are named from #{requestNumber} automatically.</p>}
      {composerAction && <MaterialsEmailModal requestId={requestId} action={composerAction} onClose={() => setComposerAction(null)} onSent={(result) => { const explicit = ['sent', 'failed', 'uncertain'].includes(result?.outcome) ? result.outcome : null; if (explicit) setEmailFeedback({ outcome: explicit, detail: explicit === 'failed' ? (result.error || 'The email was not sent.') : explicit === 'uncertain' ? 'The email result could not be confirmed. Check the recipient before trying again.' : undefined }); else if (result?.invitationSent === false) setEmailFeedback({ outcome: result.invitationOutcome === 'uncertain' ? 'uncertain' : 'failed', detail: result.invitationOutcome === 'uncertain' ? 'The invitation result could not be confirmed.' : 'The invitation email was not sent.' }); else if (result?.success === true && result.collection) setEmailFeedback({ outcome: 'sent' }); else setEmailFeedback({ outcome: 'uncertain', detail: 'The email result could not be confirmed. Check the recipient before trying again.' }); void load(); }} />}
    </section>
  );
}

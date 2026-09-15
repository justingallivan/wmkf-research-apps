/**
 * ConsultantFeedbackSection — "Consultant feedback" section on the Request
 * Workbench Reviews tab (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md
 * §3.5). Staff record informal feedback from a retained consultant, attribute
 * it to an active `expertise_roster` consultant or a one-off name/affiliation
 * stored on the entry itself (CF6), and toggle whether it is shared on the
 * external deliberation briefing page (default on, CF2).
 *
 * `previewReadOnly` disables every mutation with the same title-text pattern
 * the tab already uses. `fetchIdRef` is the tab's monotonic-fetch-id guard
 * (ReviewsTab.js:786-807), copied here so a request switch never paints
 * another request's feedback into this section.
 *
 * `mutationId` (§3.1): allocated with `crypto.randomUUID()` when the "Add
 * feedback" form opens, held through timeouts/errors so every Save retry
 * sends the same id, and rotated only after a confirmed 2xx or an explicit
 * form reset — the server replays the original row on a duplicate mutation
 * id instead of inserting twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import RichReviewEditor from '../external/RichReviewEditor';
import { SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT } from '../../config/siteVisitMaterials';

// Slice 2 attachments (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §4):
// PDF or DOCX only, one per entry. The server (`getUploadMaxMb`, an
// admin-editable Postgres setting shared with site-visit materials) is the
// authority on the actual cap; this default is shown as a label only — the
// upload-token mint route rejects an oversize file regardless of what this
// says.
const ATTACHMENT_ACCEPT = '.pdf,.docx';
const ATTACHMENT_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function consultantDisplayName(form, consultants) {
  if (form.addingPerson) return form.oneOffName.trim();
  const match = consultants.find((c) => String(c.id) === String(form.consultantRosterId));
  return match?.name || '';
}

// Same defensive pattern as review-panel-ui.js's makeIdempotencyKey and
// SessionAgendaPanel's uuid helper: every real browser has
// globalThis.crypto.randomUUID; this only matters under a test/jsdom
// environment that doesn't polyfill it.
function makeMutationId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Belt 2's predicate, exported so it is directly unit-testable: the
 * requestId-change effect (belt 1) closes the form synchronously on every
 * requestId change in this codebase's React/test setup, which makes the
 * underlying race practically unreachable through the DOM in a component
 * test — this function is what `handleSave` actually calls, so a regression
 * in the comparison itself is still caught even though the end-to-end race
 * cannot be constructed here.
 */
export function formBelongsToCurrentRequest(formRequestId, currentRequestId) {
  return formRequestId === currentRequestId;
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyForm() {
  return {
    consultantRosterId: '',
    addingPerson: false,
    oneOffName: '',
    oneOffAffiliation: '',
    receivedOn: todayIso(),
    bodyHtml: '',
    shared: true,
  };
}

export default function ConsultantFeedbackSection({ requestId, previewReadOnly = false }) {
  const [items, setItems] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Slice 2 attachment (§4). `editingAttachment` is the EXISTING attachment
  // on the entry being edited (null on the add form, or an edit form for an
  // entry with none yet) — the file input is hidden once an entry already
  // carries one (one attachment per entry; a second file is a second entry).
  const [attachFile, setAttachFile] = useState(null);
  const [attachStagingId, setAttachStagingId] = useState(null);
  const [attachUploadProgress, setAttachUploadProgress] = useState(null);
  const [attachError, setAttachError] = useState(null);
  const [editingAttachment, setEditingAttachment] = useState(null);
  const attachInputRef = useRef(null);

  // Monotonic fetch id, same pattern as ReviewsTab.js:786-807 — guards every
  // post-await state write (success and failure) so a request switch never
  // paints another request's feedback.
  const fetchIdRef = useRef(0);
  // Held across retries; rotated only after a confirmed 2xx or an explicit
  // form reset (§3.1).
  const mutationIdRef = useRef(null);
  // The requestId the open form belongs to. ReviewsTab is the only Workbench
  // tab NOT remounted per request (pages/workbench/[requestId].js:213-216 —
  // siblings pass `key={requestId}`, this one does not), so a form left open
  // on request A survives a navigation to request B: the `requestId` prop
  // changes under a still-mounted component. Two independent guards below
  // stop that from writing A's draft onto B: the effect that closes any open
  // form on a requestId change, and handleSave's own belt-and-suspenders
  // check against this ref before it ever calls fetch.
  const formRequestIdRef = useRef(null);
  // The author fields as loaded when Edit opened. Compared at save time so an
  // edit that never touched the author omits the author fields from the PATCH
  // body entirely — belt-and-suspenders alongside the server's own by-value
  // comparison in updateFeedbackEntry (§3.2): a body/date/share-only edit on
  // an entry whose roster consultant was since deactivated must not re-run
  // eligibility.
  const originalAuthorRef = useRef(null);

  const load = useCallback(async () => {
    if (!requestId) return;
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, consultantsRes] = await Promise.all([
        fetch(`/api/workbench/consultant-feedback?requestId=${encodeURIComponent(requestId)}`),
        fetch('/api/workbench/consultant-feedback/consultants'),
      ]);
      const entriesData = await entriesRes.json().catch(() => ({}));
      const consultantsData = await consultantsRes.json().catch(() => ({}));
      if (fetchId !== fetchIdRef.current) return;
      if (!entriesRes.ok) throw new Error(entriesData.error || `Failed to load consultant feedback (${entriesRes.status})`);
      setItems(entriesData.items || []);
      setConsultants(consultantsRes.ok ? (consultantsData.items || []) : []);
    } catch (e) {
      if (fetchId !== fetchIdRef.current) return;
      setError(e.message);
      setItems([]);
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const resetAttachState = useCallback(() => {
    setAttachFile(null);
    setAttachStagingId(null);
    setAttachUploadProgress(null);
    setAttachError(null);
    setEditingAttachment(null);
    // The file input keeps its selection across a re-render, so clear the
    // DOM value too (same reasoning as AwardeeTab.js's closeReplace()).
    if (attachInputRef.current) attachInputRef.current.value = '';
  }, []);

  const openAddForm = useCallback(() => {
    mutationIdRef.current = makeMutationId();
    formRequestIdRef.current = requestId;
    setEditingId(null);
    setForm(emptyForm());
    setSaveError(null);
    originalAuthorRef.current = null;
    resetAttachState();
    setFormOpen(true);
  }, [requestId, resetAttachState]);

  const openEditForm = useCallback((item) => {
    formRequestIdRef.current = requestId;
    setEditingId(item.id);
    setForm({
      consultantRosterId: item.consultant.rosterId != null ? String(item.consultant.rosterId) : '',
      addingPerson: item.oneOff,
      oneOffName: item.oneOff ? (item.consultant.name || '') : '',
      oneOffAffiliation: item.oneOff ? (item.consultant.affiliation || '') : '',
      receivedOn: item.receivedOn,
      bodyHtml: item.bodyHtml || '',
      shared: item.shared,
    });
    originalAuthorRef.current = {
      rosterId: item.consultant.rosterId != null ? item.consultant.rosterId : null,
      oneOffName: item.oneOff ? (item.consultant.name || '') : null,
      oneOffAffiliation: item.oneOff ? (item.consultant.affiliation || null) : null,
    };
    setSaveError(null);
    resetAttachState();
    setEditingAttachment(item.attachment || null);
    setFormOpen(true);
  }, [requestId, resetAttachState]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setSaveError(null);
    // Called by both Cancel and the requestId-change effect below; a save
    // left in flight when either fires must not leave the NEXT form wedged
    // on "Saving…" (the stale save's own early returns clear it too, but a
    // request switch can land here before that save's response arrives).
    setSaving(false);
    mutationIdRef.current = null;
    originalAuthorRef.current = null;
    formRequestIdRef.current = null;
    resetAttachState();
  }, [resetAttachState]);

  function handleAttachFileChange(event) {
    const file = event.target.files?.[0] || null;
    setAttachError(null);
    // A newly picked file invalidates any prior staged upload for this form
    // (a re-pick after a failed finalize should re-stage, not reuse bytes
    // for a different file).
    setAttachStagingId(null);
    setAttachUploadProgress(null);
    if (file && !ATTACHMENT_CONTENT_TYPES.has(file.type)) {
      setAttachError('Only PDF or DOCX files are accepted.');
      setAttachFile(null);
      if (attachInputRef.current) attachInputRef.current.value = '';
      return;
    }
    setAttachFile(file);
  }

  // Belt 1: a request switch on this never-remounted tab closes any open
  // form and cancels an in-progress delete confirmation outright, rather
  // than leaving A's draft to be silently saved onto B.
  useEffect(() => {
    closeForm();
    setConfirmingDeleteId(null);
  }, [requestId, closeForm]);

  const handleSave = useCallback(async () => {
    // Belt 2: refuse outright, no network call, if this form was opened for a
    // different request than the one currently mounted (the requestId-change
    // effect above should already have closed it, but this is the guard that
    // matters if the two ever race).
    if (!formBelongsToCurrentRequest(formRequestIdRef.current, requestId)) {
      setSaveError('This form is for a different request and cannot be saved. Please reopen it.');
      return;
    }
    // Client-side mirror of the server's body_required rule (§3.1): an entry
    // needs a body OR an attachment (a NEW file about to be staged, or an
    // EXISTING one already bound when editing).
    const strippedBody = form.bodyHtml.replace(/<[^>]+>/g, '').trim();
    if (!strippedBody && !attachFile && !editingAttachment) {
      setSaveError('Feedback text or an attachment is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const fetchId = fetchIdRef.current;
    // `fetchId` is bumped by `load()`, which the requestId-change effect
    // fires on every request switch (via closeForm → the effect's own
    // load()) — the same "did a switch happen mid-flight" signal every other
    // async step below already relies on, now reused for the upload steps too
    // so a staged-but-not-yet-finalized upload is abandoned on switch exactly
    // like every other in-flight response here.
    const stale = () => fetchId !== fetchIdRef.current;
    try {
      let stagingId = attachStagingId;
      if (attachFile && !stagingId) {
        const tokenRes = await fetch('/api/workbench/consultant-feedback/upload-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, filename: attachFile.name, contentType: attachFile.type, size: attachFile.size }),
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (stale()) { setSaving(false); return; }
        if (!tokenRes.ok || !tokenData.ok) throw new Error(tokenData.error || 'Could not prepare the attachment upload.');
        const { put } = await import('@vercel/blob/client');
        await put(tokenData.pathname, attachFile, {
          access: 'private',
          token: tokenData.clientToken,
          contentType: tokenData.contentType,
          onUploadProgress: ({ percentage }) => setAttachUploadProgress(Math.round(percentage)),
        });
        if (stale()) { setSaving(false); return; }
        stagingId = tokenData.stagingId;
        setAttachStagingId(stagingId);
      }

      const author = form.addingPerson
        ? { oneOff: { name: form.oneOffName.trim(), affiliation: form.oneOffAffiliation.trim() || undefined } }
        : { consultantRosterId: form.consultantRosterId ? Number(form.consultantRosterId) : null };

      if (editingId) {
        // Omit the author fields entirely when they match what Edit loaded —
        // the server also compares by value (§3.2), but not sending them at
        // all keeps a body/date/share-only save from looking like an author
        // edit in the request body itself.
        const original = originalAuthorRef.current;
        const nextRosterId = form.addingPerson ? null : (form.consultantRosterId ? Number(form.consultantRosterId) : null);
        const nextOneOffName = form.addingPerson ? form.oneOffName.trim() : null;
        const nextOneOffAffiliation = form.addingPerson ? (form.oneOffAffiliation.trim() || null) : null;
        const authorUnchanged = !!original
          && original.rosterId === nextRosterId
          && original.oneOffName === nextOneOffName
          && original.oneOffAffiliation === nextOneOffAffiliation;

        const res = await fetch('/api/workbench/consultant-feedback', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            requestId,
            ...(authorUnchanged ? {} : author),
            bodyHtml: form.bodyHtml,
            receivedOn: form.receivedOn,
            shared: form.shared,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (stale()) { setSaving(false); return; }
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);

        if (attachFile && stagingId) {
          const finalizeRes = await fetch('/api/workbench/consultant-feedback/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, stagingId, entryId: editingId }),
          });
          const finalizeData = await finalizeRes.json().catch(() => ({}));
          if (stale()) { setSaving(false); return; }
          if (!finalizeRes.ok) throw new Error(finalizeData.error || 'The attachment could not be saved.');
        }
      } else if (attachFile) {
        // Attachment-only (or attachment + body) create: the row does not
        // exist yet, so finalize creates it via `writeFeedbackEntry` with
        // `requestdocumentId` already bound — no separate POST.
        const finalizeRes = await fetch('/api/workbench/consultant-feedback/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            stagingId,
            newEntry: {
              mutationId: mutationIdRef.current,
              ...author,
              bodyHtml: form.bodyHtml,
              receivedOn: form.receivedOn,
              shared: form.shared,
              consultantName: consultantDisplayName(form, consultants),
            },
          }),
        });
        const finalizeData = await finalizeRes.json().catch(() => ({}));
        if (stale()) { setSaving(false); return; }
        if (!finalizeRes.ok) throw new Error(finalizeData.error || 'The attachment could not be saved.');
      } else {
        const res = await fetch('/api/workbench/consultant-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            mutationId: mutationIdRef.current,
            ...author,
            bodyHtml: form.bodyHtml,
            receivedOn: form.receivedOn,
            shared: form.shared,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (stale()) { setSaving(false); return; }
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      }

      // Confirmed success: clear saving and rotate the mutation id/close the
      // form BEFORE the reload — `load()` bumps `fetchIdRef`, so a later
      // stale check in this same call would otherwise see a mismatch and
      // skip clearing the button.
      setSaving(false);
      closeForm();
      await load();
    } catch (e) {
      if (stale()) {
        // Same reasoning as the success path above: a request switch that
        // landed mid-flight already ran closeForm via the effect, but this
        // call's own busy flag still needs clearing so it can't wedge a form
        // opened afterward.
        setSaving(false);
        return;
      }
      // Leave mutationIdRef and any staged upload untouched so a retry
      // replays the same mutation id and reuses the already-staged bytes
      // instead of uploading again.
      setSaveError(e.message);
      setSaving(false);
    }
  }, [form, editingId, requestId, closeForm, load, attachFile, attachStagingId, editingAttachment, consultants]);

  const handleDelete = useCallback(async (id) => {
    setDeletingId(id);
    const fetchId = fetchIdRef.current;
    try {
      const res = await fetch('/api/workbench/consultant-feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, requestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (fetchId !== fetchIdRef.current) {
        // Same wedge risk as handleSave: clear the busy flag for a stale
        // generation instead of leaving "Deleting…" stuck.
        setDeletingId(null);
        return;
      }
      if (!res.ok) {
        if (data.reason === 'attachment_removal_pending') {
          // §3.6 step 1 already committed: the entry is gone from every
          // `active` reader (the reload below will not show it — and the
          // NEXT list's own recovery sweep usually finishes steps 2-3 before
          // that reload's response even arrives). Surface the plan's exact
          // wording rather than a generic error.
          setError('Attachment removed, delete again.');
          setConfirmingDeleteId(null);
          await load();
          return;
        }
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      setConfirmingDeleteId(null);
      await load();
    } catch (e) {
      if (fetchId !== fetchIdRef.current) {
        setDeletingId(null);
        return;
      }
      setError(e.message);
    } finally {
      if (fetchId === fetchIdRef.current) setDeletingId(null);
    }
  }, [requestId, load]);

  const disabledTitle = previewReadOnly ? 'Disabled in read-only Preview' : undefined;

  return (
    <section aria-labelledby="consultant-feedback-heading" className="mt-6">
      <div className="flex items-center justify-between">
        <h2 id="consultant-feedback-heading" className="text-sm font-semibold text-gray-900">
          Consultant feedback
        </h2>
        {!formOpen && (
          <button
            type="button"
            onClick={openAddForm}
            disabled={previewReadOnly}
            title={disabledTitle}
            className="inline-flex min-h-8 items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add feedback
          </button>
        )}
      </div>

      {loading && <p className="mt-2 text-sm text-gray-500">Loading…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {formOpen && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700" htmlFor="consultant-feedback-consultant">Consultant</label>
            {!form.addingPerson ? (
              <div className="mt-1 flex items-center gap-2">
                <select
                  id="consultant-feedback-consultant"
                  value={form.consultantRosterId}
                  onChange={(e) => setForm((f) => ({ ...f, consultantRosterId: e.target.value }))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a consultant…</option>
                  {consultants.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.affiliation ? ` — ${c.affiliation}` : ''}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, addingPerson: true, consultantRosterId: '' }))}
                  className="whitespace-nowrap text-sm font-medium text-blue-800 hover:underline"
                >
                  Add person…
                </button>
              </div>
            ) : (
              <div className="mt-1 space-y-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={form.oneOffName}
                  onChange={(e) => setForm((f) => ({ ...f, oneOffName: e.target.value }))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Affiliation (optional)"
                  value={form.oneOffAffiliation}
                  onChange={(e) => setForm((f) => ({ ...f, oneOffAffiliation: e.target.value }))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, addingPerson: false, oneOffName: '', oneOffAffiliation: '' }))}
                  className="text-sm font-medium text-gray-600 hover:underline"
                >
                  Choose from roster instead
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700" htmlFor="consultant-feedback-received-on">Received</label>
            <input
              id="consultant-feedback-received-on"
              type="date"
              value={form.receivedOn}
              onChange={(e) => setForm((f) => ({ ...f, receivedOn: e.target.value }))}
              className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Feedback</label>
            <div className="mt-1">
              <RichReviewEditor
                value={form.bodyHtml}
                onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
                ariaLabel="Consultant feedback"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700" htmlFor="consultant-feedback-attachment">Attachment (optional)</label>
            {editingAttachment ? (
              <p className="mt-1 text-xs text-gray-500">
                Attachment: {editingAttachment.filename || 'file'} (one attachment per entry — delete this entry and re-add to replace it)
              </p>
            ) : (
              <>
                <input
                  id="consultant-feedback-attachment"
                  ref={attachInputRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  onChange={handleAttachFileChange}
                  className="mt-1 block w-full text-sm text-gray-700"
                />
                <p className="mt-1 text-xs text-gray-500">PDF or DOCX, up to {SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT} MB.</p>
                {attachFile && <p className="mt-1 text-xs text-gray-700">{attachFile.name}</p>}
                {attachUploadProgress != null && attachUploadProgress < 100 && (
                  <p className="mt-1 text-xs text-gray-500">Uploading… {attachUploadProgress}%</p>
                )}
                {attachError && <p className="mt-1 text-xs text-red-600">{attachError}</p>}
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.shared}
              onChange={(e) => setForm((f) => ({ ...f, shared: e.target.checked }))}
            />
            Shared on briefing page
          </label>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || previewReadOnly}
              title={disabledTitle}
              className="inline-flex min-h-9 items-center rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="inline-flex min-h-9 items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loading && items.length === 0 && !formOpen && (
        <p className="mt-2 text-sm text-gray-500">No consultant feedback recorded yet.</p>
      )}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{item.consultant.name || 'Consultant'}</span>
                  {item.consultant.affiliation && <span className="text-sm text-gray-500">{item.consultant.affiliation}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.shared ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                    {item.shared ? 'Shared' : 'Not shared'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">Received {item.receivedOn}</p>
                {item.bodyHtml && (
                  <p className="mt-1 line-clamp-1 text-sm text-gray-700">
                    {item.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
                  </p>
                )}
                {item.attachment && (
                  // Plain label, not a link: no staff download route exists for
                  // an arbitrary request-document registry id (only the
                  // proposal-specific `/api/workbench/download-proposal-document`
                  // does) — acceptable for this slice per the build brief.
                  <p className="mt-1 text-xs text-gray-500">Attachment: {item.attachment.filename || 'file'}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditForm(item)}
                  disabled={previewReadOnly}
                  title={disabledTitle}
                  className="text-sm font-medium text-blue-800 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Edit
                </button>
                {confirmingDeleteId === item.id ? (
                  <>
                    <span className="text-xs text-gray-600">Delete this entry?</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                      className="text-sm font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === item.id ? 'Deleting…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="text-sm font-medium text-gray-600 hover:underline"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(item.id)}
                    disabled={previewReadOnly}
                    title={disabledTitle}
                    className="text-sm font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

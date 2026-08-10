/**
 * Workbench Awardee tab (chunk 3d) — staff orchestration of the Grantee
 * Deliverables Portal. Drives the existing endpoints:
 *   - generate abstract:  POST /api/workbench/grantee-deliverables/generate
 *   - resolve recipients: GET  /api/workbench/grantee-deliverables/recipients
 *   - send invite:        POST /api/workbench/grantee-deliverables/send-invite
 *   - website HTML (b):   GET  /api/workbench/grantee-deliverables/website-html?requestId=
 *   - cycle export (c):   GET  /api/workbench/grantee-deliverables/cycle-export?cycleCode=
 *
 * Flow: Generate (or load) the style-guide abstract → confirm the two recipients
 * (PI in To, liaison in Cc; both pre-filled, editable) → preview/edit the email →
 * Send. Research-only scope (the workflow is only run on research grants).
 * Action-driven: no dedicated state-read endpoint — "Generate abstract" reuses an
 * existing one without a paid call, so it doubles as a load.
 *
 * Deliverable outputs (chunk 8 b/c, wired S271): "Copy website HTML" fetches the
 * single-award fragment and copies it to the clipboard; "Cycle export" opens the
 * combined printable HTML page for this request's board cycle. The cycle code
 * comes from the resolve-request `context` (meeting date → J{YY}/D{YY}); the link
 * is hidden when the request has no June/December cycle.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { GRANTEE_DELIVERABLE_LABEL, GRANTEE_DELIVERABLE_STATUS } from '../../config/granteeDeliverableStatus';
import { useProfile } from '../../context/ProfileContext';
import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';
import { fillInviteBody, fillInviteSubject, formatCobDate } from '../../config/granteeInviteEmail';

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

/**
 * Whole days past the derived response-date estimate, or 0 when not applicable.
 *
 * The estimate is the recorded invite date + 14d, matching formatCobDate. It can
 * differ from the staff-editable date expanded into the email at compose time;
 * re-sends keep the first recorded invite date. Called from the load path rather
 * than render: reading the clock during render is impure (react-hooks/purity) and
 * would let an incidental re-render change the number.
 */
function computeDaysOverdue(invitedAt, responded) {
  if (!invitedAt || responded) return 0;
  const due = new Date(invitedAt);
  if (Number.isNaN(due.getTime())) return 0;
  due.setDate(due.getDate() + 14);
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000));
}

// Mirrors formatMeetingDate in OverviewTab.
function formatSubmissionDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AwardeeTab({ requestId, context }) {
  const [status, setStatus] = useState(null);
  // Editable abstract (S278). `abstractText` is the working copy; `savedAbstractText`
  // is the last persisted value (drives the dirty/disabled state). `abstractField`
  // is which stored field a save lands in ('approved' once the grantee has
  // submitted, else 'formatted'); `abstractEtag` is the row etag loaded with the
  // text (sent back as If-Match so a concurrent change 409s); `abstractEditable`
  // reflects the server's status gate.
  const [abstractText, setAbstractText] = useState('');
  const [savedAbstractText, setSavedAbstractText] = useState('');
  const [abstractField, setAbstractField] = useState(null);
  const [abstractEtag, setAbstractEtag] = useState('');
  const [abstractEditable, setAbstractEditable] = useState(false);
  const [savingAbstract, setSavingAbstract] = useState(false);
  const [abstractMsg, setAbstractMsg] = useState(null);
  // What the grantee returned, read-only. `imageUrl` is server-derived and is
  // non-null ONLY for an absolute http(s) ref, so it is the sole value allowed
  // into an href; `imageRef` may be a relative SharePoint library path.
  const [submission, setSubmission] = useState({
    caption: null, imageRef: null, imageUrl: null, hasImage: false, submittedAt: null,
    invitedAt: null, remindedAt: null, daysOverdue: 0,
  });
  // Which half of the tab is showing: 'invitation' (what goes out) or
  // 'submission' (what came back). Auto-advanced ONCE to 'submission' when the
  // first load finds a returned package — a PD arriving from the submit
  // notification lands on the thing they were told about. `subTabPinnedRef`
  // latches on the first load or the first manual click, so neither a later
  // refetch nor the auto-advance can yank the pane out from under a click.
  const [subTab, setSubTab] = useState('invitation');
  const subTabPinnedRef = useRef(false);
  // Set by the inline image's own onError so a proxy 404/502 falls back to the
  // SharePoint affordance. Reset per load (an event, not an effect) so switching
  // requests or refetching re-tries the image rather than staying broken.
  const [imageBroken, setImageBroken] = useState(false);
  // Send-invitation modal step: null (closed) | 'confirm' | 'sending' | 'sent'.
  // The send is deliberately BEHIND the confirm step — the button no longer
  // sends, it opens this. Failures close the modal and surface on the existing
  // inline error so the PD sees the message next to the compose fields they may
  // need to fix. Mirrors the reviewer InviteEmailModal's preview→sending→sent
  // shape without pulling in its batch/per-candidate machinery.
  const [sendStep, setSendStep] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emailDefaults, setEmailDefaults] = useState({
    subject: '',
    body: '',
    configured: false,
    unavailable: false,
    loaded: false,
  });
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [websiteHtml, setWebsiteHtml] = useState(null);
  const [fetchingHtml, setFetchingHtml] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);
  // Compose-state model (S272): the body is DERIVED from (identity, template choice,
  // recipients) unless the PD has taken ownership by typing. `dirty` = real manual
  // edit; `templateMode` = which template feeds the derive ('auto' = saved-or-default,
  // 'foundation' = the shared default forced by "Reset to default"). This replaces a
  // one-way userEditedBodyRef latch that went stale across identity changes and froze
  // placeholder refills after a reset — both fixed by tracking these explicitly plus
  // an identity-reset effect below.
  const [dirty, setDirty] = useState(false);
  const [templateMode, setTemplateMode] = useState('auto');
  const currentRequestIdRef = useRef(requestId);
  const prevProfileIdRef = useRef(undefined);
  const subjectDirtyRef = useRef(false);
  const defaultLoadSeqRef = useRef(0);
  const abstractLoadSeqRef = useRef(0);

  const { preferences, currentProfile } = useProfile();
  // The logged-in PD's saved custom body (Option A: sender's pref, client-side).
  // Trim only to decide ABSENCE; use the raw value as the template so intentional
  // leading/trailing whitespace in a custom body survives.
  const savedBodyRaw = preferences?.[PREFERENCE_KEYS.GRANTEE_INVITE_BODY] || '';
  const hasSavedBody = savedBodyRaw.trim().length > 0;
  const adminDefaultBody = emailDefaults.body || '';
  const baseTemplate = hasSavedBody ? savedBodyRaw : adminDefaultBody;

  const cycleCode = context?.cycleCode || null;
  const cycleLabel = context?.cycleLabel || null;
  const awardTitle = context?.title || null;

  const handleBodyChange = (e) => {
    setDirty(true);
    setBody(e.target.value);
  };

  const handleSubjectChange = (e) => {
    subjectDirtyRef.current = true;
    setSubject(e.target.value);
  };

  // Restore the Foundation default for THIS send (local only — does not change the
  // PD's saved body). Marks the compose as foundation-template, NOT manually edited,
  // so a later recipient load still fills [Name] (it does not bounce back to the
  // saved custom body because templateMode pins the default).
  const resetToFoundationDefault = () => {
    setTemplateMode('foundation');
    setDirty(false);
  };

  const loadEmailDefaults = useCallback(async () => {
    const seq = defaultLoadSeqRef.current + 1;
    defaultLoadSeqRef.current = seq;
    try {
      const res = await fetch('/api/email-defaults/grantee-invite');
      const data = await res.json().catch(() => ({}));
      if (defaultLoadSeqRef.current !== seq) return;
      if (!res.ok) {
        setEmailDefaults({ subject: '', body: '', configured: false, unavailable: true, loaded: true });
        return;
      }
      const next = {
        subject: String(data.subject || ''),
        body: String(data.body || ''),
        configured: Boolean(data.configured),
        unavailable: Boolean(data.unavailable),
        loaded: true,
      };
      setEmailDefaults(next);
    } catch {
      if (defaultLoadSeqRef.current !== seq) return;
      setEmailDefaults({ subject: '', body: '', configured: false, unavailable: true, loaded: true });
    }
  }, []);

  const loadRecipients = useCallback(async () => {
    if (!requestId) return;
    const loadRequestId = requestId;
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/recipients?requestId=${encodeURIComponent(loadRequestId)}`);
      const data = await res.json();
      if (currentRequestIdRef.current !== loadRequestId) return;
      if (res.ok) {
        setRecipients(data);
        setToEmail(data.pi?.email || '');
        setCcEmail(data.liaison?.email || '');
      }
    } catch { /* recipients are optional context; staff can still type them */ }
  }, [requestId]);

  // Load the EFFECTIVE abstract (approved once the grantee has submitted, else the
  // draft) so the PD can review/edit whatever will publish — including a
  // grantee-returned version, which "Generate abstract" never surfaces. Guarded by
  // currentRequestIdRef so a slow load for a previous request can't clobber state
  // after the PD switches requests, and by a generation so overlapping loads for
  // the same request cannot land out of order.
  const loadAbstract = useCallback(async () => {
    if (!requestId) return;
    const loadRequestId = requestId;
    const seq = abstractLoadSeqRef.current + 1;
    abstractLoadSeqRef.current = seq;
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/abstract?requestId=${encodeURIComponent(loadRequestId)}`);
      const data = await res.json();
      if (abstractLoadSeqRef.current !== seq || currentRequestIdRef.current !== loadRequestId) return;
      if (res.ok) {
        setAbstractText(data.effective || '');
        setSavedAbstractText(data.effective || '');
        setAbstractField(data.effectiveField || null);
        setAbstractEtag(data.etag || '');
        setAbstractEditable(Boolean(data.editable));
        // Mirrors `granteeResponded` in the render — an approved abstract counts
        // as a response, and it is where the editor for that abstract lives, so
        // landing on the other pane would hide it behind a click.
        const responded = Boolean(
          data.hasImage || data.caption || data.submittedAt || data.effectiveField === 'approved',
        );
        setImageBroken(false);
        setSubmission({
          caption: data.caption || null,
          imageRef: data.imageRef || null,
          imageUrl: data.imageUrl || null,
          hasImage: Boolean(data.hasImage),
          submittedAt: data.submittedAt || null,
          invitedAt: data.invitedAt || null,
          remindedAt: data.remindedAt || null,
          daysOverdue: computeDaysOverdue(data.invitedAt, responded),
        });
        // Open on what came back, but only if the PD has not already chosen a
        // pane. Latches either way so a refetch never re-steers the view.
        if (!subTabPinnedRef.current) {
          subTabPinnedRef.current = true;
          if (responded) setSubTab('submission');
        }
        if (data.status !== undefined) setStatus(data.status);
      }
    } catch { /* abstract load is best-effort; "Generate abstract" still works */ }
  }, [requestId]);

  useEffect(() => {
    currentRequestIdRef.current = requestId;
  }, [requestId]);

  useEffect(() => {
    if (!currentProfile?.id) return;
    loadEmailDefaults();
  }, [loadEmailDefaults, currentProfile?.id]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);
  useEffect(() => { loadAbstract(); }, [loadAbstract]);

  // Identity reset (the un-latch): when the producing identity changes — the request
  // being composed, or the logged-in PD whose saved body feeds it — discard prior
  // compose state so the body re-derives for the new identity. Without this, a typed
  // or reset body from one identity would persist (stale) into the next.
  useEffect(() => {
    const id = currentProfile?.id;
    const prev = prevProfileIdRef.current;
    prevProfileIdRef.current = id;
    if (prev === undefined || prev === null) return;
    if (prev === id) return;
    setDirty(false);
    setTemplateMode('auto');
    subjectDirtyRef.current = false;
    setSubject(fillInviteSubject(emailDefaults.subject || '', { title: awardTitle }));
  }, [currentProfile?.id, emailDefaults.subject, awardTitle]);

  // Derive the body from the chosen template + recipients UNLESS the PD has taken
  // ownership by typing. `dirty` is in the deps so the render after an identity reset
  // (which clears dirty) re-fires this and reseeds; baseTemplate is in the deps so a
  // saved body loading after mount reseeds too.
  useEffect(() => {
    if (dirty) return;
    const base = templateMode === 'foundation' ? adminDefaultBody : baseTemplate;
    setBody(fillInviteBody(base, { piName: recipients?.pi?.name, title: awardTitle }));
  }, [dirty, templateMode, adminDefaultBody, baseTemplate, recipients?.pi?.name, awardTitle]);

  useEffect(() => {
    if (subjectDirtyRef.current) return;
    setSubject(fillInviteSubject(emailDefaults.subject || '', { title: awardTitle }));
  }, [emailDefaults.subject, awardTitle]);

  async function generate(regenerate = false) {
    setGenerating(true); setError(null); setAbstractMsg(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, regenerate }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Abstract generation failed.');
      // Reload the effective abstract so the editor + etag reflect the persisted
      // state (the write target may be the grantee-approved field, which generate
      // does not return).
      else { setStatus(data.status); await loadAbstract(); }
    } catch { setError('Abstract generation failed.'); }
    setGenerating(false);
  }

  async function saveAbstract() {
    setSavingAbstract(true); setError(null); setAbstractMsg(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/abstract', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, text: abstractText, etag: abstractEtag, baseField: abstractField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save the abstract.');
        // On a stale/changed conflict, reload so the PD sees the current version.
        if (data.code === 'stale') await loadAbstract();
      } else {
        setSavedAbstractText(abstractText);
        if (data.field) setAbstractField(data.field);
        if (data.etag) setAbstractEtag(data.etag);
        if (data.status !== undefined) setStatus(data.status);
        setAbstractMsg('Abstract saved.');
      }
    } catch { setError('Could not save the abstract.'); }
    setSavingAbstract(false);
  }

  async function send() {
    setSendStep('sending');
    setSending(true); setError(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/send-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, toEmail, ccEmail, subject: fillInviteSubject(subject, { title: awardTitle }), bodyText: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send the invitation.');
        setSendStep(null);
      } else {
        setStatus(data.status);
        // Best-effort: the server records invitedAt on the first status flip.
        // loadAbstract handles its own failures, so a sent email stays successful.
        await loadAbstract();
        // Only after the reload, so the receipt can quote the recorded date.
        setSendStep('sent');
      }
    } catch {
      setError('Could not send the invitation.');
      setSendStep(null);
    }
    setSending(false);
  }

  // Render-only preview of the invitation email — NEVER sends or changes status.
  // Opens the exact send HTML (with a placeholder link) in a new tab, behind a
  // PREVIEW banner so it can't be confused with a real send.
  async function previewEmail() {
    setError(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/preview-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, bodyText: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not render the preview.'); return; }
      const w = window.open('', '_blank');
      if (!w) { setError('Allow pop-ups to preview the email in a new tab.'); return; }
      const safeSubject = fillInviteSubject(subject, { title: awardTitle }).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      w.document.write(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invitation preview</title></head>' +
        '<body style="margin:0;font-family:Arial,sans-serif;color:#111">' +
        '<div style="background:#fef3c7;border-bottom:1px solid #f59e0b;padding:10px 16px;font-size:13px;color:#92400e">' +
        'PREVIEW — this email has NOT been sent. The secure portal link is generated only when you click “Send invitation”.' +
        '</div>' +
        `<div style="padding:14px 20px;border-bottom:1px solid #eee;font-size:14px"><strong>Subject:</strong> ${safeSubject}</div>` +
        `<div style="padding:20px;max-width:680px">${data.html}</div>` +
        '</body></html>');
      w.document.close();
    } catch { setError('Could not render the preview.'); }
  }

  // Output (b): fetch the single-award website HTML and copy it to the clipboard.
  // The fragment is always shown in a textarea so staff can copy manually when
  // the clipboard API is unavailable (e.g. a non-secure context).
  async function copyWebsiteHtml() {
    if (!requestId) return;
    setFetchingHtml(true); setError(null); setCopyMsg(null);
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/website-html?requestId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not build the website HTML.');
      } else {
        setWebsiteHtml(data.html || '');
        try {
          await navigator.clipboard.writeText(data.html || '');
          setCopyMsg('Website HTML copied to the clipboard.');
        } catch {
          setCopyMsg('Website HTML ready — select the text below to copy.');
        }
      }
    } catch { setError('Could not build the website HTML.'); }
    setFetchingHtml(false);
  }

  const statusLabel = status != null ? (GRANTEE_DELIVERABLE_LABEL[status] || String(status)) : 'Not started';
  // Hidden entirely pre-submit: nothing to show until the grantee returns something.
  const hasSubmission = Boolean(submission.hasImage || submission.caption || submission.submittedAt);
  // Did the grantee come back at all? Broader than hasSubmission on purpose: an
  // approved abstract is only ever written by the portal's submit path, so it is
  // itself proof of a response even when the package carried no caption or image
  // (or when those were later cleared). Everything that answers "did they
  // respond?" — the badge, the auto-advance, the empty state — keys off THIS, so
  // the pane can never simultaneously host the approved-abstract editor and claim
  // nothing was received.
  const granteeResponded = hasSubmission || abstractField === 'approved';
  // Which pane the abstract editor belongs in. It is dual-mode: pre-submit it is
  // the draft being prepared for sending (outbound); once the grantee has
  // approved a version it is what publishes (inbound result). It follows its own
  // mode rather than sitting in a fixed pane, so the editor is always next to the
  // work it belongs to. Keyed off abstractField, the same signal the copy uses.
  const abstractPane = abstractField === 'approved' ? 'submission' : 'invitation';
  // Response-date estimate, derived from the first recorded invite date + 14d. It
  // can differ from the staff-editable date expanded into the email at compose time.
  // Re-sends retain the original invite timestamp; the reminder cron fires at day
  // 12 from that same timestamp (reminders service).
  const invitedLabel = formatSubmissionDate(submission.invitedAt);
  const remindedLabel = formatSubmissionDate(submission.remindedAt);
  const dueLabel = submission.invitedAt ? formatCobDate(new Date(submission.invitedAt)) : null;
  // Read from state, not computed here: the clock is measured once at load
  // (see computeDaysOverdue) because reading Date.now() during render is impure
  // and would give an unstable result on any incidental re-render.
  const daysOverdue = submission.daysOverdue;
  const waiverAckedLabel = formatSubmissionDate(submission.submittedAt);
  const hasAbstract = abstractText.trim().length > 0;
  const abstractDirty = abstractText !== savedAbstractText;
  const effectiveBaseBody = hasSavedBody ? savedBodyRaw : adminDefaultBody;
  const emailDefaultsUnavailable = emailDefaults.loaded && emailDefaults.unavailable;
  const emailDefaultsNotConfigured = emailDefaults.loaded
    && !emailDefaults.unavailable
    && ((emailDefaults.subject || '').trim() === '' || effectiveBaseBody.trim() === '');
  const emailTextReady = subject.trim() !== '' && body.trim() !== '';
  // Re-sends are allowed by the service (non-downgrade, and the original invite
  // date is deliberately kept), so the button stays enabled once Invited — but it
  // must not look like a first send, or a stray click silently emails the grantee
  // a second time.
  const alreadyInvited = status === GRANTEE_DELIVERABLE_STATUS.INVITED
    || status === GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT;
  const sendButtonLabel = alreadyInvited ? 'Re-send invitation' : 'Send invitation';
  // MIRRORS the server guard in send-invite-service.js:82-88, which refuses
  // `status === null || status < DRAFTED` ("generate first") and
  // `status >= SUBMITTED` ("already submitted; a new invite cannot be sent").
  // Expressed as the same range rather than a list of values so the two cannot
  // disagree if another option value is inserted. Without this the button stayed
  // enabled on a submitted package and walked the PD through the whole confirm
  // modal to a guaranteed 409 — reported from the 1002788 production run.
  const invitableStatus = status !== null
    && !Number.isNaN(status)
    && status >= GRANTEE_DELIVERABLE_STATUS.DRAFTED
    && status < GRANTEE_DELIVERABLE_STATUS.SUBMITTED;
  // Distinguish "too early" from "too late" so the disabled state can say which.
  const sendClosed = status !== null
    && !Number.isNaN(status)
    && status >= GRANTEE_DELIVERABLE_STATUS.SUBMITTED;
  const canSend = invitableStatus
    && hasAbstract
    && isEmail(toEmail)
    && (!ccEmail || isEmail(ccEmail))
    && !sending
    && emailDefaults.loaded
    && !emailDefaultsUnavailable
    && !emailDefaultsNotConfigured
    && emailTextReady;

  return (
    <div className="space-y-6">
      {/* Status header — always visible, above the panes. The whole point is that
          "where does this award stand" must never be something you have to click a
          pane to discover; that ambiguity is what sent staff looking for a
          submission surface that was simply empty. */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Grantee deliverables</h3>
        <p className="text-sm text-gray-600">Status: <strong>{statusLabel}</strong></p>
        <p className="text-xs text-gray-500">
          {invitedLabel ? `Invited ${invitedLabel}` : 'Not yet invited'}
          {remindedLabel && ` · reminded ${remindedLabel}`}
          {dueLabel && !granteeResponded && ` · estimated response due ${dueLabel}`}
          {granteeResponded && ' · response received'}
        </p>
        {daysOverdue > 0 && (
          <p className="text-xs text-amber-700">
            No response {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} past the estimated response date.
          </p>
        )}
      </section>

      {/* Two panes: what goes out, and what came back. The badge carries the
          answer to "did they respond?" on the tab itself, so splitting the page
          never costs a click to find that out. */}
      <div className="flex gap-1 border-b border-gray-200" role="tablist">
        {[
          { key: 'invitation', label: 'Invitation' },
          {
            key: 'submission',
            label: 'Submission',
            badge: granteeResponded ? '✓ received' : 'pending',
            badgeClass: granteeResponded ? 'text-green-700' : 'text-gray-500',
          },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={subTab === t.key}
            onClick={() => { subTabPinnedRef.current = true; setSubTab(t.key); }}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              subTab === t.key
                ? 'border-blue-700 text-gray-900 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
            {t.badge && <span className={`ml-2 text-xs ${t.badgeClass}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {/* Abstract editor — rendered in whichever pane matches its current mode
          (see abstractPane). Unmounting on a pane switch is safe: the working
          copy, dirty flag, and etag all live in this component's state, so only
          cursor position is lost, never an edit. */}
      {subTab === abstractPane && (
      <section className="space-y-2">
        {/* Generating is an OUTBOUND-phase action: it drafts the text that gets
            sent to the grantee. Once they have returned the package it is both
            pointless and destructive — it would burn a paid LLM call and
            overwrite the historical draft (what we sent) while the published
            text is the approved version it does not touch, so nothing visible
            would change. The server refuses it too (generate-service); this just
            stops offering it. */}
        {!granteeResponded && (
          <button
            type="button"
            onClick={() => generate(hasAbstract)}
            disabled={generating}
            className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
          >
            {generating ? 'Working…' : hasAbstract ? 'Regenerate abstract' : 'Generate abstract'}
          </button>
        )}
        {hasAbstract && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600">
              {abstractField === 'approved'
                ? 'Editing the grantee-approved version — this is what publishes to the website.'
                : 'Editing the draft — review and refine before sending it to the grantee.'}
            </p>
            <textarea
              aria-label="Formatted abstract"
              value={abstractText}
              onChange={(e) => setAbstractText(e.target.value)}
              readOnly={!abstractEditable}
              rows={10}
              className="w-full text-sm border rounded p-2"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveAbstract}
                disabled={savingAbstract || !abstractEditable || !hasAbstract || !abstractDirty}
                className="px-3 py-2 text-sm rounded bg-green-700 text-white disabled:opacity-50"
              >
                {savingAbstract ? 'Saving…' : 'Save edits'}
              </button>
              {abstractDirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
              {abstractMsg && <span className="text-xs text-green-700">{abstractMsg}</span>}
              {!abstractEditable && (
                <span className="text-xs text-gray-500">Read-only in the current status.</span>
              )}
            </div>
          </div>
        )}
      </section>
      )}

      {/* Empty state. Pre-submit this pane used to render nothing at all, which
          made "the grantee has not responded" and "this feature does not exist"
          look identical. Say which one it is. */}
      {subTab === 'submission' && !granteeResponded && (
        <section className="space-y-1 rounded border border-dashed border-gray-300 p-4">
          <p className="text-sm text-gray-700">No submission received yet.</p>
          <p className="text-xs text-gray-500">
            {invitedLabel
              ? `The grantee was invited ${invitedLabel}${dueLabel ? `; the recorded invite date gives an estimated response date of ${dueLabel}` : ''}.`
              : 'Send the invitation from the Invitation tab to start the process.'}
          </p>
          <p className="text-xs text-gray-500">
            Their caption and image will appear here, and you will be emailed when they submit.
          </p>
        </section>
      )}

      {subTab === 'submission' && hasSubmission && (
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-800">Grantee submission</h4>
          {waiverAckedLabel && (
            // Labeled as the waiver acknowledgment, not "submitted": the deliverable
            // row has no submitted-date field. wmkf_waiverackedat is stamped in the
            // same submit changeset, so it is an accurate proxy — but a future
            // resubmit path could separate the two, and this label stays true if so.
            <p className="text-xs text-gray-500">Waiver acknowledged {waiverAckedLabel}</p>
          )}

          <div>
            <p className="text-xs font-medium text-gray-700">Caption</p>
            {submission.caption
              // Grantee-authored text. Rendered as a text child so React escapes it —
              // never dangerouslySetInnerHTML here.
              ? <p className="text-sm text-gray-900 whitespace-pre-wrap">{submission.caption}</p>
              : <p className="text-sm text-gray-500">No caption provided.</p>}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Image</p>
            {/* The image renders in-app through the staff-guarded proxy route.
                The SharePoint affordance below is kept, not replaced: the proxy
                can 404 on a ref shape it does not recognize or 502 when Graph is
                unavailable, and in those cases the link is the only way to see
                the file. `imageBroken` is set by the img's own onError (an event,
                never an effect) and is reset per load in loadAbstract. */}
            {submission.hasImage && !imageBroken && (
              // next/image would route private, auth-guarded bytes through the
              // optimizer and needs fixed dimensions; grantee images are
              // arbitrary-sized and must stay behind requireAppAccess, so a
              // plain <img> is the correct element here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/workbench/grantee-deliverables/image?requestId=${encodeURIComponent(requestId)}`}
                alt={submission.caption || 'Grantee-submitted award image'}
                onError={() => setImageBroken(true)}
                className="max-h-64 max-w-full rounded border border-gray-200"
              />
            )}
            {submission.imageUrl ? (
              <a
                href={submission.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-blue-700 hover:underline"
              >
                Open image in SharePoint ↗
              </a>
            ) : submission.hasImage ? (
              <p className="text-sm text-gray-900">
                <span className="font-mono text-xs break-all">{submission.imageRef}</span>
                <span className="text-gray-500"> (path in the grantee SharePoint library)</span>
              </p>
            ) : (
              <p className="text-sm text-gray-500">No image uploaded.</p>
            )}
            {submission.hasImage && imageBroken && (
              <p className="text-xs text-gray-500">
                The image could not be loaded in the app — open it in SharePoint instead.
              </p>
            )}
          </div>
        </section>
      )}

      {subTab === 'invitation' && (
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-gray-800">Invitation</h4>
        <label className="block text-sm">To (PI)
          <input aria-label="To email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} className="w-full border rounded p-1" />
          {recipients?.pi?.name && <span className="text-xs text-gray-500"> {recipients.pi.name}</span>}
        </label>
        <label className="block text-sm">Cc (liaison)
          <input aria-label="Cc email" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} className="w-full border rounded p-1" />
          {recipients?.liaison?.name && <span className="text-xs text-gray-500"> {recipients.liaison.name}</span>}
        </label>
        <label className="block text-sm">Subject
          <input aria-label="Subject" value={subject} onChange={handleSubjectChange} className="w-full border rounded p-1" />
        </label>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">Email body — edit before sending</span>
            <button
              type="button"
              onClick={resetToFoundationDefault}
              className="text-xs text-blue-700 underline"
            >
              Reset to default
            </button>
          </div>
          <textarea aria-label="Email body" value={body} onChange={handleBodyChange} rows={8} className="w-full border rounded p-2" />
        </div>
        <p className="text-xs text-gray-500">
          A secure magic-link and your saved email signature are added automatically — don’t include a signature here.
          {hasSavedBody && templateMode === 'auto' && !dirty ? ' Starting from your saved custom body (edit it in Profile Settings).' : ''}
        </p>
        {emailDefaultsUnavailable && (
          <p className="text-sm text-red-700">
            Invitation email defaults are unavailable — settings read failed. Reload this page and try again before sending.
          </p>
        )}
        {emailDefaultsNotConfigured && (
          <p className="text-sm text-amber-700">
            Invitation email default not configured. Ask an admin to set the grantee invite subject and body before sending.
          </p>
        )}
        {emailDefaults.loaded && !emailDefaultsUnavailable && !emailDefaultsNotConfigured && !emailTextReady && !sendClosed && (
          <p className="text-sm text-amber-700">
            Enter a subject and body before sending.
          </p>
        )}
        {sendClosed && (
          // Say why the button is dead rather than leaving a greyed control with
          // no explanation. The invitation half of the flow is genuinely over.
          <p className="text-sm text-gray-600">
            The grantee has already returned this package, so no further invitation can be
            sent. See the Submission tab for what they sent.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={previewEmail}
            className="px-3 py-2 text-sm rounded border border-gray-400 text-gray-800"
          >
            Preview email
          </button>
          <button
            type="button"
            onClick={() => setSendStep('confirm')}
            disabled={!canSend}
            className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
          >
            {sending ? 'Sending…' : sendButtonLabel}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {!hasAbstract
            ? 'Generate the abstract before sending. (Preview works any time.)'
            : sendClosed
              ? 'Preview opens the email in a new tab without sending.'
              : 'Preview opens the email in a new tab without sending. The first recorded invitation date starts the 14-day estimate; re-sends keep that date.'}
        </p>
      </section>
      )}

      {/* Outside both panes: the outputs apply at any stage (the website fragment
          renders whichever abstract is current), so burying them in one pane would
          add a click to a routine action. */}
      <section className="space-y-2 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-medium text-gray-800">Deliverable outputs</h4>
        <p className="text-xs text-gray-500">
          Website-ready HTML for this award, and the combined printable page for the whole board cycle.
        </p>
        {copyMsg && <p className="text-sm text-green-700">{copyMsg}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyWebsiteHtml}
            disabled={fetchingHtml || !requestId}
            className="px-3 py-2 text-sm rounded bg-gray-700 text-white disabled:opacity-50"
          >
            {fetchingHtml ? 'Working…' : 'Copy website HTML'}
          </button>
          {cycleCode ? (
            <a
              href={`/api/workbench/grantee-deliverables/cycle-export?cycleCode=${encodeURIComponent(cycleCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-sm rounded bg-gray-700 text-white no-underline"
            >
              Cycle export{cycleLabel ? ` (${cycleLabel})` : ''}
            </a>
          ) : (
            <span className="px-3 py-2 text-sm text-gray-500">
              Cycle export unavailable — no June/December board cycle on this request.
            </span>
          )}
        </div>
        {websiteHtml != null && (
          <textarea
            aria-label="Website HTML"
            readOnly
            value={websiteHtml}
            rows={10}
            onFocus={(e) => e.target.select()}
            className="w-full text-xs font-mono border rounded p-2"
          />
        )}
      </section>

      {/* Send-invitation modal. The confirm step is what the button now opens —
          sending an invitation is an irreversible outbound email, and the old
          inline receipt rendered at the TOP of the pane while the button sits at
          the bottom, so the only feedback for a real send was off-screen.
          Rendered last so it overlays; the backdrop and Cancel both close the
          confirm step, but the sent step has only an explicit Done, because a
          stray backdrop click should not dismiss the record of a real send. */}
      {sendStep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={sendStep === 'confirm' ? () => setSendStep(null) : undefined}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grantee-send-modal-title"
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-white p-8 shadow-xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {sendStep === 'sent' ? (
              <>
                <h4 id="grantee-send-modal-title" className="text-lg font-semibold text-green-800">
                  ✓ Invitation sent
                </h4>
                <div className="text-sm text-gray-900">
                  <p>Sent to {recipients?.pi?.name || 'the grantee'}</p>
                  <p className="font-mono text-sm break-all text-gray-600">{toEmail}</p>
                  {ccEmail && <p className="font-mono text-sm break-all text-gray-600">cc {ccEmail}</p>}
                </div>
                {dueLabel && (
                  <p className="text-sm text-gray-600">
                    Estimated response due {dueLabel}. A reminder sends automatically at day 12
                    if they have not responded.
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSendStep(null)}
                    className="px-3 py-2 text-sm rounded bg-blue-700 text-white"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h4 id="grantee-send-modal-title" className="text-lg font-semibold text-gray-900">
                  {alreadyInvited ? 'Re-send this invitation?' : 'Send invitation?'}
                </h4>
                {alreadyInvited && (
                  // The service keeps the ORIGINAL invite date on a re-send, so the
                  // deadline the PD sees will not move. Say so before they commit.
                  <p className="text-sm text-amber-700">
                    This grantee has already been invited. Re-sending emails them again and keeps
                    the original invitation date, so the estimated response date does not change.
                  </p>
                )}
                <dl className="text-sm text-gray-900 space-y-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">To</dt>
                    <dd className="font-mono text-sm break-all">{toEmail}</dd>
                    {recipients?.pi?.name && <dd className="text-sm text-gray-600">{recipients.pi.name}</dd>}
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Cc</dt>
                    <dd className="font-mono text-sm break-all">{ccEmail || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Subject</dt>
                    <dd className="text-sm">{fillInviteSubject(subject, { title: awardTitle })}</dd>
                  </div>
                </dl>
                <p className="text-sm text-gray-500">
                  Sends a secure magic link and starts the 14-day response estimate.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSendStep(null)}
                    disabled={sendStep === 'sending'}
                    className="px-3 py-2 text-sm rounded border border-gray-400 text-gray-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={send}
                    disabled={sendStep === 'sending'}
                    className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
                  >
                    {sendStep === 'sending' ? 'Sending…' : sendButtonLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

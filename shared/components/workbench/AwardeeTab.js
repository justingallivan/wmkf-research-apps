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
import { GRANTEE_DELIVERABLE_LABEL } from '../../config/granteeDeliverableStatus';
import { useProfile } from '../../context/ProfileContext';
import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';
import { fillInviteBody } from '../../config/granteeInviteEmail';

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

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
  const [sentMsg, setSentMsg] = useState(null);
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
      if (!subjectDirtyRef.current) setSubject(next.subject);
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
  // after the PD switches requests.
  const loadAbstract = useCallback(async () => {
    if (!requestId) return;
    const loadRequestId = requestId;
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/abstract?requestId=${encodeURIComponent(loadRequestId)}`);
      const data = await res.json();
      if (currentRequestIdRef.current !== loadRequestId) return;
      if (res.ok) {
        setAbstractText(data.effective || '');
        setSavedAbstractText(data.effective || '');
        setAbstractField(data.effectiveField || null);
        setAbstractEtag(data.etag || '');
        setAbstractEditable(Boolean(data.editable));
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
    setSubject(emailDefaults.subject || '');
  }, [currentProfile?.id, emailDefaults.subject]);

  // Derive the body from the chosen template + recipients UNLESS the PD has taken
  // ownership by typing. `dirty` is in the deps so the render after an identity reset
  // (which clears dirty) re-fires this and reseeds; baseTemplate is in the deps so a
  // saved body loading after mount reseeds too.
  useEffect(() => {
    if (dirty) return;
    const base = templateMode === 'foundation' ? adminDefaultBody : baseTemplate;
    setBody(fillInviteBody(base, { piName: recipients?.pi?.name, title: awardTitle }));
  }, [dirty, templateMode, adminDefaultBody, baseTemplate, recipients?.pi?.name, awardTitle]);

  async function generate(regenerate = false) {
    setGenerating(true); setError(null); setSentMsg(null); setAbstractMsg(null);
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
    setSending(true); setError(null); setSentMsg(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/send-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, toEmail, ccEmail, subject, bodyText: body }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Could not send the invitation.');
      else { setStatus(data.status); setSentMsg('Invitation sent to the grantee.'); }
    } catch { setError('Could not send the invitation.'); }
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
      const safeSubject = String(subject).replace(/[&<>"']/g, (c) =>
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
  const hasAbstract = abstractText.trim().length > 0;
  const abstractDirty = abstractText !== savedAbstractText;
  const effectiveBaseBody = hasSavedBody ? savedBodyRaw : adminDefaultBody;
  const emailDefaultsUnavailable = emailDefaults.loaded && emailDefaults.unavailable;
  const emailDefaultsNotConfigured = emailDefaults.loaded
    && !emailDefaults.unavailable
    && ((emailDefaults.subject || '').trim() === '' || effectiveBaseBody.trim() === '');
  const emailTextReady = subject.trim() !== '' && body.trim() !== '';
  const canSend = hasAbstract
    && isEmail(toEmail)
    && (!ccEmail || isEmail(ccEmail))
    && !sending
    && emailDefaults.loaded
    && !emailDefaultsUnavailable
    && !emailDefaultsNotConfigured
    && emailTextReady;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Grantee deliverables</h3>
        <p className="text-sm text-gray-600">Status: <strong>{statusLabel}</strong></p>
      </section>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {sentMsg && <p className="text-sm text-green-700">{sentMsg}</p>}

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => generate(hasAbstract)}
          disabled={generating}
          className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
        >
          {generating ? 'Working…' : hasAbstract ? 'Regenerate abstract' : 'Generate abstract'}
        </button>
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
        {emailDefaults.loaded && !emailDefaultsUnavailable && !emailDefaultsNotConfigured && !emailTextReady && (
          <p className="text-sm text-amber-700">
            Enter a subject and body before sending.
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
            onClick={send}
            disabled={!canSend}
            className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {hasAbstract
            ? 'Preview opens the email in a new tab without sending. Send emails the grantee and starts the 14-day clock.'
            : 'Generate the abstract before sending. (Preview works any time.)'}
        </p>
      </section>

      <section className="space-y-2">
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
    </div>
  );
}

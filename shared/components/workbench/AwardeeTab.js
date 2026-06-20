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

import { useEffect, useState, useCallback } from 'react';
import { GRANTEE_DELIVERABLE_LABEL } from '../../config/granteeDeliverableStatus';

const DEFAULT_SUBJECT = 'Your W. M. Keck Foundation award — abstract for our website';
// Program-Director-voice default (owner-approved S271). Bracketed fields are
// staff-filled before sending: [Name], [title], COB [date], and the signature
// ([Program Director name]/[title]). Auto-fill of those (PI name, award title,
// computed deadline, PD signature) is a pending enhancement gated on the open
// cadence/signature decisions. The send route appends the magic-link button +
// fallback link BELOW this body — so "the secure link below" stays accurate and
// no literal link belongs in the body (the link is always server-minted).
const DEFAULT_BODY =
  'Dear Professor [Name]:\n\n' +
  'Congratulations on your recent grant from the W. M. Keck Foundation. We plan to ' +
  'post an abstract on the Foundation’s website describing your award entitled “[title]”.\n\n' +
  'The draft abstract is based on information you provided in your proposal, lightly ' +
  'edited to conform to the style that the Foundation uses in its publications. Please ' +
  'use the secure link below to review it and make any changes no later than COB [date]. ' +
  'If we have not heard from you by this date, we will assume that we have your ' +
  'concurrence to post the draft as written.\n\n' +
  'To better highlight your work, we also encourage you to upload a high-resolution ' +
  'image related to your project, with a caption and credit. The link will walk you ' +
  'through the image and the permission to publish it.\n\n' +
  'As a reminder, in your application you and your institution agreed to acknowledge ' +
  'the Foundation’s support. Please recognize the “W. M. Keck Foundation” in ' +
  'publications and other scientific work related to this award, such as presentations ' +
  'and posters.\n\n' +
  'Please do not hesitate to contact me if you need additional information.\n\n' +
  'Thank you,\n\n' +
  '[Program Director name]\n[Program Director title]\nW. M. Keck Foundation';

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

export default function AwardeeTab({ requestId, context }) {
  const [status, setStatus] = useState(null);
  const [abstract, setAbstract] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sentMsg, setSentMsg] = useState(null);
  const [websiteHtml, setWebsiteHtml] = useState(null);
  const [fetchingHtml, setFetchingHtml] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);

  const cycleCode = context?.cycleCode || null;
  const cycleLabel = context?.cycleLabel || null;

  const loadRecipients = useCallback(async () => {
    if (!requestId) return;
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/recipients?requestId=${encodeURIComponent(requestId)}`);
      const data = await res.json();
      if (res.ok) {
        setRecipients(data);
        setToEmail(data.pi?.email || '');
        setCcEmail(data.liaison?.email || '');
      }
    } catch { /* recipients are optional context; staff can still type them */ }
  }, [requestId]);

  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  async function generate(regenerate = false) {
    setGenerating(true); setError(null); setSentMsg(null);
    try {
      const res = await fetch('/api/workbench/grantee-deliverables/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, regenerate }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Abstract generation failed.');
      else { setAbstract(data.abstractFormatted); setStatus(data.status); }
    } catch { setError('Abstract generation failed.'); }
    setGenerating(false);
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
  const canSend = Boolean(abstract) && isEmail(toEmail) && (!ccEmail || isEmail(ccEmail)) && !sending;

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
          onClick={() => generate(Boolean(abstract))}
          disabled={generating}
          className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
        >
          {generating ? 'Working…' : abstract ? 'Regenerate abstract' : 'Generate abstract'}
        </button>
        {abstract && (
          <textarea aria-label="Formatted abstract" readOnly value={abstract} rows={10} className="w-full text-sm border rounded p-2" />
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
          <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border rounded p-1" />
        </label>
        <label className="block text-sm">Message
          <textarea aria-label="Message body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="w-full border rounded p-2" />
        </label>
        <p className="text-xs text-gray-500">A secure magic-link is added to the email automatically.</p>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send invitation'}
        </button>
        {!abstract && <p className="text-xs text-gray-500">Generate the abstract before sending.</p>}
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

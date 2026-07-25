/**
 * InviteEmailModal — a lean preview→send modal for INVITING saved candidates to
 * review (Workbench Candidates tab). Deliberately NOT the Review Manager
 * EmailModal (which is coupled to localStorage templates and materials
 * attachments). This one is invitation-only:
 *   render-emails (templateType:'invitation', mints the accept/decline magic
 *   link via {{externalLink}}) → editable preview → send-emails
 *   (templateType:'invitation' → sets invited+emailSentAt, no status bump;
 *   skips already-invited unless allowResend).
 *
 * Review-process timeline: respond-by, proposal-delivery, and review-due values
 * appear in the invitation body. They are interpolated CLIENT-SIDE here (not via
 * render-emails) so a blank date drops its line instead of leaking a literal
 * {{token}} into a real email, and so editing a draft doesn't require re-fetching
 * the preview. Load order is built-in defaults → per-user sticky values →
 * admin cycle defaults → request campaign config; more specific values win.
 *
 * Props:
 *   - requestId   : current akoya_request GUID; used to load request campaign settings
 *   - candidates : [{ suggestionId, name, email }] to invite (already filtered)
 *   - settings   : { signature }
 *   - allowResend: when true, the server re-sends to already-invited candidates
 *   - onClose, onSent
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { readSseStream } from './sse';
import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';
import { loadEmailTemplates, EMPTY_TEMPLATES } from './email-template-store';

// Parse a YYYY-MM-DD as LOCAL time (not UTC) and format as "January 15, 2026".
function formatDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Reviewer-engagement Phase 1: respond-by is now a "days to respond" OFFSET, not a
// fixed date (a fixed day-0 date shortchanges later invite waves). The email still
// shows a concrete respond-by DATE — computed here as today + offset, which closely
// tracks the per-reviewer deadline the Phase-3 cron derives server-side from each
// suggestion's real emailSentAt + respondOffsetDays. Returns YYYY-MM-DD (local).
function addDaysToTodayYmd(days, today = new Date()) {
  const n = Number(days);
  if (days === '' || days == null || !Number.isFinite(n) || n < 0) return '';
  const dt = new Date(today);
  dt.setDate(dt.getDate() + Math.round(n));
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Friendly text for the skip reasons the server emits; falls back to the raw
// reason string for anything not called out here.
function skipReasonLabel(reason) {
  if (reason === 'missing_secure_link') return 'missing secure link';
  if (reason === 'unresolved_placeholder') return 'unfilled {{field}}';
  if (reason === 'email_research_only') return 'address is research-only, not invite-ready';
  if (reason === 'program_director_sender_unavailable') return 'assigned Program Director cannot send email';
  return reason;
}

function normalizeOffsetInput(value) {
  if (value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : '';
}

// Resolve each client-side timing token to its display string. respond-by comes
// from the offset (today + N days); the other two are fixed dates. These are NOT
// server placeholders — render-emails leaves them literal and we substitute here.
function timingTokenValues(timing) {
  return {
    '{{respondBy}}': formatDate(addDaysToTodayYmd(timing.respondOffsetDays)),
    '{{proposalDelivery}}': formatDate(timing.proposalSendDate),
    '{{reviewDue}}': formatDate(timing.reviewDueDate),
  };
}

function timingSummary(timing) {
  const items = [];
  const respondBy = formatDate(addDaysToTodayYmd(timing.respondOffsetDays));
  if (respondBy) items.push(`Respond by ${respondBy}`);
  const proposalDelivery = formatDate(timing.proposalSendDate);
  if (proposalDelivery) items.push(`Proposals ${proposalDelivery}`);
  const reviewDue = formatDate(timing.reviewDueDate);
  if (reviewDue) items.push(`Reviews due ${reviewDue}`);
  return items.join(' · ') || 'No timeline dates set';
}

// Substitute the timing tokens with formatted dates. A line whose token has no
// value is dropped entirely (so the bullet doesn't appear with a blank/leftover
// token). The "Review timeline:" header is dropped when nothing is set at all.
function applyTiming(body, timing) {
  const values = timingTokenValues(timing);
  const anySet = Object.values(values).some(Boolean);
  const lines = body.split('\n');
  const out = [];
  for (const line of lines) {
    if (!anySet && /^\s*Review timeline:\s*$/.test(line)) continue;
    let drop = false;
    let next = line;
    for (const [token, value] of Object.entries(values)) {
      if (line.includes(token)) {
        if (!value) { drop = true; break; }
        next = next.split(token).join(value);
      }
    }
    if (!drop) out.push(next);
  }
  return out.join('\n');
}

// The existing campaign fields remain authoritative; this only prevents an
// invitation from presenting the configured dates in an impossible order.
// Blank dates retain the existing behavior (their copy line is omitted).
export function validateInvitationTimeline(timing, today = new Date()) {
  const respondBy = addDaysToTodayYmd(timing.respondOffsetDays, today);
  const proposalDelivery = timing.proposalSendDate || '';
  const reviewDue = timing.reviewDueDate || '';

  if (respondBy && proposalDelivery && proposalDelivery < respondBy) {
    return 'Proposal release cannot be earlier than the response deadline.';
  }
  if (proposalDelivery && reviewDue && reviewDue <= proposalDelivery) {
    return 'The review due date must be after the proposal release date.';
  }
  if (!proposalDelivery && respondBy && reviewDue && reviewDue <= respondBy) {
    return 'The review due date must be after the response deadline.';
  }
  return null;
}

// Invitation subjects may use {{respondBy}}. When a campaign intentionally has
// no response offset, drop the "Action needed by …" prefix rather than leaking a
// literal token or producing an awkward empty date.
export function applySubjectTiming(subject, timing) {
  const respondBy = timingTokenValues(timing)['{{respondBy}}'];
  if (respondBy) return String(subject || '').split('{{respondBy}}').join(respondBy);
  return String(subject || '')
    .replace(/Action needed by\s*\{\{respondBy\}\}\s*:\s*/i, '')
    .replace(/\{\{respondBy\}\}/g, '')
    .trim();
}

export default function InviteEmailModal({ requestId = null, candidates = [], settings = {}, allowResend = false, onClose, onSent }) {
  const [step, setStep] = useState('preview'); // preview | sending | sent | error
  const [rawDrafts, setRawDrafts] = useState([]); // from render-emails, timing tokens still literal
  const [edits, setEdits] = useState({}); // suggestionId -> { subject?, body? } user overrides
  const [timing, setTiming] = useState({ respondOffsetDays: 7, proposalSendDate: '', reviewDueDate: '' });
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [template, setTemplate] = useState(EMPTY_TEMPLATES.invitation); // resolved invitation template (admin default + per-PD override), loaded on open
  const [templateLoaded, setTemplateLoaded] = useState(false); // gate the first render until the template load settles (see renderPreviews) — the initial `template` is the EMPTY skeleton
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: 'Rendering previews…' });
  const [results, setResults] = useState({ sent: [], failed: [], skipped: [], unconfirmed: [] });
  const [confirmedLowConfidenceIds, setConfirmedLowConfidenceIds] = useState({});
  const [abstractEditorOpen, setAbstractEditorOpen] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState('');
  const [abstractSaving, setAbstractSaving] = useState(false);
  const [abstractError, setAbstractError] = useState(null);
  // Per-recipient clipboard feedback for the manual recovery path offered only
  // when the server classifies an address as research-only. The render service
  // already minted the link using the normal invitation expiry policy; copying
  // it does not send email or stamp the suggestion invited. A separate,
  // confirmed action records the invitation only after staff sends it.
  const [manualLinkCopyState, setManualLinkCopyState] = useState({});
  const mountedRef = useRef(true);
  const timelineError = validateInvitationTimeline(timing);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable across renders (candidates is a fresh array each parent render, so a
  // raw .map() would give renderPreviews a new identity every render and the
  // render-previews effect below would re-fetch in a loop). Key on the id list.
  const idsKey = candidates.map((c) => c.suggestionId).filter(Boolean).join(',');
  const suggestionIds = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  // On open: load the user's invitation template + sticky timing defaults, then
  // overlay admin cycle defaults, then request-level campaign config for the
  // fields that are shared with Campaign settings. This keeps stale per-user
  // defaults from showing a different review due date than the admin/request
  // source of truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextTiming = {};
      try {
        const res = await fetch(`/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.INVITE_TIMING)}`);
        const data = await res.json().catch(() => ({}));
        if (data?.value) {
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          // Pick only the known keys (a pre-Phase-1 sticky value carries the retired
          // `respondByDate` date — ignore it; respondOffsetDays falls back to default 7).
          if (parsed.respondOffsetDays != null && parsed.respondOffsetDays !== '') nextTiming.respondOffsetDays = parsed.respondOffsetDays;
          if (typeof parsed.proposalSendDate === 'string') nextTiming.proposalSendDate = parsed.proposalSendDate;
          if (typeof parsed.reviewDueDate === 'string') nextTiming.reviewDueDate = parsed.reviewDueDate;
        }
      } catch { /* sticky defaults are best-effort */ }
      try {
        const res = await fetch('/api/review-manager/campaign-timeline-defaults');
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.timeline && data.isDefault !== true) {
          const d = data.timeline;
          nextTiming.respondOffsetDays = d.respondOffsetDays == null ? '' : d.respondOffsetDays;
          nextTiming.proposalSendDate = d.proposalReleaseDate || '';
          nextTiming.reviewDueDate = d.reviewDueDate || '';
        }
      } catch { /* admin cycle defaults are best-effort for preview hydration */ }
      if (requestId) {
        try {
          const res = await fetch(`/api/review-manager/campaign-config?requestId=${encodeURIComponent(requestId)}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.config) {
            const c = data.config;
            if (c.respondOffsetDays != null) nextTiming.respondOffsetDays = c.respondOffsetDays;
            if (c.reviewDueDate) nextTiming.reviewDueDate = c.reviewDueDate;
          }
        } catch { /* request campaign config is best-effort for preview hydration */ }
      }
      if (!cancelled && Object.keys(nextTiming).length > 0) {
        setTiming((t) => ({ ...t, ...nextTiming }));
      }
      try {
        const tpl = await loadEmailTemplates();
        if (!cancelled && tpl?.invitation) setTemplate(tpl.invitation);
      } catch { /* falls back to the default invitation template */ }
      finally {
        // Mark the load settled (success or failure) so renderPreviews can fire.
        // Until this flips, the first render is suppressed — otherwise it POSTs the
        // EMPTY skeleton template and render-emails 400s ("template with subject and
        // body is required"), flashing that error until the real template lands.
        if (!cancelled) setTemplateLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  // Generation guard: the effect below re-runs renderPreviews when `template`
  // lands from loadEmailTemplates, so two fetches can be in flight at once. Only
  // the latest invocation may apply its result — a slower older response must not
  // overwrite a newer one's drafts.
  const renderGenRef = useRef(0);
  const renderPreviews = useCallback(async () => {
    // Wait for the template load to settle before the first render — rendering with
    // the initial EMPTY skeleton trips the render-emails 400 guard and flashes it
    // until the real template lands. Once loaded, the effect re-fires (templateLoaded
    // is in the deps below) with the resolved template.
    if (!templateLoaded) return;
    const gen = ++renderGenRef.current;
    setError(null); setRawDrafts([]); setManualLinkCopyState({});
    setProgress({ current: 0, total: suggestionIds.length, message: 'Rendering previews…' });
    try {
      const res = await fetch('/api/review-manager/render-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionIds,
          templateType: 'invitation',
          template,
          settings: { signature: settings.signature || '' },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (gen !== renderGenRef.current) return; // superseded by a newer render
      if (!res.ok) throw new Error(data.error || 'Failed to render previews');
      setRawDrafts(data.drafts || []);
    } catch (e) {
      if (gen !== renderGenRef.current) return;
      setError(e.message);
    }
  }, [suggestionIds, settings.signature, template, templateLoaded]);

  // Render previews on open and again if the loaded template differs from the
  // default (renderPreviews identity changes when `template` updates).
  useEffect(() => {
    renderPreviews();
    // On unmount (or before a re-render) invalidate any in-flight render so its
    // post-await setRawDrafts/setError can't fire on an unmounted component — reuses
    // the existing generation guard (a bumped ref makes `gen !== current` true).
    return () => { renderGenRef.current++; };
  }, [renderPreviews]);

  // Displayed draft = server-rendered draft with timing applied, unless the user
  // has manually edited that field (edits win; changing dates won't clobber them).
  const draftView = (d) => ({
    ...d,
    subject: edits[d.suggestionId]?.subject ?? applySubjectTiming(d.subject, timing),
    body: edits[d.suggestionId]?.body ?? (d.skipped ? d.body : applyTiming(d.body, timing)),
  });
  const drafts = rawDrafts.map(draftView);

  // Single-proposal modal — abstract fields agree across all drafts, so the first
  // flagged draft (if any) speaks for the whole batch. flagged.reflowedAbstract
  // seeds the editor; flagged.requestId is the write target for the save.
  const flaggedAbstract = rawDrafts.find((d) => d.abstractFlagged === true) || null;

  const updateEdit = (suggestionId, field, value) =>
    setEdits((prev) => ({ ...prev, [suggestionId]: { ...prev[suggestionId], [field]: value } }));

  const copyManualLink = async (draft) => {
    if (!draft?.suggestionId || !draft?.manualLink) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(draft.manualLink);
      if (!mountedRef.current) return;
      setManualLinkCopyState((prev) => ({
        ...prev,
        [draft.suggestionId]: { copied: true, error: null },
      }));
    } catch (e) {
      if (!mountedRef.current) return;
      setManualLinkCopyState((prev) => ({
        ...prev,
        [draft.suggestionId]: { copied: false, error: e.message },
      }));
    }
  };

  const markManualInviteSent = async (draft) => {
    if (!draft?.suggestionId || !draft?.manualLink) return;
    const ok = window.confirm(
      `Only continue after you have sent the invitation to ${draft.candidateName || 'this reviewer'} yourself. `
      + 'This records the reviewer as invited and starts the normal reminder timeline.'
    );
    if (!ok) return;
    setManualLinkCopyState((prev) => ({
      ...prev,
      [draft.suggestionId]: { ...prev[draft.suggestionId], marking: true, markError: null },
    }));
    try {
      const res = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: draft.suggestionId,
          markManualInviteSent: true,
          manualLink: draft.manualLink,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not record the manual invitation.');
      if (!mountedRef.current) return;
      if (onSent) onSent();
      onClose();
    } catch (e) {
      if (!mountedRef.current) return;
      setManualLinkCopyState((prev) => ({
        ...prev,
        [draft.suggestionId]: { ...prev[draft.suggestionId], marking: false, markError: e.message },
      }));
    }
  };

  const handleSaveAbstract = async () => {
    if (!flaggedAbstract || !abstractDraft.trim()) return;
    // Overwriting the canonical abstract of record is durable and cannot be
    // undone; confirm it (mirrors the send path's confirm). Warn that it also
    // resets manual email edits, since we drop per-recipient body overrides
    // below so the corrected abstract reaches every draft.
    const ok = window.confirm(
      'Update this proposal’s source abstract? This overwrites the applicant '
      + 'abstract of record used for these reviewer invites, cannot be undone, and '
      + 'resets any manual edits you have made to these emails. It does not rewrite '
      + 'a grantee/board version that was already generated from the old text.'
    );
    if (!ok) return;
    setAbstractSaving(true);
    setAbstractError(null);
    try {
      const res = await fetch('/api/review-manager/update-abstract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // expectedCurrent = the abstract this editor was seeded from; the service
        // rejects (409) if someone else rewrote it since, so we never silently
        // clobber a newer edit.
        body: JSON.stringify({
          requestId: flaggedAbstract.requestId,
          abstract: abstractDraft,
          expectedCurrent: flaggedAbstract.currentAbstract,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // On a concurrent-edit conflict, reload so the editor reseeds from the
        // now-current abstract before the PD re-applies their fix.
        if (res.status === 409) renderPreviews();
        throw new Error(data.error || 'Failed to save abstract');
      }
      setAbstractEditorOpen(false);
      // Drop per-recipient subject/body overrides: a manual body edit would else
      // keep the pre-fix abstract on that recipient's email, contradicting "fixed
      // everywhere". The re-render below reseeds every draft from the new abstract.
      setEdits({});
      renderPreviews(); // re-fetch so drafts/abstractFlagged reflect the fixed abstract
    } catch (e) {
      setAbstractError(e.message);
    } finally {
      setAbstractSaving(false);
    }
  };

  const sendable = drafts.filter((d) => !d.skipped && d.candidateEmail);
  const capturedSent = results.sent.filter((r) => r.capturedEmail);
  // Sent, but the "invited" bookkeeping write failed (inviteRecorded === false) — the
  // email went out, so this is neither a clean success nor a failure. Route it into the
  // same "verify before retry" bucket as email_unconfirmed rather than the plain sent list,
  // since re-inviting without checking Dynamics risks a double-send.
  const confirmedSent = results.sent.filter((r) => !r.capturedEmail && r.inviteRecorded !== false);
  const unconfirmedSent = results.sent.filter((r) => !r.capturedEmail && r.inviteRecorded === false);
  const verifyBeforeRetry = [...results.unconfirmed, ...unconfirmedSent];
  // Quick-check recipients are sendable only after a deliberate staff check.
  // Research-only leads are removed from sendable by the render service and
  // cannot be promoted by this checkbox.
  const quickCheckSendable = sendable.filter((d) => d.emailConfidence?.action === 'quick_check');
  const allQuickChecksConfirmed = quickCheckSendable.every((d) => confirmedLowConfidenceIds[d.suggestionId] === true);

  const persistTiming = useCallback(async () => {
    try {
      await fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PREFERENCE_KEYS.INVITE_TIMING, value: JSON.stringify(timing) }),
      });
    } catch { /* sticky save is best-effort */ }
  }, [timing]);

  const handleSend = async () => {
    if (sendable.length === 0) { setError('No recipients with an email to send to.'); return; }
    if (timelineError) { setError(timelineError); return; }
    if (quickCheckSendable.length > 0 && !allQuickChecksConfirmed) {
      setError('Confirm each quick-check address before sending.');
      return;
    }
    // Irreversible-action confirm for EVERY send. Low-confidence acknowledgement
    // is the per-recipient checkbox list above (not this dialog) — this guards the
    // batch itself, since a real email cannot be unsent.
    const ok = window.confirm(
      `Send ${sendable.length} invitation${sendable.length === 1 ? '' : 's'} now via Dynamics? `
      + 'This sends a real email with an accept/decline link and cannot be undone.'
    );
    if (!ok) return;
    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Sending…' });
    setError(null);
    setResults({ sent: [], failed: [], skipped: [], unconfirmed: [] });
    persistTiming(); // remember the dates for next time (best-effort, non-blocking)
    try {
      const res = await fetch('/api/review-manager/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: sendable.map((d) => ({ suggestionId: d.suggestionId, subject: d.subject, body: d.body })),
          templateType: 'invitation',
          attachmentUrls: [],
          markAsSent: true,
          allowResend,
          // Reviewer-engagement Phase 1: persist the per-request campaign config on the
          // FIRST invite-batch send. Discrete values the Phase-3 cron / Phase-4 sweep
          // need; the server writes them to the request only if it has none yet (never
          // clobbers a later edit). reviewDueDate is YYYY-MM-DD or null.
          campaignConfig: {
            respondOffsetDays: timing.respondOffsetDays === '' ? null : Number(timing.respondOffsetDays),
            reviewDueDate: timing.reviewDueDate || null,
          },
          // Staff acknowledged THESE specific quick-check addresses in the preview
          // above (which named them). Recipient-specific, not a batch boolean: the server only
          // honors the override for these exact suggestionIds, so a row that became LOW after
          // preview (and was never shown/acknowledged) is still refused (`email_unconfirmed`).
          // Only the rows the staffer actually ticked — never the whole LOW list —
          // so a regression in the send-button disable logic cannot smuggle an
          // unconfirmed address through as confirmed.
          confirmedLowConfidenceIds: quickCheckSendable
            .filter((d) => confirmedLowConfidenceIds[d.suggestionId] === true)
            .map((d) => d.suggestionId),
        }),
      });
      let final = null;
      let sawTerminalError = false;
      await readSseStream(res, ({ event, data }) => {
        if (event === 'error') { sawTerminalError = true; setError(data?.message || 'Send failed'); return; }
        if (event === 'progress') setProgress((p) => ({ ...p, ...data }));
        else if (event === 'email_sent') setResults((r) => ({ ...r, sent: [...r.sent, data] }));
        else if (event === 'email_failed') setResults((r) => ({ ...r, failed: [...r.failed, data] }));
        else if (event === 'email_unconfirmed') setResults((r) => ({ ...r, unconfirmed: [...r.unconfirmed, data] }));
        else if (event === 'result') final = data;
      });
      if (final) {
        setResults({
          sent: final.sent || [],
          failed: final.failed || [],
          skipped: final.skipped || [],
          unconfirmed: final.unconfirmed || [],
        });
      }
      if (sawTerminalError) {
        setStep('error');
      } else {
        setStep('sent');
        if (onSent) onSent();
      }
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="font-medium text-gray-900">
            {allowResend ? 'Re-invite reviewers' : 'Invite reviewers'} ({candidates.length})
          </p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm mb-3">{error}</div>}

          {step === 'preview' && (
            <>
              <div className="mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setTimelineOpen((open) => !open)}
                  aria-expanded={timelineOpen}
                  className="w-full text-left"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-gray-700">Reviewer campaign timeline</span>
                    <span className="text-xs text-gray-500">{timelineOpen ? 'Collapse' : 'Edit'}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">{timingSummary(timing)}</span>
                </button>
                {timelineOpen && (
                  <div className="mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="text-xs text-gray-600">
                        Days to respond
                        <input type="number" min="0" step="1" value={timing.respondOffsetDays}
                          onChange={(e) => setTiming((t) => ({ ...t, respondOffsetDays: normalizeOffsetInput(e.target.value) }))}
                          className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                      </label>
                      <label className="text-xs text-gray-600">
                        Proposals released to reviewers
                        <input type="date" value={timing.proposalSendDate}
                          onChange={(e) => setTiming((t) => ({ ...t, proposalSendDate: e.target.value }))}
                          className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                      </label>
                      <label className="text-xs text-gray-600">
                        Reviews due
                        <input type="date" value={timing.reviewDueDate}
                          onChange={(e) => setTiming((t) => ({ ...t, reviewDueDate: e.target.value }))}
                          className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                      </label>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">
                      Days to respond and reviews due are request-level campaign settings when saved. Proposal release is email-only copy for this invitation. A blank field omits its line.
                    </p>
                    {timelineError ? (
                      <p role="alert" className="text-xs text-red-700 mt-2">{timelineError}</p>
                    ) : null}
                  </div>
                )}
              </div>

              {flaggedAbstract && !abstractEditorOpen && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">Abstract has hard line breaks</p>
                  <p className="mt-1 text-xs text-amber-800">
                    This proposal&rsquo;s abstract has hard line breaks (it was pasted with fixed-width wrapping).
                    It&rsquo;s been auto-cleaned for these emails, but you can fix the source abstract so future
                    reads start from clean text.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAbstractDraft(flaggedAbstract.reflowedAbstract || '');
                      setAbstractError(null);
                      setAbstractEditorOpen(true);
                    }}
                    className="mt-2 px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200"
                  >
                    Edit abstract
                  </button>
                </div>
              )}

              {abstractEditorOpen && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-sm font-medium text-gray-900">Edit abstract</p>
                  <p className="mt-1 text-xs text-gray-500">
                    We reflowed the wrapped text — add a blank line between paragraphs if needed. This updates the
                    proposal&rsquo;s abstract of record (used everywhere it appears, not just this email).
                  </p>
                  <textarea
                    className="mt-2 w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono resize-y min-h-[12rem]"
                    rows={12}
                    value={abstractDraft}
                    onChange={(e) => setAbstractDraft(e.target.value)}
                  />
                  {abstractError && <p className="mt-1 text-xs text-red-700">{abstractError}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveAbstract}
                      disabled={abstractSaving || !abstractDraft.trim()}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {abstractSaving ? 'Saving…' : 'Save abstract'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAbstractEditorOpen(false); setAbstractError(null); }}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setAbstractDraft(flaggedAbstract?.currentAbstract || '')}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Revert to original
                    </button>
                  </div>
                </div>
              )}

              {rawDrafts.length === 0 && !error ? (
                <p className="text-sm text-gray-500">{progress.message}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Review each recipient below. The secure-link position renders as one pair of accept/decline buttons in the sent email.
                  </p>
                  {drafts.map((d) => (
                    <div key={d.suggestionId} className={`border rounded-lg p-3 ${d.skipped ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{d.candidateName || '(unnamed)'}</span>
                        <span className="text-xs text-gray-500">{d.candidateEmail || 'no email'}</span>
                      </div>
                      {!d.skipped && d.emailConfidence?.action === 'quick_check' && (
                        <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                          <span aria-hidden="true">⚠</span>
                          <span>
                            Quick check recommended
                            {d.emailConfidence?.reason ? ` (${d.emailConfidence.reason})` : ''}.
                          </span>
                        </p>
                      )}
                      {d.skipped ? (
                        <div className="mt-1 text-xs text-amber-800">
                          <p>{d.skipped === 'no_email' ? 'Skipped — no email address.' : `Skipped — ${skipReasonLabel(d.skipped)}.`}</p>
                          {d.skipped === 'email_research_only' && (
                            <div className="mt-2 rounded border border-amber-200 bg-white/70 p-2">
                              <p>
                                The app will not send to an address found only through web search. If you independently
                                verify it, use Edit contact after closing this window. Or copy the secure link below
                                and paste it into a message you send yourself.
                              </p>
                              <p className="mt-1 text-[11px] text-amber-700">
                                Copying sends nothing. After you send the message yourself, record it below so the
                                app does not invite the reviewer again and can follow the normal reminder timeline.
                              </p>
                              {d.manualLink ? (
                                <div className="mt-2">
                                  <label className="block font-medium text-amber-900">
                                    Secure invitation link
                                    <input
                                      readOnly
                                      aria-label={`Secure invitation link for ${d.candidateName || 'reviewer'}`}
                                      value={d.manualLink}
                                      onFocus={(e) => e.target.select()}
                                      className="mt-1 w-full rounded border border-amber-300 bg-white px-2 py-1 font-mono text-[11px] text-gray-700"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => copyManualLink(d)}
                                    className="mt-2 rounded border border-amber-300 bg-amber-100 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-200"
                                  >
                                    Copy secure invitation link
                                  </button>
                                  {manualLinkCopyState[d.suggestionId]?.copied && (
                                    <p role="status" aria-live="polite" className="mt-1 text-[11px] text-amber-700">Copied to the clipboard.</p>
                                  )}
                                  {manualLinkCopyState[d.suggestionId]?.error && (
                                    <p role="alert" className="mt-1 text-[11px] text-amber-700">
                                      {manualLinkCopyState[d.suggestionId].error} Select and copy the link from the field above.
                                    </p>
                                  )}
                                  <p className="mt-2 text-[11px] text-amber-700">
                                    If you reload or regenerate this preview before recording the send, copy the newest link.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => markManualInviteSent(d)}
                                    disabled={manualLinkCopyState[d.suggestionId]?.marking === true}
                                    className="mt-2 rounded bg-amber-800 px-2.5 py-1 font-medium text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {manualLinkCopyState[d.suggestionId]?.marking ? 'Recording…' : 'I sent it — mark manually sent'}
                                  </button>
                                  {manualLinkCopyState[d.suggestionId]?.markError && (
                                    <p role="alert" className="mt-1 text-[11px] text-red-700">
                                      {manualLinkCopyState[d.suggestionId].markError}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="mt-2 text-red-700">
                                  A secure link could not be generated. Close this window and try again.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <input
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                            value={d.subject}
                            onChange={(e) => updateEdit(d.suggestionId, 'subject', e.target.value)}
                          />
                          <textarea
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono resize-y min-h-[16rem]"
                            rows={16}
                            value={d.body}
                            onChange={(e) => updateEdit(d.suggestionId, 'body', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {quickCheckSendable.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-medium text-amber-900">Confirm quick-check addresses</p>
                      <div className="mt-2 space-y-2">
                        {quickCheckSendable.map((d) => (
                          <label key={d.suggestionId} className="flex items-start gap-2 text-xs text-amber-900">
                            <input
                              type="checkbox"
                              checked={confirmedLowConfidenceIds[d.suggestionId] === true}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setConfirmedLowConfidenceIds((prev) => ({ ...prev, [d.suggestionId]: checked }));
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700"
                            />
                            <span>
                              <span className="font-medium">{d.candidateName || '(unnamed)'}</span>
                              {' '}<span>{d.candidateEmail}</span>
                              {d.emailConfidence?.reason ? <span className="block text-amber-800">{d.emailConfidence.reason}</span> : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === 'sending' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Sending {progress.current || 0}/{progress.total || sendable.length}… {progress.message}</p>
            </div>
          )}

          {(step === 'sent' || step === 'error') && (
            <div className="space-y-2 text-sm">
              {capturedSent.length > 0 ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900">
                  <p className="font-medium">Captured {capturedSent.length} invitation email{capturedSent.length === 1 ? '' : 's'} for rehearsal.</p>
                  <p className="mt-1 text-xs text-blue-800">
                    No Dynamics email was sent. Review the generated artifact below, then use its accept/decline link for the reviewer-side test.
                  </p>
                </div>
              ) : (
                step !== 'error' && confirmedSent.length > 0 && (
                  <p className="text-green-700">
                    Sent {confirmedSent.length}: {confirmedSent.map((r) => r.candidateName || '?').join(', ')}
                  </p>
                )
              )}
              {verifyBeforeRetry.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p className="font-medium">Possibly sent — verify before retrying</p>
                  <p className="mt-1 text-xs text-amber-800">
                    These emails may have already gone out. Check Dynamics before re-inviting to avoid a double-send.
                  </p>
                  <p className="mt-2 text-xs">
                    {verifyBeforeRetry.map((r) => `${r.candidateName || '?'}${r.error ? ` (${r.error})` : ''}`).join(', ')}
                  </p>
                </div>
              )}
              {capturedSent.length > 0 && (
                <div className="space-y-2">
                  {capturedSent.map((r) => (
                    <details key={r.suggestionId || r.emailId} className="rounded-lg border border-gray-200 bg-white p-3">
                      <summary className="cursor-pointer text-sm font-medium text-gray-900">
                        {r.candidateName || r.capturedEmail.candidateName || 'Captured invitation'} &lt;{r.capturedEmail.to || 'unknown recipient'}&gt;
                      </summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-gray-600">
                          <span className="font-medium">Subject:</span> {r.capturedEmail.subject || r.subject || '(no subject)'}
                        </p>
                        <textarea
                          readOnly
                          rows={8}
                          className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700"
                          value={r.capturedEmail.htmlBody || ''}
                        />
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {results.skipped.length > 0 && (
                <p className="text-amber-700">
                  Skipped {results.skipped.length}: {results.skipped.map((s) => `${s.candidateName || '?'} (${skipReasonLabel(s.reason)})`).join(', ')}
                </p>
              )}
              {results.failed.length > 0 && (
                <p className="text-red-700">Failed {results.failed.length}: {results.failed.map((f) => `${f.candidateName || '?'} (${f.error})`).join(', ')}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200">
          {step === 'preview' && (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sendable.length === 0 || !!timelineError || (quickCheckSendable.length > 0 && !allQuickChecksConfirmed)}
                className={`px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                  quickCheckSendable.length > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-900 hover:bg-gray-800'
                }`}
                title={timelineError || (quickCheckSendable.length > 0
                  ? `${quickCheckSendable.length} address(es) need a quick check before sending`
                  : undefined)}
              >
                {quickCheckSendable.length > 0
                  ? `Confirm & send ${sendable.length} invitation${sendable.length === 1 ? '' : 's'}`
                  : `Send ${sendable.length > 0 ? sendable.length : ''} invitation${sendable.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          {(step === 'sent' || step === 'error') && (
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

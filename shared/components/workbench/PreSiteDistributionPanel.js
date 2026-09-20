import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson, requestEnvelope } from '../../utils/api-request';
import { Card } from '../Layout';
import EmailSendFeedback from '../EmailSendFeedback';
import CuratedRecipientPicker from './CuratedRecipientPicker';
import { deliberationSessionLine } from '../../utils/deliberation-stage';
import {
  DELIBERATION_SHARE_SEED_BODY,
  DELIBERATION_SHARE_SEED_SUBJECT,
  renderDeliberationShareSubject,
} from '../../config/deliberationShareEmail';

const EMPTY_LIST = Object.freeze([]);
const STALE_PREVIEW_CODES = new Set([
  'distribution_stale_source',
  'distribution_material_stale',
  'distribution_site_visit_stale',
  'distribution_preview_changed',
  'distribution_briefing_stale',
  'distribution_session_stale',
]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function localDayOrdinal(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

function groupHistoryByDay(attempts) {
  const groups = new Map();
  attempts.forEach((attempt) => {
    const date = new Date(attempt.createdAt);
    const dayOrdinal = localDayOrdinal(date);
    if (!groups.has(dayOrdinal)) {
      groups.set(dayOrdinal, {
        dayOrdinal,
        date,
        attempts: [],
      });
    }
    groups.get(dayOrdinal).attempts.push(attempt);
  });
  return Array.from(groups.values()).sort((left, right) => right.dayOrdinal - left.dayOrdinal);
}

function historyDayLabel(date) {
  const difference = localDayOrdinal(new Date()) - localDayOrdinal(date);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isTestSend(attempt) {
  const from = attempt.from?.toLowerCase();
  return Boolean(from && [...attempt.to, ...attempt.cc].every((address) => (
    address.toLowerCase() === from
  )));
}

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

function briefingExpiryLabel(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Live briefing link header (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.4,
 * D16). Copy is one click; "Issue new link" is a two-step inline confirm that
 * names the consequence, because earlier emails stop working the moment the
 * replacement exists.
 */
function BriefingLinkCard({ link, onReissue, busy, error }) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!link || (!link.url && !link.unreadable)) return null;
  const unreadable = !link.url;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const expires = briefingExpiryLabel(link.expiresAt);
  return (
    <Card hover={false}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Briefing page link</h3>
          {unreadable ? (
            <p className="mt-1 text-sm text-amber-800">
              The current link can no longer be read on the server, so it cannot be copied or sent again. Issue a new link, then send the materials again.
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              Board members and consultants open the brief, every completed review, the proposal, and the site visit materials here without a login.
              {expires ? ` Live until ${expires}.` : ''}
            </p>
          )}
          {!unreadable && <p className="mt-2 truncate font-mono text-xs text-gray-500" title={link.url}>{link.url}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!unreadable && (
            <button
              type="button"
              onClick={copy}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          {!confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              Issue new link
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Issuing a new link stops the current one immediately. Anyone holding an earlier email will need the new link, so send the materials again afterward.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={async () => { await onReissue(); setConfirming(false); }}
              disabled={busy}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Issuing…' : 'Issue new link'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900"
            >
              Keep current link
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
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

/**
 * Modal shell for the composer (tab redesign). Escape and the Close button
 * dismiss it unless a prepare or send is in flight; focus lands on Close and
 * returns to the opener on unmount.
 */
function ComposerDialog({ onClose, busy, escapeDisabled = false, children }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previouslyFocused?.focus) previouslyFocused.focus();
    };
  }, []);
  useEffect(() => {
    // Escape closes the composer unless a nested dialog (the recipient
    // picker, stacked above at z-60) owns the key right now.
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy && !escapeDisabled) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, escapeDisabled, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-composer-title"
        className="my-6 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="share-composer-title" className="text-lg font-semibold text-gray-900">Share for the deliberation session</h3>
            <p className="mt-1 text-sm text-gray-600">
              The email carries the briefing page link; the brief, every completed review, the proposal, and the site visit materials open there without a login.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>
        {children}
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PreSiteDistributionPanel({
  requestId,
  requestNumber,
  sourceArtifact,
  siteVisit = null,
  // Tracker §5.6: the request's latest deliberation slot, shown read-only in
  // the form and bound into the preview by the server.
  session = null,
  // Material links retired 2026-09-10 (owner): the briefing page carries the
  // site visit materials; the composer no longer offers them.
  suggestedTo = EMPTY_LIST,
  suggestedCc = EMPTY_LIST,
  onHistory = null,
  // Once the current document's materials have gone out, composing another
  // send is a secondary action: the composer folds behind a closed disclosure
  // instead of presenting as the stage's main job (owner, S466).
  collapsed = false,
  // Tab redesign (shape brief, owner 2026-09-10): the Staff Deliberations tab
  // keeps the briefing-link card and history inline and opens the composer as
  // a dialog from its Share action. 'inline' is the legacy layout.
  composer = 'inline', // 'inline' | 'dialog' | 'hidden'
  onCloseComposer = null,
  // Runs before the prepare request; the tab locks the draft here (lock, then
  // preview, then send), so a lock failure surfaces in the composer.
  beforePrepare = null,
  needsLock = false,
  // Briefing-link card and email history; the tab hides them until the draft is shared.
  record = true,
}) {
  // No attachment field: since 2026-09-10 the email carries the briefing page
  // link instead of the writeup (owner; shape brief). The server records
  // attachment_mode 'none' when the field is absent.
  const [form, setForm] = useState({
    to: '',
    cc: '',
    subject: renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, requestNumber),
    bodyText: DELIBERATION_SHARE_SEED_BODY,
    // Calendar attachments have no UI since S466 (owner: unused); the form
    // pins the calendar off while the server contract stays intact.
    includeCalendar: false,
  });
  // Suggested recipients fill a blank To/Cc whenever the suggestions change
  // (attendees load after mount on the same request). Seeded during render
  // against the last seed seen, compared by value: the parent rebuilds the
  // suggestion arrays every render, so identity would re-seed endlessly.
  const seedTo = suggestedTo.join(', ');
  const seedCc = suggestedCc.join(', ');
  const seed = `${seedTo}|${seedCc}`;
  const [seenSeed, setSeenSeed] = useState(null);
  // Explicit per-field ownership: true only after this component wrote its
  // own seed into the field; cleared by every staff edit of that field.
  const autoOwnedRef = useRef({ to: false, cc: false });
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  // Plan §3.4b step 3: a dedicated confirmation state for the prepare-time
  // 409 `brief_inputs_stale` response — the bounded delta staff must review
  // before retrying with `acknowledgeStaleInputs` bound to the exact live
  // fingerprint just returned.
  const [staleInputs, setStaleInputs] = useState(null);
  // Every form change — a staff edit and the one-time admin-defaults seed
  // alike — goes through here, so a prepared preview, its confirmation, and
  // any stale-inputs acknowledgement bound to the old form never outlive it.
  const applyFormPatch = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setConfirmed(false);
    setStaleInputs(null);
  };
  if (seenSeed !== seed) {
    setSeenSeed(seed);
    // A field is replaceable when it is blank or auto-owned (the component
    // wrote its own seed there and staff have not edited it since). When the
    // seed changes the form, the prepared preview and its confirmation are
    // invalidated so a confirmed preview can never go to an obsolete set.
    const owned = autoOwnedRef.current;
    const replaceTo = !form.to.trim() || owned.to;
    const replaceCc = !form.cc.trim() || owned.cc;
    const nextTo = replaceTo ? seedTo : form.to;
    const nextCc = replaceCc ? seedCc : form.cc;
    if (replaceTo && seedTo) owned.to = true;
    if (replaceCc && seedCc) owned.cc = true;
    if (nextTo !== form.to || nextCc !== form.cc) applyFormPatch({ to: nextTo, cc: nextCc });
  }
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [error, setError] = useState(null);
  const [sendFeedback, setSendFeedback] = useState(null);
  const [notice, setNotice] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [briefingLink, setBriefingLink] = useState(null);
  const [reissuing, setReissuing] = useState(false);
  const [briefingError, setBriefingError] = useState(null);
  const [recipientPickerTarget, setRecipientPickerTarget] = useState(null);
  const [emailDefaultsStatus, setEmailDefaultsStatus] = useState(null);
  const sequence = useRef(0);
  const controllerRef = useRef(null);
  const composerTouchedRef = useRef(false);
  const defaultsSeededRequestRef = useRef(null);

  const loadHistory = useCallback(async (id, signal, expectedSequence) => {
    const body = await requestJson(
      `/api/workbench/pre-site-visit/distribution/history?requestId=${encodeURIComponent(id)}`,
      { signal, fallbackMessage: 'Email history could not be loaded.', tolerantBody: true },
    );
    if (sequence.current !== expectedSequence || id !== requestId) return;
    setHistory(body.attempts || []);
    setBriefingLink(body.briefingLink || null);
    setHistoryError(null);
    if (body.emailDefaults && defaultsSeededRequestRef.current !== id) {
      defaultsSeededRequestRef.current = id;
      setEmailDefaultsStatus({
        configured: body.emailDefaults.configured === true,
        unavailable: body.emailDefaults.unavailable === true,
      });
      if (!composerTouchedRef.current) {
        applyFormPatch({
          subject: renderDeliberationShareSubject(body.emailDefaults.subjectTemplate, requestNumber),
          bodyText: String(body.emailDefaults.bodyTemplate || ''),
        });
      }
    }
    const attempts = body.attempts || [];
    const latest = attempts[0] || null;
    const latestPresentation = latest ? attemptPresentation(latest) : null;
    onHistory?.({
      attempts,
      currentSourceEverSent: body.currentSourceEverSent === true,
      // A real (non-stale) failure on the newest attempt: the tab shows it in
      // red with a Resend action.
      latestSendFailure: latestPresentation?.label === 'Failed'
        ? { operationId: latest.operationId, message: latest.lastError }
        : null,
    });
  }, [requestId, requestNumber, onHistory]);

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

  // Clear a pending stale-inputs confirmation whenever the request, the
  // source document, or the form changes underneath it — an acknowledgement
  // is bound to one exact delta and must never survive a context switch.
  // Derived during render (not an effect) so the clear lands in the same
  // commit as the key change, matching the `seenSeed` pattern above.
  const staleInputsKey = `${requestId || ''}|${sourceArtifact?.artifactId || ''}`;
  const [seenStaleInputsKey, setSeenStaleInputsKey] = useState(staleInputsKey);
  if (seenStaleInputsKey !== staleInputsKey) {
    setSeenStaleInputsKey(staleInputsKey);
    setStaleInputs(null);
  }

  const edit = (patch) => {
    composerTouchedRef.current = true;
    if ('to' in patch) autoOwnedRef.current.to = false;
    if ('cc' in patch) autoOwnedRef.current.cc = false;
    applyFormPatch(patch);
    setError(null);
    setSendFeedback(null);
    setNotice(null);
  };

  const addDirectoryRecipients = (target, emails) => {
    const existing = new Set(String(form[target] || '').split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean));
    const otherTarget = target === 'to' ? 'cc' : 'to';
    const other = new Set(String(form[otherTarget] || '').split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean));
    const additions = emails.filter((email) => !existing.has(email) && !other.has(email));
    if (additions.length === 0) return;
    const current = form[target].trim();
    edit({ [target]: current ? current + ', ' + additions.join(', ') : additions.join(', ') });
  };

  const closeRecipientPicker = useCallback(() => {
    setRecipientPickerTarget(null);
  }, []);

  // `acknowledge`: retry a prepare that returned 409 `brief_inputs_stale`,
  // binding the retry to the exact live fingerprint staff just reviewed
  // (plan §3.4b step 3) — never a bare `true`. Only the dedicated
  // confirmation UI below passes this; the plain Create-preview button never
  // does, so an unacknowledged drift always surfaces the confirmation first.
  const prepare = async ({ acknowledge = false } = {}) => {
    if (!requestId || !sourceArtifact?.artifactId || preparing || sending) return;
    const id = requestId;
    const acknowledgeStaleInputs = acknowledge ? staleInputs?.liveFingerprint : null;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPreparing(true);
    setError(null);
    setSendFeedback(null);
    setNotice(null);
    setConfirmed(false);
    if (!acknowledge) setStaleInputs(null);
    try {
      // Lock first (owner 2026-09-10): the preview is built from the locked
      // version, so the lock happens here, before prepare, never after.
      if (beforePrepare) await beforePrepare();
      if (sequence.current !== currentSequence || id !== requestId) return;
      const { ok: resOk, status: resStatus, data: body } = await requestEnvelope('/api/workbench/pre-site-visit/distribution/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          requestId: id,
          expectedArtifactId: sourceArtifact.artifactId,
          operationId: newOperationId(),
          ...form,
          siteVisitId: siteVisit?.activityId || null,
          ...(acknowledgeStaleInputs ? { acknowledgeStaleInputs } : {}),
        },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (body.inProgress) throw new Error(body.error || 'Preview preparation is already in progress.');
      if (!resOk && body.code === 'brief_inputs_stale') {
        if (sequence.current === currentSequence && id === requestId) {
          setStaleInputs({
            generatedFingerprint: body.generatedFingerprint,
            liveFingerprint: body.liveFingerprint,
            delta: body.delta || null,
          });
        }
        return;
      }
      // H3c/B10: the server's zero-review gate (`assertBriefInputsReady`,
      // `lib/services/pre-site-visit/distribution-service.js`) fires here
      // when the client-side mirror in the tab was stale or bypassed. Named
      // separately from the generic failure below so staff see why, not a
      // bare "Preview preparation failed" — and Regenerate Brief (allowed
      // while Review, B12) is the recovery path, not a stuck brief.
      if (!resOk && body.code === 'brief_snapshot_invalid') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('The brief\'s stored input record could not be read, so it cannot be shared. Regenerate the brief and try again.');
        }
        return;
      }
      if (!resOk && body.code === 'brief_reviews_required') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('This brief has no received reviews yet, so it cannot be shared. Wait for at least one review to come in, or regenerate the brief once one has.');
        }
        return;
      }
      // Review bundle assembly (plan §11, Step C1): prepare fails closed
      // rather than silently omitting a review from the bundle or serving
      // an unbounded one. Named so staff see the actionable reason, not a
      // bare "Preview preparation failed".
      if (!resOk && body.code === 'review_bundle_incomplete') {
        if (sequence.current === currentSequence && id === requestId) {
          setError(body.error || 'A received review has no retained file yet, so the review bundle could not be assembled.');
        }
        return;
      }
      if (!resOk && body.code === 'review_bundle_part_invalid') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('One of the retained reviews is not a valid PDF, so the review bundle could not be assembled. Check the review file and try again.');
        }
        return;
      }
      if (!resOk && body.code === 'review_bundle_unavailable') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('The review bundle could not be assembled from SharePoint right now. Try again shortly.');
        }
        return;
      }
      if (!resOk && body.code === 'review_bundle_too_large') {
        if (sequence.current === currentSequence && id === requestId) {
          setError(body.error || 'The review bundle is too large to assemble. Reduce the review set or re-upload smaller review files.');
        }
        return;
      }
      // Codex adversarial review (2026-09-17, round 5 finding 1): a guarded
      // regeneration is live for this request's brief (`resolveCurrentPreRpBriefForDistribution`,
      // lib/services/pre-rp-brief/artifact-service.js). Named, not the
      // generic failure below, so staff know to wait rather than retry.
      if (!resOk && body.code === 'brief_regeneration_in_progress') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('A replacement brief is being generated; sharing is paused until it is ready.');
        }
        return;
      }
      if (!resOk) throw new Error(body.error || `Preview preparation failed (${resStatus})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setPreview(body.attempt || null);
      setStaleInputs(null);
      if (body.briefingLink) setBriefingLink(body.briefingLink);
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

  const reissueBriefingLink = async () => {
    if (reissuing) return;
    const id = requestId;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReissuing(true);
    setBriefingError(null);
    try {
      const { ok: resOk, status: resStatus, data: body, error: envelopeError } = await requestEnvelope('/api/workbench/pre-site-visit/briefing-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { requestId: id, action: 'reissue', expectedLinkId: briefingLink?.id || undefined },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (!resOk && (body.code === 'briefing_link_superseded' || body.code === 'briefing_send_in_progress')) {
        // The link changed under us or a send still carries it: refresh the
        // header from history instead of retrying blindly.
        await loadHistory(id, controller.signal, currentSequence);
        throw new Error(body.error || envelopeError.message);
      }
      if (!resOk) throw new Error(body.error || `The new link could not be issued (${resStatus})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setBriefingLink(body.link || null);
      // Any prepared preview carried the old link; it can no longer be sent.
      setPreview(null);
      setConfirmed(false);
    } catch (reissueError) {
      if (reissueError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) setBriefingError(reissueError.message);
    } finally {
      if (sequence.current === currentSequence && id === requestId) {
        setReissuing(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const send = async () => {
    if (!preview?.operationId || !preview.previewHash || !preview.briefingLinkId || !confirmed || notice || preparing || sending) return;
    const id = requestId;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    setError(null);
    setSendFeedback(null);
    try {
      const { ok: resOk, status: resStatus, data: body } = await requestEnvelope('/api/workbench/pre-site-visit/distribution/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          requestId: id,
          operationId: preview.operationId,
          previewHash: preview.previewHash,
        },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (body.code === 'distribution_send_unconfirmed' && body.pendingSend) {
        if (sequence.current === currentSequence && id === requestId) {
          setPreview(body.pendingSend);
          setConfirmed(false);
          setSendFeedback({ status: 'uncertain', message: body.error });
        }
        return;
      }
      if (body.inProgress) throw new Error(body.error || 'This exact send is already in progress.');
      if (!resOk && STALE_PREVIEW_CODES.has(body.code)) {
        if (sequence.current === currentSequence && id === requestId) {
          setPreview(null);
          setConfirmed(false);
          setNotice(body.code === 'distribution_briefing_stale'
            ? 'The briefing page link for this preview is out of date. Create a new preview, review it, and then send.'
            : body.code === 'distribution_session_stale'
              ? 'The deliberation session changed after this preview. Create a new preview, review it, and then send.'
              : 'This preview is out of date because the visit details or materials changed. Create a new preview, review it, and then send.');
        }
        return;
      }
      // Codex adversarial review (2026-09-17, round 5 finding 1): the same
      // freshness recheck prepare uses also runs at send time, so a guarded
      // regeneration that started after this preview was prepared blocks
      // completion here too. Named, and the existing (still valid) preview
      // is kept rather than discarded, since nothing about it is stale.
      if (!resOk && body.code === 'brief_regeneration_in_progress') {
        if (sequence.current === currentSequence && id === requestId) {
          setError('A replacement brief is being generated; sharing is paused until it is ready.');
        }
        return;
      }
      if (!resOk) {
        const sendFailure = new Error(body.error || `Send failed (${resStatus})`);
        sendFailure.outcome = body.outcome || 'failed';
        throw sendFailure;
      }
      if (sequence.current !== currentSequence || id !== requestId) return;
      setPreview(body.attempt || preview);
      setConfirmed(false);
      setNotice(null);
      try {
        await loadHistory(id, controller.signal, currentSequence);
      } catch (historyRefreshError) {
        if (historyRefreshError?.name !== 'AbortError'
          && sequence.current === currentSequence
          && id === requestId) setHistoryError(historyRefreshError.message);
      }
    } catch (sendError) {
      if (sendError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) {
        setSendFeedback({
          status: sendError.outcome || 'uncertain',
          message: sendError.message,
        });
      }
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
        {sendFeedback && (
          <EmailSendFeedback
            className="mt-4"
            status={sendFeedback.status}
            message={sendFeedback.message}
            data-testid="distribution-send-feedback"
          />
        )}

        {emailDefaultsStatus?.unavailable && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            The Admin email defaults could not be loaded. Built-in wording is shown and can be edited before previewing.
          </div>
        )}
        {emailDefaultsStatus && !emailDefaultsStatus.unavailable && !emailDefaultsStatus.configured && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700" role="status">
            Share for deliberation defaults are not fully configured in Admin. Built-in wording is shown and can be edited before previewing.
          </div>
        )}

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800" data-testid="composer-session-slot">
          <span className="font-medium">{deliberationSessionLine(session)}</span>
          {session?.meetingLink && <span className="text-gray-600"> Join link included.</span>}
          {!session?.scheduledStartIso && <span className="text-gray-600"> The email will say so; the PC schedules sessions in Meeting Tracker.</span>}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="distribution-to" className="block text-sm font-medium text-gray-800">To</label>
              <button
                type="button"
                onClick={() => setRecipientPickerTarget('to')}
                disabled={preparing || sending}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
              >
                Add from directory
              </button>
            </div>
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
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="distribution-cc" className="block text-sm font-medium text-gray-800">Cc</label>
              <button
                type="button"
                onClick={() => setRecipientPickerTarget('cc')}
                disabled={preparing || sending}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
              >
                Add from directory
              </button>
            </div>
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
        {needsLock && (
          <p className="mt-4 text-sm text-gray-600" data-testid="composer-lock-note">
            Creating the preview locks this exact Word version as the working document and turns off regeneration.
          </p>
        )}
        <button
          type="button"
          onClick={() => prepare()}
          disabled={preparing || sending || !form.to.trim() || !form.subject.trim() || !form.bodyText.trim()}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {preparing
            ? (needsLock ? 'Locking and creating preview…' : 'Creating preview…')
            : needsLock ? 'Lock and preview' : preview ? 'Create new preview' : 'Create preview'}
        </button>
        {notice && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" aria-live="polite">
            {notice}
          </div>
        )}
        {staleInputs && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert" data-testid="stale-inputs-notice">
            <h4 className="font-semibold">The request&apos;s inputs changed since the brief was generated</h4>
            <p className="mt-1">Review the changes below before sharing.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {staleInputs.delta?.changedRequestFields?.length > 0 && (
                <li>Changed fields: {staleInputs.delta.changedRequestFields.join(', ')}</li>
              )}
              {staleInputs.delta?.abstractChanged && <li>The abstract changed.</li>}
              {staleInputs.delta?.addedReviewerSuggestionIds?.length > 0 && (
                <li>{staleInputs.delta.addedReviewerSuggestionIds.length} reviewer(s) added</li>
              )}
              {staleInputs.delta?.removedReviewerSuggestionIds?.length > 0 && (
                <li>{staleInputs.delta.removedReviewerSuggestionIds.length} reviewer(s) removed</li>
              )}
              {staleInputs.delta?.changedReviewerSuggestionIds?.length > 0 && (
                <li>{staleInputs.delta.changedReviewerSuggestionIds.length} reviewer(s) changed</li>
              )}
              <li>
                Reviews: {staleInputs.delta?.generatedReviewCount ?? 0} at generation → {staleInputs.delta?.liveReviewCount ?? 0} now
              </li>
            </ul>
            <button
              type="button"
              onClick={() => prepare({ acknowledge: true })}
              disabled={preparing || sending}
              className="mt-3 rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              I reviewed the changes above — share anyway
            </button>
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
              <div><dt className="inline font-medium">Pre-discussion:</dt> <dd className="inline">{deliberationSessionLine(preview.session).replace('Deliberation session: ', '')}{preview.session?.meetingLink ? ' · Join link included' : ''}</dd></div>
              <div>
                <dt className="inline font-medium">Briefing page:</dt>{' '}
                <dd className="inline">
                  {preview.briefingLinkId
                    ? `Link included${briefingExpiryLabel(briefingLink?.expiresAt) ? ` — live until ${briefingExpiryLabel(briefingLink?.expiresAt)}` : ''}`
                    : 'No link — this preview cannot be sent'}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Message:</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded border border-blue-100 bg-white p-3">{preview.bodyText}</dd>
              </div>
              {preview.attachments.length > 0 && (
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
              )}
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
              <EmailSendFeedback
                className="mt-4"
                status="sent"
              />
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
                  I reviewed the recipients, message, and briefing page link shown above.
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
      <CuratedRecipientPicker
        open={recipientPickerTarget !== null}
        target={recipientPickerTarget || 'to'}
        toValue={form.to}
        ccValue={form.cc}
        onAdd={addDirectoryRecipients}
        onClose={closeRecipientPicker}
      />
      {record && (
        <BriefingLinkCard
          link={briefingLink}
          onReissue={reissueBriefingLink}
          busy={reissuing || preparing || sending}
          error={briefingError}
        />
      )}
      {composer === 'dialog' && (
        <ComposerDialog onClose={onCloseComposer} busy={preparing || sending} escapeDisabled={recipientPickerTarget !== null}>
          {composerBody}
        </ComposerDialog>
      )}
      {composer === 'inline' && (
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
            <h3 className="text-base font-semibold text-gray-900">Send deliberation materials</h3>
            <p className="mt-1 text-sm text-gray-600">
              Create a fixed preview, review the recipients and the briefing page link, then send through Dynamics.
            </p>
            {composerBody}
          </>
        )}
      </Card>
      )}

      {record && (
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
          <div className="mt-3 space-y-4">
            {groupHistoryByDay(history).map((group) => (
              <section key={group.dayOrdinal}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {historyDayLabel(group.date)}
                </h4>
                <ul className="mt-2 space-y-3">
                  {group.attempts.map((attempt) => {
                    const presentation = attemptPresentation(attempt);
                    return (
                      <li key={attempt.operationId} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-gray-900">{attempt.subject}</p>
                            <p className="mt-1">To: {attempt.to.join(', ')}</p>
                            {attempt.cc.length > 0 && <p>Cc: {attempt.cc.join(', ')}</p>}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${presentation.pillClass}`}>
                              {presentation.label}
                            </span>
                            {isTestSend(attempt) && (
                              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                Test send
                              </span>
                            )}
                          </div>
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
                        {attempt.staleInputsAcknowledged && (
                          <div className="mt-1 text-xs text-amber-800" data-testid="stale-inputs-acknowledged">
                            <p className="font-medium">
                              Staff acknowledged newer inputs at {new Date(attempt.staleInputsAcknowledged.acknowledgedAt).toLocaleString()}
                              {attempt.staleInputsAcknowledged.acknowledgedByName ? ` by ${attempt.staleInputsAcknowledged.acknowledgedByName}` : ''}.
                            </p>
                            {attempt.staleInputsAcknowledged.delta?.changedRequestFields?.length > 0 && (
                              <p>Changed fields: {attempt.staleInputsAcknowledged.delta.changedRequestFields.join(', ')}</p>
                            )}
                            {attempt.staleInputsAcknowledged.delta?.abstractChanged && <p>The abstract changed.</p>}
                            <p>
                              Reviews: {attempt.staleInputsAcknowledged.delta?.generatedReviewCount ?? 0} at generation → {attempt.staleInputsAcknowledged.delta?.liveReviewCount ?? 0} at share
                            </p>
                          </div>
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
              </section>
            ))}
          </div>
        )}
        </details>
      </Card>
      )}
    </>
  );
}

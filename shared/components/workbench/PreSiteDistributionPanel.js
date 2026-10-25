import DistributionWordingDefault from './DistributionWordingDefault';
import useDistributionUnsavedChanges from './useDistributionUnsavedChanges';
import { Button } from '../Layout';
import EmailAddressSummary from '../EmailAddressSummary';
import EmailDialog from '../EmailDialog';
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
  validateDeliberationShareTemplate,
} from '../../config/deliberationShareEmail';

const EMPTY_LIST = Object.freeze([]);
const STALE_PREVIEW_CODES = new Set(['distribution_stale_source', 'distribution_material_stale', 'distribution_site_visit_stale', 'distribution_preview_changed', 'distribution_briefing_stale', 'distribution_session_stale']);
const sameDistributionId = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
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
            <Button variant="outline" size="sm"
              type="button"
              onClick={copy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800"
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          )}
          {!confirming && (
            <Button variant="outline" size="sm"
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 disabled:opacity-50"
            >
              Issue new link
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Issuing a new link stops the current one immediately. Anyone holding an earlier email will need the new link, so send the materials again afterward.</p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm"
              type="button"
              onClick={async () => { await onReissue(); setConfirming(false); }}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Issuing…' : 'Issue new link'}
            </Button>
            <Button variant="outline" size="sm"
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900"
            >
              Keep current link
            </Button>
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
  return (
    <EmailDialog label="Share for the deliberation session" busy={busy || escapeDisabled} onClose={onClose}>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="presentation">
      <div
        className="my-6 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="share-composer-title" className="text-lg font-semibold text-gray-900">Share for the deliberation session</h3>
            <p className="mt-1 text-sm text-gray-600">
              The email carries the briefing page link; the brief, every completed review, the proposal, and the site visit materials open there without a login.
            </p>
          </div>
          <Button variant="outline" size="sm"
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 disabled:opacity-50"
          >
            Close
          </Button>
        </div>
        {children}
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <Button variant="outline" size="sm"
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
    </EmailDialog>
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
  composeOpenVersion = 0,
  onRetentionChange = null,
  sourceUnavailable = false,
  authPaused = false,
  actorScope = '',
  // Runs before the prepare request; the tab locks the draft here (lock, then
  // preview, then send), so a lock failure surfaces in the composer.
  beforePrepare = null,
  needsLock = false,
  // Briefing-link card and email history; the tab hides them until the draft is shared.
  record = true,
  // Rendered between the briefing-link card and Email history when `record`
  // is on (owner 2026-09-25: the tab's Research Presentation Materials card).
  beforeHistory = null,
}) {
  const actionsPaused = sourceUnavailable || authPaused;
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
  const baseline = useRef({ ...form });
  const recoveryRef = useRef(null);
  const [recovery, setRecovery] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsData, setDefaultsData] = useState(null);
  const [composeSource, setComposeSource] = useState('built_in');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState({ subject: DELIBERATION_SHARE_SEED_SUBJECT, body: DELIBERATION_SHARE_SEED_BODY });
  const editorBaseline = useRef(editor);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceUncertain, setPreferenceUncertain] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState(null);
  const defaultsGeneration = useRef(0);
  const preferenceGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; defaultsGeneration.current++; preferenceGeneration.current++; }; }, []);
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
  if (seenSeed !== seed && !recoveryRef.current) {
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
    if (replaceTo) { owned.to = true; baseline.current.to = seedTo; }
    if (replaceCc) { owned.cc = true; baseline.current.cc = seedCc; }
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

  const historySequence = useRef(0);
  const sequence = useRef(0); // prepare lane
  const controllerRef = useRef(null);
  const reissueSequence = useRef(0);
  const sendSequence = useRef(0);
  const sendInFlight = useRef(false);
  const sourceKey = `${requestId}:${sourceArtifact?.artifactId || ''}:${sourceUnavailable}`;
  const sourceRef = useRef(sourceKey);
  sourceRef.current = sourceKey;
  const composerTouchedRef = useRef(false);


  const loadHistory = useCallback(async (id, signal, expectedSequence) => {
    const body = await requestJson(
      `/api/workbench/pre-site-visit/distribution/history?requestId=${encodeURIComponent(id)}`,
      { signal, fallbackMessage: 'Email history could not be loaded.', tolerantBody: true },
    );
    if (historySequence.current !== expectedSequence || id !== requestId) return;
    setHistory(body.attempts || []);
    setBriefingLink(body.briefingLink || null);
    setHistoryError(null);
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
  }, [requestId, onHistory]);

  useEffect(() => {
    const currentSequence = ++historySequence.current;
    const controller = new AbortController();
    if (requestId) {
      loadHistory(requestId, controller.signal, currentSequence).catch((loadError) => {
        if (loadError?.name !== 'AbortError'
          && historySequence.current === currentSequence
          && requestId) setHistoryError(loadError.message);
      });
    }
    return () => {
      historySequence.current += 1;
      controller.abort();

    };
  }, [requestId, loadHistory, sourceKey]);

  // Clear a pending stale-inputs confirmation whenever the request, the
  // source document, or the form changes underneath it — an acknowledgement
  // is bound to one exact delta and must never survive a context switch.
  // Derived during render (not an effect) so the clear lands in the same
  // commit as the key change, matching the `seenSeed` pattern above.
  const staleInputsKey = sourceKey;
  const [seenStaleInputsKey, setSeenStaleInputsKey] = useState(staleInputsKey);
  if (seenStaleInputsKey !== staleInputsKey) {
    setSeenStaleInputsKey(staleInputsKey);
    setStaleInputs(null);
    sequence.current++;
    reissueSequence.current++;
    controllerRef.current?.abort();
    setPreparing(false);
    setReissuing(false);
    if (!recoveryRef.current) { setPreview(null); setConfirmed(false); }
  }

  const draftDirty = !recovery && Object.keys(baseline.current).some(key => form[key] !== baseline.current[key]);
  const editorDirty = editor.subject !== editorBaseline.current.subject || editor.body !== editorBaseline.current.body;
  useDistributionUnsavedChanges(draftDirty || editorDirty || preferenceBusy || preferenceUncertain || Boolean(recovery), Boolean(recovery), preferenceBusy || preferenceUncertain);
  useEffect(() => {
    onRetentionChange?.({ draftDirty, editorDirty, mutationPending: preferenceBusy || preferenceUncertain, recoveryPending: Boolean(recovery) });
  }, [draftDirty, editorDirty, preferenceBusy, preferenceUncertain, recovery, onRetentionChange]);
  useEffect(() => () => onRetentionChange?.({ draftDirty: false, editorDirty: false, mutationPending: false, recoveryPending: false }), [onRetentionChange]);

  const readDefaults = async ({ initialize = false } = {}) => {
    const generation = ++defaultsGeneration.current;
    const mutationVersion = preferenceGeneration.current;
    setDefaultsLoading(true);
    try {
      const data = await requestJson('/api/workbench/pre-site-visit/distribution/email-preferences', { headers: { 'Cache-Control': 'no-cache' } });
      if (!data?.effective || typeof data.effective.subject !== 'string' || typeof data.effective.body !== 'string') throw new Error('Defaults could not be read.');
      if (!mounted.current || generation !== defaultsGeneration.current || mutationVersion !== preferenceGeneration.current) return;
      setDefaultsData(data);
      setPreferenceUncertain(false);
      const template = data.own || data.shared || data.effective;
      setEditor(template);
      editorBaseline.current = template;
      setPreferenceMessage([
        data.ownStatus === 'duplicates' ? 'Multiple saved defaults were found. Clear them before saving.' : null,
        ['invalid', 'encrypted', 'unavailable'].includes(data.ownStatus) ? 'Your saved default could not be used. Review the fallback or reload to confirm.' : null,
        data.source !== 'personal' && Object.values(data.sharedStatus || {}).some(status => ['invalid', 'unavailable'].includes(status)) ? 'Some shared wording could not be used. Built-in fallback is shown for those fields.' : null,
      ].filter(Boolean).join(' ') || null);
      if (initialize && !composerTouchedRef.current && !recoveryRef.current) {
        const patch = { subject: renderDeliberationShareSubject(data.effective.subject, requestNumber), bodyText: data.effective.body };
        if (patch.subject.length > 500 || /[\r\n]/.test(patch.subject)) {
          setPreferenceMessage('The resolved default subject is too long or invalid. Built-in wording is shown. Edit your default subject or the current email.');
          return;
        }
        setComposeSource(data.source);
        Object.assign(baseline.current, patch);
        applyFormPatch(patch);
      }
    } catch (readError) {
      if (mounted.current && generation === defaultsGeneration.current && mutationVersion === preferenceGeneration.current) {
        setPreferenceMessage(readError.message || 'Defaults unavailable. Built-in wording is shown; edit it before previewing.');
        setDefaultsData(null);
      }
    } finally {
      if (mounted.current && generation === defaultsGeneration.current) setDefaultsLoading(false);
    }
  };
  const seenOpen = useRef(null);
  useEffect(() => {
    if (composer === 'hidden' || seenOpen.current === composeOpenVersion) return;
    const alreadyOpened = seenOpen.current !== null;
    seenOpen.current = composeOpenVersion;
    if (recoveryRef.current || preferenceBusy) return;
    if (alreadyOpened && (draftDirty || editorDirty)) { setDiscarding('close'); return; }
    const fresh = { to: seedTo, cc: seedCc, subject: renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, requestNumber), bodyText: DELIBERATION_SHARE_SEED_BODY, includeCalendar: false };
    baseline.current = fresh; setComposeSource('built_in');
    autoOwnedRef.current = { to: true, cc: true };
    composerTouchedRef.current = false;
    setSeenSeed(seed);
    setForm(fresh);
    setPreview(null); setConfirmed(false); setStaleInputs(null); setError(null); setNotice(null); setSendFeedback(null);
    setRecipientPickerTarget(null); setDiscarding(false); setEditorOpen(false);
    readDefaults({ initialize: true });
    // Open versions, not recipient array identities, own initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeOpenVersion, composer]);

  const mutatePreference = async method => {
    if (preferenceBusy || preparing || sending || preferenceUncertain || actionsPaused) return;
    if (method === 'PUT') {
      const checked = validateDeliberationShareTemplate(editor);
      if (!checked.valid) { setPreferenceMessage(checked.errors.join(' ')); return; }
    }
    const generation = ++preferenceGeneration.current;
    defaultsGeneration.current++;
    setDefaultsLoading(false);
    setPreferenceBusy(true); setPreferenceMessage(null);
    try {
      const result = await requestJson('/api/workbench/pre-site-visit/distribution/email-preferences', { method, body: method === 'PUT' ? { template: editor } : {} });
      if (!mounted.current || generation !== preferenceGeneration.current) return;
      if (result?.ok !== true) throw new Error('The change could not be confirmed.');
      editorBaseline.current = editor;
      setPreferenceMessage((method === 'PUT' ? 'Default saved. The current email is unchanged.' : 'Default cleared. The current email is unchanged.')
        + (result.refreshUnavailable ? ' Reload defaults to refresh the editor before another change.' : ''));
      if (result.effective) {
        setDefaultsData(result);
        const next = result.own || result.shared || result.effective;
        editorBaseline.current = next; setEditor(next);
      } else setDefaultsData(null);
    } catch (mutationError) {
      if (mounted.current && generation === preferenceGeneration.current) {
        const reason = mutationError?.payload?.reason;
        if (reason === 'validation' || reason === 'duplicates') {
          setPreferenceMessage(reason === 'duplicates' ? 'Multiple saved defaults were found. Clear them before saving.' : mutationError.payload.errors?.join(' ') || 'Check the default subject and message.');
          if (reason === 'duplicates') setDefaultsData(current => ({ ...current, canSave: false, canClear: true }));
          return;
        }
        setPreferenceUncertain(true);
        setPreferenceMessage('The change could not be confirmed. Reload defaults before trying another change.');
      }
    } finally { if (mounted.current && generation === preferenceGeneration.current) setPreferenceBusy(false); }
  };
  const closeComposer = () => {
    if (preparing || sending || preferenceBusy) return;
    if (discarding) { setDiscarding(false); return; }
    if (draftDirty || editorDirty) { setDiscarding('close'); return; }
    onCloseComposer?.();
  };
  const discardAndClose = () => {
    setEditor(editorBaseline.current);
    if (discarding === 'reload') { setDiscarding(false); readDefaults(); return; }
    if (!recoveryRef.current) { setForm({ ...baseline.current }); setPreview(null); setConfirmed(false); setStaleInputs(null); }
    setDiscarding(false); onCloseComposer?.();
  };

  const edit = (patch) => {
    if (recoveryRef.current || actionsPaused || preferenceBusy) return;
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
    if (!requestId || !sourceArtifact?.artifactId || preparing || sending || preferenceBusy || defaultsLoading || recoveryRef.current || actionsPaused) return;
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
    if (reissuing || recoveryRef.current || actionsPaused || preferenceBusy || preparing || sending) return;
    const id = requestId;
    const currentSequence = ++reissueSequence.current;
    const controller = new AbortController();
    setReissuing(true);
    setBriefingError(null);
    try {
      const { ok: resOk, status: resStatus, data: body } = await requestEnvelope('/api/workbench/pre-site-visit/briefing-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { requestId: id, action: 'reissue', expectedLinkId: briefingLink?.id || undefined },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (!resOk && (body.code === 'briefing_link_superseded' || body.code === 'briefing_send_in_progress')) {
        // The link changed under us or a send still carries it: refresh the
        // header from history instead of retrying blindly.
        await loadHistory(id, controller.signal, historySequence.current);
        const REISSUE_REFUSAL_FALLBACKS = {
          briefing_link_superseded: 'The briefing link was replaced by another action. Refresh to see the current link.',
          briefing_send_in_progress: 'A send that carries the current briefing link has not finished. Retry it (or wait for it to reconcile) before issuing a new link.',
        };
        throw new Error(body.error || REISSUE_REFUSAL_FALLBACKS[body.code]);
      }
      if (!resOk) throw new Error(body.error || `The new link could not be issued (${resStatus})`);
      if (reissueSequence.current !== currentSequence || id !== requestId) return;
      setBriefingLink(body.link || null);
      // Any prepared preview carried the old link; it can no longer be sent.
      setPreview(null);
      setConfirmed(false);
    } catch (reissueError) {
      if (reissueError?.name !== 'AbortError'
        && reissueSequence.current === currentSequence
        && id === requestId) setBriefingError(reissueError.message);
    } finally {
      if (reissueSequence.current === currentSequence && id === requestId) {
        setReissuing(false);

      }
    }
  };

  const send = async () => {
    if (authPaused || sendInFlight.current || !preview?.operationId || !preview.previewHash || !preview.briefingLinkId || !confirmed || preparing || sending || preferenceBusy || (!recoveryRef.current && actionsPaused)) return;
    const id = requestId;
    const envelope = recoveryRef.current || { preview, form: { ...form }, actorScope, sourceKey, calls: 0, uncertain: false };
    recoveryRef.current = envelope; setRecovery(envelope);
    const frozen = envelope.preview;
    sendInFlight.current = true;
    const call = ++sendSequence.current;
    envelope.calls++;
    setSending(true); setError(null); setSendFeedback(null);
    const active = () => mounted.current && sendSequence.current === call && recoveryRef.current === envelope;
    try {
      const result = await requestEnvelope('/api/workbench/pre-site-visit/distribution/send', {
        method: 'POST', body: { requestId: id, operationId: frozen.operationId, previewHash: frozen.previewHash },
      });
      if (!active()) return;
      const body = result.data;
      const attempt = body?.attempt;
      const complete = result.ok ? sameDistributionId(attempt?.operationId, frozen.operationId) && sameDistributionId(attempt?.requestId, id)
        && typeof attempt.transportAccepted === 'boolean' && attempt.previewHash === frozen.previewHash
        && typeof attempt.from === 'string' && attempt.from === frozen.from
        && Array.isArray(attempt.to) && Array.isArray(attempt.cc) && Array.isArray(attempt.attachments)
        && attempt.to.every(value => typeof value === 'string') && attempt.cc.every(value => typeof value === 'string')
        && typeof attempt.subject === 'string' && typeof attempt.bodyText === 'string'
        : typeof body?.code === 'string' && !result.error?.parseError;
      if (!complete || body?.inProgress || body?.code === 'distribution_send_unconfirmed' || body?.outcome === 'uncertain') envelope.uncertain = true;
      envelope.calls--;
      if (complete && result.ok && attempt.transportAccepted === true) {
        recoveryRef.current = null; setRecovery(null); setConfirmed(false);
        if (sourceRef.current === envelope.sourceKey) setPreview(attempt);
        else {
          setPreview(null);
          setSendFeedback({ status: 'sent' });
          setNotice('The original email was sent. The brief changed; create a new preview to share the current brief.');
        }
        baseline.current = { ...form };
        if (sourceRef.current === envelope.sourceKey) {
          try { await loadHistory(id, undefined, historySequence.current); } catch (refreshError) { if (mounted.current) setHistoryError(refreshError.message); }
        }
        return;
      }
      const message = body?.error || (body?.code === 'brief_regeneration_in_progress' ? 'A replacement brief is being generated; sharing is paused until it is ready.' : body?.inProgress ? 'This exact send is already in progress.' : 'The email outcome is unconfirmed. Retry the original email before preparing another.');
      if (!envelope.uncertain && envelope.calls === 0) {
        try {
          const fresh = await requestJson(`/api/workbench/pre-site-visit/distribution/history?requestId=${encodeURIComponent(id)}`, { headers: { 'Cache-Control': 'no-cache' } });
          if (!active()) return;
          const row = fresh?.attempts?.find(item => sameDistributionId(item.requestId, id) && sameDistributionId(item.operationId, frozen.operationId));
          if (row?.transportAccepted === false && row.dynamicsEmailId === null && row.sendRequestedAt === null) {
            recoveryRef.current = null; setRecovery(null); setPreview(null); setConfirmed(false); setNotice(message);
            return;
          }
        } catch { /* No proof: retain the exact envelope. */ }
      }
      if (active()) { setSendFeedback({ status: 'uncertain', message }); setConfirmed(false); }
    } catch (sendError) {
      envelope.uncertain = true;
      envelope.calls = Math.max(0, envelope.calls - 1);
      if (active()) { setConfirmed(false); setSendFeedback({ status: 'uncertain', message: sendError.message }); }
    } finally { if (sendSequence.current === call) { sendInFlight.current = false; if (mounted.current) setSending(false); } }
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

        {sourceUnavailable && <p role="status" className="mt-4 text-sm text-amber-900">Sharing is paused while the brief or session is unavailable. Your edits are retained.</p>}
        {recovery && <p role="status" className="mt-4 text-sm text-amber-900">Reconcile the original email before creating another preview. Retry uses the original recipients and wording.</p>}
        {defaultsLoading && <p role="status" className="mt-3 text-sm text-gray-600">Loading current defaults…</p>}
        {<p className="mt-3 text-sm text-gray-600">Wording source: {composeSource === 'personal' ? 'your personal default' : composeSource === 'shared' ? 'shared defaults (built-in fallback where needed)' : 'built-in defaults'}.</p>}
        {!defaultsLoading && preferenceMessage && !editorOpen && <p role="status" className="mt-3 text-sm text-gray-800">{preferenceMessage}</p>}
        {discarding && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
          <p>{discarding === 'reload' ? 'Discard your unsaved default wording and reload?' : 'Discard your unsaved email edits?'}</p>
          <div className="mt-3 flex gap-3"><Button type="button" variant="secondary" onClick={() => setDiscarding(false)}>Keep editing</Button>
          <Button type="button" variant="secondary" onClick={discardAndClose}>{discarding === 'reload' ? 'Discard default edits and reload' : 'Discard edits and close'}</Button></div>
        </div>}

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800" data-testid="composer-session-slot">
          <span className="font-medium">{deliberationSessionLine(session)}</span>
          {session?.meetingLink && <span className="text-gray-600"> Join link included.</span>}
          {!session?.scheduledStartIso && <span className="text-gray-600"> The email will say so; the PC schedules sessions in Meeting Tracker.</span>}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="distribution-to" className="block text-sm font-medium text-gray-800">To</label>
              <Button variant="link" size="sm"
                type="button"
                onClick={() => setRecipientPickerTarget('to')}
                disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
              >
                Add from directory
              </Button>
            </div>
            <textarea
              id="distribution-to"
              rows={2}
              value={form.to}
              onChange={(event) => edit({ to: event.target.value })}
              placeholder="One or more known addresses, separated by commas or new lines"
              disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="distribution-cc" className="block text-sm font-medium text-gray-800">Cc</label>
              <Button variant="link" size="sm"
                type="button"
                onClick={() => setRecipientPickerTarget('cc')}
                disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
              >
                Add from directory
              </Button>
            </div>
            <textarea
              id="distribution-cc"
              rows={2}
              value={form.cc}
              onChange={(event) => edit({ cc: event.target.value })}
              placeholder="Optional"
              disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
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
            disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
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
            disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <DistributionWordingDefault open={editorOpen} onOpen={setEditorOpen} template={editor} onChange={setEditor}
          data={defaultsData} busy={preferenceBusy || defaultsLoading} blocked={preparing || sending || preferenceUncertain || actionsPaused}
          message={preferenceMessage} onSave={() => mutatePreference('PUT')} onClear={() => mutatePreference('DELETE')}
          onReload={() => { if (editorDirty) setDiscarding('reload'); else readDefaults(); }} />
        {needsLock && (
          <p className="mt-4 text-sm text-gray-600" data-testid="composer-lock-note">
            Creating the preview locks this exact Word version as the working document and turns off regeneration.
          </p>
        )}
        <Button variant="primary" size="sm"
          type="button"
          onClick={() => prepare()}
          disabled={preparing || sending || preferenceBusy || defaultsLoading || actionsPaused || Boolean(recovery) || !form.to.trim() || !form.subject.trim() || !form.bodyText.trim()}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {preparing
            ? (needsLock ? 'Locking and creating preview…' : 'Creating preview…')
            : needsLock ? 'Lock and preview' : preview ? 'Create new preview' : 'Create preview'}
        </Button>
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
            <Button variant="primary" size="sm"
              type="button"
              onClick={() => prepare({ acknowledge: true })}
              disabled={preparing || sending || preferenceBusy || actionsPaused || Boolean(recovery)}
              className="mt-3 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              I reviewed the changes above — share anyway
            </Button>
          </div>
        )}

        {preview && (
          <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="font-semibold text-gray-900">Email preview</h4>
            <EmailAddressSummary from={preview.from} to={preview.to} cc={preview.cc} />
            <dl className="mt-3 space-y-2 text-sm text-gray-700">
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
                    disabled={preparing || sending || preferenceBusy || authPaused || (actionsPaused && !recovery)}
                    className="mt-0.5"
                  />
                  I reviewed the recipients, message, and briefing page link shown above.
                </label>
                <Button variant="primary" size="sm"
                  type="button"
                  onClick={send}
                  disabled={!confirmed || preparing || sending || preferenceBusy || authPaused || (actionsPaused && !recovery)}
                  className="mt-3 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send email'}
                </Button>
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
        <ComposerDialog onClose={closeComposer} busy={preparing || sending || preferenceBusy} escapeDisabled={recipientPickerTarget !== null}>
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

      {record && beforeHistory}

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

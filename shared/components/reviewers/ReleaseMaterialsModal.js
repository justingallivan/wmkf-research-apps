import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Button } from '../Layout';
import { EMPTY_TEMPLATES, loadEmailTemplates, saveEmailTemplates } from './email-template-store';
import { renderPreviewFailureMessage, RENDER_PREVIEW_NETWORK_MESSAGE } from './render-preview-failure';
import { membershipKeyFor } from './reviewer-draft-keys';
import { SEND_SKIP_REASON_LABEL } from '../../utils/reviewer-send-skip-reasons';

// ─── Email Modal ────────────────────────────────────────────────────────────

const EMAIL_FIELDS_STORAGE_KEY = 'review_manager_email_fields';
const ATTACHMENTS_STORAGE_KEY = 'review_manager_attachments';

// Bounded per-render network timeout for /api/review-manager/render-emails.
// Since d040a7a3 preview renders are read-only server-side (no token
// minting), so aborting a stuck request client-side can no longer strand a
// durable write — this exists purely to recover the UI (release the
// single-flight lock + tail) from a request that never settles, not to
// coordinate with any server-side cancellation.
export const PREVIEW_RENDER_TIMEOUT_MS = 45000;

function fileKeyOf(file) {
  return `${file.library}::${file.folder}::${file.name}`;
}

const emptyProposalDoc = () => ({
  loading: false,
  error: null,
  blobUrl: null,
  filename: null,
  allFiles: [],
  pickedKey: null,
});

export default function ReleaseMaterialsModal({ isOpen, onClose, reviewers, proposalTitle, proposalKey, requestId, settings, onEmailsSent, membershipCause, degraded = false }) {
  // This request-scoped entry point is intentionally materials-only. Review-due
  // nudges use ReviewReminderAction's fresh eligibility + atomic-claim path, and
  // thank-yous are handled by the dedicated sweep. Keeping those choices out of
  // the release modal prevents one generic composer from competing with the
  // lifecycle-specific actions.
  const templateType = 'materials';
  const [templates, setTemplates] = useState(EMPTY_TEMPLATES);
  const [step, setStep] = useState('compose'); // compose | preview | sending | sent
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [drafts, setDrafts] = useState([]); // [{ suggestionId, candidateName, candidateEmail, requestNumber, subject, body, skipped? }]
  const [sentResults, setSentResults] = useState({ sent: [], failed: [], skipped: [] });
  const [error, setError] = useState(null);
  const [emailFields, setEmailFields] = useState({
    reviewDueDate: settings.reviewDueDate || '',
    proposalSendDate: '',
    // honorarium removed S199 — now a Dataverse ground-truth read server-side.
  });
  // Attachments are per-template-type so switching templates (e.g. Materials
  // → Thank-you) doesn't carry over the proposal PDF or other type-specific files.
  const [attachmentsByType, setAttachmentsByType] = useState({ materials: [], followup: [], thankyou: [] });
  const attachments = Array.isArray(attachmentsByType?.[templateType]) ? attachmentsByType[templateType] : [];
  const [proposalDoc, setProposalDoc] = useState(emptyProposalDoc);
  const proposalLoadSeq = useRef(0);
  // Admin-configurable, default OFF (docs/agent-wiki/topics/external-reviewer-portal.md):
  // when off, the release email is portal-link-only ({{externalLink}} in the
  // template) — no proposal auto-attach, no manual file picker, no Blob upload.
  // Read fresh every time the modal opens (see effect below); never a build-time
  // constant.
  const [attachProposalEmailEnabled, setAttachProposalEmailEnabled] = useState(false);
  // Reviewer-visible SharePoint materials preflight — warns the PD before a
  // "materials" release when the reviewer-portal download folder is empty.
  // status: 'idle' | 'checking' | 'ok' | 'unavailable'. 'unavailable' covers
  // both a non-ok response and a fetch failure — the client can't verify
  // either way, so it shows a neutral note and does NOT gate the send (an
  // unreachable check must never block a real release).
  const [materialsPreflight, setMaterialsPreflight] = useState({ status: 'idle', fileCount: null });
  const setAttachments = (updater) => {
    setAttachmentsByType((prev) => {
      const current = prev[templateType] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      const merged = { ...prev, [templateType]: next };
      try { localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(merged)); } catch (e) { /* ignore */ }
      return merged;
    });
  };
  const [isUploading, setIsUploading] = useState(false);
  // True only when the last preview render failed — gates the compose banner's
  // Retry button so it never offers to re-render on a send-path error.
  const [previewFailed, setPreviewFailed] = useState(false);
  // True whenever a preview render is queued or in flight — disables the
  // footer Preview button and the Retry button.
  const [rendering, setRendering] = useState(false);
  // Declared here (not beside saveTemplate below) so the session-identity
  // reconcile effect, which resets it on a new session, can reference the
  // setter without a textual before-declaration lint warning.
  const [templateSaved, setTemplateSaved] = useState(false);

  // Synchronous single-flight lock for handlePreview, keyed to the modal-session
  // epoch that was current when a render was started. A second call for the SAME
  // session returns immediately; a stale finally (from a session that has since
  // closed/reopened) must not clear a newer session's lock or `rendering` state.
  const renderingEpochRef = useRef(null);
  // Serializes preview-render execution across close/reopen sessions (not just
  // across same-session clicks): a render kicked off just before close and a
  // new render kicked off right after reopen must still apply in session order.
  // Chaining every render onto this tail guarantees at most one fetch in flight.
  const renderTailRef = useRef(Promise.resolve());
  // Monotonic modal-session id, bumped on every isOpen transition (open AND
  // close) and never reset. A response for an earlier open/close session can
  // never mutate a later session's state — see handlePreview/handleSend.
  const modalSessionRef = useRef(0);
  // The AbortController for whatever render-emails fetch is currently
  // outstanding (if any), so close/reopen can abort it immediately instead of
  // leaving it to the PREVIEW_RENDER_TIMEOUT_MS ceiling. Aborting settles that
  // fetch's promise, which is what actually releases renderTailRef for the
  // next session — without this, ReleaseMaterialsModal staying mounted across close
  // means a hung render's tail blocks every later session until it times out.
  const activeRenderAbortRef = useRef(null);

  // Stage 6B3: modal session identity = isOpen + requestId + a per-reviewer
  // membership+recipient key, plus the one-use completion-cause consumption
  // (see handleSend/onEmailsSent below). Compare stable membership BY VALUE
  // (see membershipKeyFor above), never array identity or reviewer
  // display-object identity — a same-membership, same-field-values rerender
  // with fresh row objects must not reset drafts/step. modalSessionRef
  // (declared above) IS the epoch: handlePreview/handleSend already capture
  // and compare against it.
  // Stage 6B3a: identity also folds in a settings-by-VALUE key (signature +
  // reviewDueDate — the only two `settings` fields consumed anywhere, see
  // snapshotSettings in handlePreview) — never the whole `settings` object,
  // which the panel call site rebuilds fresh every render ({...settings,
  // reviewDueDate}) and which can carry unrelated host keys.
  // Stage 6B3b: the membership key itself widened from suggestionId-only to
  // suggestionId+name+email+affiliation (membershipKeyFor) — the rendered
  // draft body is sent verbatim (the server only re-resolves the destination
  // address at send time), so a same-id change to a recipient's rendered
  // fields after preview must invalidate the session exactly like a
  // membership change, not just leave a stale greeting/affiliation in the
  // sent body.
  // Stage 6B3c: identity also folds in a proposal-by-VALUE key (proposalKey
  // prop, computed by the call site via proposalKeyFor over proposalTitle/
  // proposalAbstract/proposalAuthors/proposalInstitution — see
  // proposalKeyFor above) — the rendered draft body also embeds these
  // PROPOSAL fields (render-emails-service.js) and is sent verbatim, so a
  // same-requestId proposal edit after preview must invalidate the session
  // exactly like a membership or settings change.
  const mountedRef = useRef(true);
  const saveTimerRef = useRef(null);
  const uploadAttemptRef = useRef(null);
  // The most recently FINISHED send attempt (see handleSend), set only when
  // its `complete` event lands. `onEmailsSent` is called with this exact
  // object, so the panel hands the SAME object back as the `membershipCause`
  // prop after it clears selection — the effect below matches the incoming
  // prop's identity/fields against this ref to decide whether a prior→empty
  // membership transition is the one THIS attempt caused (and so must not
  // reset the just-completed summary), vs. any other membership change
  // (which discards this ref and invalidates normally).
  const lastSendAttemptRef = useRef(null);
  const sessionContextRef = useRef({
    isOpen: false,
    requestId: undefined,
    key: '',
    settingsKey: '',
    // Stage 6B3c: proposal-by-VALUE key (proposalKeyFor) — see the
    // committed-session effect below.
    proposalKey: '',
    // The committed settings.reviewDueDate default at last reconcile — the
    // "prior default" the emailFields follow-rule below compares against.
    reviewDueDateDefault: '',
    onEmailsSent,
  });

  // Mount/unmount lifetime: unmounting (the modal renders under `canManage &&`
  // at the panel call site, so permission loss is unmount here — see D2 in
  // the 6B3 trace) permanently invalidates every in-flight attempt. This is a
  // SEPARATE dimension from the committed-session reconcile effect below,
  // mirroring the ReviewReminderAction/6B1 mount-effect pair.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modalSessionRef.current += 1;
      lastSendAttemptRef.current = null;
      if (activeRenderAbortRef.current) {
        activeRenderAbortRef.current.abort();
        activeRenderAbortRef.current = null;
      }
      proposalLoadSeq.current += 1;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      uploadAttemptRef.current = null;
    };
  }, []);

  // Committed-session reconciliation: no dependency array, no cleanup, so it
  // runs on every commit (mirrors the Stage 6B1/6B2 committed-props effect
  // pattern). Any change to isOpen, requestId, the membership+recipient key
  // (Stage 6B3b — see membershipKeyFor above), the settings-by-value key
  // (Stage 6B3a), or the proposal-by-value key (Stage 6B3c — see
  // proposalKeyFor above) bumps modalSessionRef, aborts the active render,
  // and resets compose/preview/send scratch state back to a fresh 'compose'
  // session — except when the transition is the one-use completion-cause
  // exemption (a prior-membership→empty transition tagged by the
  // just-finished send attempt, with settings AND proposal ALSO unchanged),
  // which updates the committed key WITHOUT bumping or resetting,
  // preserving the just-completed 'sent' summary. Same-membership,
  // same-recipient-fields array/object churn (fresh reviewer objects, same
  // ids and same name/email/affiliation; a fresh `settings` object with the
  // same signature/reviewDueDate values; a fresh `proposal` object with the
  // same title/abstract/authors/institution values) never bumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const context = sessionContextRef.current;
    const nextKey = membershipKeyFor(reviewers);
    // Settings identity by VALUE, not object identity: the panel call site
    // rebuilds `settings` fresh every render ({...settings, reviewDueDate:
    // proposal.reviewDeadline}), so comparing the object (or JSON.stringify
    // of the whole thing) would bump on every render and would also pick up
    // unrelated host keys riding along in `...settings`. Only `signature` and
    // `reviewDueDate` are ever consumed (see snapshotSettings in
    // handlePreview) — those are the only two fields in this key. Joined
    // with U+0000, which cannot appear in a date string and is not
    // realistically typeable into the freeform signature field, so the two
    // fields can't collide across the separator.
    const nextSettingsKey = `${settings.signature || ''}\u0000${settings.reviewDueDate || ''}`;
    const changed = context.isOpen !== isOpen || context.requestId !== requestId || context.key !== nextKey
      || context.settingsKey !== nextSettingsKey || context.proposalKey !== proposalKey;

    if (changed) {
      // The one-use completion-cause exemption: this specific transition is
      // priorKey→empty, the session/request/settings/proposal are UNCHANGED
      // (only membership moved), and the cause the panel handed back as a
      // prop is exactly the attempt this modal's own last `complete`
      // produced (same token), still unconsumed, still referring to the
      // current epoch/request/prior membership. Any mismatch (untagged
      // empty, a different membership, request/mode/permission/settings/
      // proposal change, an expired/reused/foreign cause, or a change that
      // happened before completion) invalidates normally.
      const attempt = lastSendAttemptRef.current;
      const cause = membershipCause;
      const isCompletionExemption = Boolean(
        context.isOpen === isOpen
          && context.requestId === requestId
          && context.settingsKey === nextSettingsKey
          && context.proposalKey === proposalKey
          && nextKey === ''
          && attempt
          && !attempt.consumed
          && cause
          && cause.token === attempt.token
          && cause.session === modalSessionRef.current
          && cause.requestId === requestId
          && cause.priorKey === context.key
      );

      if (isCompletionExemption) {
        attempt.consumed = true;
        context.key = nextKey;
      } else {
        lastSendAttemptRef.current = null;
        modalSessionRef.current += 1;
        context.isOpen = isOpen;
        context.requestId = requestId;
        context.key = nextKey;
        // Deadline follow rule: emailFields.reviewDueDate is seeded from the
        // prop once (useState initializer) and otherwise wins over it at
        // render, so widening the key alone would invalidate the session on
        // a deadline change but never actually move the visible/sent date.
        // Move it to the new committed default ONLY when the field still
        // holds the PRIOR committed default or is empty — i.e. the PD never
        // customized it away, and no localStorage restore put something else
        // there. A functional update: a fresh `settings` object with the
        // SAME reviewDueDate value must not schedule a no-op setState here
        // (guarded by the nextDueDateDefault !== prevDueDateDefault check
        // below), and if the field was customized, this must return the same
        // `prev` object so the setState is a true no-op.
        const prevDueDateDefault = context.reviewDueDateDefault;
        const nextDueDateDefault = settings.reviewDueDate || '';
        if (nextDueDateDefault !== prevDueDateDefault) {
          setEmailFields(prev => (
            (!prev.reviewDueDate || prev.reviewDueDate === prevDueDateDefault)
              ? { ...prev, reviewDueDate: nextDueDateDefault }
              : prev
          ));
        }
        context.settingsKey = nextSettingsKey;
        context.proposalKey = proposalKey;
        context.reviewDueDateDefault = nextDueDateDefault;
        if (activeRenderAbortRef.current) {
          activeRenderAbortRef.current.abort();
          activeRenderAbortRef.current = null;
        }
        // proposalLoadSeq is NOT bumped here: loadProposal posts only
        // {requestId, fileKey} — membership is irrelevant to which document
        // loads, so a membership-only change must not orphan a non-stale
        // load. The two resetProposalDoc effects below already invalidate it
        // on isOpen and requestId changes, and the unmount cleanup covers
        // unmount; this branch also fires for pure membership changes, which
        // must leave a pending proposal load alone.
        if (isOpen) {
          setStep('compose');
          setProgress({ current: 0, total: 0, message: '' });
          setDrafts([]);
          setSentResults({ sent: [], failed: [], skipped: [] });
          setError(null);
          setPreviewFailed(false);
          setRendering(false);
          setIsUploading(false);
          uploadAttemptRef.current = null;
          setTemplateSaved(false);
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
        }
      }
    }
    context.onEmailsSent = onEmailsSent;
  });

  // Read the attach-proposal-email setting fresh every time the modal opens
  // (never cached/build-time) so an admin toggle takes effect immediately.
  // Fetch failure degrades to the documented default (OFF/portal-link-only).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/review-manager/release-settings');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setAttachProposalEmailEnabled(!!(res.ok && data?.attachProposalEmail));
      } catch (e) {
        if (!cancelled) setAttachProposalEmailEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Materials-release preflight: fetch fresh whenever the modal is open on
  // the 'materials' template (open, and every switch into it) so a folder
  // that was empty a minute ago but has since been populated doesn't show a
  // stale warning. Same cancelled-flag guard as the release-settings effect
  // above — no setState after this run is superseded or the modal closes.
  useEffect(() => {
    if (!isOpen || templateType !== 'materials' || !requestId) return;
    let cancelled = false;
    setMaterialsPreflight({ status: 'checking', fileCount: null });
    (async () => {
      try {
        const res = await fetch(`/api/review-manager/materials-preflight?requestId=${encodeURIComponent(requestId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setMaterialsPreflight({ status: 'ok', fileCount: typeof data.fileCount === 'number' ? data.fileCount : null });
        } else {
          setMaterialsPreflight({ status: 'unavailable', fileCount: null });
        }
      } catch (e) {
        if (!cancelled) setMaterialsPreflight({ status: 'unavailable', fileCount: null });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, templateType, requestId]);

  const resetProposalDoc = useCallback(() => {
    proposalLoadSeq.current += 1;
    setProposalDoc(emptyProposalDoc());
  }, []);

  const loadProposal = useCallback(async (fileKey) => {
    if (!requestId) return;
    const seq = proposalLoadSeq.current + 1;
    proposalLoadSeq.current = seq;
    setProposalDoc(prev => ({
      ...emptyProposalDoc(),
      allFiles: prev.allFiles || [],
      pickedKey: fileKey || prev.pickedKey || null,
      loading: true,
    }));
    try {
      const response = await fetch('/api/reviewer-finder/load-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileKey ? { requestId, fileKey } : { requestId }),
      });
      const data = await response.json().catch(() => ({}));
      const allFiles = Array.isArray(data.allFiles) ? data.allFiles : [];

      if (!response.ok || !data.success) {
        if (proposalLoadSeq.current !== seq) return;
        setProposalDoc({
          loading: false,
          error: response.status === 404 ? 'not_found' : (data.error || `Could not load the proposal document (${response.status})`),
          blobUrl: null,
          filename: null,
          allFiles,
          pickedKey: null,
        });
        return;
      }

      if (proposalLoadSeq.current !== seq) return;
      setProposalDoc({
        loading: false,
        error: null,
        blobUrl: data.blobUrl || null,
        filename: data.filename || null,
        allFiles,
        pickedKey: data.picked || null,
      });
    } catch (err) {
      if (proposalLoadSeq.current !== seq) return;
      setProposalDoc({
        loading: false,
        error: err.message || 'Could not load the proposal document',
        blobUrl: null,
        filename: null,
        allFiles: [],
        pickedKey: null,
      });
    }
  }, [requestId]);

  useEffect(() => {
    if (!isOpen) resetProposalDoc();
  }, [isOpen, resetProposalDoc]);

  useEffect(() => {
    resetProposalDoc();
  }, [requestId, resetProposalDoc]);

  useEffect(() => {
    // Attach-proposal-email OFF (default): never auto-load/Blob-upload the
    // proposal from SharePoint — the release email is portal-link-only.
    if (!isOpen || templateType !== 'materials' || !requestId || !attachProposalEmailEnabled) return;
    loadProposal();
  }, [isOpen, templateType, requestId, attachProposalEmailEnabled, loadProposal]);

  // Templates load from the per-user Dataverse store; email-fields + attachments
  // remain per-browser (localStorage) — they're per-send scratch, not templates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await loadEmailTemplates();
      if (!cancelled) setTemplates(t);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(EMAIL_FIELDS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setEmailFields(prev => ({
          ...prev,
          ...parsed,
          // A stale saved blank must not hide the request's campaign date.
          reviewDueDate: parsed.reviewDueDate || prev.reviewDueDate || settings.reviewDueDate || '',
        }));
      }
    } catch (e) { /* ignore */ }
    try {
      const saved = localStorage.getItem(ATTACHMENTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Backward-compat: legacy storage was a flat array of attachments.
        // Treat that as materials (where attachments were intended to land).
        if (Array.isArray(parsed)) {
          setAttachmentsByType({ materials: parsed, followup: [], thankyou: [] });
        } else {
          setAttachmentsByType({ materials: [], followup: [], thankyou: [], ...parsed });
        }
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Plain function, not useCallback: it reads mountedRef/modalSessionRef
  // (deliberately outside its "deps"), and it's used only as an onClick
  // handler here — no downstream memoization depends on its identity.
  const saveTemplate = async () => {
    // Templates → per-user Dataverse store (shared with the Workbench invite
    // flow + the EmailTemplatesModal). Email-fields + attachments stay local.
    // Preference persistence itself (localStorage + saveEmailTemplates) is
    // NEVER reverted by a departed session — only the "Saved ✓" feedback and
    // its 1.5s timer are session/mounted-owned (Stage 6B3 D-save-template).
    const epoch = modalSessionRef.current;
    try {
      localStorage.setItem(EMAIL_FIELDS_STORAGE_KEY, JSON.stringify(emailFields));
      localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(attachmentsByType));
    } catch (e) { /* ignore */ }
    const ok = await saveEmailTemplates(templates);
    if (!mountedRef.current || modalSessionRef.current !== epoch) return;
    setTemplateSaved(ok);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (ok) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        if (mountedRef.current && modalSessionRef.current === epoch) setTemplateSaved(false);
      }, 1500);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    // Stage 6B3 D6: `isUploading` is released by attempt identity regardless
    // of session epoch (the 6B2 lock pattern), but stale-session writes
    // (attachments/localStorage/error) are suppressed. Already-started bytes
    // may finish uploading — we never delete an uploaded blob or infer
    // rollback — but a stale attempt does not start its NEXT file, and does
    // not touch attachments/error for a departed session.
    const epoch = modalSessionRef.current;
    const attempt = {};
    uploadAttemptRef.current = attempt;
    const isCurrent = () => mountedRef.current && modalSessionRef.current === epoch;
    setIsUploading(true);
    let stale = false;
    try {
      const { upload } = await import('@vercel/blob/client');
      if (!isCurrent()) { stale = true; }
      for (const file of files) {
        if (stale) break;
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload-handler',
        });
        if (!isCurrent()) { stale = true; break; }
        const newAttachment = { url: blob.url, filename: file.name, size: file.size };
        setAttachments((prev) => [...prev, newAttachment]);
      }
    } catch (err) {
      if (isCurrent()) setError(`Failed to upload: ${err.message}`);
    } finally {
      if (uploadAttemptRef.current === attempt) {
        uploadAttemptRef.current = null;
        if (mountedRef.current) setIsUploading(false);
      }
      e.target.value = ''; // reset input
    }
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const currentTemplate = templates[templateType];
  const proposalFiles = [...(proposalDoc.allFiles || [])].sort((a, b) => {
    const ap = a.classification === 'proposal' ? 0 : 1;
    const bp = b.classification === 'proposal' ? 0 : 1;
    return ap - bp || String(a.name).localeCompare(String(b.name));
  });

  // Single-flight + modal-session guarded preview render (v3). Returns the
  // scheduled promise; callers (the Preview/Retry buttons) don't need to await it.
  const handlePreview = () => {
    const epoch = modalSessionRef.current;
    // Reentrancy guard: a second call for the SAME session (same-tick double
    // click, or Retry clicked while its own render is still pending) is a no-op —
    // at most one fetch per modal session may execute at a time.
    if (renderingEpochRef.current === epoch) return renderTailRef.current;
    // Set the lock synchronously (before setRendering) so two same-tick clicks
    // can't both observe an unlocked ref.
    renderingEpochRef.current = epoch;
    setRendering(true);

    // Snapshot the request inputs now — a queued run (waiting on a prior,
    // still-closing session's tail) must use what was current when IT was
    // requested, not whatever the compose form holds by the time its turn comes.
    const snapshotSuggestionIds = reviewers.map(r => r.suggestionId);
    const snapshotTemplateType = templateType;
    const snapshotTemplate = currentTemplate;
    const snapshotSettings = {
      signature: settings.signature || '',
      reviewDueDate: emailFields.reviewDueDate || settings.reviewDueDate || '',
      customFields: {
        proposalSendDate: emailFields.proposalSendDate || '',
        // honorarium intentionally omitted — render-emails injects the
        // Dataverse ground-truth amount server-side (S199).
      },
    };

    const run = renderTailRef.current.then(async () => {
      // Superseded before its turn (the session closed/reopened while this run
      // waited behind a prior session's tail) — skip the fetch entirely.
      if (modalSessionRef.current !== epoch) return;

      setError(null);
      setDrafts([]);
      setPreviewFailed(false);
      setProgress({ current: 0, total: 0, message: 'Rendering previews...' });

      // Bound this fetch so a hung request can't wedge renderTailRef forever —
      // ReleaseMaterialsModal stays mounted when closed, so without this a stuck render
      // would block every later session's preview too (only close/reopen abort,
      // above, gets there sooner). Preview renders are read-only server-side
      // since d040a7a3, so aborting here never strands a durable write.
      const controller = new AbortController();
      activeRenderAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), PREVIEW_RENDER_TIMEOUT_MS);

      try {
        const response = await fetch('/api/review-manager/render-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            suggestionIds: snapshotSuggestionIds,
            templateType: snapshotTemplateType,
            template: snapshotTemplate,
            settings: snapshotSettings,
          }),
          signal: controller.signal,
        });
        if (modalSessionRef.current !== epoch) return;

        // Tolerate a non-JSON body (gateway timeout / crashed function) — the
        // status-code message below beats a raw JSON parse error in the banner.
        const data = await response.json().catch(() => ({}));
        if (modalSessionRef.current !== epoch) return;
        if (!response.ok) {
          const failure = new Error(renderPreviewFailureMessage({ status: response.status, serverMessage: data.error }));
          failure.isPreviewFailure = true;
          throw failure;
        }

        setDrafts(data.drafts || []);
        setStep('preview');
      } catch (err) {
        if (modalSessionRef.current !== epoch) return;
        // The compose step keeps its Preview button visible, so the retry
        // affordance already exists here; only the message needed help.
        // A timeout/close abort surfaces as AbortError, which — like any other
        // non-server failure — falls through to the network message below.
        setError(err.isPreviewFailure ? err.message : RENDER_PREVIEW_NETWORK_MESSAGE);
        setPreviewFailed(true);
      } finally {
        clearTimeout(timeoutId);
        if (activeRenderAbortRef.current === controller) activeRenderAbortRef.current = null;
      }
    });
    renderTailRef.current = run;
    run.finally(() => {
      // Clear the lock/rendering only if both the lock epoch and the current
      // modal epoch still equal the captured value — a stale run's finally must
      // never clear a newer session's lock or state.
      if (renderingEpochRef.current === epoch && modalSessionRef.current === epoch) {
        renderingEpochRef.current = null;
        setRendering(false);
      }
    });
    return run;
  };

  const updateDraft = (suggestionId, field, value) => {
    setDrafts(prev => prev.map(d =>
      d.suggestionId === suggestionId ? { ...d, [field]: value } : d
    ));
  };

  const handleSend = async () => {
    const sendable = drafts.filter(d => !d.skipped && d.candidateEmail);
    if (sendable.length === 0) {
      setError('No recipients with email to send to');
      return;
    }

    // Missing exact reviewer proposal for a "materials" release: confirm the
    // PD means to send anyway before creating the (irreversible) email
    // activities. Only gates on a verified-empty count ('ok' + 0) — an
    // unverifiable check ('unavailable') must never block a real send.
    if (templateType === 'materials' && materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0) {
      const releaseAnyway = window.confirm(
        'The expected reviewer proposal PDF is not available for this request — reviewers who follow '
          + 'their link will find nothing to download. Release anyway?'
      );
      if (!releaseAnyway) return;
    }

    const ok = window.confirm(
      `Release the proposal to ${sendable.length} reviewer${sendable.length !== 1 ? 's' : ''} now? `
        + 'This will send the materials email through Dynamics and cannot be undone.'
    );
    if (!ok) return;

    // Captured before any async work: a response arriving after this modal
    // session closed/reopened must not mutate the current session's state.
    // requestIdAtSend/priorKey are the COMMITTED identity at send start (not
    // recomputed from props later) — this is what makes the completion-cause
    // exemption's field comparisons in the session effect tautologically
    // correct for this exact attempt.
    const epoch = modalSessionRef.current;
    const requestIdAtSend = sessionContextRef.current.requestId;
    const priorKey = sessionContextRef.current.key;
    const sendToken = Symbol('send');
    // Local mutable accumulator: the authoritative source for the completion
    // summary, fed only by email_sent/email_failed/result — NOT a snapshot of
    // (possibly stale/batched) React state. `finished` makes the attempt
    // terminal: once true, no further event (a duplicate complete, or a
    // trailing error/result in a later chunk) has any effect.
    let results = { sent: [], failed: [], skipped: [] };
    let finished = false;
    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Starting...' });
    setError(null);
    setSentResults(results);

    try {
      // Attach-proposal-email OFF (default): never send attachmentUrls — the
      // release email is portal-link-only ({{externalLink}} in the template).
      const manualAttachmentUrls = attachProposalEmailEnabled
        ? attachments.map(a => a.url).filter(Boolean)
        : [];
      const attachmentUrls = attachProposalEmailEnabled && templateType === 'materials' && proposalDoc.blobUrl
        ? Array.from(new Set([proposalDoc.blobUrl, ...manualAttachmentUrls]))
        : manualAttachmentUrls;

      const response = await fetch('/api/review-manager/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: sendable.map(d => ({
            suggestionId: d.suggestionId,
            subject: d.subject,
            body: d.body,
            externalLinkExpected: d.externalLinkExpected,
            draftFingerprint: d.draftFingerprint,
          })),
          templateType,
          attachmentUrls,
          markAsSent: true,
        }),
      });
      if (modalSessionRef.current !== epoch) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.message || `Email send failed (${response.status})`);
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new Error('Email send returned no readable response stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;
      // reader.cancel() is a best-effort client stream close, not a server
      // rollback: it may be absent on a test double, and its promise
      // rejection is observed everywhere it's called so it never surfaces as
      // an unhandled rejection.
      const cancelReader = () => {
        try {
          const p = reader.cancel();
          if (p && typeof p.then === 'function') p.catch(() => {});
        } catch (e) { /* best-effort */ }
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (modalSessionRef.current !== epoch) {
          cancelReader();
          return;
        }
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // A duplicate `complete`, or a trailing `error`/`result`, arriving
          // in the SAME chunk right after this attempt already finished must
          // also have no effect.
          if (finished) break;
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'progress') {
                setProgress(prev => ({ ...prev, ...data }));
              } else if (currentEvent === 'email_sent') {
                results = { ...results, sent: [...results.sent, data] };
                setSentResults(results);
              } else if (currentEvent === 'email_failed') {
                results = { ...results, failed: [...results.failed, data] };
                setSentResults(results);
              } else if (currentEvent === 'result') {
                results = {
                  sent: data.sent || [],
                  failed: data.failed || [],
                  skipped: data.skipped || [],
                };
                setSentResults(results);
              } else if (currentEvent === 'complete') {
                // Mark this attempt finished BEFORE calling the parent — the
                // finished flag is what makes a duplicate complete or a
                // trailing error/result a no-op, and the recorded attempt is
                // what lets the session effect recognize the exact
                // membership-clear this callback is about to cause.
                finished = true;
                setSentResults(results);
                setStep('sent');
                lastSendAttemptRef.current = {
                  token: sendToken,
                  session: epoch,
                  requestId: requestIdAtSend,
                  priorKey,
                  consumed: false,
                };
                const cause = lastSendAttemptRef.current;
                const latestOnEmailsSent = sessionContextRef.current.onEmailsSent;
                if (latestOnEmailsSent) {
                  try {
                    const result = latestOnEmailsSent(cause);
                    if (result && typeof result.then === 'function') result.catch(() => {});
                  } catch (e) {
                    // Swallow: confirmed send, callback/refresh failure only —
                    // never relabel a confirmed mutation as failed.
                  }
                }
              } else if (currentEvent === 'error') {
                setError(data.message);
                setStep('preview');
              }
            } catch (e) { /* parse error, ignore */ }
            currentEvent = null;
          }
        }
      }
      if (finished) cancelReader();
    } catch (err) {
      if (modalSessionRef.current !== epoch || finished) return;
      setError(err.message);
      setStep('preview');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'download' ? 'Emails Ready' : 'Release proposal to reviewers'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'compose' && (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm flex items-start justify-between gap-3">
                  <span>{error}</span>
                  {previewFailed && (
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={rendering}
                      className="shrink-0 px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-800 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    >
                      ↻ Retry
                    </button>
                  )}
                </div>
              )}

              {materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0 && (
                <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                  The expected reviewer proposal PDF is not available for this request — reviewers
                  who follow their link will find nothing to download.
                </div>
              )}

              {materialsPreflight.status === 'unavailable' && (
                <div className="p-3 bg-gray-50 text-gray-500 rounded-lg text-sm">
                  Couldn’t verify reviewer materials availability.
                </div>
              )}

              {/* Email Fields — dates and values for placeholders */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-gray-600 mb-1">Email Fields (used in placeholders)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Review Due Date</label>
                    <input
                      type="date"
                      value={emailFields.reviewDueDate}
                      onChange={e => setEmailFields(prev => ({ ...prev, reviewDueDate: e.target.value }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Proposal Send Date</label>
                    <input
                      type="date"
                      value={emailFields.proposalSendDate}
                      onChange={e => setEmailFields(prev => ({ ...prev, proposalSendDate: e.target.value }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:outline-none"
                    />
                  </div>
                  {/* Honorarium amount removed from per-user input (S199): it is
                      now a single Dataverse ground-truth (honorarium.default_amount)
                      read server-side at email-render time. The
                      {{customField:honorarium}} placeholder still works — it's
                      filled by the server, not this form. */}
                </div>
              </div>

              {!attachProposalEmailEnabled && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  Reviewers access materials via their secure portal link (included automatically) —
                  no attachment is sent. An admin can enable email attachments in Admin → Reviewer
                  Release Attachments.
                </div>
              )}

              {attachProposalEmailEnabled && (
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">Proposal document</p>
                    {proposalDoc.loading && (
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                    )}
                  </div>
                  {proposalDoc.error === 'not_found' ? (
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                      No canonical reviewer proposal was found at
                      {' '}Reviewer Materials/Proposal_&#123;Request#&#125;.pdf.
                    </div>
                  ) : proposalDoc.error ? (
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                      {proposalDoc.error}{' '}
                      <button type="button" onClick={() => loadProposal()} className="underline font-medium">Retry</button>
                    </div>
                  ) : proposalDoc.loading ? (
                    <p className="text-sm text-gray-500">Loading the request’s proposal from SharePoint…</p>
                  ) : proposalDoc.blobUrl ? (
                    <p className="text-sm text-gray-700">
                      Will attach: <span className="font-medium">{proposalDoc.filename}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600">
                      No canonical reviewer proposal was found at
                      {' '}Reviewer Materials/Proposal_&#123;Request#&#125;.pdf.
                    </p>
                  )}

                  {proposalFiles.length > 0 && (
                    <div className="mt-3">
                      <label className="block text-xs text-gray-500 mb-1" htmlFor="proposal-document-picker">
                        Historical/manual override: choose a different request file
                      </label>
                      <select
                        id="proposal-document-picker"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                        value={proposalDoc.pickedKey || ''}
                        disabled={proposalDoc.loading}
                        onChange={(ev) => { if (ev.target.value) loadProposal(ev.target.value); }}
                      >
                        {!proposalDoc.pickedKey && <option value="">Select a file…</option>}
                        {proposalFiles.map((file) => {
                          const key = fileKeyOf(file);
                          return (
                            <option key={key} value={key}>
                              {file.name}{file.classification === 'proposal' ? '  ·  proposal' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Attachments — gated by the admin-configurable attach-proposal-email
                  setting (default OFF). When off, no file picker is shown, nothing
                  is uploaded to Blob, and no attachmentUrls are sent. */}
              {attachProposalEmailEnabled && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-medium text-gray-600">Attachments (included in .eml files)</p>
                  <label className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                    isUploading ? 'bg-gray-300 text-gray-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}>
                    {isUploading ? 'Uploading...' : '+ Add File'}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
                      multiple
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                  </label>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No attachments. Upload reviewer instructions, templates, etc.</p>
                ) : (
                  <div className="space-y-1">
                    {attachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-gray-200">
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="text-sm text-gray-700 truncate">{att.filename}</span>
                          {att.size && <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(att.size)}</span>}
                        </div>
                        <button
                          onClick={() => removeAttachment(i)}
                          className="text-gray-400 hover:text-red-500 ml-2 flex-shrink-0"
                          title="Remove attachment"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={currentTemplate.subject}
                  onChange={e => setTemplates(prev => ({
                    ...prev,
                    [templateType]: { ...prev[templateType], subject: e.target.value },
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                <textarea
                  value={currentTemplate.body}
                  onChange={e => setTemplates(prev => ({
                    ...prev,
                    [templateType]: { ...prev[templateType], body: e.target.value },
                  }))}
                  rows={14}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {/* Placeholders reference */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-600 mb-1">Available Placeholders</p>
                <div className="flex flex-wrap gap-1">
                  {['greeting', 'recipientName', 'salutation', 'recipientLastName',
                    'proposalTitle', 'piName', 'piInstitution', 'externalLink',
                    'reviewDueDate', 'programName', 'signature',
                    'investigatorTeam', 'reviewerFormLink',
                    'customField:proposalSendDate', 'customField:honorarium',
                    'customField:proposalDueDate'].map(p => (
                    <code key={p} className="text-xs bg-white px-1.5 py-0.5 rounded border border-gray-200 text-gray-600">
                      {`{{${p}}}`}
                    </code>
                  ))}
                </div>
              </div>

              {/* Recipients summary */}
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>{reviewers.length}</strong> reviewer{reviewers.length !== 1 ? 's' : ''} selected
                  {reviewers.filter(r => !r.email).length > 0 && (
                    <span className="text-orange-600 ml-2">
                      ({reviewers.filter(r => !r.email).length} without email — will be skipped)
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                Review and personalize each email below. Edits here are sent as-is to each
                recipient. Attachments and the sender are locked at this step.
              </div>
              {drafts.filter(d => d.skipped).length > 0 && (
                <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-800">
                  {drafts.filter(d => d.skipped).length} reviewer(s) will be skipped (no email on file).
                </div>
              )}
              <div className="space-y-3">
                {drafts.map((d) => (
                  <div key={d.suggestionId} className={`border rounded-lg p-3 ${d.skipped ? 'bg-gray-50 opacity-60' : 'bg-white'}`}>
                    <div className="flex items-baseline justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{d.candidateName}</p>
                        <p className="text-xs text-gray-500">
                          {d.candidateEmail || 'no email on file'}
                          {d.requestNumber && <span className="ml-2">· request {d.requestNumber}</span>}
                        </p>
                      </div>
                      {d.skipped && (
                        <span className="text-xs text-orange-700 font-medium">Will be skipped</span>
                      )}
                    </div>
                    {!d.skipped && (
                      <>
                        <input
                          type="text"
                          value={d.subject}
                          onChange={e => updateDraft(d.suggestionId, 'subject', e.target.value)}
                          className="w-full mb-2 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                          placeholder="Subject"
                        />
                        <textarea
                          value={d.body}
                          onChange={e => updateDraft(d.suggestionId, 'body', e.target.value)}
                          rows={8}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 font-mono"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'sending' && (
            <div className="space-y-4 py-8">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto" />
                <p className="text-gray-700 font-medium">{progress.message || 'Sending...'}</p>
                {progress.total > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 max-w-md mx-auto">
                    <div
                      className="bg-gray-700 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                <p className="text-sm text-gray-500">{progress.current} / {progress.total}</p>
              </div>
              {(sentResults.sent.length > 0 || sentResults.failed.length > 0) && (
                <div className="border-t border-gray-200 pt-3 space-y-1 max-h-48 overflow-y-auto">
                  {sentResults.sent.map(s => (
                    <div key={`s-${s.suggestionId}`} className="flex items-center gap-2 text-sm text-green-700">
                      <span>✓</span><span>{s.candidateName}</span><span className="text-gray-400 text-xs">{s.candidateEmail}</span>
                    </div>
                  ))}
                  {sentResults.failed.map(f => (
                    <div key={`f-${f.suggestionId}`} className="flex items-center gap-2 text-sm text-red-700">
                      <span>✗</span><span>{f.candidateName}</span><span className="text-red-500 text-xs">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'sent' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                  sentResults.failed.length === 0 ? 'bg-green-100' : 'bg-yellow-100'
                  }`}>
                  <svg className={`w-6 h-6 ${sentResults.failed.length === 0 ? 'text-green-600' : 'text-yellow-600'}`}
                       fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-900">
                  {sentResults.sent.length} sent
                  {sentResults.failed.length > 0 && `, ${sentResults.failed.length} failed`}
                  {sentResults.skipped.length > 0 && `, ${sentResults.skipped.length} skipped`}
                </p>
              </div>
              <div className="space-y-1">
                {sentResults.sent.map(s => (
                  <div key={`s-${s.suggestionId}`} className="flex items-center justify-between p-2 bg-green-50 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span>
                      <span className="font-medium text-gray-900">{s.candidateName}</span>
                      <span className="text-gray-500 text-xs">{s.candidateEmail}</span>
                    </div>
                    {s.regardingLinked && <span className="text-xs text-green-700">linked to request</span>}
                  </div>
                ))}
                {sentResults.failed.map(f => (
                  <div key={`f-${f.suggestionId}`} className="p-2 bg-red-50 rounded text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-red-600">✗</span>
                      <span className="font-medium text-gray-900">{f.candidateName}</span>
                      <span className="text-gray-500 text-xs">{f.candidateEmail}</span>
                    </div>
                    <p className="text-xs text-red-700 ml-6">{f.error}</p>
                  </div>
                ))}
                {sentResults.skipped.map(s => (
                  <div key={`sk-${s.suggestionId}`} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm text-gray-600">
                    <span>—</span>
                    <span className="font-medium">{s.candidateName}</span>
                    <span className="text-xs">skipped ({SEND_SKIP_REASON_LABEL[s.reason] || s.reason || 'not sent'})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            disabled={step === 'sending'}
          >
            {step === 'sent' ? 'Close' : 'Cancel'}
          </button>
          <div className="flex gap-2">
            {step === 'compose' && (
              <>
                <button
                  onClick={saveTemplate}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors"
                  title="Save these as your default templates (stored to your account)"
                >
                  {templateSaved ? 'Saved ✓' : 'Save Template'}
                </button>
                <Button onClick={handlePreview} disabled={rendering}>
                  Preview {reviewers.filter(r => r.email).length} Email{reviewers.filter(r => r.email).length !== 1 ? 's' : ''}
                </Button>
              </>
            )}
            {step === 'preview' && (
              <>
                <button
                  onClick={() => setStep('compose')}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors"
                >
                  Back
                </button>
                <Button onClick={handleSend} disabled={degraded} title={degraded ? 'Reviewer data could not be refreshed - retry before making changes' : undefined}>
                  Send {drafts.filter(d => !d.skipped).length} Email{drafts.filter(d => !d.skipped).length !== 1 ? 's' : ''}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

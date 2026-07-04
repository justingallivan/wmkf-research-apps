/**
 * ReviewerManagePanel — the request-scoped reviewer-management substance.
 *
 * Extracted from `pages/review-manager.js`'s `ProposalDetailTab` (Phase 2 of the
 * Request Workbench build — see `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`). Both the
 * standalone Review Manager page and the Workbench per-request shell render this.
 *
 * The proposal-selector dropdown, the standalone proposal info card, and the
 * per-app signature Settings bar are intentionally NOT here — they stay in the
 * Review Manager page (request context comes from the host in the Workbench).
 *
 * Props:
 *   - proposal   : the request projection ({ proposalId, proposalTitle, reviewDeadline, ... })
 *   - reviewers  : the reviewer rows to manage (already scoped to this request)
 *   - loading    : optional; shows a subtle spinner in the actions bar
 *   - onRefresh  : called after any mutation so the host re-fetches
 *   - settings   : { signature, ... } — feeds the email templates (sender is
 *                  always the signed-in MS account; signature is freeform text)
 *   - mode       : undefined|'all' → every reviewer (Review Manager behavior);
 *                  'track' → Workbench post-acceptance lifecycle sub-tab
 *   - canManage  : soft UI gate (decided S207). When false, write controls are
 *                  hidden and the table is read-only. The reused server APIs stay
 *                  org-open regardless — this is cosmetic, not an auth boundary.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Card, Button } from '../Layout';
import ReviewFormFields from '../external/ReviewFormFields';
import { STATUS_PIPELINE, getStatusInfo, filterByMode } from './reviewer-modes';
import { EMPTY_TEMPLATES, loadEmailTemplates, saveEmailTemplates } from './email-template-store';

// Pure status-pipeline / mode-bucketing logic lives in ./reviewer-modes
// (React-free + unit-tested). Re-export the pipeline so existing importers of
// it from this module keep working.
export { STATUS_PIPELINE, MODE_STATUSES, MODE_WORK_REMAINING, filterByMode } from './reviewer-modes';

// ─── Template Defaults ──────────────────────────────────────────────────────
// Resolution + per-PD persistence live in email-template-store.js: the org
// default (admin "Email Defaults" panel, Dataverse wmkf_appsystemsetting) with a
// per-PD override layered on top (wmkf_appuserpreferences, EMAIL_TEMPLATES).
// loadEmailTemplates() returns the resolved set; EMPTY_TEMPLATES is the blank
// skeleton used until that load completes.

// ─── Status Badge ───────────────────────────────────────────────────────────

export function StatusBadge({ status }) {
  const info = getStatusInfo(status);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${info.color}`}>
      {info.label}
    </span>
  );
}

// ─── Magic-link Token State ─────────────────────────────────────────────────

const TOKEN_STATE_INFO = {
  not_minted: { label: 'Not sent', color: 'bg-gray-100 text-gray-600' },
  active:     { label: 'Active',   color: 'bg-blue-100 text-blue-800' },
  revoked:    { label: 'Revoked',  color: 'bg-red-100 text-red-800' },
  expired:    { label: 'Expired',  color: 'bg-orange-100 text-orange-800' },
};

export function TokenStateBadge({ state, expiresAt, firstAccessedAt }) {
  const info = TOKEN_STATE_INFO[state] || TOKEN_STATE_INFO.not_minted;
  const tooltip = [
    expiresAt && `Expires ${new Date(expiresAt).toLocaleDateString()}`,
    firstAccessedAt && `Opened ${new Date(firstAccessedAt).toLocaleDateString()}`,
  ].filter(Boolean).join(' · ');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${info.color}`}
      title={tooltip || undefined}
    >
      {info.label}
      {state === 'active' && firstAccessedAt && (
        <span className="ml-1 text-[10px] opacity-75">opened</span>
      )}
    </span>
  );
}

const MENU_WIDTH = 224; // w-56

export function TokenActionsMenu({ reviewer, onRegenerate, onRevoke, onMarkReceivedNoFile, onRemove }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null); // { left, top } in viewport px, or null
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const isActive = reviewer.tokenState === 'active';
  const hasReview = !!(reviewer.reviewReceivedAt);
  // 1 (regenerate) + revoke? + mark-received? + remove? — drives the upward-flip
  // height estimate so the portalled menu never opens off-screen.
  const itemCount = 1 + (isActive ? 1 : 0) + (!hasReview ? 1 : 0) + (onRemove ? 1 : 0);

  // Position the menu in viewport coords, flipping upward when there isn't room
  // below. Rendered in a portal (see below) so it escapes the table card's
  // `overflow-hidden` clip and the footer's stacking context.
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estHeight = itemCount * 40 + 8;
    const openUp = rect.bottom + estHeight > window.innerHeight && rect.top > estHeight;
    setCoords({
      left: Math.max(8, rect.right - MENU_WIDTH),
      top: openUp ? rect.top - estHeight - 4 : rect.bottom + 4,
    });
  }, [itemCount]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDocClick = (e) => {
      // Close only when the click is outside BOTH the trigger and the portalled
      // menu (the menu lives outside this component's DOM subtree).
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Position is computed once on open; close on scroll/resize so a stale
    // fixed position can never be shown detached from its row.
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        title="Reviewer link actions"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: MENU_WIDTH }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-sm"
        >
          <button
            onClick={() => { setOpen(false); onRegenerate(); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50"
          >
            {reviewer.tokenState === 'not_minted' ? 'Generate link & copy' : 'Regenerate link & copy'}
          </button>
          {isActive && (
            <button
              onClick={() => { setOpen(false); onRevoke(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700"
            >
              Revoke link
            </button>
          )}
          {!hasReview && (
            <button
              onClick={() => { setOpen(false); onMarkReceivedNoFile(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50"
            >
              Mark received (no file)
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => { setOpen(false); onRemove(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700 border-t border-gray-100"
            >
              Remove from this request
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Email Modal ────────────────────────────────────────────────────────────

const EMAIL_FIELDS_STORAGE_KEY = 'review_manager_email_fields';
const ATTACHMENTS_STORAGE_KEY = 'review_manager_attachments';

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

function EmailModal({ isOpen, onClose, reviewers, proposalTitle, requestId, settings, onEmailsSent }) {
  const [templateType, setTemplateType] = useState('materials');
  const [templates, setTemplates] = useState(EMPTY_TEMPLATES);
  const [step, setStep] = useState('compose'); // compose | preview | sending | sent
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [drafts, setDrafts] = useState([]); // [{ suggestionId, candidateName, candidateEmail, requestNumber, subject, body, skipped? }]
  const [sentResults, setSentResults] = useState({ sent: [], failed: [], skipped: [] });
  const [error, setError] = useState(null);
  const [emailFields, setEmailFields] = useState({
    reviewDueDate: '',
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

  // Reset email compose state when modal opens.
  useEffect(() => {
    if (isOpen) {
      setStep('compose');
      setProgress({ current: 0, total: 0, message: '' });
      setDrafts([]);
      setSentResults({ sent: [], failed: [], skipped: [] });
      setError(null);
    }
  }, [isOpen]);

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
    if (templateType !== 'materials') resetProposalDoc();
  }, [templateType, resetProposalDoc]);

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
      if (saved) setEmailFields(prev => ({ ...prev, ...JSON.parse(saved) }));
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

  const [templateSaved, setTemplateSaved] = useState(false);
  const saveTemplate = useCallback(async () => {
    // Templates → per-user Dataverse store (shared with the Workbench invite
    // flow + the EmailTemplatesModal). Email-fields + attachments stay local.
    try {
      localStorage.setItem(EMAIL_FIELDS_STORAGE_KEY, JSON.stringify(emailFields));
      localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(attachmentsByType));
    } catch (e) { /* ignore */ }
    const ok = await saveEmailTemplates(templates);
    setTemplateSaved(ok);
    if (ok) setTimeout(() => setTemplateSaved(false), 1500);
  }, [templates, emailFields, attachmentsByType]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      const { upload } = await import('@vercel/blob/client');
      for (const file of files) {
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload-handler',
        });
        const newAttachment = { url: blob.url, filename: file.name, size: file.size };
        setAttachments((prev) => [...prev, newAttachment]);
      }
    } catch (err) {
      setError(`Failed to upload: ${err.message}`);
    } finally {
      setIsUploading(false);
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

  const handlePreview = async () => {
    setError(null);
    setDrafts([]);
    setProgress({ current: 0, total: 0, message: 'Rendering previews...' });

    try {
      const response = await fetch('/api/review-manager/render-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionIds: reviewers.map(r => r.suggestionId),
          templateType,
          template: currentTemplate,
          settings: {
            signature: settings.signature || '',
            reviewDueDate: emailFields.reviewDueDate || settings.reviewDueDate || '',
            customFields: {
              proposalSendDate: emailFields.proposalSendDate || '',
              // honorarium intentionally omitted — render-emails injects the
              // Dataverse ground-truth amount server-side (S199).
            },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to render previews');
      }

      setDrafts(data.drafts || []);
      setStep('preview');
    } catch (err) {
      setError(err.message);
    }
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

    // Empty reviewer-materials folder for a "materials" release: confirm the
    // PD means to send anyway before creating the (irreversible) email
    // activities. Only gates on a verified-empty count ('ok' + 0) — an
    // unverifiable check ('unavailable') must never block a real send.
    if (templateType === 'materials' && materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0) {
      const releaseAnyway = window.confirm(
        'No reviewer materials are in the download folder for this request — reviewers who follow '
          + 'their link will find nothing to download. Release anyway?'
      );
      if (!releaseAnyway) return;
    }

    const ok = window.confirm(
      `Send ${sendable.length} email${sendable.length !== 1 ? 's' : ''} now via Dynamics? `
        + 'This will create email activities on the linked requests and cannot be undone.'
    );
    if (!ok) return;

    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Starting...' });
    setError(null);
    setSentResults({ sent: [], failed: [], skipped: [] });

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
          })),
          templateType,
          attachmentUrls,
          markAsSent: true,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'progress') {
                setProgress(prev => ({ ...prev, ...data }));
              } else if (currentEvent === 'email_sent') {
                setSentResults(prev => ({ ...prev, sent: [...prev.sent, data] }));
              } else if (currentEvent === 'email_failed') {
                setSentResults(prev => ({ ...prev, failed: [...prev.failed, data] }));
              } else if (currentEvent === 'result') {
                setSentResults({
                  sent: data.sent || [],
                  failed: data.failed || [],
                  skipped: data.skipped || [],
                });
              } else if (currentEvent === 'complete') {
                setStep('sent');
                if (onEmailsSent) onEmailsSent();
              } else if (currentEvent === 'error') {
                setError(data.message);
                setStep('preview');
              }
            } catch (e) { /* parse error, ignore */ }
            currentEvent = null;
          }
        }
      }
    } catch (err) {
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
            {step === 'download' ? 'Emails Ready' : `Generate ${templateType.charAt(0).toUpperCase() + templateType.slice(1)} Emails`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'compose' && (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
              )}

              {/* Template Type Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Type</label>
                <div className="flex gap-2">
                  {['materials', 'followup', 'thankyou'].map(type => (
                    <button
                      key={type}
                      onClick={() => setTemplateType(type)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        templateType === type
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type === 'materials' ? 'Materials' : type === 'followup' ? 'Follow-up' : 'Thank You'}
                    </button>
                  ))}
                </div>
              </div>

              {templateType === 'materials' && materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0 && (
                <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                  No reviewer materials are in the download folder for this request — reviewers who
                  follow their link will find nothing to download.
                </div>
              )}

              {templateType === 'materials' && materialsPreflight.status === 'unavailable' && (
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

              {templateType === 'materials' && !attachProposalEmailEnabled && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  Reviewers access materials via their secure portal link (included automatically) —
                  no attachment is sent. An admin can enable email attachments in Admin → Reviewer
                  Release Attachments.
                </div>
              )}

              {templateType === 'materials' && attachProposalEmailEnabled && (
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">Proposal document</p>
                    {proposalDoc.loading && (
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                    )}
                  </div>
                  {proposalDoc.error === 'not_found' ? (
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                      No proposal document found for this request yet — has it been submitted?
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
                    <p className="text-sm text-gray-600">No proposal document found for this request yet — has it been submitted?</p>
                  )}

                  {proposalFiles.length > 0 && (
                    <div className="mt-3">
                      <label className="block text-xs text-gray-500 mb-1" htmlFor="proposal-document-picker">
                        Wrong document? choose another
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
                    <span className="text-xs">skipped (no email)</span>
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
                <Button onClick={handlePreview}>
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
                <Button onClick={handleSend}>
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

// ─── Review Upload Modal ────────────────────────────────────────────────────

function UploadReviewModal({ isOpen, onClose, reviewer, onUploaded }) {
  const formRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState(null);
  const [infectedDetail, setInfectedDetail] = useState(null);

  if (!isOpen || !reviewer) return null;

  const prefill = {
    affiliation: reviewer.reviewerAffiliation || reviewer.affiliation || '',
    impact: reviewer.reviewerImpact ?? null,
    risk: reviewer.reviewerRisk ?? null,
    overallRating: reviewer.reviewerOverallRating ?? null,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors(null);
    setInfectedDetail(null);

    const formData = new FormData(formRef.current);
    formData.append('suggestionId', reviewer.suggestionId);

    const fileEntries = formData.getAll('files').filter(f => f && f.size > 0);
    if (fileEntries.length === 0) {
      setErrors(['Please attach at least one file.']);
      return;
    }

    setUploading(true);
    try {
      const response = await fetch('/api/review-manager/upload-review', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        if (data.reason === 'infected') {
          setInfectedDetail(Array.isArray(data.errors) ? data.errors : []);
        } else {
          setErrors(data.errors || [data.reason || 'Upload failed.']);
        }
        return;
      }
      if (onUploaded) onUploaded(reviewer.suggestionId, data);
      onClose();
    } catch (err) {
      setErrors([err.message || 'Network error.']);
    } finally {
      setUploading(false);
    }
  };

  const reviewOnFile = !!reviewer.reviewSharePointFolder;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">Upload Review</h2>
          <p className="text-sm text-gray-500 mt-1">for {reviewer.name}</p>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="p-6 space-y-5">
          {reviewOnFile && (
            <div className="p-3 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-800">
                A review is already on file
                {reviewer.reviewFilename ? <> (<strong>{reviewer.reviewFilename}</strong>)</> : null}.
                Uploading replaces it.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="rm-files" className="block text-sm font-semibold text-gray-900">
              Review file(s) <span className="text-red-600">*</span>
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Up to 5 files. PDF, DOCX, or DOC. Max 25 MB each.
            </p>
            <input
              id="rm-files"
              name="files"
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              required
              disabled={uploading}
              className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </div>

          <ReviewFormFields initialValues={prefill} disabled={uploading} idPrefix="rm" />

          {errors && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <p className="font-semibold">Please fix the following:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {errors.map((err, i) => (<li key={i}>{err}</li>))}
              </ul>
            </div>
          )}

          {infectedDetail && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900 space-y-2">
              <p className="font-semibold">Virus scanner rejected the file</p>
              <p>
                The uploaded file was flagged as potentially malicious and was not stored.
                The review-form fields above are preserved — replace just the file and try again.
                The Program Director on this proposal has been notified automatically.
              </p>
              {infectedDetail.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-red-800 underline">Detection detail</summary>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {infectedDetail.map((err, i) => (<li key={i}>{err}</li>))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <Button type="submit" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Status Dropdown ──────────────────────────────────────────────────────

function StatusDropdown({ currentStatus, onChange }) {
  const settableStatuses = STATUS_PIPELINE.filter(s => s.key !== 'accepted');
  return (
    <label className="inline-flex flex-col items-start gap-0.5 text-left">
      <span className="text-[10px] uppercase text-gray-400 leading-none">Correct status</span>
      <select
        value={currentStatus === 'accepted' ? '' : currentStatus}
        onChange={e => onChange(e.target.value)}
        className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white hover:border-gray-400 focus:ring-1 focus:ring-gray-400 focus:outline-none cursor-pointer"
      >
        {currentStatus === 'accepted' && (
          <option value="" disabled>Accepted</option>
        )}
        {settableStatuses.map(s => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
    </label>
  );
}

// ─── Reviewer Manage Panel ──────────────────────────────────────────────────

export default function ReviewerManagePanel({
  proposal,
  reviewers: reviewersProp,
  loading = false,
  onRefresh,
  settings = {},
  mode,
  canManage = true,
}) {
  const [selectedReviewers, setSelectedReviewers] = useState(new Set());
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [uploadModalReviewer, setUploadModalReviewer] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null); // { suggestionId, value }
  const [savingNotes, setSavingNotes] = useState(false);

  const allReviewers = reviewersProp || proposal?.reviewers || [];
  const reviewers = filterByMode(allReviewers, mode);

  // Reset selection / notes when the proposal OR the active mode changes — a
  // selection made under one sub-tab shouldn't leak into another's visible set.
  useEffect(() => {
    setSelectedReviewers(new Set());
    setEditingNotes(null);
  }, [proposal?.proposalId, mode]);

  const selectedList = reviewers.filter(r => selectedReviewers.has(r.suggestionId));
  const allSelected = reviewers.length > 0 && reviewers.every(r => selectedReviewers.has(r.suggestionId));
  const acceptedReviewers = reviewers.filter(r => r.reviewStatus === 'accepted');
  const selectedAcceptedList = selectedList.filter(r => r.reviewStatus === 'accepted');

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedReviewers(new Set());
    } else {
      setSelectedReviewers(new Set(reviewers.map(r => r.suggestionId)));
    }
  };

  const toggleSelect = (id) => {
    setSelectedReviewers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveNotes = async (suggestionId, notes) => {
    setSavingNotes(true);
    try {
      await fetch('/api/review-manager/reviewers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, notes }),
      });
      setEditingNotes(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSavingNotes(false);
    }
  };

  // ── External-link lifecycle actions ─────────────────────────────────────
  // These hit the Phase 5 staff endpoints. All are no-ops in dev when the
  // suggestion has never had a token minted (regenerate is the entry point);
  // revoke + mark-received are 404-tolerant on the backend.
  const handleRegenerateToken = async (suggestionId) => {
    try {
      const resp = await fetch('/api/review-manager/regenerate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        alert(`Could not generate a new link: ${data.reason || resp.status}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        alert(`Link copied to clipboard. Expires ${new Date(data.expiresAt).toLocaleDateString()}.`);
      } catch {
        // Clipboard can fail on insecure contexts — show the URL anyway.
        prompt('Reviewer link (copy manually):', data.url);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error generating link: ${err.message}`);
    }
  };

  const handleRevokeToken = async (suggestionId) => {
    if (!confirm('Revoke this reviewer\'s magic link? They will no longer be able to use it.')) return;
    try {
      const resp = await fetch('/api/review-manager/revoke-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        alert(`Revoke failed: ${data.reason || resp.status}`);
        return;
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  const handleMarkReceivedNoFile = async (suggestionId) => {
    if (!confirm('Mark this review as received without a file? Use this for informal feedback or paper reviews you do not plan to scan.')) return;
    try {
      const resp = await fetch('/api/review-manager/mark-received-no-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        alert(`Could not mark received: ${data.reason || resp.status}`);
        return;
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  // Remove a reviewer from THIS request. The my-candidates DELETE endpoint is
  // server-authoritative (S213, Codex BUG-1 fix): it revokes any live magic link
  // FIRST, then soft-deletes (sets the suggestion wmkf_selected=false). It never
  // touches the global wmkf_potentialreviewer person / promoted contact, which
  // are reused across requests; the engagement row + its history are preserved,
  // just dropped from the request's lists. Doing the revoke server-side means we
  // don't rely on a stale client tokenState to decide whether a link needs
  // killing — `hasLiveLink` here only tailors the confirm wording. A revoke
  // failure on the server fails the whole DELETE (non-ok), so the row is kept and
  // we never leave an unselected row with a live link.
  const handleRemoveReviewer = async (reviewer) => {
    const hasLiveLink = reviewer.tokenState === 'active';
    const msg = `Remove ${reviewer.name || 'this reviewer'} from this request?\n\n`
      + 'This drops them from your reviewer list for this proposal. '
      + (hasLiveLink ? 'Their review link will be revoked. ' : '')
      + 'Their reviewer record and any review history are preserved.';
    if (!confirm(msg)) return;

    try {
      const resp = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: reviewer.suggestionId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const detail = data.error || data.message || data.details || resp.status;
        alert(`Could not remove the reviewer: ${detail}`);
        return;
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error removing reviewer: ${err.message}`);
    }
  };

  const updateStatus = async (suggestionId, newStatus) => {
    try {
      await fetch('/api/review-manager/reviewers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, reviewStatus: newStatus }),
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleUploadComplete = () => {
    setUploadModalReviewer(null);
    if (onRefresh) onRefresh();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!proposal) return null;

  const emptyLabel = mode && mode !== 'all'
    ? 'No reviewers in this stage.'
    : 'No reviewers yet.';

  return (
    <div className="space-y-4">
      {/* Actions bar. Counts use selectedList (visible + selected), not the raw
          selectedReviewers set, which can retain IDs no longer visible after a
          refresh removes a reviewer — that would overcount (Codex S209). */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {selectedList.length > 0 ? `${selectedList.length} selected` : `${reviewers.length} reviewer${reviewers.length !== 1 ? 's' : ''}`}
          </span>
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Release proposal to reviewers (reviewer-engagement §3.A): a one-click
              materials send to accepted-awaiting-materials reviewers, even
              though Track Reviewers also shows later lifecycle statuses.
              If the user has selected a subset of accepted reviewers (using
              selectedList's visible+selected semantics, not the raw
              selectedReviewers set — see Codex S209 note above), release
              targets only that subset; otherwise it targets all accepted
              reviewers. Accepted-only is also enforced server-side in
              send-emails. */}
          {canManage && acceptedReviewers.length > 0 && (
            <Button
              onClick={() => {
                const releaseTargets = selectedAcceptedList.length > 0
                  ? selectedAcceptedList
                  : acceptedReviewers;
                setSelectedReviewers(new Set(releaseTargets.map(r => r.suggestionId)));
                setEmailModalOpen(true);
              }}
            >
              Release proposal to reviewers ({selectedAcceptedList.length > 0 ? selectedAcceptedList.length : acceptedReviewers.length})
            </Button>
          )}
          {canManage && selectedList.length > 0 && (
            <Button onClick={() => setEmailModalOpen(true)}>
              Send Email ({selectedList.length})
            </Button>
          )}
        </div>
      </div>

      {/* Reviewers table */}
      {reviewers.length === 0 ? (
        <Card hover={false}>
          <p className="text-sm text-gray-500 text-center py-6">{emptyLabel}</p>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {canManage && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Link</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                {canManage && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reviewers.map(r => {
                const isEditing = editingNotes?.suggestionId === r.suggestionId;
                const lastAction = r.thankyouSentAt || r.reviewReceivedAt || r.reminderSentAt || r.materialsSentAt;

                return (
                  <tr key={r.suggestionId} className="hover:bg-gray-50 transition-colors">
                    {canManage && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedReviewers.has(r.suggestionId)}
                          onChange={() => toggleSelect(r.suggestionId)}
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.affiliation || ''}</p>
                      {r.email && <p className="text-xs text-gray-400">{r.email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.reviewStatus} />
                      {r.reminderCount > 0 && (
                        <span className="text-xs text-gray-400 ml-1">({r.reminderCount} reminder{r.reminderCount !== 1 ? 's' : ''})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TokenStateBadge state={r.tokenState} expiresAt={r.tokenExpiresAt} firstAccessedAt={r.proposalFirstAccessedAt} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {lastAction ? formatDate(lastAction) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingNotes.value}
                            onChange={e => setEditingNotes({ ...editingNotes, value: e.target.value })}
                            className="w-32 px-2 py-1 text-xs border border-gray-300 rounded"
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveNotes(r.suggestionId, editingNotes.value);
                              if (e.key === 'Escape') setEditingNotes(null);
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => saveNotes(r.suggestionId, editingNotes.value)}
                            disabled={savingNotes}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Save
                          </button>
                        </div>
                      ) : canManage ? (
                        <button
                          onClick={() => setEditingNotes({ suggestionId: r.suggestionId, value: r.notes || '' })}
                          className="text-xs text-gray-500 hover:text-gray-700 max-w-[150px] truncate block"
                          title={r.notes || 'Click to add notes'}
                        >
                          {r.notes || <span className="italic text-gray-300">Add notes</span>}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500 max-w-[150px] truncate block" title={r.notes || ''}>
                          {r.notes || <span className="italic text-gray-300">—</span>}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Status dropdown */}
                          <StatusDropdown
                            currentStatus={r.reviewStatus}
                            onChange={(newStatus) => updateStatus(r.suggestionId, newStatus)}
                          />
                          {/* Upload review */}
                          {(r.reviewStatus === 'materials_sent' || r.reviewStatus === 'under_review') && (
                            <button
                              onClick={() => setUploadModalReviewer(r)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                              title="Staff upload (override)"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <span>Staff upload (override)</span>
                            </button>
                          )}
                          {/* Download received review from SharePoint via Graph. */}
                          {r.reviewSharePointFolder && (
                            <a
                              href={`/api/review-manager/download-review?suggestionId=${encodeURIComponent(r.suggestionId)}`}
                              className="p-1.5 text-green-600 hover:text-green-800 rounded-lg hover:bg-green-50"
                              title={`Download: ${r.reviewFilename || 'review'}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>
                          )}
                          {/* Magic-link actions menu */}
                          <TokenActionsMenu
                            reviewer={r}
                            onRegenerate={() => handleRegenerateToken(r.suggestionId)}
                            onRevoke={() => handleRevokeToken(r.suggestionId)}
                            onMarkReceivedNoFile={() => handleMarkReceivedNoFile(r.suggestionId)}
                            onRemove={() => handleRemoveReviewer(r)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {canManage && (
        <>
          <EmailModal
            isOpen={emailModalOpen}
            onClose={() => setEmailModalOpen(false)}
            reviewers={selectedList}
            proposalTitle={proposal.proposalTitle}
            requestId={proposal?.proposalId}
            settings={{
              ...settings,
              reviewDueDate: proposal.reviewDeadline,
            }}
            onEmailsSent={() => {
              setSelectedReviewers(new Set());
              if (onRefresh) onRefresh();
            }}
          />

          <UploadReviewModal
            isOpen={!!uploadModalReviewer}
            onClose={() => setUploadModalReviewer(null)}
            reviewer={uploadModalReviewer}
            onUploaded={handleUploadComplete}
          />
        </>
      )}
    </div>
  );
}

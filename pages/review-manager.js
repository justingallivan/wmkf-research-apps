import { useState, useEffect, useRef, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import HelpButton from '../shared/components/HelpButton';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ReviewFormFields from '../shared/components/external/ReviewFormFields';
import { useProfile } from '../shared/context/ProfileContext';

// ─── Status Pipeline ────────────────────────────────────────────────────────

const STATUS_PIPELINE = [
  { key: 'accepted', label: 'Accepted', color: 'bg-blue-100 text-blue-800' },
  { key: 'materials_sent', label: 'Materials Sent', color: 'bg-indigo-100 text-indigo-800' },
  { key: 'under_review', label: 'Under Review', color: 'bg-yellow-100 text-yellow-800' },
  { key: 'review_received', label: 'Review Received', color: 'bg-green-100 text-green-800' },
  { key: 'complete', label: 'Complete', color: 'bg-gray-100 text-gray-800' },
];

function getStatusInfo(status) {
  return STATUS_PIPELINE.find(s => s.key === status) || STATUS_PIPELINE[0];
}

// ─── Template Defaults ──────────────────────────────────────────────────────

const DEFAULT_TEMPLATES = {
  materials: {
    subject: 'Review Materials: {{proposalTitle}}',
    body: `{{greeting}},

Thank you for agreeing to review the proposal "{{proposalTitle}}" from {{piInstitution}}.

Please use your secure reviewer link to download the proposal materials and submit your completed review:
{{externalLink}}

This link is unique to you. We ask that you submit your review by {{reviewDueDate}}.

If you have any questions about the review process, please don't hesitate to reach out.

Thank you for your time and expertise.

{{signature}}`,
  },
  followup: {
    subject: 'Reminder: Review Due — {{proposalTitle}}',
    body: `{{greeting}},

This is a friendly reminder that your review of "{{proposalTitle}}" is due by {{reviewDueDate}}.

Your secure reviewer link (also in the original invitation):
{{externalLink}}

Please let us know if you need additional time or have any questions.

Thank you,

{{signature}}`,
  },
  thankyou: {
    subject: 'Thank You for Your Review — {{proposalTitle}}',
    body: `{{greeting}},

Thank you very much for completing your review of "{{proposalTitle}}". Your expertise and thoughtful evaluation are greatly appreciated and will be invaluable to the Foundation's decision-making process.

We will be in touch regarding the processing of your honorarium.

With gratitude,

{{signature}}`,
  },
};

const TEMPLATE_STORAGE_KEY = 'review_manager_templates';

// ─── Tab Component ──────────────────────────────────────────────────────────

function Tab({ label, active, onClick, icon, badge }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-6 py-3 font-medium text-sm
        border-b-2 transition-all duration-200
        ${active
          ? 'border-gray-900 text-gray-900 bg-gray-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }
      `}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">{badge}</span>
      )}
    </button>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
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

function TokenStateBadge({ state, expiresAt, firstAccessedAt }) {
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

function TokenActionsMenu({ reviewer, onRegenerate, onRevoke, onMarkReceivedNoFile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const isActive = reviewer.tokenState === 'active';
  const hasReview = !!(reviewer.reviewReceivedAt);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        title="Reviewer link actions"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 text-sm">
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
        </div>
      )}
    </div>
  );
}

// ─── Status Summary Chips ───────────────────────────────────────────────────

function StatusSummary({ statusSummary }) {
  if (!statusSummary || Object.keys(statusSummary).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_PIPELINE.map(s => {
        const count = statusSummary[s.key];
        if (!count) return null;
        return (
          <span key={s.key} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>
            {count} {s.label.toLowerCase()}
          </span>
        );
      })}
    </div>
  );
}

// ─── Email Modal ────────────────────────────────────────────────────────────

const EMAIL_FIELDS_STORAGE_KEY = 'review_manager_email_fields';
const ATTACHMENTS_STORAGE_KEY = 'review_manager_attachments';

function EmailModal({ isOpen, onClose, reviewers, proposalTitle, settings, onEmailsSent }) {
  const [templateType, setTemplateType] = useState('materials');
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [step, setStep] = useState('compose'); // compose | preview | sending | sent
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [drafts, setDrafts] = useState([]); // [{ suggestionId, candidateName, candidateEmail, requestNumber, subject, body, skipped? }]
  const [sentResults, setSentResults] = useState({ sent: [], failed: [], skipped: [] });
  const [error, setError] = useState(null);
  const [emailFields, setEmailFields] = useState({
    reviewDueDate: '',
    proposalSendDate: '',
    commitDate: '',
    // honorarium removed S199 — now a Dataverse ground-truth read server-side.
  });
  // Attachments are per-template-type so switching templates (e.g. Materials
  // → Thank-you) doesn't carry over the proposal PDF or other type-specific files.
  const [attachmentsByType, setAttachmentsByType] = useState({ materials: [], followup: [], thankyou: [] });
  const attachments = Array.isArray(attachmentsByType?.[templateType]) ? attachmentsByType[templateType] : [];
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

  // Reset transient state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('compose');
      setProgress({ current: 0, total: 0, message: '' });
      setDrafts([]);
      setSentResults({ sent: [], failed: [], skipped: [] });
      setError(null);
    }
  }, [isOpen]);

  // Load saved templates, email fields, and attachments from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setTemplates(prev => ({ ...prev, ...parsed }));
      }
    } catch (e) { /* ignore */ }
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

  const saveTemplate = useCallback(() => {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
      localStorage.setItem(EMAIL_FIELDS_STORAGE_KEY, JSON.stringify(emailFields));
      localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(attachmentsByType));
    } catch (e) { /* ignore */ }
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
              commitDate: emailFields.commitDate || '',
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
          attachmentUrls: attachments.map(a => a.url),
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
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Commit By Date</label>
                    <input
                      type="date"
                      value={emailFields.commitDate}
                      onChange={e => setEmailFields(prev => ({ ...prev, commitDate: e.target.value }))}
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

              {/* Attachments */}
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
                    'customField:proposalSendDate', 'customField:commitDate', 'customField:honorarium',
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
                >
                  Save Template
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

// ─── Cycle Overview Tab ─────────────────────────────────────────────────────

function CycleOverviewTab({ proposals, cycles, selectedCycleCode, onCycleChange, onSelectProposal, loading }) {
  const filteredProposals = selectedCycleCode === 'all'
    ? proposals
    : proposals.filter(p => p.grantCycleCode === selectedCycleCode);

  return (
    <div className="space-y-4">
      {/* Cycle selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Grant Cycle</label>
        <select
          value={selectedCycleCode}
          onChange={e => onCycleChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
        >
          <option value="all">All Cycles</option>
          {cycles.filter(c => c.shortCode).map(c => (
            <option key={c.shortCode} value={c.shortCode}>{c.name} ({c.shortCode})</option>
          ))}
        </select>
        {loading && (
          <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
        )}
      </div>

      {/* Proposals table */}
      {filteredProposals.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-2">No accepted reviewers found</p>
            <p className="text-gray-400 text-sm">
              Reviewers marked as &quot;accepted&quot; in the Reviewer Finder will appear here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proposal</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PI</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cycle</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewers</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProposals.map(p => (
                <tr key={p.proposalId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    {p.requestNumber && (
                      <p className="text-xs font-mono text-gray-400">#{p.requestNumber}</p>
                    )}
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.proposalTitle}</p>
                    {p.proposalInstitution && (
                      <p className="text-xs text-gray-500 mt-0.5">{p.proposalInstitution}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.proposalAuthors || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.grantCycleCode || '—'}</td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-gray-900">{p.reviewers.length}</td>
                  <td className="px-4 py-3">
                    <StatusSummary statusSummary={p.statusSummary} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onSelectProposal(p)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Proposal Detail Tab ────────────────────────────────────────────────────

function ProposalDetailTab({ proposal, proposals, onProposalChange, onRefresh, settings }) {
  const [selectedReviewers, setSelectedReviewers] = useState(new Set());
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [uploadModalReviewer, setUploadModalReviewer] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null); // { suggestionId, value }
  const [savingNotes, setSavingNotes] = useState(false);

  // Reset selection / notes when proposal changes
  useEffect(() => {
    setSelectedReviewers(new Set());
    setEditingNotes(null);
  }, [proposal?.proposalId]);

  if (!proposal) {
    return (
      <Card>
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg mb-2">Select a proposal</p>
          <p className="text-gray-400 text-sm">
            Choose a proposal from the dropdown above or click &quot;Manage&quot; on the Overview tab.
          </p>
        </div>
      </Card>
    );
  }

  const reviewers = proposal.reviewers || [];
  const selectedList = reviewers.filter(r => selectedReviewers.has(r.suggestionId));
  const allSelected = reviewers.length > 0 && selectedReviewers.size === reviewers.length;

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

  return (
    <div className="space-y-4">
      {/* Proposal Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Proposal</label>
        <select
          value={proposal.proposalId}
          onChange={e => {
            const p = proposals.find(x => x.proposalId === e.target.value);
            if (p) onProposalChange(p);
          }}
          className="flex-1 max-w-xl px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
        >
          {proposals.map(p => (
            <option key={p.proposalId} value={p.proposalId}>
              {p.proposalTitle} ({p.reviewers.length} reviewer{p.reviewers.length !== 1 ? 's' : ''})
            </option>
          ))}
        </select>
      </div>

      {/* Proposal Info */}
      <Card>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-gray-900">{proposal.proposalTitle}</h3>
            <p className="text-sm text-gray-600 mt-1">
              {proposal.proposalAuthors && <span>PI: {proposal.proposalAuthors}</span>}
              {proposal.proposalInstitution && <span> — {proposal.proposalInstitution}</span>}
            </p>
            {(proposal.cycleLabel || proposal.grantCycleCode) && (
              <p className="text-xs text-gray-500 mt-1">
                Cycle: {proposal.cycleLabel || proposal.grantCycleCode}
              </p>
            )}
          </div>
          <StatusSummary statusSummary={proposal.statusSummary} />
        </div>
      </Card>

      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {selectedReviewers.size > 0 ? `${selectedReviewers.size} selected` : `${reviewers.length} reviewer${reviewers.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedReviewers.size > 0 && (
            <Button onClick={() => setEmailModalOpen(true)}>
              Send Email ({selectedReviewers.size})
            </Button>
          )}
        </div>
      </div>

      {/* Reviewers table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Link</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Action</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reviewers.map(r => {
              const isEditing = editingNotes?.suggestionId === r.suggestionId;
              const lastAction = r.thankyouSentAt || r.reviewReceivedAt || r.reminderSentAt || r.materialsSentAt;

              return (
                <tr key={r.suggestionId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedReviewers.has(r.suggestionId)}
                      onChange={() => toggleSelect(r.suggestionId)}
                      className="rounded border-gray-300"
                    />
                  </td>
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
                    {isEditing ? (
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
                    ) : (
                      <button
                        onClick={() => setEditingNotes({ suggestionId: r.suggestionId, value: r.notes || '' })}
                        className="text-xs text-gray-500 hover:text-gray-700 max-w-[150px] truncate block"
                        title={r.notes || 'Click to add notes'}
                      >
                        {r.notes || <span className="italic text-gray-300">Add notes</span>}
                      </button>
                    )}
                  </td>
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
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                          title="Upload review"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
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
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <EmailModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reviewers={selectedList}
        proposalTitle={proposal.proposalTitle}
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
    </div>
  );
}

// ─── Status Advance Button ──────────────────────────────────────────────────

function StatusDropdown({ currentStatus, onChange }) {
  return (
    <select
      value={currentStatus}
      onChange={e => onChange(e.target.value)}
      className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white hover:border-gray-400 focus:ring-1 focus:ring-gray-400 focus:outline-none cursor-pointer"
    >
      {STATUS_PIPELINE.map(s => (
        <option key={s.key} value={s.key}>{s.label}</option>
      ))}
    </select>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

function ReviewManagerPage() {
  const { currentProfile } = useProfile();
  const profileId = currentProfile?.id || null;

  const [activeTab, setActiveTab] = useState('overview');
  const [proposals, setProposals] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [selectedCycleCode, setSelectedCycleCode] = useState('all');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ signature: '' });


  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('review_manager_settings');
      if (saved) setSettings(JSON.parse(saved));
    } catch (e) { /* ignore */ }
  }, []);

  // Load grant cycles
  useEffect(() => {
    const loadCycles = async () => {
      try {
        const res = await fetch('/api/reviewer-finder/grant-cycles');
        const data = await res.json();
        setCycles((data.cycles || []).filter(c => c.isActive !== false));
      } catch (err) {
        console.error('Failed to load grant cycles:', err);
      }
    };
    loadCycles();
  }, []);

  // Load reviewers
  const loadReviewers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCycleCode !== 'all') params.set('cycleCode', selectedCycleCode);

      const res = await fetch(`/api/review-manager/reviewers?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setProposals(data.proposals || []);
        // If we had a selected proposal, refresh it
        if (selectedProposal) {
          const updated = (data.proposals || []).find(p => p.proposalId === selectedProposal.proposalId);
          if (updated) setSelectedProposal(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load reviewers:', err);
    } finally {
      setLoading(false);
    }
    // Granular selectedProposal?.proposalId dep is intentional — only the id is
    // read; depending on the whole object would rebuild on unrelated field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleCode, profileId, selectedProposal?.proposalId]);

  // Reload reviewers only when the cycle filter changes. Adding loadReviewers
  // would also refetch on every proposal selection (its proposalId dep).
  useEffect(() => {
    loadReviewers();
  }, [selectedCycleCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    loadReviewers();
  };

  const handleSelectProposal = (proposal) => {
    setSelectedProposal(proposal);
    setActiveTab('detail');
  };

  const handleSettingsChange = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('review_manager_settings', JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };

  const totalReviewers = proposals.reduce((sum, p) => sum + p.reviewers.length, 0);

  return (
    <Layout title="Review Manager">
      <PageHeader title="Review Manager" icon="📋">
        <HelpButton appKey="review-manager" className="mt-3" />
      </PageHeader>

      <div className="py-8 space-y-6">
        {/* Settings bar */}
        <Card>
          <details className="group">
            <summary className="cursor-pointer flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Settings</span>
              <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Signature</label>
              <textarea
                value={settings.signature || ''}
                onChange={e => handleSettingsChange('signature', e.target.value)}
                placeholder="Your name and title"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-2">
                Emails are sent from your signed-in Microsoft account.
              </p>
            </div>
          </details>
        </Card>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <Tab
              label="Overview"
              icon="📊"
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              badge={totalReviewers}
            />
            <Tab
              label="Proposal Detail"
              icon="📄"
              active={activeTab === 'detail'}
              onClick={() => setActiveTab('detail')}
            />
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'overview' && (
            <CycleOverviewTab
              proposals={proposals}
              cycles={cycles}
              selectedCycleCode={selectedCycleCode}
              onCycleChange={setSelectedCycleCode}
              onSelectProposal={handleSelectProposal}
              loading={loading}
            />
          )}
          {activeTab === 'detail' && (
            <ProposalDetailTab
              proposal={selectedProposal}
              proposals={proposals}
              onProposalChange={setSelectedProposal}
              onRefresh={handleRefresh}
              settings={settings}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default function ReviewManagerGuard() {
  return (
    <RequireAppAccess appKey="review-manager">
      <ReviewManagerPage />
    </RequireAppAccess>
  );
}

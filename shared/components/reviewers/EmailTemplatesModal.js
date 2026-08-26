/**
 * EmailTemplatesModal — per-user editor for the reviewer email templates
 * (invitation, materials, follow-up, thank-you). Loads from / saves to Dataverse
 * via the shared store (email-template-store.js). This is the canonical place to
 * manage your default templates; the per-send composers (InviteEmailModal,
 * ReviewerManagePanel) seed their drafts from what's saved here.
 *
 * Props: { onClose }
 */

import { useState, useEffect } from 'react';
import {
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  loadEmailTemplates,
  loadAdminTemplateDefaults,
  saveEmailTemplates,
} from './email-template-store';
import { validateInvitationTemplateForSave } from '../../../lib/utils/invitation-link-validator';

const PLACEHOLDER_HINT = '{{greeting}} {{proposalTitle}} {{piInstitution}} {{externalLink}} {{reviewDueDate}} {{signature}}';
const INVITATION_TIMING_HINT = '{{respondBy}} {{proposalDelivery}} {{reviewDue}}';

export default function EmailTemplatesModal({ onClose }) {
  const [templates, setTemplates] = useState(null);
  const [adminDefaults, setAdminDefaults] = useState(null);
  const [active, setActive] = useState('invitation');
  const [status, setStatus] = useState('loading'); // loading | ready | saving | saved | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, defs] = await Promise.all([loadEmailTemplates(), loadAdminTemplateDefaults()]);
      if (!cancelled) { setTemplates(t); setAdminDefaults(defs); setStatus('ready'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = (field, value) =>
    setTemplates((prev) => ({ ...prev, [active]: { ...prev[active], [field]: value } }));

  // Reset to the org default (admin "Email Defaults" panel). Clearing the per-PD
  // override this way lets future admin edits flow through to this field again.
  const resetActiveToDefault = () =>
    setTemplates((prev) => ({ ...prev, [active]: { ...(adminDefaults?.[active] || { subject: '', body: '' }) } }));

  const handleSave = async () => {
    setError(null);
    if (!validateInvitationTemplateForSave(templates?.invitation).valid) {
      setStatus('error');
      setError('Invitation templates must include {{externalLink}} in the subject or body.');
      return;
    }
    setStatus('saving');
    const ok = await saveEmailTemplates(templates);
    if (ok) { setStatus('saved'); setTimeout(() => setStatus('ready'), 1500); }
    else { setStatus('error'); setError('Failed to save templates. Please try again.'); }
  };

  const t = templates?.[active];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="font-medium text-gray-900">My email templates</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {status === 'loading' || !templates ? (
            <p className="text-sm text-gray-500">Loading your templates…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-100 pb-3">
                {TEMPLATE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActive(type)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${active === type ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {TEMPLATE_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                  <input
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                    value={t.subject}
                    onChange={(e) => update('subject', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                  <textarea
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono"
                    rows={16}
                    value={t.body}
                    onChange={(e) => update('body', e.target.value)}
                  />
                </div>
                <p className="text-[11px] text-gray-400">
                  Placeholders: <span className="font-mono">{PLACEHOLDER_HINT}</span>
                  {active === 'invitation' && (
                    <> · timeline (this cycle): <span className="font-mono">{INVITATION_TIMING_HINT}</span> (dates are entered when you send)</>
                  )}
                </p>
                <button type="button" onClick={resetActiveToDefault} className="text-xs text-gray-500 underline">
                  Reset this template to the default
                </button>
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200">
          {status === 'saved' && <span className="text-sm text-green-700 mr-auto">Saved ✓</span>}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={status === 'loading' || status === 'saving' || !templates}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            {status === 'saving' ? 'Saving…' : 'Save templates'}
          </button>
        </div>
      </div>
    </div>
  );
}

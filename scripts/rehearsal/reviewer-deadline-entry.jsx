/** UI-only fixture: unknown fetches throw, all mail/date changes stay in memory. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReviewerDueDateEditor from '../../shared/components/reviewers/ReviewerDueDateEditor';
import { validateDeadlineTemplate } from '../../shared/config/reviewerDeadlineEmail';
import { REVIEWER_EXTENSION_SEED_BODY, REVIEWER_EXTENSION_SEED_SUBJECT } from '../../lib/seed/email-defaults/reviewer-actions';
let savedDefault = null;
let date = null;
let sends = 0;
let failOnce = false;
const shared = { subject: REVIEWER_EXTENSION_SEED_SUBJECT, body: REVIEWER_EXTENSION_SEED_BODY };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/api/review-manager/deadline-email-preferences') {
    if (!init.method || init.method === 'GET') return response({ ok: true, configured: savedDefault !== null, template: savedDefault ?? shared, shared });
    if (init.method === 'DELETE') savedDefault = null;
    else if (init.method === 'PUT') {
      const checked = validateDeadlineTemplate(body.template);
      if (!checked.valid) return response({ ok: false, reason: 'validation', errors: checked.errors }, 400);
      savedDefault = checked.value;
    } else throw new Error('Unexpected preference action');
    return response({ ok: true });
  }
  if (url.pathname === '/api/review-manager/review-due-extension' && init.method === 'POST') {
    if (body.action === 'preview') {
      const template = body.template ?? savedDefault ?? shared;
      const effective = body.operation === 'save' ? body.reviewDueDateOverride : body.operation === 'restore' ? '2099-09-01' : date || '2099-09-01';
      const replace = (text) => text.replaceAll('{{greeting}}', 'Dear Dr. Sample').replaceAll('{{reviewerName}}', 'Dr. Sample Reviewer').replaceAll('{{proposalTitle}}', 'Synthetic Telescope Study').replaceAll('{{reviewDueDate}}', effective).replaceAll('{{signature}}', 'Sample Program Director');
      return response({ ok: true, preview: { template, subject: replace(template.subject), bodyText: replace(template.body), from: 'pd@example.test', to: 'reviewer@example.test', cc: body.cc || [], proof: 'ui-only-proof', effectiveReviewDeadline: effective } });
    }
    const writes = ['save', 'restore'].includes(body.action);
    if (writes) date = body.action === 'restore' ? null : body.reviewDueDateOverride;
    if (failOnce) { failOnce = false; return response({ ok: false, saved: writes, notified: false, reason: 'send_failed', retryable: true, retryProof: 'ui-only-retry' }, 502); }
    sends += 1;
    return response({ ok: true, saved: writes, notified: true });
  }
  throw new Error(`Blocked unexpected fixture request: ${url.pathname}`);
};
function App() {
  const [pd, setPd] = useState(true);
  const [revision, setRevision] = useState(0);
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Reviewer deadline walkthrough</h1>
    <p className="text-sm text-gray-600">Synthetic UI fixture. No email, API or Dataverse access.</p>
    <label className="block text-sm"><input type="checkbox" checked={pd} onChange={(e) => setPd(e.target.checked)} /> Acting as assigned PD</label>
    <button className="rounded border px-3 py-2 text-sm" onClick={() => { failOnce = true; }}>Make next email fail</button>
    <ReviewerDueDateEditor key={revision} suggestionId="11111111-1111-4111-8111-111111111111" reviewerName="Dr. Sample Reviewer" defaultDate="2099-09-01" overrideDate={date} effectiveDate={date || '2099-09-01'} canManage={pd} assignedPdContext={pd ? 'assigned' : 'other'} onSaved={() => setRevision((v) => v + 1)} />
    <p className="text-sm text-gray-600">Captured sends: {sends}</p>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);

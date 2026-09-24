import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RespondReminderModal from '../../shared/components/reviewers/RespondReminderModal';
import {
  REVIEWER_REMINDER_RESPOND_BY_SEED_SUBJECT,
  REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_SUBJECT,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
} from '../../lib/seed/email-defaults/reviewer-reminders';
import {
  buildRespondReminderBodyText,
  renderReviewDueReminder,
} from '../../lib/external/reviewer-reminder-email';
import { validateRehearsalTemplate } from './reviewer-reminder-validation';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const PD_ID = '33333333-3333-4333-8333-333333333333';
const SUPERUSER_ID = '44444444-4444-4444-8444-444444444444';
const PD_EMAIL = 'program.director@example.test';
const REVIEWER_EMAIL = 'reviewer@example.test';
const reviewerName = 'Dr. Sample Reviewer';
const title = 'Synthetic Proposal for Staff Rehearsal';
const signatureBlock = { name: 'Sample Program Director', email: PD_EMAIL, signature: 'Sample Program Director\nW. M. Keck Foundation' };
const shared = {
  respond: { subject: REVIEWER_REMINDER_RESPOND_BY_SEED_SUBJECT, body: REVIEWER_REMINDER_RESPOND_BY_SEED_BODY },
  reviewdue: { subject: REVIEWER_REMINDER_REVIEW_DUE_SEED_SUBJECT, body: REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY },
};
const saved = new Map();
const proofs = new Map();
const captures = [];
let actorId = PD_ID;
let nextSendUncertain = false;
let proofNumber = 0;
const notify = () => window.dispatchEvent(new Event('rehearsal-update'));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const keyFor = (owner, kind) => `${owner}:${kind}`;

// requestEnvelope resolves fetch at call time, so no real API request can leave
// this standalone page. The static server also refuses every /api path.
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/api/review-manager/reminder-email-preferences') {
    const kind = method === 'GET' ? url.searchParams.get('kind') : body.kind;
    if (!Object.hasOwn(shared, kind)) return response({ ok: false, reason: 'invalid_kind' }, 400);
    const key = keyFor(actorId, kind);
    if (method === 'GET') return response({ ok: true, ownSystemId: actorId, configured: saved.has(key), shared: shared[kind], template: saved.get(key) || shared[kind] });
    if (method === 'PUT') {
      const checked = validateRehearsalTemplate(kind, body.template);
      if (!checked.valid) return response({ ok: false, reason: 'validation', errors: checked.errors }, 400);
      saved.set(key, checked.value);
      notify();
      return response({ ok: true });
    }
    if (method === 'DELETE') {
      saved.delete(key);
      notify();
      return response({ ok: true });
    }
  }
  if (url.pathname === '/api/review-manager/send-review-reminder' && method === 'POST') {
    const kind = body.kind;
    if (!Object.hasOwn(shared, kind) || body.requestId !== REQUEST_ID || body.suggestionId !== SUGGESTION_ID) {
      return response({ ok: false, reason: 'not_found' }, 404);
    }
    if (body.action === 'preview') {
      const template = body.template || saved.get(keyFor(PD_ID, kind)) || shared[kind];
      const checked = validateRehearsalTemplate(kind, template);
      if (!checked.valid) return response({ ok: false, reason: 'invalid_preview', errors: checked.errors }, 400);
      const rendered = kind === 'respond'
        ? { subject: template.subject, bodyText: buildRespondReminderBodyText({ bodyTemplate: template.body, reviewerName, title, signatureBlock }) }
        : renderReviewDueReminder({ subjectTemplate: template.subject, bodyTemplate: template.body, reviewerName, title, reviewDueDate: '2026-10-15', signatureBlock });
      const proof = `synthetic-proof-${++proofNumber}`;
      proofs.set(proof, { kind, template: { ...template }, actorId });
      return response({ ok: true, draft: {
        ...rendered,
        previewHtml: rendered.html || null,
        template,
        proof,
        senderId: PD_ID,
        from: PD_EMAIL,
        to: REVIEWER_EMAIL,
        name: reviewerName,
      } });
    }
    if (body.action === 'send') {
      const valid = validateRehearsalTemplate(kind, body.template);
      if (!valid.valid) return response({ ok: false, reason: 'invalid_preview', errors: valid.errors }, 400);
      const checked = proofs.get(body.proof);
      if (!checked || checked.kind !== kind || checked.actorId !== actorId || JSON.stringify(checked.template) !== JSON.stringify(body.template)) {
        return response({ ok: false, reason: 'preview_stale' }, 409);
      }
      proofs.delete(body.proof);
      if (nextSendUncertain) {
        nextSendUncertain = false;
        notify();
        return response({ ok: false, reason: 'send_unconfirmed' }, 202);
      }
      captures.push({ kind, subject: body.template.subject, from: PD_EMAIL, to: REVIEWER_EMAIL });
      notify();
      return response({ ok: true });
    }
  }
  throw new Error(`Rehearsal blocked an unexpected request: ${method} ${url.pathname}`);
};

function App() {
  const [role, setRole] = useState('pd');
  const [kind, setKind] = useState('respond');
  const [open, setOpen] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => {
      setRevision((value) => value + 1);
      setUncertain(nextSendUncertain);
    };
    window.addEventListener('rehearsal-update', update);
    return () => window.removeEventListener('rehearsal-update', update);
  }, []);
  const chooseRole = (value) => {
    actorId = value === 'pd' ? PD_ID : SUPERUSER_ID;
    setRole(value);
    setOpen(false);
  };
  const chooseKind = (value) => { setKind(value); setOpen(false); };
  const chooseUncertain = (value) => { nextSendUncertain = value; setUncertain(value); };

  return <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <strong>Synthetic staff rehearsal.</strong> This page uses the real reminder composer and seeded Admin wording with in-memory API responses. Send captures a local receipt; it cannot send email or change Dataverse.
    </div>
    <h1 className="text-3xl font-semibold">Reviewer reminder walkthrough</h1>
    <ol className="list-decimal pl-6 space-y-1 text-sm text-gray-700">
      <li>Open each reminder kind, edit the wording, then refresh the preview before sending.</li>
      <li>Save a PD default, close and reopen, then try a one-send edit without saving.</li>
      <li>Switch to Superuser: the message still uses the PD mailbox and copy, while Save changes only the superuser’s own default.</li>
      <li>Enable an uncertain result for the next send and confirm Send stays disabled after Refresh.</li>
    </ol>
    <div className="flex flex-wrap gap-4 items-end">
      <label className="text-sm">Acting as
        <select aria-label="Acting as" value={role} onChange={(event) => chooseRole(event.target.value)} className="block mt-1 rounded border px-2 py-1">
          <option value="pd">Program Director</option><option value="superuser">Superuser</option>
        </select>
      </label>
      <label className="text-sm">Reminder kind
        <select aria-label="Reminder kind" value={kind} onChange={(event) => chooseKind(event.target.value)} className="block mt-1 rounded border px-2 py-1">
          <option value="respond">Respond by</option><option value="reviewdue">Review due</option>
        </select>
      </label>
      <button type="button" onClick={() => setOpen(true)} className="rounded bg-blue-700 px-3 py-1.5 text-white">Open composer</button>
    </div>
    <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={uncertain} onChange={(event) => chooseUncertain(event.target.checked)} /> Make next Send result uncertain</label>
    <div className="rounded border bg-white p-4 text-sm space-y-1">
      <p>PD saved default for this kind: <strong>{saved.has(keyFor(PD_ID, kind)) ? 'Yes' : 'No — Admin copy'}</strong></p>
      <p>Superuser saved default for this kind: <strong>{saved.has(keyFor(SUPERUSER_ID, kind)) ? 'Yes' : 'No'}</strong></p>
      <p>Captured sends: <strong>{captures.length}</strong></p>
      {captures.length > 0 && <p>Most recent: {captures.at(-1).subject} → {captures.at(-1).to}</p>}
    </div>
    {open && <RespondReminderModal key={`${role}:${kind}`} requestId={REQUEST_ID} candidate={{ suggestionId: SUGGESTION_ID, name: reviewerName }} kind={kind} onClose={() => setOpen(false)} onSent={notify} />}
    <span className="hidden">{revision}</span>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);

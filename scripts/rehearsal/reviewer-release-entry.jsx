import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReleaseEmailModal from '../../shared/components/reviewers/ReleaseEmailModal';
import AcceptedReviewerReleaseModal from '../../shared/components/reviewers/AcceptedReviewerReleaseModal';
import { buildWithdrawSufficientBodyText } from '../../lib/external/reviewer-withdraw-email';
import { validateRehearsalReleaseTemplate } from './reviewer-release-validation';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PENDING_IDS = ['22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555'];
const ACCEPTED_ID = '66666666-6666-4666-8666-666666666666';
const PD_ID = '33333333-3333-4333-8333-333333333333';
const SUPERUSER_ID = '44444444-4444-4444-8444-444444444444';
const PD_EMAIL = 'program.director@example.test';
const title = 'Synthetic Proposal for Staff Rehearsal';
const signatureBlock = { name: 'Sample Program Director', email: PD_EMAIL, signature: 'Sample Program Director\nW. M. Keck Foundation' };
const reviewers = {
  [PENDING_IDS[0]]: { name: 'Dr. Avery Sample', email: 'avery.sample@example.test' },
  [PENDING_IDS[1]]: { name: 'Prof. Jordan Example', email: 'jordan.example@example.test' },
  [ACCEPTED_ID]: { name: 'Dr. Casey Placeholder', email: 'casey.placeholder@example.test' },
};
// Synthetic stand-ins for the shared Admin wording (the real copy lives in Admin).
const shared = {
  withdraw: {
    subject: 'Thank you — W. M. Keck Foundation review',
    body: '{{greeting}},\n\nThank you for considering our request to review {{proposalClause}}. We have now secured the reviews we need, so we no longer need your help with this proposal.\n\n{{signature}}',
  },
  release: {
    subject: 'Thank you for agreeing to review',
    body: '{{greeting}},\n\nThank you for agreeing to review {{proposalClause}}. We have received enough reviews and are releasing you from the assignment.\n\n{{signature}}',
  },
};
const saved = new Map();
const captures = [];
const state = { actorId: PD_ID, pdUnreadable: false, slowSave: false, colleagueNote: false };
let serverNote = 'Reviewer agreed on 2026-10-01.';
const notify = () => window.dispatchEvent(new Event('rehearsal-update'));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const keyFor = (owner, kind) => `${owner}:${kind}`;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function senderWording(kind) {
  if (state.pdUnreadable) return { template: shared[kind], templateSource: 'shared_fallback', templateNotice: 'preference_unavailable' };
  const own = saved.get(keyFor(PD_ID, kind));
  return own ? { template: own, templateSource: 'personal' } : { template: shared[kind], templateSource: 'shared' };
}

function draftFor(id, kind) {
  const wording = senderWording(kind);
  const reviewer = reviewers[id];
  return {
    suggestionId: id,
    status: 'ok',
    name: reviewer.name,
    to: reviewer.email,
    from: PD_EMAIL,
    senderId: PD_ID,
    subject: wording.template.subject,
    bodyText: buildWithdrawSufficientBodyText({ bodyTemplate: wording.template.body, reviewerName: reviewer.name, title, signatureBlock }),
    templateSource: wording.templateSource,
    ...(wording.templateNotice ? { templateNotice: wording.templateNotice } : {}),
  };
}

// requestEnvelope resolves fetch at call time, so no real API request can leave
// this standalone page. The static server also refuses every /api path.
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/api/review-manager/release-email-preferences') {
    const kind = method === 'GET' ? url.searchParams.get('kind') : body.kind;
    if (!Object.hasOwn(shared, kind)) return response({ ok: false, reason: 'invalid_kind' }, 400);
    const key = keyFor(state.actorId, kind);
    if (method === 'GET') {
      return response({ ok: true, kind, ownSystemId: state.actorId, shared: shared[kind], configured: saved.has(key), template: saved.get(key) || shared[kind] });
    }
    if (state.slowSave) await wait(3000);
    if (method === 'PUT') {
      const checked = validateRehearsalReleaseTemplate(kind, body.template);
      if (!checked.valid) return response({ ok: false, reason: 'validation', errors: checked.errors }, 400);
      saved.set(key, checked.value);
      notify();
      return response({ ok: true, kind, template: checked.value });
    }
    if (method === 'DELETE') {
      saved.delete(key);
      notify();
      return response({ ok: true, kind });
    }
  }
  if (url.pathname === '/api/review-manager/render-withdraw-emails' && method === 'POST') {
    return response({ ok: true, drafts: body.suggestionIds.map((id) => draftFor(id, 'withdraw')) });
  }
  if (url.pathname === '/api/review-manager/withdraw-sufficient' && method === 'POST') {
    const results = body.suggestionIds.map((id) => {
      if (!body.sendEmail) return { suggestionId: id, status: 'withdrawn_no_email_by_reason' };
      const override = body.overrides?.[id];
      captures.push({ kind: 'Pending withdrawal', to: reviewers[id].email, subject: override.subject, bodyText: override.bodyText });
      return { suggestionId: id, status: 'withdrawn_emailed' };
    });
    notify();
    return response({ ok: true, withdrawn: results.length, results });
  }
  if (url.pathname === '/api/review-manager/terminal-transition' && method === 'POST' && body.preview) {
    return response({ ok: true, drafts: [{ ...draftFor(ACCEPTED_ID, 'release'), expectedNotes: serverNote, existingNotes: serverNote, honorariumDisposition: 'none' }] });
  }
  throw new Error(`Rehearsal blocked an unexpected request: ${method} ${url.pathname}`);
};

// The accepted dialog hands its release to the parent (as ReviewerManagePanel
// does); this stands in for the server's expectedNotes check.
async function releaseAccepted(payload) {
  const override = payload.overrides[ACCEPTED_ID];
  if (state.colleagueNote) serverNote = 'Colleague: reviewer asked for an extension.';
  if (override.expectedNotes !== serverNote) {
    notify();
    return { ok: false, error: 'notes_changed' };
  }
  serverNote = payload.internalNotes[ACCEPTED_ID];
  if (payload.sendEmail) captures.push({ kind: 'Accepted release', to: reviewers[ACCEPTED_ID].email, subject: override.subject, bodyText: override.bodyText });
  notify();
  return { ok: true, data: { transitioned: 1, results: [{ suggestionId: ACCEPTED_ID, status: payload.sendEmail ? 'released_emailed' : 'released_no_email_by_choice' }] } };
}

function Toggle({ label, field, onChange }) {
  const [checked, setChecked] = useState(state[field]);
  return <label className="flex gap-2 items-center text-sm">
    <input type="checkbox" checked={checked} onChange={(event) => { state[field] = event.target.checked; setChecked(event.target.checked); onChange?.(); }} /> {label}
  </label>;
}

function App() {
  const [role, setRole] = useState('pd');
  const [open, setOpen] = useState(null);
  const [, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('rehearsal-update', update);
    return () => window.removeEventListener('rehearsal-update', update);
  }, []);
  const chooseRole = (value) => {
    state.actorId = value === 'pd' ? PD_ID : SUPERUSER_ID;
    setRole(value);
    setOpen(null);
  };
  const savedLabel = (owner, kind) => (saved.has(keyFor(owner, kind)) ? `Yes — “${saved.get(keyFor(owner, kind)).subject}”` : 'No (Admin wording)');

  return <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <strong>Synthetic staff rehearsal.</strong> This page runs the real release dialogs with made-up reviewers, synthetic Admin wording and in-memory API responses. Release only records a local receipt below; it cannot send email or change Dataverse. Reload the page to reset everything.
    </div>
    <h1 className="text-3xl font-semibold">Release courtesy email walkthrough</h1>
    <ol className="list-decimal pl-6 space-y-1 text-sm text-gray-700">
      <li>As the Program Director, open <em>Pending withdrawal</em>, choose “No longer needed”, open “Your default wording”, change it and save. Both emails re-render with your wording.</li>
      <li>Edit one email, then save your default again: you are asked before your edit is replaced. Release, and check the receipt shows the edited text and nothing new was saved as your default.</li>
      <li>Open <em>Accepted release</em>, type an internal note, save new default wording: the email updates and your note stays.</li>
      <li>Switch to Superuser: emails still start from the PD’s wording; saving changes only the superuser’s default and does not re-render.</li>
      <li>Turn on “PD’s saved wording is unreadable”: dialogs show a notice and start from the Admin wording, and you can still send.</li>
      <li>Turn on “Slow save”: while saving, the email fields and Release are locked.</li>
      <li>Turn on “A colleague changes the note”, then release an accepted reviewer: the release is refused with the “notes changed” message.</li>
    </ol>
    <div className="flex flex-wrap gap-4 items-end">
      <label className="text-sm">Acting as
        <select aria-label="Acting as" value={role} onChange={(event) => chooseRole(event.target.value)} className="block mt-1 rounded border px-2 py-1">
          <option value="pd">Program Director (sender)</option><option value="superuser">Superuser</option>
        </select>
      </label>
      <button type="button" onClick={() => setOpen('withdraw')} className="rounded bg-blue-700 px-3 py-1.5 text-white">Pending withdrawal (2 reviewers)</button>
      <button type="button" onClick={() => setOpen('release')} className="rounded bg-blue-700 px-3 py-1.5 text-white">Accepted release (1 reviewer)</button>
    </div>
    <div className="space-y-1">
      <Toggle label="PD’s saved wording is unreadable" field="pdUnreadable" />
      <Toggle label="Slow save (3 seconds)" field="slowSave" />
      <Toggle label="A colleague changes the internal note before release" field="colleagueNote" />
    </div>
    <div className="rounded border bg-white p-4 text-sm space-y-1">
      <p>PD default — withdrawal: <strong>{savedLabel(PD_ID, 'withdraw')}</strong>; accepted release: <strong>{savedLabel(PD_ID, 'release')}</strong></p>
      <p>Superuser default — withdrawal: <strong>{savedLabel(SUPERUSER_ID, 'withdraw')}</strong>; accepted release: <strong>{savedLabel(SUPERUSER_ID, 'release')}</strong></p>
      <p>Internal note on the accepted reviewer: <strong>{serverNote || '(none)'}</strong></p>
      <p>Emails “sent”: <strong>{captures.length}</strong></p>
      {captures.slice().reverse().map((capture, index) => <details key={index} className="rounded border p-2">
        <summary>{capture.kind}: “{capture.subject}” → {capture.to}</summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs">{capture.bodyText}</pre>
      </details>)}
    </div>
    {open === 'withdraw' && <ReleaseEmailModal key={`withdraw:${role}`} requestId={REQUEST_ID} suggestionIds={PENDING_IDS} onClose={() => setOpen(null)} onReleased={notify} />}
    {open === 'release' && <AcceptedReviewerReleaseModal key={`release:${role}`} reviewer={{ suggestionId: ACCEPTED_ID, name: reviewers[ACCEPTED_ID].name }} requestId={REQUEST_ID} onClose={() => setOpen(null)} onRelease={releaseAccepted} />}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);

import { useMemo, useState } from 'react';
import MaterialsEmailModal from '../../shared/components/meeting-tracker/MaterialsEmailModal';
import ProfileContext from '../../shared/context/ProfileContext';
import {
  SITE_VISIT_MATERIALS_INVITE_SEED_BODY,
  SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT,
  SITE_VISIT_MATERIALS_REMINDER_SEED_BODY,
  SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT,
} from '../../lib/seed/email-defaults/site-visit-materials';

const SHARED_TEMPLATES = {
  invitation: { subject: SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT, body: SITE_VISIT_MATERIALS_INVITE_SEED_BODY },
  reminder: { subject: SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT, body: SITE_VISIT_MATERIALS_REMINDER_SEED_BODY },
};

const SAMPLE_RECIPIENT = { name: 'Sample recipient', email: 'sample-recipient@example.invalid' };
const SAMPLE_LIAISON = { name: 'Sample liaison', email: 'sample-liaison@example.invalid' };

export function createRehearsalTransport() {
  const overrides = {};

  return async (url, options = {}) => {
    const method = options.method || 'GET';
    const parsed = new URL(url, 'https://materials-rehearsal.invalid');
    const kind = parsed.searchParams.get('kind') || options.body?.kind || 'invitation';
    const body = options.body || {};

    if (parsed.pathname === '/api/meeting-tracker/materials-email-preferences') {
      if (method === 'GET') {
        const shared = { ...SHARED_TEMPLATES[kind] };
        return { ok: true, status: 200, data: { template: { ...(overrides[kind] || shared) }, shared } };
      }
      if (method === 'PUT') {
        overrides[kind] = { ...body.template };
        return { ok: true, status: 200, data: { ok: true, template: { ...overrides[kind] } } };
      }
      if (method === 'DELETE') {
        delete overrides[kind];
        return { ok: true, status: 200, data: { ok: true } };
      }
    }

    if (parsed.pathname.startsWith('/api/meeting-tracker/visits/') && method === 'POST') {
      if (body.action === 'preview') {
        const isReminder = body.sendAction === 'remind';
        const requiredToken = isReminder ? '{{missingItems}}' : '{{checklist}}';
        if (!String(body.emailTemplate?.body || '').includes(requiredToken)) {
          return { ok: false, status: 400, data: { error: `Keep ${requiredToken} in the sample message.` } };
        }
        const allowedTokens = new Set(['checklist', 'dueDate', 'institution', 'liaisonFullName', 'missingItems', 'missingItemsGrammar', 'piLastName', 'programCoordinatorName', 'proposalTitle', 'signature', 'uploadLink', 'visitDate']);
        const unknownToken = String(body.emailTemplate?.body || '').match(/\{\{(\w+)\}\}/g)?.find((token) => !allowedTokens.has(token.slice(2, -2)));
        if (unknownToken) return { ok: false, status: 400, data: { error: `Unsupported sample placeholder ${unknownToken}.` } };
        const values = {
          institution: 'Sample institution',
          proposalTitle: 'Sample proposal',
          piLastName: 'Doe',
          liaisonFullName: 'Sample liaison',
          programCoordinatorName: 'Sample program coordinator',
          visitDate: 'October 3, 2030',
          dueDate: 'October 1, 2030',
          checklist: '  - Sample budget\n  - Sample project plan',
          missingItems: '  - Sample missing item',
          missingItemsGrammar: 'item is',
          uploadLink: '[secure upload link appears at send time]',
          signature: 'Materials team',
        };
        const bodyText = String(body.emailTemplate?.body || '').replace(/\{\{(\w+)\}\}/g, (match, key) => values[key] || match);
        const subject = String(body.emailTemplate?.subject || 'Sample materials email').replace(/\{\{(\w+)\}\}/g, (match, key) => values[key] || match);
        return {
          ok: true,
          status: 200,
          data: {
            proof: `rehearsal-proof-${body.sendAction}`,
            subject,
            bodyText,
            recipients: [SAMPLE_RECIPIENT],
            ccRecipients: [SAMPLE_LIAISON],
            fromEmail: 'materials-rehearsal@example.invalid',
            secureLinkPlaceholder: true,
            missingItems: isReminder ? ['Sample missing item'] : undefined,
          },
        };
      }
      if (!body.proof || body.proof !== `rehearsal-proof-${body.action}`) {
        return { ok: false, status: 409, data: { error: 'Refresh the sample preview before sending.' } };
      }
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          invitationSent: body.action === 'create' ? true : undefined,
          collection: { id: `rehearsal-collection-${body.action}` },
        },
      };
    }

    return { ok: false, status: 404, data: { error: 'Unsupported rehearsal request.' } };
  };
}

export async function getServerSideProps() {
  if (process.env.NODE_ENV !== 'development' && process.env.VERCEL_ENV !== 'preview') return { notFound: true };
  return { props: { rehearsalEnabled: true } };
}

export default function MaterialsEmailRehearsalPage({ rehearsalEnabled }) {
  const [action, setAction] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const transport = useMemo(() => createRehearsalTransport(), []);

  if (!rehearsalEnabled) return null;

  return (
    <ProfileContext.Provider value={{ profileId: 'materials-rehearsal', currentProfile: { id: 'materials-rehearsal' } }}>
      <main className="min-h-screen bg-gray-50 p-6 text-gray-900">
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preview rehearsal</p>
          <h1 className="mt-1 text-2xl font-semibold">Materials email rehearsal</h1>
          <p className="mt-2 text-sm text-gray-700">Try the email dialogs with sample recipients and content. No emails are sent, and your real requests and saved defaults are unchanged.</p>
          <div role="note" className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm">Sample-only mode. Any saved default and send result lasts only until this page is refreshed.</div>
          <div className="mt-6 flex flex-wrap gap-3" aria-label="Email rehearsal actions">
            {['create', 'invite', 'remind'].map((choice) => (
              <button key={choice} type="button" onClick={() => { setOutcome(null); setAction(choice); }} className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
                {choice === 'create' ? 'First invitation' : choice === 'invite' ? 'Resend invitation' : 'Reminder'}
              </button>
            ))}
          </div>
          {outcome && <p role="status" className="mt-4 text-sm">Last rehearsal result: {outcome}</p>}
        </div>
        {action && <MaterialsEmailModal key={action} requestId="materials-rehearsal-request" action={action} requestEnvelope={transport} notice="Sample-only rehearsal. Send simulates success; no email is sent." onClose={() => setAction(null)} onSent={(result) => setOutcome(result?.outcome || 'uncertain')} />}
      </main>
    </ProfileContext.Provider>
  );
}

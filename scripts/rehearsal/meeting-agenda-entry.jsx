/** Synthetic component rehearsal: no application/server/provider transport. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import SessionAgendaPanel from '../../shared/components/meeting-tracker/SessionAgendaPanel';
import { validateAgendaTemplate } from '../../shared/config/agendaEmail';
const sessionId = '11111111-1111-4111-8111-111111111111';
const shared = { subject: 'Pre-discussion agenda — {{sessionDate}}', body: 'Please review the agenda for {{sessionDate}}.' };
let saved = null;
let preview = null;
const defaults = () => ({ subject: (saved || shared).subject, message: (saved || shared).body, source: saved ? 'personal' : 'shared', personalStatus: saved ? 'configured' : 'absent', sharedStatus: 'available' });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('External network denied');
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/api/meeting-tracker/agenda-email-preferences') {
    if (init.method === 'PUT') { const checked = validateAgendaTemplate(body.template); if (!checked.valid) return response({ reason: 'validation' }, 400); saved = checked.value; }
    if (init.method === 'DELETE') saved = null;
    return response({ ok: true, configured: saved !== null, template: saved || shared, shared, defaults: defaults() });
  }
  if (url.pathname === `/api/meeting-tracker/sessions/${sessionId}/agenda`) {
    if (init.method === 'POST') {
      preview = { operationId: body.operationId, to: body.to.split(',').map((x) => x.trim()), cc: body.cc ? body.cc.split(',').map((x) => x.trim()) : [], subject: body.subject.replaceAll('{{sessionDate}}', 'Monday, October 26'), bodyText: `${body.bodyText.replaceAll('{{sessionDate}}', 'Monday, October 26')}\n\nPre-discussion: Monday, October 26, 2026, 9:00 AM–10:00 AM PDT.\n\nAgenda\n\n9:00 AM–9:15 AM · #TEST · Synthetic proposal · Lead PD: Alex Staff`, transportAccepted: false };
      return response({ success: true, agenda: preview });
    }
    if (init.method === 'PATCH') { preview = { ...preview, transportAccepted: true, sentAt: new Date().toISOString() }; return response({ success: true, agenda: preview }); }
    return response({ defaults: defaults(), lastAgenda: preview?.transportAccepted ? preview : null });
  }
  throw new Error(`Unexpected rehearsal request ${url.pathname}`);
};
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-semibold">Synthetic pre-discussion session</h1><p className="mt-2 text-gray-600">Local component rehearsal — no real mail or data changes.</p><SessionAgendaPanel sessionId={sessionId} session={{ sessionId, scheduledStartIso: '2026-10-26T16:00:00Z', scheduledEndIso: '2026-10-26T17:00:00Z', ianaTimeZone: 'America/Los_Angeles', attendees: [{ name: 'Alex Staff', email: 'alex@example.org' }] }} slots={[]} recipients={{ staff: [], board: [] }} /></main>);

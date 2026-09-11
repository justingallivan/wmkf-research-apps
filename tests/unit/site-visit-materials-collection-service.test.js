/** @jest-environment node */
import {
  canonicalFilename,
  confirmMaterialsReady,
  createMaterialsCollection,
  getMaterialsCollection,
  invitationBodyText,
  matchReceivedFiles,
  remindMaterialsContributors,
  waiveMaterialsItem,
} from '../../lib/services/site-visit-materials/collection-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-15T17:00:00Z');

const request = () => ({
  akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_title: 'The Secret History of Our Sun',
  wmkf_meetingdate: '2026-12-11', akoya_requeststatus: 100000001, wmkf_triagestatus: 100000000,
  _akoya_applicantid_value_formatted: 'Franklin Cat University',
});
// Wed 2026-10-07 09:00 PDT → due Mon 2026-10-05, closes 2026-10-14T19:00Z + 7d.
const visit = () => ({ activityid: VISIT_ID, scheduledstart: '2026-10-07T16:00:00Z', scheduledend: '2026-10-07T19:00:00Z', wmkf_ianatimezone: 'America/Los_Angeles' });

function registryRow(overrides) {
  return {
    wmkf_requestdocumentid: overrides.id, _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000,
    wmkf_sharepointitemid: 'item', wmkf_filename: overrides.filename, modifiedon: overrides.modifiedon || '2026-10-01T00:00:00Z', wmkf_sharepointversionid: '1.0',
    ...overrides,
  };
}

function deps(overrides = {}) {
  let stored = null;
  const d = {
    schemaReady: () => true,
    getRequest: jest.fn(async () => request()),
    findActiveSiteVisit: jest.fn(async () => visit()),
    resolveRecipients: jest.fn(async () => ({ pi: { name: 'Pat Investigator', email: 'PI@example.edu', hasEmail: true }, liaison: { name: 'Lee Liaison', email: 'liaison@example.edu', hasEmail: true } })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getOpenCollection: jest.fn(async () => stored),
    getLatestCollection: jest.fn(async () => stored),
    insertCollection: jest.fn(async (row) => { stored = { id: row.id, request_id: row.requestId, site_visit_activity_id: row.siteVisitActivityId, status: 'open', due_at: row.dueAt, closes_at: row.closesAt, checklist: row.checklist, contacts: row.contacts, jti: row.jti, token_digest: row.tokenDigest, token_ciphertext: row.tokenCiphertext, created_by: row.createdBy, reminder_count: 0, created_at: NOW }; return stored; }),
    recordInvitation: jest.fn(async (id, emailId) => { stored = { ...stored, invited_at: NOW, invitation_email_id: emailId }; return stored; }),
    recordReminder: jest.fn(async (id, emailId) => { stored = { ...stored, last_reminder_at: NOW, last_reminder_email_id: emailId, reminder_count: stored.reminder_count + 1 }; return stored; }),
    updateChecklist: jest.fn(async (id, checklist) => { stored = { ...stored, checklist }; return stored; }),
    markReady: jest.fn(async (id, actor) => { if (stored.status !== 'open') return null; stored = { ...stored, status: 'ready', ready_confirmed_at: NOW, ready_confirmed_by: actor }; return stored; }),
    reopenFromReady: jest.fn(),
    mint: jest.fn(async ({ subject, audience, ops, expiresAt }) => ({ jwt: `jwt-${subject}-${audience}-${ops.join(',')}-${expiresAt.toISOString()}`, jti: 'jti-1', hash: 'a'.repeat(64) })),
    seal: jest.fn((jwt) => `sealed:${jwt}`),
    unseal: jest.fn((sealed) => sealed.replace(/^sealed:/, '')),
    randomUUID: jest.fn(() => '44444444-4444-4444-8444-444444444444'),
    now: () => NOW,
    sendEmail: jest.fn(async () => '55555555-5555-4555-8555-555555555555'),
    buildContributorUrl: jest.fn((jwt) => `https://apps.test/external/materials/${jwt}`),
    ...overrides,
  };
  d.__stored = () => stored;
  d.__setStored = (row) => { stored = row; };
  return d;
}

test('canonical filenames follow §7.3 and the registry match is by artifact type + canonical name, newest first', () => {
  expect(canonicalFilename('1003222', 'presentation_pdf', 'pdf')).toBe('1003222 Site Visit Presentation.pdf');
  expect(canonicalFilename('1003222', 'presentation_source', '.PPTX')).toBe('1003222 Site Visit Presentation.pptx');
  expect(canonicalFilename('1003222', 'participant_bios', 'docx')).toBe('1003222 Site Visit Participant Bios.docx');
  const rows = [
    registryRow({ id: 'old', filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2026-09-01T00:00:00Z' }),
    registryRow({ id: 'new', filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2026-09-02T00:00:00Z' }),
    registryRow({ id: 'src', filename: '1003222 Site Visit Presentation.key' }),
    registryRow({ id: 'bios-wrong-type', filename: '1003222 Site Visit Participant Bios.pdf' }), // slides type → not bios
    registryRow({ id: 'bios', filename: '1003222 Site Visit Participant Bios.pdf', wmkf_artifacttype: 100000004 }),
    registryRow({ id: 'other', filename: 'Campus map.pdf', wmkf_artifacttype: 100000004 }),
    registryRow({ id: 'superseded', filename: '1003222 Site Visit Presentation.pdf', wmkf_lifecyclestate: 100000003, modifiedon: '2026-09-09T00:00:00Z' }),
    registryRow({ id: 'foreign', filename: '1003222 Site Visit Presentation.pdf', _wmkf_request_value: 'zzzzzzzz-0000-4000-8000-000000000000', modifiedon: '2026-09-09T00:00:00Z' }),
    registryRow({ id: 'not-ready', filename: '1003222 Site Visit Presentation.pdf', wmkf_operationstatus: 100000000, modifiedon: '2026-09-09T00:00:00Z' }),
  ];
  const { received, other } = matchReceivedFiles(rows, REQUEST_ID, '1003222');
  expect(received.presentation_pdf.artifactId).toBe('new');
  expect(received.presentation_source.artifactId).toBe('src');
  expect(received.participant_bios.artifactId).toBe('bios');
  expect(other.map((row) => row.artifactId)).toEqual(['other']);
});

test('create: advancing request + active visit → due two business days before in the visit zone, closes visit end + 7d, sealed link, invitation to PI and liaison', async () => {
  const d = deps();
  const result = await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  const inserted = d.insertCollection.mock.calls[0][0];
  expect(inserted.dueAt.toISOString()).toBe('2026-10-05T16:00:00.000Z'); // Mon, same wall-clock time
  expect(inserted.closesAt.toISOString()).toBe('2026-10-14T19:00:00.000Z');
  expect(inserted.contacts).toEqual({ pi: { role: 'pi', name: 'Pat Investigator', email: 'PI@example.edu' }, liaison: { role: 'liaison', name: 'Lee Liaison', email: 'liaison@example.edu' } });
  expect(inserted.checklist.map((item) => item.key)).toEqual(['presentation_pdf', 'presentation_source', 'participant_bios']);
  expect(d.mint).toHaveBeenCalledWith({ subject: REQUEST_ID, audience: 'materials', ops: ['upload_materials'], expiresAt: inserted.closesAt });
  expect(inserted.tokenCiphertext).toMatch(/^sealed:jwt-/);
  // The raw token lives only inside the sealed value; no other column carries it.
  const { tokenCiphertext, ...rest } = inserted;
  expect(tokenCiphertext).toContain('jwt-' + REQUEST_ID + '-materials');
  expect(JSON.stringify(rest)).not.toContain('jwt-' + REQUEST_ID + '-materials');
  const email = d.sendEmail.mock.calls[0][0];
  expect(email.to).toEqual(['PI@example.edu', 'liaison@example.edu']);
  expect(email.from).toBe('pc@wmkeck.org');
  expect(email.actingUserSystemId).toBe(ACTOR);
  expect(email.correlationKey).toBe('wmkf-site-visit-materials-invite:44444444-4444-4444-8444-444444444444');
  expect(email.url).toContain('https://apps.test/external/materials/jwt-');
  expect(email.buttonLabel).toBe('Upload site visit materials');
  expect(email.bodyText).not.toContain('https://apps.test/external/materials/jwt-');
  expect(email.bodyText).toContain('No login is needed. You may forward the link below to a colleague who is helping.');
  expect(email.bodyText).not.toContain('The link stays open until');
  expect(email.bodyText).toContain('Presentation (PDF)');
  expect(email.bodyText).toContain('Monday, October 5, 2026');
  expect(result.invitationSent).toBe(true);
  expect(result.collection).toMatchObject({ state: 'missing', missing: ['presentation_pdf', 'presentation_source', 'participant_bios'], contributorUrl: expect.stringContaining('/external/materials/') });
});

test('create refusals: no visit, already open, no recipient email, not schedulable; an email failure keeps the row and reports invitationSent=false', async () => {
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ findActiveSiteVisit: jest.fn(async () => null) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_visit_required' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ getOpenCollection: jest.fn(async () => ({ id: 'x' })) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_exists' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ resolveRecipients: jest.fn(async () => ({ pi: { email: null }, liaison: { email: null } })) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_no_recipients' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ getRequest: jest.fn(async () => ({ ...request(), wmkf_triagestatus: 100000001, akoya_requeststatus: 1 })) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_request_not_schedulable' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: 'nope', fromEmail: 'pc@wmkeck.org' }, deps()))
    .rejects.toMatchObject({ code: 'site_visit_materials_actor_required' });

  const failing = deps({ sendEmail: jest.fn(async () => { throw new Error('transport down'); }) });
  const result = await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, failing);
  expect(failing.insertCollection).toHaveBeenCalledTimes(1);
  expect(failing.recordInvitation).not.toHaveBeenCalled();
  expect(result.invitationSent).toBe(false);
  expect(result.collection.invitedAt).toBeNull();
});

test('read joins the registry: state moves missing → received → ready; waive removes an item from the requirement; reminder names only the missing items', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.findDocumentsByRequest.mockResolvedValue({ records: [
    registryRow({ id: 'pdf', filename: '1003222 Site Visit Presentation.pdf' }),
    registryRow({ id: 'bios', filename: '1003222 Site Visit Participant Bios.pdf', wmkf_artifacttype: 100000004 }),
  ] });
  let { collection } = await getMaterialsCollection({ requestId: REQUEST_ID }, d);
  expect(collection.state).toBe('missing');
  expect(collection.missing).toEqual(['presentation_source']);

  await expect(confirmMaterialsReady({ requestId: REQUEST_ID, actorId: ACTOR }, d)).rejects.toMatchObject({ code: 'site_visit_materials_incomplete' });

  ({ collection } = await remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d));
  const reminder = d.sendEmail.mock.calls[1][0];
  expect(reminder.bodyText).toContain('Presentation source (PowerPoint or Keynote)');
  expect(reminder.bodyText).not.toContain('Presentation (PDF)');
  expect(reminder.bodyText).not.toContain('https://apps.test/external/materials/');
  expect(reminder.url).toContain('https://apps.test/external/materials/');
  expect(reminder.buttonLabel).toBe('Upload the missing items');
  expect(reminder.correlationKey).toBe('wmkf-site-visit-materials-reminder:44444444-4444-4444-8444-444444444444:1');
  expect(collection.reminderCount).toBe(1);

  ({ collection } = await waiveMaterialsItem({ requestId: REQUEST_ID, key: 'presentation_source', waived: true }, d));
  expect(collection.state).toBe('received');
  expect(collection.missing).toEqual([]);
  await expect(remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d)).rejects.toMatchObject({ code: 'site_visit_materials_nothing_missing' });

  ({ collection } = await confirmMaterialsReady({ requestId: REQUEST_ID, actorId: ACTOR }, d));
  expect(collection.state).toBe('ready');
  expect(d.markReady).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', ACTOR);
  await expect(waiveMaterialsItem({ requestId: REQUEST_ID, key: 'nope', waived: true }, d)).rejects.toMatchObject({ code: 'site_visit_materials_item_unknown' });
});

test('a collection past its close instant reads as closed even before the sweep marks it; the schema flag off is 503', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.now = () => new Date('2026-10-20T00:00:00Z');
  const { collection } = await getMaterialsCollection({ requestId: REQUEST_ID }, d);
  expect(collection.state).toBe('closed');
  await expect(getMaterialsCollection({ requestId: REQUEST_ID }, deps({ schemaReady: () => false }))).rejects.toMatchObject({ httpStatus: 503 });
  const body = invitationBodyText({ institution: 'U', title: 'T', visitStartIso: '2026-10-07T16:00:00Z', timeZone: 'America/Los_Angeles', dueAt: '2026-10-05T16:00:00Z', checklist: [{ key: 'a', label: 'A', required: true, waived: false }, { key: 'b', label: 'B', required: true, waived: true }] });
  expect(body).not.toContain('- B');
  expect(body).not.toContain('The link stays open');
});

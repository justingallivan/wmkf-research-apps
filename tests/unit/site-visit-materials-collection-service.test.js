/** @jest-environment node */
const mockGetById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/grant-request.js'),
  getById: (...args) => mockGetById(...args),
}));

const mockGetSettingStrict = jest.fn();
jest.mock('../../lib/services/settings-service.js', () => ({
  ...jest.requireActual('../../lib/services/settings-service.js'),
  getSettingStrict: (...args) => mockGetSettingStrict(...args),
}));
import {
  canonicalFilename,
  confirmMaterialsReady,
  createMaterialsCollection,
  getMaterialsCollection,
  inviteMaterialsContributors,
  invitationBodyText,
  previewMaterialsEmail,
  matchReceivedFiles,
  missingRequiredItems,
  projectCollection,
  remindMaterialsContributors,
  reminderBodyText,
  summarizeCollection,
  waiveMaterialsItem,
} from '../../lib/services/site-visit-materials/collection-service';
import { renderMaterialsEmailHtml } from '../../lib/external/site-visit-materials-email';
import {
  SITE_VISIT_MATERIALS_INVITE_SEED_BODY,
  SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT,
  SITE_VISIT_MATERIALS_REMINDER_SEED_BODY,
  SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT,
} from '../../lib/seed/email-defaults/site-visit-materials';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-15T17:00:00Z');
const DEFAULT_TEXT = {
  'email.site_visit_materials_invite.subject': SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT,
  'email.site_visit_materials_invite.body': SITE_VISIT_MATERIALS_INVITE_SEED_BODY,
  'email.site_visit_materials_reminder.subject': SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT,
  'email.site_visit_materials_reminder.body': SITE_VISIT_MATERIALS_REMINDER_SEED_BODY,
};

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
    resolveMaterialNames: jest.fn(async () => ({ piLastName: 'Investigator', piEmail: 'PI@example.edu', liaisonFullName: 'Lee Liaison', liaisonEmail: 'liaison@example.edu', programCoordinatorName: 'Casey Coordinator' })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getOpenCollection: jest.fn(async () => stored),
    getLatestCollection: jest.fn(async () => stored),
    backgroundJobsSchemaReady: () => false,
    listUploadJobsForRequest: jest.fn(async () => []),
    insertCollection: jest.fn(async (row) => { stored = { id: row.id, request_id: row.requestId, site_visit_activity_id: row.siteVisitActivityId, status: 'open', due_at: row.dueAt, closes_at: row.closesAt, checklist: row.checklist, contacts: row.contacts, jti: row.jti, token_digest: row.tokenDigest, token_ciphertext: row.tokenCiphertext, created_by: row.createdBy, reminder_count: 0, created_at: NOW }; return stored; }),
    recordInvitation: jest.fn(async (id, emailId) => { stored = { ...stored, invited_at: NOW, invitation_email_id: emailId }; return stored; }),
    updateContacts: jest.fn(async (id, expected, contacts) => { stored = { ...stored, contacts }; return stored; }),
    claimManualReminder: jest.fn(async (id) => { if (stored.status && stored.status !== 'open') return null; stored = { ...stored, last_reminder_at: NOW, reminder_count: stored.reminder_count + 1 }; return stored; }),
    attachReminderEmailId: jest.fn(async (id, emailId) => { stored = { ...stored, last_reminder_email_id: emailId }; return stored; }),
    updateChecklist: jest.fn(async (id, checklist) => { stored = { ...stored, checklist }; return stored; }),
    markReady: jest.fn(async (id, actor) => { if (stored.status !== 'open') return null; stored = { ...stored, status: 'ready', ready_confirmed_at: NOW, ready_confirmed_by: actor }; return stored; }),
    reopenFromReady: jest.fn(),
    mint: jest.fn(async ({ subject, audience, ops, expiresAt }) => ({ jwt: `jwt-${subject}-${audience}-${ops.join(',')}-${expiresAt.toISOString()}`, jti: 'jti-1', hash: 'a'.repeat(64) })),
    seal: jest.fn((jwt) => `sealed:${jwt}`),
    unseal: jest.fn((sealed) => sealed.replace(/^sealed:/, '')),
    randomUUID: jest.fn(() => '44444444-4444-4444-8444-444444444444'),
    now: () => NOW,
    readEmailDefaults: jest.fn(async (keys) => ({ ok: true, values: Object.fromEntries(keys.map((key) => [key, DEFAULT_TEXT[key]])) })),
    resolvePcSignature: jest.fn(async () => 'Casey Coordinator\nW. M. Keck Foundation'),
    sendEmail: jest.fn(async () => '55555555-5555-4555-8555-555555555555'),
    buildContributorUrl: jest.fn((jwt) => `https://apps.test/external/materials/${jwt}`),
    ...overrides,
  };
  d.__stored = () => stored;
  d.__setStored = (row) => { stored = row; };
  return d;
}

beforeEach(() => {
  mockGetById.mockClear();
  mockGetSettingStrict.mockClear();
  mockGetById.mockResolvedValue({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
  mockGetSettingStrict.mockResolvedValue({ found: false, value: null });
  delete process.env.TEST_REQUEST_ISOLATION;
});

const MATERIALS_CONTACTS = {
  pi: { role: 'pi', name: 'Pat Investigator', email: 'PI@example.edu' },
  liaison: { role: 'liaison', name: 'Lee Liaison', email: 'liaison@example.edu' },
  liaisonStatus: 'found',
};
const MATERIALS_RECIPIENTS = ['PI@example.edu', 'liaison@example.edu'];
const MATERIALS_PREPARED_EMAIL = {
  subject: 'Materials request', bodyText: 'Please send the materials.',
  recipients: MATERIALS_RECIPIENTS,
  toRecipients: ['PI@example.edu'], ccRecipients: ['liaison@example.edu'],
};

function openMaterialsRow() {
  return {
    id: 'collection-1', request_id: REQUEST_ID, status: 'open',
    due_at: new Date('2026-10-05T16:00:00.000Z'),
    closes_at: new Date('2026-10-14T19:00:00.000Z'), created_at: NOW,
    checklist: [
      { key: 'presentation_pdf', label: 'Presentation (PDF)', required: true, waived: false },
      { key: 'presentation_source', label: 'Presentation source', required: true, waived: false },
      { key: 'participant_bios', label: 'Participant bios', required: true, waived: false },
    ],
    contacts: MATERIALS_CONTACTS, token_ciphertext: 'sealed:existing-token', reminder_count: 0,
  };
}

async function runMaterialsAction(action, d) {
  if (action === 'create') {
    return createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org', preparedEmail: MATERIALS_PREPARED_EMAIL }, d);
  }
  d.__setStored(openMaterialsRow());
  if (action === 'invite') {
    return inviteMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org', preparedEmail: MATERIALS_PREPARED_EMAIL }, d);
  }
  return remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org', preparedEmail: MATERIALS_PREPARED_EMAIL }, d);
}

function expectMaterialsEffects(d, action, happened) {
  const calls = action === 'create'
    ? [d.mint, d.insertCollection, d.sendEmail]
    : action === 'invite'
      ? [d.updateContacts, d.sendEmail]
      : [d.claimManualReminder, d.sendEmail, d.attachReminderEmailId];
  for (const call of calls) happened ? expect(call).toHaveBeenCalled() : expect(call).not.toHaveBeenCalled();
}

describe('Test Request recipient checks on manual materials sends', () => {
  const synthetic = { wmkf_istestrequest: true, wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222' };
  const allowlisted = { found: true, value: JSON.stringify({ addresses: ['pi@example.edu', 'liaison@example.edu'] }) };

  test.each(['create', 'invite', 'remind'])('%s sends when every current recipient is allowlisted', async (action) => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    mockGetById.mockResolvedValue(synthetic);
    mockGetSettingStrict.mockResolvedValue(allowlisted);
    const d = deps({ resolveRecipients: jest.fn(async () => MATERIALS_CONTACTS) });

    await runMaterialsAction(action, d);

    expect(mockGetSettingStrict).toHaveBeenCalledWith('testRequestEmailAllowlist');
    expectMaterialsEffects(d, action, true);
    expect(d.sendEmail.mock.calls[0][0]).toMatchObject({ to: ['PI@example.edu'], cc: ['liaison@example.edu'] });
  });

  test.each(['create', 'invite', 'remind'])('%s refuses one non-allowlisted recipient before side effects', async (action) => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    mockGetById.mockResolvedValue(synthetic);
    mockGetSettingStrict.mockResolvedValue({ found: true, value: JSON.stringify({ addresses: ['pi@example.edu'] }) });
    const d = deps({ resolveRecipients: jest.fn(async () => MATERIALS_CONTACTS) });

    await expect(runMaterialsAction(action, d)).rejects.toMatchObject({ code: 'test_request_email_denied', httpStatus: 409 });

    expect(mockGetSettingStrict).toHaveBeenCalledWith('testRequestEmailAllowlist');
    expectMaterialsEffects(d, action, false);
  });

  test.each(['create', 'invite', 'remind'])('%s keeps ordinary Requests working without reading the allowlist', async (action) => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    mockGetById.mockResolvedValue({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
    const d = deps({ resolveRecipients: jest.fn(async () => MATERIALS_CONTACTS) });

    await runMaterialsAction(action, d);

    expect(mockGetSettingStrict).not.toHaveBeenCalled();
    expectMaterialsEffects(d, action, true);
  });

  test.each(['create', 'invite', 'remind'])('%s fails closed when Request state is unknown', async (action) => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    mockGetById.mockRejectedValue(new Error('state read failed'));
    const d = deps({ resolveRecipients: jest.fn(async () => MATERIALS_CONTACTS) });

    await expect(runMaterialsAction(action, d)).rejects.toMatchObject({ code: 'test_request_email_denied', httpStatus: 409 });

    expect(mockGetSettingStrict).not.toHaveBeenCalled();
    expectMaterialsEffects(d, action, false);
  });
});

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
  expect(inserted.contacts).toEqual({ pi: { role: 'pi', name: 'Pat Investigator', email: 'PI@example.edu' }, liaison: { role: 'liaison', name: 'Lee Liaison', email: 'liaison@example.edu' }, liaisonStatus: 'found' });
  expect(inserted.checklist.map((item) => item.key)).toEqual(['presentation_pdf', 'presentation_source', 'participant_bios']);
  expect(d.mint).toHaveBeenCalledWith({ subject: REQUEST_ID, audience: 'materials', ops: ['upload_materials'], expiresAt: inserted.closesAt });
  expect(inserted.tokenCiphertext).toMatch(/^sealed:jwt-/);
  // The raw token lives only inside the sealed value; no other column carries it.
  const { tokenCiphertext, ...rest } = inserted;
  expect(tokenCiphertext).toContain('jwt-' + REQUEST_ID + '-materials');
  expect(JSON.stringify(rest)).not.toContain('jwt-' + REQUEST_ID + '-materials');
  const email = d.sendEmail.mock.calls[0][0];
  expect(email.to).toEqual(['PI@example.edu']);
  expect(email.cc).toEqual(['liaison@example.edu']);
  expect(email.from).toBe('pc@wmkeck.org');
  expect(email.actingUserSystemId).toBe(ACTOR);
  expect(email.correlationKey).toBe('wmkf-site-visit-materials-invite:44444444-4444-4444-8444-444444444444');
  expect(email.url).toContain('https://apps.test/external/materials/jwt-');
  expect(email.buttonLabel).toBe('Upload site visit materials');
  expect(email.subject).toBe('W.M. Keck Foundation Research Presentation Materials Request');
  expect(email.bodyText).not.toContain('https://apps.test/external/materials/jwt-');
  expect(email.bodyText).toContain('Dear Dr. Investigator,');
  expect(email.bodyText).toContain('Often, the participant bios are prepared by your institutional liaison (Lee Liaison)');
  expect(email.bodyText).toContain('Sincerely,\nCasey Coordinator');
  expect(email.bodyText).not.toContain('The link stays open until');
  expect(email.bodyText).toContain('Presentation (PDF)');
  expect(email.bodyText).toContain('Monday, October 5, 2026');
  expect(d.resolvePcSignature).not.toHaveBeenCalled();
  expect(result.invitationSent).toBe(true);
  expect(result.collection).toMatchObject({ state: 'missing', missing: ['presentation_pdf', 'presentation_source', 'participant_bios'], contributorUrl: expect.stringContaining('/external/materials/') });
});

test('create refusals: no visit, already open, no recipient email, not schedulable; an email failure keeps the row and reports invitationSent=false', async () => {
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ findActiveSiteVisit: jest.fn(async () => null) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_visit_required' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ getOpenCollection: jest.fn(async () => ({ id: 'x' })) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_exists' });
  await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, deps({ resolveRecipients: jest.fn(async () => ({ pi: { email: null }, liaison: { email: null } })) })))
    .rejects.toMatchObject({ code: 'site_visit_materials_recipients_required' });
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

test('invite and remind reject an unlinked actor before reading or claiming a collection', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.getRequest.mockClear();
  d.readEmailDefaults.mockClear();
  for (const action of [inviteMaterialsContributors, remindMaterialsContributors]) {
    await expect(action({ requestId: REQUEST_ID, actorId: null, fromEmail: 'pc@wmkeck.org' }, d))
      .rejects.toMatchObject({ code: 'site_visit_materials_actor_required', httpStatus: 403 });
  }
  expect(d.getRequest).not.toHaveBeenCalled();
  expect(d.readEmailDefaults).not.toHaveBeenCalled();
  expect(d.claimManualReminder).not.toHaveBeenCalled();
  expect(d.sendEmail).toHaveBeenCalledTimes(1);
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
  expect(reminder.subject).toBe('W.M. Keck Foundation Research Presentation Materials Request');
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

test('reminder preview excludes a job-held required slot and its proof sends when another slot is missing', async () => {
  const originalSecret = process.env.EXTERNAL_LINK_SECRET;
  process.env.EXTERNAL_LINK_SECRET = 'materials-preview-test-secret-at-least-32-chars';
  const emailTemplate = { subject: SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT, body: SITE_VISIT_MATERIALS_REMINDER_SEED_BODY };
  const d = deps({
    backgroundJobsSchemaReady: () => true,
    listUploadJobsForRequest: jest.fn(async () => [
      { job_id: 'job-held', slot: 'presentation_pdf', status: 'processing', filename: 'new.pdf', attempt_count: 1 },
    ]),
  });
  const row = openMaterialsRow();
  row.checklist[2].waived = true;
  d.__setStored(row);

  try {
    const preview = await previewMaterialsEmail({ requestId: REQUEST_ID, action: 'remind', actorId: ACTOR, fromEmail: 'pc@wmkeck.org', emailTemplate }, d);
    expect(preview.missingKeys).toEqual(['presentation_source']);
    expect(preview.bodyText).toContain('Presentation source');
    expect(preview.bodyText).not.toContain('Presentation (PDF)');

    const preparedEmail = {
      subject: preview.subject,
      bodyText: preview.bodyText,
      names: preview.names,
      recipients: preview.allRecipients,
      toRecipients: preview.recipients.map((person) => person.email),
      ccRecipients: preview.ccRecipients.map((person) => person.email),
      missingKeys: preview.missingKeys,
      collectionId: preview.collectionId,
      dueAt: preview.dueAt,
      visitSnapshot: preview.visitSnapshot,
      template: emailTemplate,
    };
    await remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org', emailTemplate, preparedEmail }, d);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.sendEmail.mock.calls[0][0].bodyText).toContain('Presentation source');
    expect(d.sendEmail.mock.calls[0][0].bodyText).not.toContain('Presentation (PDF)');
  } finally {
    if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
    else process.env.EXTERNAL_LINK_SECRET = originalSecret;
  }
});

test('manual reminder claims before sending (S507): claim order, 409 on a lost claim, and an email id attached only after a successful send', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);

  const order = [];
  d.claimManualReminder.mockImplementation(async (id) => { order.push('claim'); const stored = d.__stored(); const next = { ...stored, last_reminder_at: NOW, reminder_count: stored.reminder_count + 1 }; d.__setStored(next); return next; });
  d.sendEmail.mockImplementation(async (...args) => { order.push('send'); return '55555555-5555-4555-8555-555555555555'; });
  d.attachReminderEmailId.mockImplementation(async (id, emailId) => { order.push('attach'); const stored = d.__stored(); const next = { ...stored, last_reminder_email_id: emailId }; d.__setStored(next); return next; });

  await remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  expect(order).toEqual(['claim', 'send', 'attach']);
  expect(d.claimManualReminder).toHaveBeenCalledWith(d.__stored().id, NOW, d.__stored().contacts, d.__stored().contacts);

  // Claim lost (e.g. the cron claimed moments earlier): 409, never sends, never attaches.
  d.claimManualReminder.mockImplementation(async () => null);
  const sendCallsBefore = d.sendEmail.mock.calls.length;
  await expect(remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d))
    .rejects.toMatchObject({ code: 'site_visit_materials_reminder_just_sent', httpStatus: 409 });
  expect(d.sendEmail.mock.calls.length).toBe(sendCallsBefore);
  expect(d.attachReminderEmailId).not.toHaveBeenCalledWith(expect.anything(), undefined);

  // Send failure after a successful claim: at-most-once — the error propagates, the claim stands, nothing is attached.
  d.claimManualReminder.mockImplementation(async (id) => { const stored = d.__stored(); const next = { ...stored, last_reminder_at: NOW, reminder_count: stored.reminder_count + 1 }; d.__setStored(next); return next; });
  const attachCallsBefore = d.attachReminderEmailId.mock.calls.length;
  const reminderCountBefore = d.__stored().reminder_count;
  d.sendEmail.mockImplementation(async () => { throw new Error('transport down'); });
  await expect(remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d))
    .rejects.toMatchObject({ code: 'site_visit_materials_send_unconfirmed', httpStatus: 202 });
  expect(d.attachReminderEmailId.mock.calls.length).toBe(attachCallsBefore);
  expect(d.__stored().reminder_count).toBe(reminderCountBefore + 1);
});

test('a collection past its close instant reads as closed even before the sweep marks it; the schema flag off is 503', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.now = () => new Date('2026-10-20T00:00:00Z');
  const { collection } = await getMaterialsCollection({ requestId: REQUEST_ID }, d);
  expect(collection.state).toBe('closed');
  await expect(getMaterialsCollection({ requestId: REQUEST_ID }, deps({ schemaReady: () => false }))).rejects.toMatchObject({ httpStatus: 503 });
  const body = invitationBodyText({ bodyTemplate: SITE_VISIT_MATERIALS_INVITE_SEED_BODY, institution: 'U', title: 'T', visitStartIso: '2026-10-07T16:00:00Z', timeZone: 'America/Los_Angeles', dueAt: '2026-10-05T16:00:00Z', checklist: [{ key: 'a', label: 'A', required: true, waived: false }, { key: 'b', label: 'B', required: true, waived: true }], names: { piLastName: 'Investigator', liaisonFullName: 'Lee Liaison', programCoordinatorName: 'Casey Coordinator' } });
  expect(body).toBe('Dear Dr. Investigator,\n\nAhead of your Research Presentation to the W.M. Keck Foundation on Wednesday, October 7, 2026, please upload the following by Monday, October 5, 2026:\n\n  - A\n\nOften, the participant bios are prepared by your institutional liaison (Lee Liaison) who is copied on this email and may use the same link below to upload the material.\n\nSincerely,\nCasey Coordinator');
});

test('edited invitation and reminder settings supply distinct subjects and bodies with resolved tokens', async () => {
  const custom = {
    ...DEFAULT_TEXT,
    'email.site_visit_materials_invite.subject': 'INVITE {{proposalTitle}}',
    'email.site_visit_materials_invite.body': 'Invite {{proposalTitle}} / {{institution}} / {{visitDate}} / {{dueDate}}\n{{checklist}}\n{{uploadLink}}\n{{signature}}',
    'email.site_visit_materials_reminder.subject': 'REMIND {{proposalTitle}}',
    'email.site_visit_materials_reminder.body': 'Remind {{missingItemsGrammar}}: {{missingItems}}\n{{uploadLink}}\n{{signature}}',
  };
  const d = deps({
    readEmailDefaults: jest.fn(async (keys) => ({ ok: true, values: Object.fromEntries(keys.map((key) => [key, custom[key]])) })),
    buildContributorUrl: jest.fn((jwt) => `https://apps.test/external/materials/${jwt}?a=1&b=2`),
  });
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  const invite = d.sendEmail.mock.calls[0][0];
  expect(invite.subject).toBe('INVITE The Secret History of Our Sun');
  expect(invite.bodyText).toContain('Invite The Secret History of Our Sun / Franklin Cat University / Wednesday, October 7, 2026 / Monday, October 5, 2026');
  expect(invite.bodyText).toContain('  - Presentation (PDF)');
  expect(invite.bodyText).toContain('?a=1&b=2');
  expect(invite.bodyText).toContain('Casey Coordinator\nW. M. Keck Foundation');
  expect(invite.bodyText).not.toContain('{{');
  const html = renderMaterialsEmailHtml(invite);
  expect(html).toContain('a=1&amp;b=2');
  expect(html).not.toContain('a=1&b=2');

  await remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  const reminder = d.sendEmail.mock.calls[1][0];
  expect(reminder.subject).toBe('REMIND The Secret History of Our Sun');
  expect(reminder.bodyText).toContain('Remind items are:');
  expect(reminder.bodyText).toContain('  - Presentation (PDF)');
  expect(reminder.bodyText).toContain('?a=1&b=2');
  expect(reminder.bodyText).toContain('Casey Coordinator\nW. M. Keck Foundation');
  expect(reminder.bodyText).not.toContain('{{');
  expect(d.resolvePcSignature).toHaveBeenCalledTimes(2);
});

test('blank required settings block both sends before invitation receipt or reminder claim changes', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const blank = { ok: false, values: {}, failures: [{ key: 'email.site_visit_materials_invite.body', reason: 'blank' }] };
  const failedInvite = deps({ readEmailDefaults: jest.fn(async () => blank) });
  const result = await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, failedInvite);
  expect(result.invitationSent).toBe(false);
  expect(failedInvite.sendEmail).not.toHaveBeenCalled();
  expect(failedInvite.recordInvitation).not.toHaveBeenCalled();
  expect(failedInvite.__stored().invited_at).toBeUndefined();

  const existingInvite = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, existingInvite);
  const invitedBefore = existingInvite.__stored();
  existingInvite.readEmailDefaults.mockResolvedValue(blank);
  await expect(inviteMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, existingInvite))
    .rejects.toMatchObject({ code: 'site_visit_materials_email_defaults_unavailable', httpStatus: 503 });
  expect(existingInvite.sendEmail).toHaveBeenCalledTimes(1);
  expect(existingInvite.__stored()).toEqual(invitedBefore);

  existingInvite.readEmailDefaults.mockResolvedValue({ ok: true, values: {
    'email.site_visit_materials_invite.subject': SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT,
    'email.site_visit_materials_invite.body': SITE_VISIT_MATERIALS_INVITE_SEED_BODY,
  } });
  existingInvite.sendEmail.mockRejectedValue(new Error('transport down'));
  await expect(inviteMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, existingInvite))
    .rejects.toMatchObject({ code: 'site_visit_materials_send_unconfirmed', httpStatus: 202 });
  expect(existingInvite.__stored()).toEqual(invitedBefore);

  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  const before = d.__stored();
  d.readEmailDefaults.mockResolvedValue({ ok: false, values: {}, failures: [{ key: 'email.site_visit_materials_reminder.body', reason: 'blank' }] });
  await expect(remindMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d))
    .rejects.toMatchObject({ code: 'site_visit_materials_email_defaults_unavailable', httpStatus: 503 });
  expect(d.claimManualReminder).not.toHaveBeenCalled();
  expect(d.sendEmail).toHaveBeenCalledTimes(1);
  expect(d.__stored()).toEqual(before);
  log.mockRestore();
});

test('an invitation receipt failure preserves the accepted Dynamics activity id for reconciliation', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.recordInvitation.mockRejectedValue(new Error('receipt write failed'));

  await expect(inviteMaterialsContributors({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d))
    .rejects.toMatchObject({
      code: 'site_visit_materials_send_unconfirmed',
      httpStatus: 202,
      body: expect.objectContaining({ emailId: '55555555-5555-4555-8555-555555555555' }),
    });
});

test('seed reminder retains singular grammar and excludes received items', () => {
  const text = reminderBodyText({
    bodyTemplate: SITE_VISIT_MATERIALS_REMINDER_SEED_BODY,
    institution: 'U', title: 'T', visitStartIso: '2026-10-07T16:00:00Z', names: { piLastName: 'Investigator', liaisonFullName: 'Lee Liaison', programCoordinatorName: 'Casey Coordinator' },
    timeZone: 'America/Los_Angeles', dueAt: '2026-10-05T16:00:00Z',
    missing: [{ label: 'Presentation source (PowerPoint or Keynote)' }],
  });
  expect(text).toBe('Dear Dr. Investigator,\n\nThis is a reminder to submit materials for your Research Presentation to the W.M. Keck Foundation on Wednesday, October 7, 2026. The following item is still needed by Monday, October 5, 2026:\n\n  - Presentation source (PowerPoint or Keynote)\n\nOften, the participant bios are prepared by your institutional liaison (Lee Liaison) who is copied on this email and may use the same link below to upload the material.\n\nSincerely,\nCasey Coordinator');
});

test('summarizeCollection keeps state, counts, and the window; drops the link, contacts, and per-item detail; waived items leave the denominator', async () => {
  const d = deps();
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  d.findDocumentsByRequest.mockResolvedValue({ records: [registryRow({ id: 'p', filename: '1003222 Site Visit Presentation.pdf' })] });
  await waiveMaterialsItem({ requestId: REQUEST_ID, key: 'participant_bios', waived: true }, d);
  const { collection } = await getMaterialsCollection({ requestId: REQUEST_ID }, d);
  expect(collection.contributorUrl).toMatch(/^https?:\/\/|^\/external\/materials\//);
  const summary = summarizeCollection(collection);
  expect(summary).toEqual({
    state: 'missing', processingCount: 0, attentionCount: 0, receivedCount: 1, requiredCount: 2, otherCount: 0,
    dueAt: collection.dueAt, closesAt: collection.closesAt, overdue: false, invited: true,
  });
  expect(Object.keys(summary)).not.toEqual(expect.arrayContaining(['contributorUrl', 'contacts', 'checklist', 'id']));
  expect(summarizeCollection(null)).toBeNull();
  expect(missingRequiredItems({ checklist: collection.checklist }, { presentation_pdf: { artifactId: 'p' } }).map((item) => item.key)).toEqual(['presentation_source']);
  expect(missingRequiredItems({ checklist: collection.checklist }, { presentation_pdf: { artifactId: 'p' } }, {
    mode: 'reminder_actionable', activeJobSlots: new Set(['presentation_source']),
  })).toEqual([]);
});

test('staff projection exposes sanitized cross-collection jobs and blocks Ready while an upload is active', async () => {
  const d = deps({
    backgroundJobsSchemaReady: () => true,
    listUploadJobsForRequest: jest.fn(async () => [
      { job_id: 'job-1', collection_id: 'old-collection', slot: 'presentation_pdf', status: 'processing', filename: 'new.pdf', attempt_count: 2, error_code: 'raw-storage-exception' },
      { job_id: 'job-2', collection_id: 'old-collection', slot: 'participant_bios', status: 'needs_attention', filename: 'bios.pdf', attempt_count: 8, error_code: 'coordinator_action_required' },
    ]),
  });
  await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  const { collection } = await getMaterialsCollection({ requestId: REQUEST_ID }, d);
  expect(d.listUploadJobsForRequest).toHaveBeenCalledWith(REQUEST_ID, { collectionIds: ['44444444-4444-4444-8444-444444444444'] });
  expect(collection).toMatchObject({ state: 'needs_attention', processingCount: 1, attentionCount: 1 });
  expect(collection.uploadJobs).toEqual([
    expect.objectContaining({ jobId: 'job-1', status: 'processing', errorCode: null }),
    expect.objectContaining({ jobId: 'job-2', status: 'needs_attention', errorCode: 'coordinator_action_required' }),
  ]);
  await expect(confirmMaterialsReady({ requestId: REQUEST_ID, actorId: ACTOR }, d)).rejects.toMatchObject({ code: 'site_visit_materials_uploads_incomplete' });
  expect(d.markReady).not.toHaveBeenCalled();
});

test('new collection creation immediately exposes an active job held by its previous collection', async () => {
  const d = deps({
    backgroundJobsSchemaReady: () => true,
    listUploadJobsForRequest: jest.fn(async () => [
      { job_id: 'job-old', collection_id: 'old-collection', slot: 'presentation_pdf', status: 'processing', filename: 'replacement.pdf', attempt_count: 1 },
    ]),
  });
  const result = await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  expect(result.collection).toMatchObject({ state: 'processing', processingCount: 1 });
  expect(result.collection.uploadJobs).toEqual([expect.objectContaining({ jobId: 'job-old', status: 'processing' })]);
});

test('job status read failure after invitation preserves successful collection creation and marks status unavailable', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const d = deps({
    backgroundJobsSchemaReady: () => true,
    listUploadJobsForRequest: jest.fn(async () => { throw new Error('ledger unavailable'); }),
  });
  const result = await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
  expect(result.invitationSent).toBe(true);
  expect(result.collection).toMatchObject({ uploadJobs: [], uploadStatusUnavailable: true });
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test('projectCollection reports a past closes_at as closed even while the row still says open (the sweep only makes that durable)', () => {
  const row = { id: 'c', request_id: REQUEST_ID, site_visit_activity_id: VISIT_ID, status: 'open', due_at: '2026-10-05T19:00:00Z', closes_at: '2026-10-14T19:00:00Z', checklist: [], contacts: {}, created_at: NOW };
  expect(projectCollection(row, { now: new Date('2026-10-15T00:00:00Z') }).state).toBe('closed');
  expect(projectCollection(row, { now: new Date('2026-10-10T00:00:00Z') }).state).toBe('received');
});

test('the signature token uses the sending PC preference, with the PC name as fallback', async () => {
  jest.resetModules();
  const getByIdWithSelect = jest.fn(async () => ({ systemuserid: ACTOR, fullname: 'Casey Coordinator', internalemailaddress: 'pc@wmkeck.org', isdisabled: false }));
  const resolveSystemUserToProfile = jest.fn(async () => 17);
  const getUserPreferences = jest.fn(async () => ({ email_signature: JSON.stringify({ signature: 'Best,\nCasey Coordinator' }) }));
  jest.doMock('../../lib/dataverse/adapters/system-user.js', () => ({ getByIdWithSelect }));
  jest.doMock('../../lib/services/dataverse-identity-map.js', () => ({ resolveSystemUserToProfile }));
  jest.doMock('../../lib/services/database-service.js', () => ({ DatabaseService: { getUserPreferences } }));
  try {
    const { DEFAULT_DEPENDENCIES } = require('../../lib/services/site-visit-materials/collection-service');
    expect(await DEFAULT_DEPENDENCIES.resolvePcSignature(ACTOR)).toBe('Best,\nCasey Coordinator\nW. M. Keck Foundation');
    expect(getByIdWithSelect).toHaveBeenCalledWith(ACTOR, 'systemuserid,fullname,internalemailaddress,isdisabled');
    expect(resolveSystemUserToProfile).toHaveBeenCalledWith(ACTOR);
    expect(getUserPreferences).toHaveBeenCalledWith(17, false);
    getUserPreferences.mockResolvedValue({});
    expect(await DEFAULT_DEPENDENCIES.resolvePcSignature(ACTOR)).toBe('Casey Coordinator\nW. M. Keck Foundation');
  } finally {
    jest.dontMock('../../lib/dataverse/adapters/system-user.js');
    jest.dontMock('../../lib/services/dataverse-identity-map.js');
    jest.dontMock('../../lib/services/database-service.js');
  }
});

// Liaison plan reader 4: only a confirmed 'none' allows a PI-only send.
describe('Liaison of record in the contacts snapshot', () => {
  const PI_ONLY_BODY = SITE_VISIT_MATERIALS_INVITE_SEED_BODY.replace(/Often, the participant bios[^\n]*\n\n/, '');
  const noLiaison = () => jest.fn(async () => ({
    pi: { name: 'Pat Investigator', email: 'PI@example.edu', hasEmail: true },
    liaison: { contactId: null, name: null, email: null },
    liaisonStatus: 'none',
  }));

  test('none → the invitation goes to the PI only and the snapshot records liaisonStatus none', async () => {
    expect(PI_ONLY_BODY).not.toContain('{{liaisonFullName}}');
    const d = deps({ resolveRecipients: noLiaison() });
    await createMaterialsCollection({
      requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org',
      emailTemplate: { subject: SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT, body: PI_ONLY_BODY },
    }, d);
    expect(d.insertCollection.mock.calls[0][0].contacts).toEqual({
      pi: { role: 'pi', name: 'Pat Investigator', email: 'PI@example.edu' }, liaison: null, liaisonStatus: 'none',
    });
    expect(d.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['PI@example.edu'], cc: [] }));
  });

  test('none with a {{liaisonFullName}} template is refused, naming the missing institution Primary Contact', async () => {
    const d = deps({ resolveRecipients: noLiaison() });
    const error = await previewMaterialsEmail({ requestId: REQUEST_ID, action: 'create', actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d).catch((e) => e);
    expect(error).toMatchObject({ code: 'site_visit_materials_email_name_unavailable', httpStatus: 409 });
    expect(error.message).toMatch(/no Primary Contact/);
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  test('a found Liaison without an email refuses (409), never PI-only', async () => {
    const d = deps({ resolveRecipients: jest.fn(async () => ({
      pi: { name: 'Pat Investigator', email: 'PI@example.edu', hasEmail: true },
      liaison: { contactId: 'li-1', name: 'Lee Liaison', email: null },
      liaisonStatus: 'found',
    })) });
    await expect(createMaterialsCollection({
      requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org',
      emailTemplate: { subject: SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT, body: PI_ONLY_BODY },
    }, d)).rejects.toThrow(/Liaison/);
    await expect(createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d))
      .rejects.toMatchObject({ code: 'site_visit_materials_recipients_required', httpStatus: 409 });
    expect(d.insertCollection).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  test('a legacy snapshot without liaisonStatus still requires the Liaison for a reminder', async () => {
    const d = deps();
    await createMaterialsCollection({ requestId: REQUEST_ID, actorId: ACTOR, fromEmail: 'pc@wmkeck.org' }, d);
    d.__setStored({ ...d.__stored(), invited_at: NOW, contacts: { pi: { role: 'pi', name: 'Pat Investigator', email: 'PI@example.edu' }, liaison: null } });
    d.sendEmail.mockClear();
    const { prepareMaterialsReminderEmail } = jest.requireActual('../../lib/services/site-visit-materials/collection-service');
    await expect(prepareMaterialsReminderEmail({ row: d.__stored(), request: request(), visit: visit(), missing: [], actorId: ACTOR }, d))
      .rejects.toMatchObject({ code: 'site_visit_materials_recipients_required' });
  });
});

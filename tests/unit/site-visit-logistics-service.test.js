import {
  getSiteVisitLogistics,
  saveSiteVisitLogistics,
} from '../../lib/services/site-visit/logistics-service';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument';
import { SITE_VISIT_FORMAT } from '../../shared/config/siteVisit';
import { PARTY_NAVIGATION_PROPERTY } from '../../lib/dataverse/adapters/site-visit';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PARTY_ID = '44444444-4444-4444-8444-444444444444';

test('adapter exposes the exact Site Visit ActivityParty navigation used by service projections', () => {
  expect(PARTY_NAVIGATION_PROPERTY).toBe('wmkf_SiteVisit_activity_parties');
});

const refs = {
  version: 1,
  organizer: { kind: 'staff', profileId: 7 },
  requiredAttendees: [{ kind: 'roster', rosterId: 12 }],
  optionalAttendees: [{ kind: 'manual', name: 'Guest', email: 'guest@example.org' }],
};

function savedRow(overrides = {}) {
  return {
    activityid: ACTIVITY_ID,
    _etag: 'W/"10"',
    _regardingobjectid_value: REQUEST_ID,
    subject: 'Site Visit',
    description: 'Discussion',
    scheduledstart: '2026-09-15T14:00:00.000Z',
    scheduledend: '2026-09-15T16:00:00.000Z',
    wmkf_visitformat: SITE_VISIT_FORMAT.HYBRID,
    wmkf_ianatimezone: 'America/Chicago',
    wmkf_locationorlink: 'Conference room / Teams',
    wmkf_attendeerefsjson: JSON.stringify(refs),
    wmkf_SiteVisit_activity_parties: [{ activitypartyid: PARTY_ID }],
    modifiedon: '2026-08-24T12:00:00Z',
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const directory = {
    staff: [{
      kind: 'staff', profileId: 7, name: 'Organizer', email: 'organizer@wmkeck.org',
      systemUserId: ACTOR_ID,
    }],
    external: [{
      kind: 'roster', rosterId: 12, name: 'Board Member', email: 'board@example.org',
    }],
  };
  return {
    schemaReady: jest.fn(() => true),
    getArtifactStatus: jest.fn(async () => ({
      currentArtifact: {
        artifactId: '55555555-5555-4555-8555-555555555555',
        lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      },
    })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    findActiveByRequest: jest.fn(async () => ({ records: [] })),
    getSiteVisitById: jest.fn(async () => savedRow()),
    createSiteVisit: jest.fn(async () => ({ activityid: ACTIVITY_ID })),
    updateSiteVisit: jest.fn(async () => undefined),
    replaceSiteVisitWithParties: jest.fn(async () => ({ ok: true })),
    getRecipientDirectory: jest.fn(async () => directory),
    resolveRecipientRefs: jest.fn(async (inputRefs) => inputRefs.map((ref) => {
      if (ref.kind === 'staff') return directory.staff[0];
      if (ref.kind === 'roster') return directory.external[0];
      return { ...ref, systemUserId: null };
    })),
    ...overrides,
  };
}

const input = {
  requestId: REQUEST_ID,
  subject: 'Site Visit',
  description: 'Discussion',
  startLocal: '2026-09-15T09:00',
  endLocal: '2026-09-15T11:00',
  timeZone: 'America/Chicago',
  format: SITE_VISIT_FORMAT.HYBRID,
  locationOrLink: 'Conference room / Teams',
  organizer: refs.organizer,
  requiredAttendees: refs.requiredAttendees,
  optionalAttendees: refs.optionalAttendees,
};

test('creates one request-bound Site Visit with resolved ActivityParty roles', async () => {
  const deps = dependencies();
  const result = await saveSiteVisitLogistics(input, { actingUserSystemId: ACTOR_ID }, deps);

  expect(result.siteVisit.activityId).toBe(ACTIVITY_ID);
  expect(deps.createSiteVisit).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: 'Site Visit',
      scheduledstart: '2026-09-15T14:00:00.000Z',
      scheduledend: '2026-09-15T16:00:00.000Z',
      wmkf_attendeerefsjson: JSON.stringify(refs),
      'regardingobjectid_akoya_request_wmkf_sitevisit@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    }),
    expect.arrayContaining([
      expect.objectContaining({ participationtypemask: 7, systemUserId: ACTOR_ID }),
      expect.objectContaining({ participationtypemask: 5, addressused: 'board@example.org' }),
      expect.objectContaining({ participationtypemask: 6, addressused: 'guest@example.org' }),
    ]),
    { actingUserSystemId: ACTOR_ID },
  );
});

test('PATCHes the exact active activity when attendee identities are unchanged', async () => {
  const current = savedRow();
  const deps = dependencies({ findActiveByRequest: jest.fn(async () => ({ records: [current] })) });
  await saveSiteVisitLogistics({
    ...input,
    activityId: ACTIVITY_ID,
    etag: 'W/"10"',
  }, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.createSiteVisit).not.toHaveBeenCalled();
  expect(deps.updateSiteVisit).toHaveBeenCalledWith(
    ACTIVITY_ID,
    'W/"10"',
    expect.objectContaining({ subject: 'Site Visit' }),
    { actingUserSystemId: ACTOR_ID },
  );
  expect(deps.replaceSiteVisitWithParties).not.toHaveBeenCalled();
});

test('atomically replaces the same activity ID when attendee identities change', async () => {
  const current = savedRow();
  const deps = dependencies({ findActiveByRequest: jest.fn(async () => ({ records: [current] })) });
  await saveSiteVisitLogistics({
    ...input,
    activityId: ACTIVITY_ID,
    etag: 'W/"10"',
    optionalAttendees: [],
  }, { actingUserSystemId: ACTOR_ID }, deps);

  expect(deps.updateSiteVisit).not.toHaveBeenCalled();
  expect(deps.replaceSiteVisitWithParties).toHaveBeenCalledWith(expect.objectContaining({
    activityId: ACTIVITY_ID,
    etag: 'W/"10"',
    payload: expect.objectContaining({
      'regardingobjectid_akoya_request_wmkf_sitevisit@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    }),
    actingUserSystemId: ACTOR_ID,
  }));
});

test('fails closed on duplicate active activities and stale ETags', async () => {
  await expect(getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [savedRow(), savedRow({ activityid: ACTOR_ID })] })),
  }))).rejects.toMatchObject({ code: 'site_visit_duplicate_active' });

  await expect(saveSiteVisitLogistics({
    ...input,
    activityId: ACTIVITY_ID,
    etag: 'W/"9"',
  }, { actingUserSystemId: ACTOR_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [savedRow()] })),
  }))).rejects.toMatchObject({ code: 'site_visit_write_conflict' });
});

test('returns only eligible ready non-superseded material links for the request', async () => {
  const eligible = {
    wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_filename: 'slides.pdf',
    wmkf_sharepointweburl: 'https://example.sharepoint.com/slides.pdf',
  };
  const result = await getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [savedRow()] })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [
      eligible,
      { ...eligible, wmkf_requestdocumentid: ACTOR_ID, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED },
      { ...eligible, wmkf_requestdocumentid: PARTY_ID, _wmkf_request_value: ACTOR_ID },
    ] })),
  }));

  expect(result.materials).toEqual([expect.objectContaining({
    artifactId: eligible.wmkf_requestdocumentid,
    filename: 'slides.pdf',
  })]);
  expect(result.siteVisit.startLocal).toBe('2026-09-15T09:00');
});

test('projects a Dynamics-scheduled visit without the app map via ActivityParty fallback', async () => {
  // Scheduled directly in Dynamics (S466): no wmkf_attendeerefsjson, real parties.
  const row = savedRow({
    wmkf_attendeerefsjson: null,
    wmkf_SiteVisit_activity_parties: [
      { activitypartyid: 'p1', participationtypemask: 7, addressused: 'Organizer@wmkeck.org' },
      { activitypartyid: 'p2', participationtypemask: 5, addressused: 'required@wmkeck.org' },
      { activitypartyid: 'p3', participationtypemask: 6, addressused: 'optional@example.org' },
      { activitypartyid: 'p4', participationtypemask: 5, addressused: null },
    ],
  });
  const result = await getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [row] })),
  }));

  expect(result.siteVisit.organizer).toEqual({ kind: 'manual', email: 'organizer@wmkeck.org' });
  expect(result.siteVisit.requiredAttendees).toEqual([{ kind: 'manual', email: 'required@wmkeck.org' }]);
  expect(result.siteVisit.optionalAttendees).toEqual([{ kind: 'manual', email: 'optional@example.org' }]);
});

test('still fails closed when neither the app map nor usable parties exist', async () => {
  await expect(getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [savedRow({
      wmkf_attendeerefsjson: null,
      wmkf_SiteVisit_activity_parties: [],
    })] })),
  }))).rejects.toMatchObject({ code: 'site_visit_attendee_map_invalid' });

  // A PRESENT-but-corrupt map keeps the strict contract even with parties.
  await expect(getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    findActiveByRequest: jest.fn(async () => ({ records: [savedRow({
      wmkf_attendeerefsjson: '{"version":99}',
      wmkf_SiteVisit_activity_parties: [
        { activitypartyid: 'p1', participationtypemask: 7, addressused: 'organizer@wmkeck.org' },
      ],
    })] })),
  }))).rejects.toMatchObject({ code: 'site_visit_attendee_map_invalid' });
});

test('requires an active stage, mapped actor, and non-duplicated recipient emails', async () => {
  await expect(saveSiteVisitLogistics(input, { actingUserSystemId: null }, dependencies()))
    .rejects.toMatchObject({ code: 'site_visit_actor_required' });

  await expect(getSiteVisitLogistics({ requestId: REQUEST_ID }, dependencies({
    getArtifactStatus: jest.fn(async () => ({ currentArtifact: null })),
  }))).rejects.toMatchObject({ code: 'site_visit_stage_not_active' });

  const duplicateDirectory = dependencies({
    resolveRecipientRefs: jest.fn(async (inputRefs) => inputRefs.map((ref) => ({
      ...ref, name: 'Duplicate', email: 'same@example.org', systemUserId: ACTOR_ID,
    }))),
  });
  await expect(saveSiteVisitLogistics(input, { actingUserSystemId: ACTOR_ID }, duplicateDirectory))
    .rejects.toMatchObject({ code: 'site_visit_attendee_duplicate' });
});

/** @jest-environment node */
import { getMaterialsSummaryByRequests, getMaterialsSummaryForRequest } from '../../lib/services/site-visit-materials/summary-reader';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-06T17:00:00Z');
const NUMBERS = new Map([[R1, '1003222'], [R2, '1003223']]);

function row(overrides = {}) {
  return {
    id: 'c1', request_id: R1, status: 'open', due_at: '2026-10-05T19:00:00Z', closes_at: '2026-10-14T19:00:00Z',
    checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false })),
    contacts: { pi: { role: 'pi', name: 'Pat', email: 'pi@example.edu' } }, invited_at: '2026-09-20T00:00:00Z',
    reminder_count: 0, created_at: '2026-09-20T00:00:00Z', token_ciphertext: 'sealed',
    ...overrides,
  };
}
function doc(requestId, filename, artifactType = REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES) {
  return {
    wmkf_requestdocumentid: `${requestId}-${filename}`, _wmkf_request_value: requestId, wmkf_artifacttype: artifactType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_sharepointitemid: 'item', wmkf_filename: filename, modifiedon: '2026-10-01T00:00:00Z',
  };
}
function deps(overrides = {}) {
  return {
    schemaReady: () => true,
    listLatestCollections: jest.fn(async () => [row()]),
    findDocumentsByCycle: jest.fn(async () => [doc(R1, '1003222 Site Visit Presentation.pdf'), doc(R1, '1003222 Site Visit Presentation.pptx'), doc(R2, '1003223 Site Visit Presentation.pdf')]),
    findDocumentsByRequest: jest.fn(async () => []),
    now: () => NOW,
    ...overrides,
  };
}

test('cycle read: two registry calls feed every request; a request without a collection stays null; summary carries no link or contacts', async () => {
  const d = deps();
  const map = await getMaterialsSummaryByRequests({ requestIds: [R1, R2], requestNumbers: NUMBERS, cycleCode: 'd26' }, d);
  expect(d.findDocumentsByCycle).toHaveBeenCalledWith('D26');
  expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
  expect(map.get(R2)).toBeNull();
  expect(map.get(R1)).toEqual({
    state: 'missing', receivedCount: 2, requiredCount: 3, otherCount: 0,
    dueAt: '2026-10-05T19:00:00.000Z', closesAt: '2026-10-14T19:00:00.000Z', overdue: true, invited: true,
  });
  expect(JSON.stringify(map.get(R1))).not.toMatch(/sealed|example\.edu|contributorUrl|contacts/);
});

test('without a cycle, one registry read per request that has a collection; waived items leave the required count', async () => {
  const waived = row({ checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: item.key === 'participant_bios' })) });
  const d = deps({ listLatestCollections: async () => [waived], findDocumentsByRequest: jest.fn(async () => [doc(R1, '1003222 Site Visit Presentation.pdf'), doc(R1, '1003222 Site Visit Presentation.pptx')]) });
  const map = await getMaterialsSummaryByRequests({ requestIds: [R1, R2], requestNumbers: NUMBERS }, d);
  expect(d.findDocumentsByRequest).toHaveBeenCalledTimes(1);
  expect(d.findDocumentsByCycle).not.toHaveBeenCalled();
  expect(map.get(R1)).toMatchObject({ state: 'received', receivedCount: 2, requiredCount: 2, overdue: false });
});

test('fail-open: readiness off, an empty id list, or any throw returns the complete all-null map without a registry read', async () => {
  const off = deps({ schemaReady: () => false });
  expect([...(await getMaterialsSummaryByRequests({ requestIds: [R1], requestNumbers: NUMBERS }, off)).entries()]).toEqual([[R1, null]]);
  expect(off.listLatestCollections).not.toHaveBeenCalled();
  expect((await getMaterialsSummaryByRequests({ requestIds: [], requestNumbers: NUMBERS }, deps())).size).toBe(0);
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const broken = deps({ listLatestCollections: async () => { throw new Error('relation does not exist'); } });
  expect([...(await getMaterialsSummaryByRequests({ requestIds: [R1, R2], requestNumbers: NUMBERS }, broken)).values()]).toEqual([null, null]);
  const brokenRegistry = deps({ findDocumentsByCycle: async () => { throw new Error('dataverse 503'); } });
  expect((await getMaterialsSummaryByRequests({ requestIds: [R1], requestNumbers: NUMBERS, cycleCode: 'D26' }, brokenRegistry)).get(R1)).toBeNull();
  log.mockRestore();
});

test('single request: projects the tracker read down; readiness 503 and other failures are null', async () => {
  const collection = { id: 'c1', state: 'ready', checklist: [{ key: 'presentation_pdf', required: true, waived: false, received: { artifactId: 'x' } }], other: [{ artifactId: 'o' }], dueAt: 'd', closesAt: 'c', overdue: false, invitedAt: 'i', contributorUrl: 'https://secret', contacts: { pi: { email: 'pi@example.edu' } } };
  const summary = await getMaterialsSummaryForRequest({ requestId: R1 }, { getCollection: async () => ({ collection }) });
  expect(summary).toEqual({ state: 'ready', receivedCount: 1, requiredCount: 1, otherCount: 1, dueAt: 'd', closesAt: 'c', overdue: false, invited: true });
  expect(await getMaterialsSummaryForRequest({ requestId: R1 }, { getCollection: async () => ({ collection: null }) })).toBeNull();
  expect(await getMaterialsSummaryForRequest({ requestId: R1 }, { getCollection: async () => { throw Object.assign(new Error('off'), { code: 'site_visit_materials_schema_not_ready' }); } })).toBeNull();
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(await getMaterialsSummaryForRequest({ requestId: R1 }, { getCollection: async () => { throw new Error('db'); } })).toBeNull();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

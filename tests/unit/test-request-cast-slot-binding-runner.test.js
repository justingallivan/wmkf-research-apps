import { inspectCastSlotBinding, runCastSlotBinding, runConfirmedCastSlotBinding } from '../../lib/services/test-requests/cast-slot-binding-runner.js';
import { fenceCastSlotClient } from '../../lib/services/test-requests/production-write-fence.js';

const RUN = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const SOURCE = '55555555-5555-4555-8555-555555555555';

function fixture({ slots = [null, null, null, null, null], patch = 'ok', journal = null, metadata = 'ok' } = {}) {
  let requestSlots = [...slots];
  let etag = 'W/"10"';
  let row = journal;
  const ledger = {
    getRun: jest.fn(async () => ({ runId: RUN, sourceRequestId: SOURCE, destinationRequestId: REQUEST, destinationEnvironment: 'production', status: 'ready' })),
    listCastMembers: jest.fn(async () => [{ memberId: PERSON, role: 'suggested_reviewer', status: 'verified' }]),
    getCastBinding: jest.fn(async () => ({ runId: RUN, memberId: PERSON, status: 'verified' })),
    getCastSlotBinding: jest.fn(async () => row),
    planCastSlotBinding: jest.fn(async () => {
      row = { runId: RUN, memberId: PERSON, expectedRequestId: REQUEST, expectedPersonId: PERSON, status: 'planned' };
      return row;
    }),
    recordCastSlotSnapshot: jest.fn(async ({ etag: beforeEtag, slots: beforeSlots }) => {
      row = { ...row, beforeEtag, beforeSlots, status: 'planned' };
      return row;
    }),
    markCastSlotDispatched: jest.fn(async () => { row = { ...row, status: 'dispatched' }; return row; }),
    markCastSlotVerified: jest.fn(async ({ provenance, readback }) => {
      row = { ...row, status: 'verified', provenance, afterSlots: readback.slots };
      return row;
    }),
    markCastSlotNeedsAttention: jest.fn(async ({ failureCode }) => {
      row = { ...row, status: 'needs_attention', failureCode };
      return row;
    }),
  };
  const requestBody = () => ({
    akoya_requestid: REQUEST,
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: RUN,
    '@odata.etag': etag,
    ...Object.fromEntries(requestSlots.map((id, index) => [`_wmkf_potentialreviewer${index + 1}_value`, id])),
  });
  const client = {
    baseUrl: 'https://wmkf.crm.dynamics.com',
    get: jest.fn(async (path) => {
      if (path.startsWith('/akoya_requests(')) return { ok: true, body: requestBody() };
      if (path.startsWith('/wmkf_potentialreviewerses(')) return { ok: true, body: {
        wmkf_potentialreviewersid: PERSON, statecode: 0, wmkf_issyntheticreviewer: true,
      } };
      if (path.includes('/ManyToOneRelationships?')) {
        if (metadata === 'unavailable') throw new Error('temporary metadata read failure');
        return { ok: true, body: { value: [{
        ReferencingAttribute: 'wmkf_potentialreviewer1',
        ReferencedEntity: 'wmkf_potentialreviewers',
        ReferencingEntityNavigationPropertyName: 'wmkf_PotentialReviewer1',
      }] } };
      }
      throw new Error(`unexpected read ${path}`);
    }),
    patchWithOptions: jest.fn(async () => {
      if (patch === 'lost') { requestSlots[0] = PERSON; etag = 'W/"11"'; throw new Error('lost response'); }
      if (patch === 'conflict_match') { requestSlots[0] = PERSON; etag = 'W/"11"'; return { ok: false, status: 412 }; }
      if (patch === 'conflict_other') { requestSlots[0] = OTHER; etag = 'W/"11"'; return { ok: false, status: 412 }; }
      if (patch === 'unchanged_etag') { requestSlots[0] = PERSON; return { ok: true, status: 204 }; }
      requestSlots[0] = PERSON; etag = 'W/"11"'; return { ok: true, status: 204 };
    }),
    post: jest.fn(),
  };
  return { client, ledger, setSlots: (next) => { requestSlots = next; }, getRow: () => row };
}

test('a hand-set cast slot is observed and never patched', async () => {
  const f = fixture({ slots: [PERSON, OTHER, null, null, null] });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).resolves.toMatchObject({ provenance: 'observed_preexisting' });
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
  expect(f.ledger.recordCastSlotSnapshot).toHaveBeenCalledWith(expect.objectContaining({ slots: [PERSON, OTHER, null, null, null] }));
});

test('the separate slot preview reads exact target and occupancy without a journal or PATCH write', async () => {
  const f = fixture({ slots: [null, OTHER, null, null, null] });
  await expect(inspectCastSlotBinding({ ...f, runId: RUN })).resolves.toMatchObject({
    runId: RUN, requestId: REQUEST, personId: PERSON, requestEtag: 'W/"10"',
    outcome: 'occupied', journalStatus: 'absent',
  });
  expect(f.ledger.planCastSlotBinding).not.toHaveBeenCalled();
  expect(f.ledger.recordCastSlotSnapshot).not.toHaveBeenCalled();
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test('a confirmation for another Request cannot plan or dispatch a slot operation', async () => {
  const f = fixture();
  await expect(runConfirmedCastSlotBinding({ ...f, runId: RUN, confirmedRequestId: OTHER }))
    .rejects.toMatchObject({ code: 'cast_slot_confirmation_mismatch' });
  expect(f.ledger.planCastSlotBinding).not.toHaveBeenCalled();
  expect(f.ledger.markCastSlotDispatched).not.toHaveBeenCalled();
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test('a matching confirmation invokes one fenced slot operation', async () => {
  const f = fixture();
  await expect(runConfirmedCastSlotBinding({ ...f, runId: RUN, confirmedRequestId: REQUEST }))
    .resolves.toMatchObject({ provenance: 'confirmed_patch' });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
});

test('an empty Request sends exactly one concrete ETag PATCH and verifies readback', async () => {
  const f = fixture();
  await expect(runCastSlotBinding({ ...f, runId: RUN })).resolves.toMatchObject({ provenance: 'confirmed_patch' });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
  expect(f.client.patchWithOptions).toHaveBeenCalledWith(`/akoya_requests(${REQUEST})`, {
    'wmkf_PotentialReviewer1@odata.bind': `/wmkf_potentialreviewerses(${PERSON})`,
  }, { 'If-Match': 'W/"10"' });
  await runCastSlotBinding({ ...f, runId: RUN });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
});

test('an occupied other slot stops with a persisted refusal and zero PATCHes', async () => {
  const f = fixture({ slots: [null, OTHER, null, null, null] });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).rejects.toMatchObject({ code: 'cast_slot_occupied_slot' });
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
  expect(f.getRow()).toMatchObject({ status: 'needs_attention', failureCode: 'occupied_slot' });
});

test.each([
  ['lost', 'observed_after_ambiguous_dispatch'],
  ['conflict_match', 'observed_after_conflict'],
])('a %s PATCH response is recovered by exact readback without retry', async (patch, provenance) => {
  const f = fixture({ patch });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).resolves.toMatchObject({ provenance });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
});

test('a nonmatching 412 stops without retry', async () => {
  const f = fixture({ patch: 'conflict_other' });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).rejects.toMatchObject({ code: 'cast_slot_etag_conflict' });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
  expect(f.getRow()).toMatchObject({ status: 'needs_attention' });
});

test('a metadata read failure leaves the planned journal retriable without a PATCH', async () => {
  const f = fixture({ metadata: 'unavailable' });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).rejects.toMatchObject({ code: 'cast_slot_metadata_unavailable' });
  expect(f.getRow()).toMatchObject({ status: 'planned' });
  expect(f.ledger.markCastSlotNeedsAttention).not.toHaveBeenCalled();
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test('a matching slot without a new row version stops for inspection', async () => {
  const f = fixture({ patch: 'unchanged_etag' });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).rejects.toMatchObject({ code: 'cast_slot_readback_mismatch' });
  expect(f.getRow()).toMatchObject({ status: 'needs_attention', failureCode: 'readback_mismatch' });
  expect(f.client.patchWithOptions).toHaveBeenCalledTimes(1);
});

test('a dispatched journal resumes by readback without any second PATCH', async () => {
  const f = fixture({ slots: [PERSON, null, null, null, null], journal: {
    runId: RUN, memberId: PERSON, expectedRequestId: REQUEST, expectedPersonId: PERSON,
    status: 'dispatched', beforeSlots: [null, null, null, null, null],
  } });
  await expect(runCastSlotBinding({ ...f, runId: RUN })).resolves.toMatchObject({ provenance: 'observed_after_ambiguous_dispatch' });
  expect(f.client.patchWithOptions).not.toHaveBeenCalled();
});

test.each([undefined, '*', 'W/"not-numeric"'])('the slot fence rejects nonconcrete ETag %s', (etag) => {
  const client = { patchWithOptions: jest.fn() };
  expect(() => fenceCastSlotClient(client, {
    destinationRequestId: REQUEST, sourceRequestId: SOURCE, personId: PERSON,
    navigationProperty: 'wmkf_PotentialReviewer1', etag,
  })).toThrow(/concrete ETag/);
  expect(client.patchWithOptions).not.toHaveBeenCalled();
});

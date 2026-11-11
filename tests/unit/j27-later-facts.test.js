/**
 * J27 later-phase facts (plan: J27_LATER_PHASE_LISTS_PLAN_2026-11-10, step 1).
 * Each mapping has a case where the condition it guards is present in the
 * setup, so a removed rule fails a test rather than passing by absence.
 */
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE,
  REQUEST_DOCUMENT_OPERATION_STATUS as OP,
  PRE_SITE_VISIT_CONTRACT,
} from '../../shared/config/requestDocument.js';
import {
  documentFacts, isAcceptedPresentationRow, loadJ27LaterFacts, presentationBinding, presentationFact, rosterFact,
} from '../../lib/services/workbench/j27-later-facts.js';
import { deriveJ27Stage } from '../../lib/services/workbench/j27-read-model.js';

const R = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const S = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333';
const V = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const NOW = Date.parse('2027-05-01T00:00:00Z');
// Completed is eligible, Open is a known non-eligible state, Scheduled is eligible.
const PAIRS = [
  { stateCode: 1, statusCode: 2, eligible: true },
  { stateCode: 3, statusCode: 4, eligible: true },
  { stateCode: 2, statusCode: 3, eligible: false },
];

const source = (over = {}) => ({
  wmkf_requestdocumentid: S, _wmkf_request_value: R, wmkf_artifacttype: TYPE.PRE_SITE_VISIT,
  wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.REVIEW, wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
  wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'item', _etag: 'W/"1"', ...over,
});
const final = (over = {}) => ({
  wmkf_requestdocumentid: F, _wmkf_request_value: R, wmkf_artifacttype: TYPE.FINAL_WRITEUP,
  wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.REVIEW, _wmkf_sourcedocument_value: S,
  wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'item', wmkf_sharepointweburl: 'https://example.invalid/doc',
  wmkf_sourceversionid: '3.0', wmkf_sourcecontenthash: 'hash', wmkf_groupreviewstartedat: '2027-05-10T00:00:00Z',
  _wmkf_groupreviewstartedby_value: USER, ...over,
});
const leadership = (over = {}) => final({
  wmkf_lifecyclestate: LIFE.FINAL, wmkf_leadershipreviewstartedat: '2027-05-20T00:00:00Z',
  _wmkf_leadershipreviewstartedby_value: USER, wmkf_sharepointversionid: '4.0', wmkf_sharepointetag: 'etag',
  wmkf_sharepointlastmodified: '2027-05-19T00:00:00Z', wmkf_filesize: 100, wmkf_contenthash: 'content', ...over,
});
const request = (over = {}) => ({ akoya_requestid: R, _wmkf_currentpresitevisit_value: S, _wmkf_currentfinalwriteup_value: null, ...over });
const visit = (over = {}) => ({
  activityid: V, _regardingobjectid_value: R, statecode: 1, statuscode: 2,
  scheduledstart: '2027-04-20T17:00:00Z', scheduledend: '2027-04-20T18:00:00Z', ...over,
});
const ready = { schemaReady: true };
const options = { pairs: PAIRS, nowMs: NOW };

describe('documentFacts', () => {
  test('an eligible draft with no Final pointer: draft exists, no review stage', () => {
    expect(documentFacts(request(), [source()], ready)).toEqual({
      boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: null },
    });
  });

  test('no current draft is a known state, not a failed read', () => {
    expect(documentFacts(request({ _wmkf_currentpresitevisit_value: null }), [], ready)).toEqual({
      boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null },
    });
  });

  test.each([
    ['still a working draft', { wmkf_lifecyclestate: LIFE.DRAFT }],
    ['still generating', { wmkf_operationstatus: OP.GENERATING }],
  ])('a draft that is %s is not yet a Board draft', (_label, over) => {
    expect(documentFacts(request(), [source(over)], ready).boardDraft).toEqual({ status: 'present', exists: false });
  });

  test('group review: the draft row has moved to the Final lifecycle and still counts as existing', () => {
    const facts = documentFacts(request({ _wmkf_currentfinalwriteup_value: F }),
      [source({ wmkf_lifecyclestate: LIFE.FINAL }), final()], ready);
    expect(facts).toEqual({
      boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: 'group-review' },
    });
    // The stage model must not ask for a Board draft during review.
    const stage = deriveJ27Stage({
      request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending' },
      visitAssessment: { status: 'present' }, ...facts,
    });
    expect(stage.phase).toBe('final-assessment');
    expect(stage.taskKeys).not.toContain('write-board-draft');
  });

  test('leadership review passes the checkpoint through the fields a list-facts row carries', () => {
    const facts = documentFacts(request({ _wmkf_currentfinalwriteup_value: F }),
      [source({ wmkf_lifecyclestate: LIFE.FINAL }), leadership()], ready);
    expect(facts.transition).toEqual({ status: 'present', phase: 'leadership-review' });
  });

  test.each(['wmkf_sharepointetag', 'wmkf_contenthash', 'wmkf_sourceversionid', 'wmkf_sourcecontenthash'])(
    'a Final row missing %s is a failed read, not a missing draft', (field) => {
      const facts = documentFacts(request({ _wmkf_currentfinalwriteup_value: F }),
        [source({ wmkf_lifecyclestate: LIFE.FINAL }), leadership({ [field]: null })], ready);
      expect(facts).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
    },
  );

  test.each([
    ['a Final pointer to a missing row', request({ _wmkf_currentfinalwriteup_value: F }), [source()]],
    ['a Final pointer to a row of the wrong type', request({ _wmkf_currentfinalwriteup_value: S }), [source()]],
    ['a draft already Final with no Final pointer', request(), [source({ wmkf_lifecyclestate: LIFE.FINAL })]],
    ['a draft pointer to a missing row', request(), []],
    ['a draft with no SharePoint identity', request(), [source({ wmkf_sharepointitemid: null })]],
  ])('%s is unavailable', (_label, req, rows) => {
    expect(documentFacts(req, rows, ready)).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
  });

  test('two Final rows being generated for the draft need reconciliation: not "ready to start"', () => {
    const pending = (id) => final({ wmkf_requestdocumentid: id, wmkf_operationstatus: OP.GENERATING });
    const rows = [source(), pending(F), pending('77777777-7777-4777-8777-777777777777')];
    const facts = documentFacts(request(), rows, ready);
    expect(facts).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } });
    const stage = deriveJ27Stage({
      request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending' },
      presentation: { status: 'present', exists: true, id: V, ended: true, legacyException: false }, ...facts,
    });
    expect(stage.taskKeys).not.toContain('start-group-review');
    // One Final row being generated is an ordinary state.
    expect(documentFacts(request(), [source(), pending(F)], ready).boardDraft).toEqual({ status: 'present', exists: true });
  });

  test('another request\'s rows are ignored', () => {
    const facts = documentFacts(request(), [source({ _wmkf_request_value: OTHER })], ready);
    expect(facts.boardDraft).toEqual({ status: 'unavailable' });
  });

  test('a missing write fence does not hide a draft from a reader', () => {
    expect(documentFacts(request(), [source({ _etag: undefined })], ready).boardDraft).toEqual({ status: 'present', exists: true });
  });

  test('transition schema off: an eligible draft still exists, only the review stage is not provisioned', () => {
    const facts = documentFacts(request(), [source()], { schemaReady: false });
    expect(facts).toEqual({ boardDraft: { status: 'present', exists: true }, transition: { status: 'not-provisioned' } });
    // Hiding the draft would leave this request in Deliberations (Codex plan review 3).
    const stage = deriveJ27Stage({
      request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending' },
      visitAssessment: { status: 'present' }, roster: { status: 'present', stale: false },
      presentation: { status: 'present', exists: true, id: V, ended: true, legacyException: false }, ...facts,
    });
    expect(stage.phase).toBe('final-assessment');
  });

  test('transition schema off: no draft is still "no draft", and a Final pointer still means a draft was handed off', () => {
    const off = { schemaReady: false };
    expect(documentFacts(request({ _wmkf_currentpresitevisit_value: null }), [], off).boardDraft).toEqual({ status: 'present', exists: false });
    expect(documentFacts(request({ _wmkf_currentfinalwriteup_value: F }), [source({ wmkf_lifecyclestate: LIFE.FINAL })], off)).toEqual({
      boardDraft: { status: 'present', exists: true }, transition: { status: 'not-provisioned' },
    });
    expect(documentFacts(request(), [], off)).toEqual({ boardDraft: { status: 'unavailable' }, transition: { status: 'not-provisioned' } });
  });
});

describe('presentationFact', () => {
  test('no record: no presentation, timing unknown', () => {
    expect(presentationFact(R, [], options).presentation).toEqual({
      status: 'present', exists: false, id: null, ended: null, legacyException: false,
    });
  });

  test('one completed record whose end has passed', () => {
    const seen = presentationFact(R, [visit()], options);
    expect(seen.presentation).toEqual({ status: 'present', exists: true, id: V, ended: true, legacyException: false });
    expect(seen.visit.activityid).toBe(V);
  });

  test('one scheduled record whose end is in the future', () => {
    const rows = [visit({ statecode: 3, statuscode: 4, scheduledend: '2027-06-01T18:00:00Z' })];
    expect(presentationFact(R, rows, options).presentation).toMatchObject({ exists: true, ended: false });
  });

  test('two eligible records: exists, timing unknown, no single identity', () => {
    const rows = [visit(), visit({ activityid: '66666666-6666-4666-8666-666666666666' })];
    const seen = presentationFact(R, rows, options);
    expect(seen.presentation).toMatchObject({ exists: true, ended: null, id: null });
    expect(seen.visit).toBeNull();
  });

  test('a record the configured pairs do not know leaves timing unknown', () => {
    const rows = [visit(), visit({ activityid: '66666666-6666-4666-8666-666666666666', statecode: 9, statuscode: 9 })];
    expect(presentationFact(R, rows, options).presentation.ended).toBeNull();
  });

  test('no configured pairs (the Preview today): the presentation exists and its end is unknown', () => {
    expect(presentationFact(R, [visit()], { pairs: [], nowMs: NOW }).presentation).toMatchObject({ exists: true, ended: null });
  });

  test('a cancelled record is not a presentation', () => {
    const rows = [visit({ statecode: 2, statuscode: 3 })];
    expect(isAcceptedPresentationRow(rows[0])).toBe(false);
    expect(presentationFact(R, rows, options).presentation).toMatchObject({ exists: false, ended: null });
  });

  test('another request\'s record is ignored', () => {
    expect(presentationFact(R, [visit({ _regardingobjectid_value: OTHER })], options).presentation.exists).toBe(false);
  });

  test('legacyException is never granted (D63)', () => {
    expect(presentationFact(R, [], { pairs: [], nowMs: NOW }).presentation.legacyException).toBe(false);
  });
});

describe('rosterFact', () => {
  const seen = presentationFact(R, [visit()], options);
  const stored = (binding) => JSON.stringify({ [V]: { binding, wmkf: ['A'], consultants: [] } });
  const on = { rosterEnabled: true };

  test('a roster saved against this presentation and schedule', () => {
    const req = request({ wmkf_confirmedmeetingroster: stored(presentationBinding(seen.visit)) });
    expect(rosterFact(req, seen, on)).toEqual({ status: 'present', stale: false });
  });

  test('a roster saved before the presentation was rescheduled is stale', () => {
    const req = request({ wmkf_confirmedmeetingroster: stored('older-binding') });
    expect(rosterFact(req, seen, on)).toEqual({ status: 'present', stale: true });
  });

  test('a roster saved for a different presentation does not count', () => {
    const req = request({ wmkf_confirmedmeetingroster: JSON.stringify({ [OTHER]: { binding: 'x' } }) });
    expect(rosterFact(req, seen, on)).toEqual({ status: 'absent' });
  });

  test('no presentation: absent; two presentations: unavailable; unreadable storage: absent and stale', () => {
    expect(rosterFact(request(), presentationFact(R, [], options), on)).toEqual({ status: 'absent' });
    const two = presentationFact(R, [visit(), visit({ activityid: '66666666-6666-4666-8666-666666666666' })], options);
    expect(rosterFact(request(), two, on)).toEqual({ status: 'unavailable' });
    expect(rosterFact(request({ wmkf_confirmedmeetingroster: '{' }), seen, on)).toEqual({ status: 'absent', stale: true });
  });

  test('a stored entry whose names do not validate is not a confirmed roster, even with a matching binding', () => {
    const value = JSON.stringify({ [V]: { binding: presentationBinding(seen.visit), wmkf: 'Alice', consultants: [] } });
    const fact = rosterFact(request({ wmkf_confirmedmeetingroster: value }), seen, on);
    expect(fact).toEqual({ status: 'absent', stale: true });
    const stage = deriveJ27Stage({
      request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending' },
      presentation: seen.presentation, roster: fact,
    });
    expect(stage.taskKeys).toContain('confirm-roster');
  });

  test('a presentation only the configured schedule pairs recognise cannot be confirmed, so it is not asked for', () => {
    const pairs = [{ stateCode: 0, statusCode: 3, eligible: true }];
    const odd = presentationFact(R, [visit({ statecode: 0, statuscode: 3 })], { pairs, nowMs: NOW });
    expect(odd.presentation).toMatchObject({ exists: true, ended: true });
    const fact = rosterFact(request(), odd, on);
    expect(fact).toEqual({ status: 'unavailable' });
    const stage = deriveJ27Stage({
      request: { status: 'present', cycleCode: 'J27', phaseIStatus: 100000003, requestStatus: 'Phase II Pending' },
      presentation: odd.presentation, roster: fact,
    });
    expect(stage.taskKeys).not.toContain('confirm-roster');
  });

  test('schema off reads not-provisioned even when a roster is stored', () => {
    const req = request({ wmkf_confirmedmeetingroster: stored(presentationBinding(seen.visit)) });
    expect(rosterFact(req, seen, { rosterEnabled: false })).toEqual({ status: 'not-provisioned' });
  });
});

describe('loadJ27LaterFacts', () => {
  const deps = (over = {}) => ({
    findDocuments: jest.fn(async (_ids, { artifactType }) => ({
      records: artifactType === TYPE.PRE_SITE_VISIT ? [source()] : [],
    })),
    findSiteVisits: jest.fn(async () => ({ records: [visit()] })),
    schemaReady: () => true,
    rosterEnabled: () => true,
    readSchedulePairs: () => PAIRS,
    now: () => NOW,
    ...over,
  });

  test('three batched reads for the whole set, none per row', async () => {
    const d = deps();
    const second = request({ akoya_requestid: OTHER, _wmkf_currentpresitevisit_value: null });
    const facts = await loadJ27LaterFacts([request(), second], d);
    expect(d.findDocuments).toHaveBeenCalledTimes(2);
    expect(d.findSiteVisits).toHaveBeenCalledTimes(1);
    expect(d.findSiteVisits).toHaveBeenCalledWith([R, OTHER]);
    expect(d.findDocuments.mock.calls.every(([ids, opts]) => ids.length === 2 && opts.listFactsOnly === true)).toBe(true);
    expect(facts.get(R)).toEqual({
      presentation: { status: 'present', exists: true, id: V, ended: true, legacyException: false },
      roster: { status: 'absent' },
      boardDraft: { status: 'present', exists: true },
      transition: { status: 'present', phase: null },
    });
    expect(facts.get(OTHER)).toMatchObject({
      presentation: { exists: false }, boardDraft: { status: 'present', exists: false },
    });
  });

  test('a failed presentation read marks only its keys unavailable and does not throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const facts = await loadJ27LaterFacts([request()], deps({ findSiteVisits: jest.fn(async () => { throw new Error('down'); }) }));
    expect(facts.get(R)).toMatchObject({
      presentation: { status: 'unavailable' }, roster: { status: 'unavailable' },
      boardDraft: { status: 'present', exists: true },
    });
    warn.mockRestore();
  });

  test('a capped document read marks the document keys unavailable, presentation intact', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const facts = await loadJ27LaterFacts([request()], deps({ findDocuments: jest.fn(async () => ({ records: [source()], capped: true })) }));
    expect(facts.get(R)).toMatchObject({
      boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' },
      presentation: { status: 'present', exists: true },
    });
    warn.mockRestore();
  });

  test('transition schema off: drafts are still read, Final rows are not', async () => {
    const d = deps({ schemaReady: () => false });
    const facts = await loadJ27LaterFacts([request()], d);
    expect(d.findDocuments).toHaveBeenCalledTimes(1);
    expect(d.findDocuments.mock.calls[0][1].artifactType).toBe(TYPE.PRE_SITE_VISIT);
    expect(facts.get(R)).toMatchObject({ boardDraft: { status: 'present', exists: true }, transition: { status: 'not-provisioned' } });
  });

  test('no requests: no reads', async () => {
    const d = deps();
    expect((await loadJ27LaterFacts([], d)).size).toBe(0);
    expect(d.findSiteVisits).not.toHaveBeenCalled();
  });
});

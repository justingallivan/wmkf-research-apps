/** @jest-environment node */
import {
  getWorkbenchIntegrityContext,
  recordWorkbenchIntegrityReview,
} from '../../lib/services/workbench/integrity-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM_ID = '22222222-2222-4222-8222-222222222222';
const PERSON = { contactId: CONTACT_ID, name: 'Ada Example', institution: 'North University', role: 'PI' };
const RESULT = {
  name: PERSON.name,
  institution: PERSON.institution,
  sourceCoverageVersion: 1,
  matchCount: 0,
  sources: {
    retraction_watch: { searched: true, matches: [], error: null },
    pubpeer: { searched: true, summary: 'No results', error: null },
    news: { searched: true, summary: 'No results', error: null },
  },
};
const RUN = {
  id: 10,
  request_id: REQUEST_ID,
  created_at: '2026-09-26T20:00:00.000Z',
  screened_names: [PERSON],
  results: [RESULT],
  match_count: 0,
  status: 'pending',
};

function dataverseDependencies({ people = [PERSON], programDirectorId = SYSTEM_ID } = {}) {
  return {
    grantRequestAdapter: { getById: jest.fn().mockResolvedValue({
      akoya_requestid: REQUEST_ID,
      _wmkf_projectleader_value: CONTACT_ID,
      _wmkf_programdirector_value: programDirectorId,
    }) },
    appRequestPersonAdapter: { queryAllPersons: jest.fn().mockResolvedValue({ records: people.map((person) => ({
      _wmkf_contact_value: person.contactId,
      wmkf_role: person.role === 'PI' ? 100000000 : 100000001,
      wmkf_Contact: {
        fullname: person.name,
        adx_organizationname: person.institution,
      },
    })), capped: false }) },
    contactAdapter: { getByIdWithSelect: jest.fn() },
    getUserRole: jest.fn().mockResolvedValue('read_only'),
    peopleOverride: people,
  };
}

function dependenciesFor(peopleDeps, options = {}) {
  const state = {
    runs: options.runs || [RUN],
    reviews: options.reviews || [],
    inserts: [],
    sqlCalls: [],
    makeConcurrentRun: options.makeConcurrentRun || null,
    staleAtAppend: options.staleAtAppend || null,
  };
  const db = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    state.sqlCalls.push({ query, values });
    if (query.includes('INSERT INTO integrity_screening_reviews')) {
      if (state.staleAtAppend) state.runs = [state.staleAtAppend, ...state.runs];
      const conditional = query.includes('WHERE ? = ( SELECT id FROM integrity_screenings WHERE request_id = ? ORDER BY created_at DESC, id DESC LIMIT 1 )');
      if (conditional) {
        const latest = state.runs.filter((run) => run.request_id === values[7])
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id - left.id)[0];
        if (!latest || String(latest.id) !== String(values[6])) return { rows: [] };
      }
      state.inserts.push(values);
      state.reviews.unshift({
        id: 501 + state.inserts.length,
        screening_id: values[0],
        request_id: values[1],
        reviewer_profile_id: values[2],
        reviewer_systemuser_id: values[3],
        decision: values[4],
        notes: values[5],
        created_at: '2026-09-26T21:00:00.000Z',
        display_name: 'PD Reviewer',
      });
      if (state.makeConcurrentRun) state.runs = [state.makeConcurrentRun, ...state.runs];
      return { rows: [{ id: 500 + state.inserts.length }] };
    }
    if (query.includes('FROM integrity_screenings') && query.includes('AND id = ?')) {
      const [requestId, id] = values;
      return { rows: state.runs.filter((run) => run.request_id === requestId && String(run.id) === String(id)).slice(0, 1) };
    }
    if (query.includes('FROM integrity_screenings') && query.includes('ORDER BY created_at DESC, id DESC') && query.includes('LIMIT 1')) {
      const requestId = values[0];
      return { rows: state.runs.filter((run) => run.request_id === requestId).slice(0, 1) };
    }
    if (query.includes('FROM integrity_screenings') && query.includes('ORDER BY created_at DESC, id DESC')) {
      const requestId = values[0];
      return { rows: state.runs.filter((run) => run.request_id === requestId).slice(0, 21) };
    }
    if (query.includes('FROM integrity_screening_reviews r')) {
      const screeningId = query.includes('ANY(?)') ? null : values[0];
      const rows = state.reviews.filter((review) => screeningId === null
        ? values[0].map(String).includes(String(review.screening_id))
        : String(review.screening_id) === String(screeningId));
      return { rows };
    }
    if (query.includes('FROM integrity_screenings') && query.includes('LIMIT 1')) {
      const [requestId, id] = values;
      return { rows: state.runs.filter((run) => run.request_id === requestId && String(run.id) === String(id)).slice(0, 1) };
    }
    return { rows: [] };
  };
  return { ...peopleDeps, ...options.dependencies, sql: db, state };
}

function reviewArgs(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    screeningId: RUN.id,
    decision: 'approved',
    notes: '',
    profileId: 42,
    actingUserSystemId: SYSTEM_ID,
    ...overrides,
  };
}

test('fresh lead-PD role and linked identity can append approval to the exact latest complete roster', async () => {
  const peopleDeps = dataverseDependencies();
  const deps = dependenciesFor(peopleDeps);
  const result = await recordWorkbenchIntegrityReview(reviewArgs(), deps);
  expect(peopleDeps.getUserRole).toHaveBeenCalledWith(42);
  expect(deps.state.inserts).toHaveLength(1);
  expect(deps.state.inserts[0].slice(0, 6)).toEqual([RUN.id, REQUEST_ID, 42, SYSTEM_ID, 'approved', '']);
  expect(deps.state.sqlCalls.find(({ query }) => query.includes('INSERT INTO integrity_screening_reviews')).query)
    .toContain('ORDER BY created_at DESC, id DESC LIMIT 1');
  expect(result.review.status).toBe('approved');
  expect(result.review.canReview).toBe(true);
  expect(result.review.canApprove).toBe(false);
  expect(result.review.latestDecision).toMatchObject({
    screeningId: RUN.id, decision: 'approved', reviewerName: 'PD Reviewer',
    reviewerProfileId: 42, reviewerSystemId: SYSTEM_ID,
  });
});

test('superuser may review; an unrelated staff user cannot read run or append disposition', async () => {
  const superDeps = dataverseDependencies();
  superDeps.getUserRole.mockResolvedValue('superuser');
  const allowed = dependenciesFor(superDeps);
  await recordWorkbenchIntegrityReview(reviewArgs({ actingUserSystemId: '33333333-3333-4333-8333-333333333333' }), allowed);
  expect(allowed.state.inserts).toHaveLength(1);

  const staffDeps = dataverseDependencies();
  const denied = dependenciesFor(staffDeps);
  await expect(recordWorkbenchIntegrityReview(reviewArgs({ actingUserSystemId: '33333333-3333-4333-8333-333333333333' }), denied))
    .rejects.toMatchObject({ httpStatus: 403, body: { code: 'integrity_review_forbidden' } });
  expect(denied.state.sqlCalls).toHaveLength(0);
  expect(denied.state.inserts).toHaveLength(0);
});

test('approval rejects historical, cross-request, stale-roster, incomplete, and unversioned runs', async () => {
  const peopleDeps = dataverseDependencies();
  const staleRuns = [
    { ...RUN, id: 11, created_at: '2026-09-26T21:00:00.000Z' },
  ];
  const crossRequest = dependenciesFor(peopleDeps, {
    runs: [{ ...RUN, id: 11, request_id: '99999999-9999-4999-8999-999999999999' }],
  });
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), crossRequest))
    .rejects.toMatchObject({ httpStatus: 404, body: { code: 'screening_not_found' } });
  expect(crossRequest.state.inserts).toHaveLength(0);

  const historical = dependenciesFor(peopleDeps, { runs: [{ ...RUN, id: 11 }, RUN] });
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), historical))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'screening_not_latest' } });
  expect(historical.state.inserts).toHaveLength(0);

  const changedDeps = dataverseDependencies({ people: [{ ...PERSON, institution: 'Changed University' }] });
  const changed = dependenciesFor(changedDeps);
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), changed))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'integrity_roster_changed' } });
  expect(changed.state.inserts).toHaveLength(0);

  const incomplete = dependenciesFor(peopleDeps, { runs: [{ ...RUN, results: [{ ...RESULT, sources: { ...RESULT.sources, news: { searched: false, error: 'unavailable' } } }] }] });
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), incomplete))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'integrity_screen_incomplete' } });
  expect(incomplete.state.inserts).toHaveLength(0);

  const legacy = dependenciesFor(peopleDeps, { runs: [{ ...RUN, results: [{ ...RESULT, sourceCoverageVersion: undefined }] }] });
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), legacy))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'integrity_screen_incomplete' } });
  expect(legacy.state.inserts).toHaveLength(0);
});

test('a deleted named junction contact reports identity_unavailable, not roster_changed, and blocks approval', async () => {
  const peopleDeps = dataverseDependencies({ people: [{ ...PERSON, institution: '' }] });
  peopleDeps.contactAdapter.getByIdWithSelect.mockRejectedValue(Object.assign(new Error('Dataverse record is unavailable'), {
    serviceName: 'dataverse', status: 404, dataverseCode: '0x80040217',
  }));
  const deps = dependenciesFor(peopleDeps);
  const context = await getWorkbenchIntegrityContext({ requestId: REQUEST_ID, profileId: 42, actingUserSystemId: SYSTEM_ID }, deps);
  expect(context.people[0]).toMatchObject({ name: PERSON.name, identityUnavailable: true });
  expect(context.review.status).toBe('identity_unavailable');
  expect(context.review.canApprove).toBe(false);
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), deps))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'person_identity_unavailable' } });
  expect(deps.state.inserts).toHaveLength(0);
});

test('hold is allowed for incomplete latest run but requires nonblank notes and bounded text', async () => {
  const incompleteRun = { ...RUN, results: [{ ...RESULT, sourceCoverageVersion: undefined }] };
  const emptyNotes = dependenciesFor(dataverseDependencies(), { runs: [incompleteRun] });
  await expect(recordWorkbenchIntegrityReview(reviewArgs({ decision: 'hold', notes: '   ' }), emptyNotes))
    .rejects.toMatchObject({ body: { code: 'hold_notes_required' } });
  expect(emptyNotes.state.inserts).toHaveLength(0);

  const tooLong = dependenciesFor(dataverseDependencies(), { runs: [incompleteRun] });
  await expect(recordWorkbenchIntegrityReview(reviewArgs({ decision: 'hold', notes: 'x'.repeat(2001) }), tooLong))
    .rejects.toMatchObject({ body: { code: 'invalid_notes' } });
  expect(tooLong.state.inserts).toHaveLength(0);

  const allowed = dependenciesFor(dataverseDependencies(), { runs: [incompleteRun] });
  const result = await recordWorkbenchIntegrityReview(reviewArgs({ decision: 'hold', notes: 'Needs more review' }), allowed);
  expect(allowed.state.inserts[0][4]).toBe('hold');
  expect(allowed.state.inserts[0][5]).toBe('Needs more review');
  expect(result.review.status).toBe('hold');
  expect(result.review.latestDecision.decision).toBe('hold');
});

test('conditional append rejects when a newer run arrives after the precheck', async () => {
  const newerRun = { ...RUN, id: 11, created_at: '2026-09-26T22:00:00.000Z' };
  const deps = dependenciesFor(dataverseDependencies(), { staleAtAppend: newerRun });
  await expect(recordWorkbenchIntegrityReview(reviewArgs(), deps))
    .rejects.toMatchObject({ httpStatus: 409, body: { code: 'screening_not_latest' } });
  expect(deps.state.inserts).toHaveLength(0);
});

test('post-write refresh reports a concurrent newer run as needs_review', async () => {
  const newerRun = { ...RUN, id: 11, created_at: '2026-09-26T22:00:00.000Z' };
  const deps = dependenciesFor(dataverseDependencies(), { makeConcurrentRun: newerRun });
  const result = await recordWorkbenchIntegrityReview(reviewArgs(), deps);
  expect(deps.state.inserts).toHaveLength(1);
  expect(result.latestRun.id).toBe(11);
  expect(result.review.status).toBe('needs_review');
  expect(result.review.latestDecision).toBeNull();
});

test('history cursor is scoped to the request and pages with the timestamp/id tuple', async () => {
  const calls = [];
  const db = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.includes('SELECT id, created_at FROM integrity_screenings')) {
      return { rows: [{ id: 10, created_at: RUN.created_at }] };
    }
    if (query.includes('CROSS JOIN ( SELECT created_at, id')) return { rows: [] };
    if (query.includes('SELECT id, created_at, screened_names')) return { rows: [RUN] };
    return { rows: [] };
  };
  const deps = { ...dataverseDependencies(), sql: db };
  const result = await getWorkbenchIntegrityContext({
    requestId: REQUEST_ID, profileId: 42, actingUserSystemId: SYSTEM_ID, beforeRunId: 10,
  }, deps);
  expect(result.history).toEqual([]);
  const cursorCall = calls.find((call) => call.query.includes('SELECT id, created_at FROM integrity_screenings'));
  expect(cursorCall.query).toContain('request_id = ? AND id = ?');
  expect(cursorCall.values).toEqual([REQUEST_ID, 10]);
  const pageCall = calls.find((call) => call.query.includes('CROSS JOIN ( SELECT created_at, id'));
  expect(pageCall.query).toContain('(screening.created_at, screening.id) < (cursor.created_at, cursor.id)');
  expect(pageCall.values).toEqual([REQUEST_ID, 10, REQUEST_ID, 21]);
  expect(pageCall.values).not.toContain(RUN.created_at);
});

// Finding 9 (PR #366): repeated Dataverse and SQL reads.
const screeningReads = (deps) => deps.state.sqlCalls.filter(({ query }) => (
  query.includes('FROM integrity_screenings') && !query.includes('INSERT')
));

test('uncursored context reads the run list and its reviews once each', async () => {
  const review = { id: 7, screening_id: RUN.id, decision: 'hold', notes: 'Check', created_at: RUN.created_at, display_name: 'PD' };
  const deps = dependenciesFor(dataverseDependencies(), { runs: [{ ...RUN, id: 11, created_at: '2026-09-27T00:00:00.000Z' }, RUN], reviews: [review] });
  const result = await getWorkbenchIntegrityContext({ requestId: REQUEST_ID, profileId: 42, actingUserSystemId: SYSTEM_ID }, deps);
  expect(screeningReads(deps)).toHaveLength(1);
  expect(deps.state.sqlCalls.filter(({ query }) => query.includes('FROM integrity_screening_reviews r'))).toHaveLength(1);
  expect(result.latestRun).toEqual({
    id: 11, createdAt: '2026-09-27T00:00:00.000Z', screenedNames: RUN.screened_names,
    results: RUN.results, matchCount: 0, status: 'pending',
  });
  expect(result.latestRun).not.toHaveProperty('reviews');
  expect(result.history.map((run) => run.id)).toEqual([11, 10]);
  expect(result.review.latestDecision).toBeNull();
});

test('cursored context still reports the true latest run, not the page head', async () => {
  const runs = [{ ...RUN, id: 11, created_at: '2026-09-27T00:00:00.000Z' }, RUN];
  const db = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.includes('SELECT id, created_at FROM integrity_screenings')) return { rows: [runs[0]] };
    if (query.includes('CROSS JOIN')) return { rows: [RUN] };
    if (query.includes('ORDER BY created_at DESC, id DESC LIMIT 1')) return { rows: [runs[0]] };
    return { rows: [] };
  };
  const result = await getWorkbenchIntegrityContext({
    requestId: REQUEST_ID, profileId: 42, actingUserSystemId: SYSTEM_ID, beforeRunId: 11,
  }, { ...dataverseDependencies(), sql: db });
  expect(result.history.map((run) => run.id)).toEqual([10]);
  expect(result.latestRun.id).toBe(11);
});

test('recording a disposition loads Dataverse and the actor role once and reads the target once', async () => {
  const peopleDeps = dataverseDependencies();
  const deps = dependenciesFor(peopleDeps);
  const result = await recordWorkbenchIntegrityReview(reviewArgs(), deps);
  expect(peopleDeps.grantRequestAdapter.getById).toHaveBeenCalledTimes(1);
  expect(peopleDeps.appRequestPersonAdapter.queryAllPersons).toHaveBeenCalledTimes(1);
  expect(peopleDeps.getUserRole).toHaveBeenCalledTimes(1);
  const insertIndex = deps.state.sqlCalls.findIndex(({ query }) => query.includes('INSERT INTO integrity_screening_reviews'));
  expect(deps.state.sqlCalls.slice(0, insertIndex).filter(({ query }) => query.includes('FROM integrity_screenings'))).toHaveLength(1);
  expect(result.review.status).toBe('approved');
  expect(result.people).toEqual([PERSON]);
});

test('migration 057 and fresh-install setup preserve append-only review rows and constraints', () => {
  const fs = require('fs');
  const migration = fs.readFileSync('lib/db/migrations/057_integrity_screening_reviews.sql', 'utf8');
  const setup = fs.readFileSync('scripts/setup-database.js', 'utf8');
  for (const source of [migration, setup]) {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS integrity_screening_reviews');
    expect(source).toContain('reviewer_profile_id INTEGER NOT NULL REFERENCES user_profiles(id)');
    expect(source).toContain('reviewer_systemuser_id UUID NOT NULL');
    expect(source).toContain("decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'hold'))");
    expect(source).toContain('char_length(notes) <= 2000');
    expect(source).toContain('idx_integrity_screening_reviews_request_created');
    expect(source).toContain('idx_integrity_screening_reviews_screening_created');
  }
  expect(migration).not.toContain('ON DELETE CASCADE');
});

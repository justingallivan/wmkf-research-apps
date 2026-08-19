/**
 * @jest-environment node
 *
 * Unit tests for reviewer-roster-store (S224) — the Postgres CRUD behind the
 * Workbench Find-tab durable candidate roster. `@vercel/postgres` `sql` is
 * mocked; these cover the JS-side behavior (normalization, name filtering,
 * partitioning, return shapes) and assert the SQL guards/intent are present.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
import { sql } from '@vercel/postgres';

const store = require('../../lib/services/reviewer-roster-store');

const REQ = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [], rowCount: 0 });
});

// Flatten the interpolated values of every sql`...` call for assertions.
function allInterpolations() {
  return sql.mock.calls.flatMap((call) => call.slice(1));
}
function queryTextOf(callIndex) {
  const frags = sql.mock.calls[callIndex][0];
  return Array.isArray(frags) ? frags.join(' ') : '';
}

describe('listForRequest', () => {
  test('partitions active/excluded/ineligible/blocked and collects allNames across EVERY status', async () => {
    sql.mockResolvedValueOnce({ rows: [
      { status: 'active', display_name: 'Ann Lee', candidate: { name: 'Ann Lee' } },
      { status: 'excluded', display_name: 'Bob Roe', candidate: { name: 'Bob Roe' } },
      { status: 'ineligible', display_name: 'Pat Thiel', candidate: { name: 'Pat Thiel', eligibilityStatus: 'deceased' } },
      { status: 'blocked', display_name: 'Eve Poe', candidate: { name: 'Eve Poe', promotionDecision: 'blocked_applicant_excluded' } },
      { status: 'saved', candidate_key: 'suggestion:sug-9', display_name: 'Cy Poe', candidate: { name: 'Cy Poe', suggestionId: 'SUG-9' } },
      { status: 'coi_dropped', display_name: 'Dee Coe', candidate: { name: 'Dee Coe', hasInstitutionCOI: true } },
    ] });
    const out = await store.listForRequest(REQ);
    expect(out.active.map((c) => c.name)).toEqual(['Ann Lee']);
    expect(out.excluded.map((c) => c.name)).toEqual(['Bob Roe']);
    expect(out.ineligible.map((c) => c.name)).toEqual(['Pat Thiel']);
    expect(out.blocked.map((c) => c.name)).toEqual(['Eve Poe']);
    expect(out.savedKeys).toEqual(['suggestion:sug-9']);
    // allNames is the cross-run dedup union — must include saved + excluded + coi_dropped too.
    expect(out.allNames).toEqual(['Ann Lee', 'Bob Roe', 'Pat Thiel', 'Eve Poe', 'Cy Poe', 'Dee Coe']);
  });
});

describe('findCandidateBySuggestion', () => {
  test('returns the server-owned roster status with the candidate blob', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'suggestion:sug-1',
      status: 'ineligible',
      display_name: 'Pat Thiel',
      candidate: { name: 'Pat Thiel', suggestionId: 'SUG-1' },
      source_kind: 'applicant_suggested',
      updated_at_token: '2026-07-20 10:00:00+00',
    }] });

    await expect(store.findCandidateBySuggestion(REQ, 'SUG-1')).resolves.toMatchObject({
      name: 'Pat Thiel',
      suggestionId: 'SUG-1',
      candidateKey: 'suggestion:sug-1',
      rosterStatus: 'ineligible',
      rosterUpdatedAt: '2026-07-20 10:00:00+00',
    });
    expect(queryTextOf(0)).toMatch(/candidate_key\s*=/);
    expect(allInterpolations()).toContain('suggestion:sug-1');
  });

  // The promote path depends on this staying canonical-key-only: an anchor-stamped row
  // that predates the identity spine must remain invisible here, because its gate inputs
  // are null and resolving it would wave it through promotion (S387).
  test('still requires the canonical key, not just the anchor', async () => {
    await store.findCandidateBySuggestion(REQ, 'SUG-1');
    expect(queryTextOf(0)).toMatch(/candidate_key\s*=/);
  });
});

describe('findCandidateBySuggestionAnchor', () => {
  test('resolves a row whose key is a pre-anchor placeholder', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'legacy-row:369',
      status: 'active',
      display_name: 'W. Lee Kraus',
      candidate: { name: 'W. Lee Kraus', suggestionId: 'SUG-1', candidateKey: 'legacy-row:369' },
      source_kind: 'applicant_suggested',
      updated_at_token: '2026-07-29 17:36:31+00',
    }] });

    await expect(store.findCandidateBySuggestionAnchor(REQ, 'SUG-1')).resolves.toMatchObject({
      name: 'W. Lee Kraus',
      candidateKey: 'legacy-row:369',
      rosterStatus: 'active',
    });
    // Matches on the ANCHOR — the key appears only as an ORDER BY tiebreak, never as a
    // filter, which is the whole point: a placeholder-keyed row must be findable.
    expect(queryTextOf(0)).toMatch(/candidate->>'suggestionId'/);
    const whereClause = queryTextOf(0).split(/ORDER BY/i)[0].split(/WHERE/i)[1] || '';
    expect(whereClause).not.toMatch(/candidate_key/);
    expect(queryTextOf(0)).toMatch(/ORDER BY \(candidate_key/);
  });

  test('prefers the canonical row when both shapes exist', async () => {
    await store.findCandidateBySuggestionAnchor(REQ, 'SUG-1');
    expect(queryTextOf(0)).toMatch(/ORDER BY \(candidate_key\s*=/);
    expect(allInterpolations()).toContain('suggestion:sug-1');
  });

  test('returns null without querying when the anchor is missing', async () => {
    await expect(store.findCandidateBySuggestionAnchor(REQ, '')).resolves.toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
});

describe('findCandidatesByKeys', () => {
  test('returns exact request-scoped roster rows with status and concurrency tokens', async () => {
    const longGeneratedKey = `candidate:${'a'.repeat(680)}`;
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'candidate:ann',
      status: 'active',
      display_name: 'Ann Lee',
      candidate: { name: 'Ann Lee' },
      source_kind: 'literature_retrieved',
      updated_at_token: '2026-07-20 11:00:00+00',
    }] });

    await expect(store.findCandidatesByKeys(REQ, [
      'candidate:ann',
      'candidate:ann',
      longGeneratedKey,
      '',
    ])).resolves.toEqual([expect.objectContaining({
      name: 'Ann Lee',
      candidateKey: 'candidate:ann',
      rosterStatus: 'active',
      rosterUpdatedAt: '2026-07-20 11:00:00+00',
    })]);
    expect(queryTextOf(0)).toMatch(/jsonb_array_elements_text/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      JSON.stringify(['candidate:ann', longGeneratedKey]),
    ]));
  });
});

describe('removePreviousActiveSearchResults', () => {
  test('deletes only active allowlisted search provenance and returns the count', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      removed: 2,
      removed_keys: ['candidate:a', 'candidate:b'],
      roster_rows: [
        { status: 'active', display_name: 'Applicant Person', candidate: { name: 'Applicant Person' }, updated_at_token: '2026-07-19 15:00:00.123456+00' },
        { status: 'excluded', display_name: 'Excluded Person', candidate: { name: 'Excluded Person' } },
        { status: 'saved', display_name: 'Saved Person', candidate: { name: 'Saved Person' } },
        { status: 'active', display_name: 'Flagged COI Person', candidate: { name: 'Flagged COI Person', hasInstitutionCOI: true }, updated_at_token: '2026-07-19 14:00:00.654321+00' },
        { status: 'coi_dropped', display_name: 'COI Ledger Person', candidate: { name: 'COI Ledger Person' } },
      ],
    }] });

    const out = await store.removePreviousActiveSearchResults(
      REQ,
      [
        { candidateKey: 'candidate:a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:b', updatedAt: '2026-07-19T13:00:00.000Z' },
        { candidateKey: 'candidate:a', updatedAt: '2026-07-19T12:00:00.000Z' },
      ],
    );
    expect(out.removed).toBe(2);
    expect(out.removedKeys).toEqual(['candidate:a', 'candidate:b']);
    expect(out.active.map((candidate) => candidate.name)).toEqual(['Applicant Person', 'Flagged COI Person']);
    expect(out.active[0].rosterUpdatedAt).toBe('2026-07-19 15:00:00.123456+00');
    expect(out.excluded.map((candidate) => candidate.name)).toEqual(['Excluded Person']);
    expect(out.allNames).toEqual(['Applicant Person', 'Excluded Person', 'Saved Person', 'Flagged COI Person', 'COI Ledger Person']);

    const text = queryTextOf(0);
    expect(text).toMatch(/DELETE FROM reviewer_find_roster/);
    expect(text).toMatch(/roster\.status = 'active'/);
    expect(text).toMatch(/jsonb_to_recordset/);
    expect(text).toMatch(/roster\.updated_at::text = target\.updated_at_token/);
    expect(text).toMatch(/hasInstitutionCOI.*IS DISTINCT FROM 'true'/);
    expect(text).toMatch(/candidate_key NOT IN \(SELECT candidate_key FROM deleted\)/);
    expect(text).toMatch(/source_kind IN/);
    expect(text).toMatch(/'literature_retrieved'/);
    expect(text).toMatch(/'referred'/);
    expect(text).toMatch(/'claude_verified'/);
    expect(text).not.toMatch(/'applicant_suggested'/);
    expect(text).not.toMatch(/status IN/);
    expect(allInterpolations()).toContain(REQ);
    expect(allInterpolations()).toContain(JSON.stringify([
      { candidate_key: 'candidate:a', updated_at_token: '2026-07-19T12:00:00.000Z' },
      { candidate_key: 'candidate:b', updated_at_token: '2026-07-19T13:00:00.000Z' },
    ]));
  });

  test('an empty candidate-ref set performs only the roster read', async () => {
    sql.mockResolvedValueOnce({ rows: [
      { status: 'active', display_name: 'Applicant Person', candidate: { name: 'Applicant Person' } },
    ] });
    const out = await store.removePreviousActiveSearchResults(REQ, []);
    expect(out.removed).toBe(0);
    expect(out.removedKeys).toEqual([]);
    expect(out.active.map((candidate) => candidate.name)).toEqual(['Applicant Person']);
    expect(out.excluded).toEqual([]);
    expect(out.allNames).toEqual(['Applicant Person']);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(queryTextOf(0)).toMatch(/SELECT candidate_key, status/);
    expect(queryTextOf(0)).not.toMatch(/DELETE/);
  });
});

describe('recordSurfaced', () => {
  beforeEach(() => {
    sql.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test('records named candidates (normalized) and skips unnamed/blank ones', async () => {
    const n = await store.recordSurfaced(REQ, [
      { name: 'Dr. Ann Lee' }, { name: '' }, { name: '   ' }, { name: 'Bob' },
    ]);
    expect(n).toBe(2);
    const interps = allInterpolations();
    expect(interps).toContain('ann lee'); // honorific stripped + normalized
    expect(interps).toContain('bob');
  });

  test('the conflict update guards against downgrading excluded/saved (never-downgrade)', async () => {
    await store.recordSurfaced(REQ, [{ name: 'Ann Lee' }]);
    // The INSERT ... ON CONFLICT DO UPDATE must only run WHERE status='active',
    // so excluded/saved/coi_dropped can never be reactivated by a surfaced record.
    const insertCall = sql.mock.calls.findIndex((c) =>
      Array.isArray(c[0]) && c[0].join(' ').includes('INSERT INTO reviewer_find_roster'));
    expect(insertCall).toBeGreaterThanOrEqual(0);
    expect(queryTextOf(insertCall)).toMatch(/status = 'active'/);
  });

  test('records direct deceased evidence as monotonic ineligible status', async () => {
    await store.recordSurfaced(REQ, [{
      name: 'Patricia Thiel',
      eligibilityStatus: 'deceased',
      eligibilityEvidence: { url: 'https://ameslab.gov/pat-thiel' },
    }]);
    const text = queryTextOf(0);
    expect(allInterpolations()).toContain('ineligible');
    expect(text).toMatch(/EXCLUDED\.status = 'ineligible'/);
    expect(text).toMatch(/reviewer_find_roster\.status = 'ineligible'/);
  });

  test('keeps same-name candidates with different affiliations in separate roster rows', async () => {
    await store.recordSurfaced(REQ, [
      { name: 'Alex Kim', affiliation: 'University One' },
      { name: 'Alex Kim', affiliation: 'University Two' },
    ]);
    const inserts = sql.mock.calls.filter((call) => queryTextOf(sql.mock.calls.indexOf(call)).includes('INSERT INTO reviewer_find_roster'));
    expect(inserts).toHaveLength(2);
    const keys = inserts.map((call) => call.slice(1).find((value) => (
      typeof value === 'string' && value.startsWith('candidate:')
    )));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    expect(inserts[0][0].join(' ')).toMatch(/ON CONFLICT \(request_id, candidate_key\)/);
  });

  test('uses the snapshot token for conflict updates and reports a stale no-op', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const n = await store.recordSurfaced(
      REQ,
      [{ name: 'Ann Lee', suggestionId: 'SUG-1' }],
      { expectedUpdatedAt: '2026-07-20 10:00:00+00' },
    );
    expect(n).toBe(0);
    expect(queryTextOf(0)).toMatch(/reviewer_find_roster\.updated_at::text/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      true,
      '2026-07-20 10:00:00+00',
    ]));
  });

  test('allows a first insert while refusing a conflict when the snapshot had no row', async () => {
    const n = await store.recordSurfaced(
      REQ,
      [{ name: 'Ann Lee', suggestionId: 'SUG-1' }],
      { expectedUpdatedAt: null },
    );
    expect(n).toBe(1);
    expect(queryTextOf(0)).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([false, '']));
  });
});

describe('recordCoiDropped', () => {
  test('upserts named institution-COI drops as non-selectable coi_dropped ledger rows', async () => {
    const n = await store.recordCoiDropped(REQ, [
      {
        name: 'Dr. Dee Coe',
        affiliation: 'University of Michigan',
        institutionCOIDetails: {
          piInstitution: 'University of Michigan',
          reviewerInstitution: 'University of Michigan',
        },
      },
      { name: '' },
    ], { dropStage: 'track_a_verified', matchSource: 'test' });

    expect(n).toBe(1);
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/'coi_dropped'/);
    expect(text).toMatch(/status = 'coi_dropped'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining(['dee coe']));
    const blob = JSON.parse(allInterpolations().find((value) => typeof value === 'string' && value.includes('track_a_verified')));
    expect(blob).toMatchObject({
      name: 'Dr. Dee Coe',
      hasInstitutionCOI: true,
      institutionCOIDetails: {
        piInstitution: 'University of Michigan',
        reviewerInstitution: 'University of Michigan',
        dropStage: 'track_a_verified',
        matchSource: 'test',
      },
    });
  });
});

describe('setExcluded', () => {
  test('upserts (eviction-tolerant) and forces status excluded', async () => {
    await store.setExcluded(REQ, { name: 'Bob Roe' });
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/status = 'excluded'/);
    expect(allInterpolations()).toContain('bob roe');
  });

  test('throws on a nameless candidate', async () => {
    await expect(store.setExcluded(REQ, { name: '' })).rejects.toThrow(/name\/key required/);
  });
});

describe('promote', () => {
  test('returns the stored candidate blob on success', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Bob Roe', hIndex: 9 } }] });
    const blob = await store.promote(REQ, 'candidate:bob');
    expect(blob).toEqual({ name: 'Bob Roe', hIndex: 9 });
    expect(queryTextOf(0)).toMatch(/status = 'excluded'/); // only promotes from excluded
    expect(queryTextOf(0)).toMatch(/candidate_key =/);
    expect(allInterpolations()).toContain('candidate:bob');
  });

  test('no-op (null) when the row is gone (cap eviction)', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    expect(await store.promote(REQ, 'candidate:ghost')).toBeNull();
  });
});

describe('staff identity confirmation', () => {
  test('stores an actor/time/contact-bound confirmation only on an active request row', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate: { name: 'Dr Ann Lee' } }], rowCount: 1 });
    const out = await store.confirmIdentity(REQ, {
      name: 'Dr Ann Lee',
      email: ' ANN@Example.edu ',
      website: 'https://example.edu/ann',
      affiliation: 'Example University',
    }, { actorProfileId: 7, actorSystemUserId: 'SYS-7' });

    expect(out.confirmationId).toEqual(expect.any(String));
    const text = queryTextOf(0);
    expect(text).toMatch(/status = 'active'/);
    expect(text).toMatch(/candidate = candidate \|\|/);
    expect(text).toMatch(/candidate_key =/);
    const stored = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('staffIdentityConfirmation')
    )));
    expect(stored).toMatchObject({
      email: 'ann@example.edu',
      pdIdentityConfirmed: true,
      applicantContactMismatch: false,
      pdIdentityConfirmationId: out.confirmationId,
      staffIdentityConfirmation: {
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
        actorProfileId: 7,
        actorSystemUserId: 'SYS-7',
      },
    });
  });

  test('findIdentityConfirmation is request + opaque-id scoped', async () => {
    sql.mockResolvedValueOnce({
      rows: [{
        candidate_key: 'candidate:ann',
        confirmation: { source: 'staff_confirmed', email: 'ann@example.edu' },
      }],
    });
    await expect(store.findIdentityConfirmation(REQ, 'confirm-1')).resolves.toMatchObject({
      source: 'staff_confirmed',
      email: 'ann@example.edu',
      rosterCandidateKey: 'candidate:ann',
    });
    expect(queryTextOf(0)).toMatch(/SELECT candidate_key/);
    expect(queryTextOf(0)).toMatch(/candidate->>'pdIdentityConfirmationId'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([REQ, 'confirm-1']));
  });
});

describe('updateContactDraft', () => {
  test('merges website and affiliation into the active request row without touching Dataverse', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'orcid:0000-0002-4517-2318',
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: '2026-08-18 17:29:00+00',
        candidate: {
          name: 'Peter Reiners',
          email: 'reiners@arizona.edu',
          automatedIdentityAttestation: 'old-automated-token',
          pdIdentityConfirmed: true,
          pdIdentityConfirmationId: 'old-confirmation',
          staffIdentityConfirmation: { source: 'staff_confirmed' },
          contactEnrichment: { email: 'reiners@arizona.edu' },
        },
      }] })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'orcid:0000-0002-4517-2318',
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: '2026-08-18 17:30:00+00',
        candidate: {
          name: 'Peter Reiners',
          email: 'reiners@arizona.edu',
          website: 'https://profiles.arizona.edu/person/reiners',
          websiteSource: 'manual',
          websitePersistAllowed: true,
          affiliation: 'University of Arizona',
          affiliationSource: 'staff_manual',
          affiliationPersistAllowed: true,
          manualContactFields: ['website', 'affiliation'],
          serverIdentityReviewReason: 'manual_contact_changed',
          contactEnrichment: {
            email: 'reiners@arizona.edu',
            website: 'https://profiles.arizona.edu/person/reiners',
            websiteSource: 'manual',
            websitePersistAllowed: true,
            affiliation: 'University of Arizona',
            affiliationSource: 'staff_manual',
            affiliationPersistAllowed: true,
          },
        },
      }] });

    const out = await store.updateContactDraft(
      REQ,
      'orcid:0000-0002-4517-2318',
      {
        website: 'https://profiles.arizona.edu/person/reiners',
        affiliation: 'University of Arizona',
      },
    );

    expect(out).toMatchObject({
      candidateKey: 'orcid:0000-0002-4517-2318',
      rosterStatus: 'active',
      rosterUpdatedAt: '2026-08-18 17:30:00+00',
      website: 'https://profiles.arizona.edu/person/reiners',
      websitePersistAllowed: true,
      affiliation: 'University of Arizona',
      affiliationPersistAllowed: true,
      manualContactFields: ['website', 'affiliation'],
      serverIdentityReviewReason: 'manual_contact_changed',
    });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(queryTextOf(0)).toMatch(/status = 'active'/);
    expect(queryTextOf(1)).toMatch(/UPDATE reviewer_find_roster/);
    expect(queryTextOf(1)).toMatch(/updated_at = .*::timestamptz/);
    expect(allInterpolations()).toContain('2026-08-18 17:29:00+00');
    const written = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('profiles.arizona.edu')
    )));
    expect(written).toMatchObject({
      name: 'Peter Reiners',
      email: 'reiners@arizona.edu',
      website: 'https://profiles.arizona.edu/person/reiners',
      affiliation: 'University of Arizona',
      manualContactFields: ['website', 'affiliation'],
      serverIdentityReviewReason: 'manual_contact_changed',
    });
    expect(written).not.toHaveProperty('automatedIdentityAttestation');
    expect(written).not.toHaveProperty('pdIdentityConfirmed');
    expect(written).not.toHaveProperty('pdIdentityConfirmationId');
    expect(written).not.toHaveProperty('staffIdentityConfirmation');
  });

  test('returns null without writing when the row is no longer active', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    await expect(store.updateContactDraft(
      REQ,
      'candidate:gone',
      { website: 'https://example.edu/profile' },
    )).resolves.toBeNull();
    expect(sql).toHaveBeenCalledTimes(1);
    expect(queryTextOf(0)).toMatch(/status = 'active'/);
  });

  test('keeps applicant-managed authority on its separate promotion contract', async () => {
    const applicant = {
      name: 'Applicant Reviewer',
      isApplicantRecommended: true,
      automatedIdentityAttestation: 'applicant-token',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'applicant-confirmation',
      staffIdentityConfirmation: { source: 'staff_confirmed' },
    };
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'suggestion:applicant',
        status: 'active',
        source_kind: 'applicant_suggested',
        updated_at_token: '2026-08-18 17:29:00+00',
        candidate: applicant,
      }] })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'suggestion:applicant',
        status: 'active',
        source_kind: 'applicant_suggested',
        updated_at_token: '2026-08-18 17:30:00+00',
        candidate: { ...applicant, affiliation: 'Applicant University' },
      }] });

    const out = await store.updateContactDraft(
      REQ,
      'suggestion:applicant',
      { affiliation: 'Applicant University' },
    );
    expect(out).toMatchObject({
      automatedIdentityAttestation: 'applicant-token',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'applicant-confirmation',
    });
    const written = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('Applicant University')
    )));
    expect(written).toMatchObject({
      automatedIdentityAttestation: 'applicant-token',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'applicant-confirmation',
    });
    expect(written).not.toHaveProperty('serverIdentityReviewReason');
  });

  test('recognizes applicant-managed authority from trusted stored provenance even with a legacy source kind', async () => {
    const applicant = {
      name: 'Provenance Applicant Reviewer',
      provenance: {
        kind: 'applicant_suggested',
        sources: ['applicant_form'],
        seedRole: 'applicant_suggested',
        groundingWorkIds: [],
      },
      automatedIdentityAttestation: 'applicant-token',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'applicant-confirmation',
      staffIdentityConfirmation: { source: 'staff_confirmed' },
    };
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'suggestion:provenance-applicant',
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: '2026-08-18 17:29:00+00',
        candidate: applicant,
      }] })
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'suggestion:provenance-applicant',
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: '2026-08-18 17:30:00+00',
        candidate: { ...applicant, affiliation: 'Applicant University' },
      }] });

    await store.updateContactDraft(
      REQ,
      'suggestion:provenance-applicant',
      { affiliation: 'Applicant University' },
    );
    const written = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('Applicant University')
    )));
    expect(written).toMatchObject({
      automatedIdentityAttestation: 'applicant-token',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'applicant-confirmation',
    });
    expect(written).not.toHaveProperty('serverIdentityReviewReason');
  });

  test('fails closed instead of overwriting a concurrently changed row', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{
        candidate_key: 'candidate:changed',
        status: 'active',
        source_kind: 'literature_retrieved',
        updated_at_token: '2026-08-18 17:29:00+00',
        candidate: { name: 'Changed Reviewer' },
      }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(store.updateContactDraft(
      REQ,
      'candidate:changed',
      { affiliation: 'New Institution' },
    )).resolves.toBeNull();
    expect(queryTextOf(1)).toMatch(/updated_at = .*::timestamptz/);
  });

  test('rejects a non-profile website instead of reporting success with a cleared value', async () => {
    sql.mockResolvedValueOnce({ rows: [{
      candidate_key: 'candidate:unsafe-site',
      status: 'active',
      source_kind: 'literature_retrieved',
      updated_at_token: '2026-08-18 17:29:00+00',
      candidate: { name: 'Safe Reviewer' },
    }] });

    await expect(store.updateContactDraft(
      REQ,
      'candidate:unsafe-site',
      { website: 'https://example.edu/cv.pdf' },
    )).rejects.toMatchObject({ code: 'invalid_contact_draft' });
    expect(sql).toHaveBeenCalledTimes(1);
  });
});

describe('address attestation', () => {
  test('persists a receipt for the real literature-row shape with matching top-level and enrichment emails', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: '2026-07-30 10:00:00+00',
          candidate: {
            name: 'Ann Lee',
            email: 'found@example.edu',
            emailSource: 'scholarly_multi',
            conflictRecordUnavailable: true,
            contactEnrichment: {
              email: 'found@example.edu',
              emailSource: 'scholarly_multi',
              conflictRecordUnavailable: true,
            },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          source_kind: 'literature_retrieved',
          updated_at_token: '2026-07-30 10:01:00+00',
          candidate: { name: 'Ann Lee', email: 'found@example.edu' },
        }],
        rowCount: 1,
      });

    const out = await store.attestAddress(REQ, 'candidate:ann', {
      email: 'found@example.edu',
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile',
      actorProfileId: '7',
      actorSystemUserId: 'SYS-7',
    });

    expect(out.receipt).toMatchObject({
      receiptId: expect.any(String),
      email: 'found@example.edu',
      personConfirmed: true,
      requestId: REQ,
      candidateKey: 'candidate:ann',
    });
    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      manualContactFields: [],
      addressTrustReceipt: { email: 'found@example.edu' },
      contactEnrichment: {
        email: 'found@example.edu',
        emailSource: 'scholarly_multi',
      },
    });
    expect(queryTextOf(1)).toMatch(/updated_at::text/);
    expect(allInterpolations()).toContain('2026-07-30 10:00:00+00');
  });

  test('an explicitly changed attested address replaces both candidate projections and becomes manual', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-1',
          candidate: {
            name: 'Ann Lee',
            email: 'found@example.edu',
            emailSource: 'scholarly_multi',
            contactEnrichment: { email: 'found@example.edu', emailSource: 'scholarly_multi' },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-2',
          candidate: { name: 'Ann Lee', email: 'stored@example.edu' },
        }],
        rowCount: 1,
      });

    await store.attestAddress(REQ, 'candidate:ann', {
      email: 'stored@example.edu',
      evidenceType: 'direct_correspondence',
      note: 'Confirmed directly.',
    });

    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'stored@example.edu',
      emailSource: 'manual',
      manualContactFields: ['email'],
      addressTrustReceipt: { email: 'stored@example.edu' },
      contactEnrichment: {
        email: 'stored@example.edu',
        emailSource: 'manual',
      },
    });
  });

  test('verified contact and address renew one matching staff confirmation in the same roster update', async () => {
    sql
      .mockResolvedValueOnce({
        rows: [{
          candidate_key: 'candidate:ann',
          status: 'active',
          source_kind: 'literature_retrieved',
          updated_at_token: 'row-version-1',
          candidate: {
            name: 'Ann Lee',
            email: 'ann@example.edu',
            website: 'https://example.edu/old',
            affiliation: 'Old Department',
            pdIdentityConfirmed: true,
            pdIdentityConfirmationId: 'confirmation-old',
            staffIdentityConfirmation: {
              confirmationId: 'confirmation-old',
              source: 'staff_confirmed',
              normalizedName: 'ann lee',
              email: 'ann@example.edu',
              website: 'https://example.edu/old',
              affiliation: 'Old Department',
            },
            contactEnrichment: { email: 'ann@example.edu' },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          updated_at_token: 'row-version-2',
          candidate: { name: 'Ann Lee', email: 'ann@example.edu' },
        }],
        rowCount: 1,
      });

    await store.attestAddress(REQ, 'candidate:ann', {
      email: 'ann@example.edu',
      verifiedContact: {
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
      },
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/current',
      actorProfileId: 'profile-1',
      actorSystemUserId: 'system-1',
    });

    const persisted = JSON.parse(allInterpolations().find((entry) => (
      typeof entry === 'string' && entry.includes('addressTrustReceipt')
    )));
    expect(persisted).toMatchObject({
      email: 'ann@example.edu',
      emailSource: 'manual',
      website: 'https://example.edu/current',
      websiteSource: 'manual',
      affiliation: 'Current Department',
      affiliationSource: 'staff_manual',
      manualContactFields: expect.arrayContaining(['email', 'website', 'affiliation']),
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: expect.any(String),
      addressTrustReceipt: { email: 'ann@example.edu' },
      staffIdentityConfirmation: {
        confirmationId: expect.any(String),
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
        actorProfileId: 'profile-1',
        actorSystemUserId: 'system-1',
      },
      contactEnrichment: {
        email: 'ann@example.edu',
        website: 'https://example.edu/current',
        affiliation: 'Current Department',
      },
    });
    expect(persisted.pdIdentityConfirmationId)
      .toBe(persisted.staffIdentityConfirmation.confirmationId);
  });
});

describe('finalizeCandidatePromotion', () => {
  test('server-owned finalization persists exact Dataverse anchors and returns the key', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ann' }], rowCount: 1 });

    const result = await store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ann Lee', candidateKey: 'candidate:ann', email: 'ann@example.edu' },
      {
        candidateKey: 'candidate:ann',
        suggestionId: 'SUG-1',
        potentialReviewerId: 'PID-1',
      },
    );

    expect(result).toEqual({ saved: true, candidateKey: 'candidate:ann' });
    const text = queryTextOf(0);
    expect(text).toMatch(/INSERT INTO reviewer_find_roster/);
    expect(text).toMatch(/status = 'saved'/);
    expect(text).toMatch(/status IN \('active', 'saved'\)/);
    expect(text).toMatch(/RETURNING candidate_key/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      'candidate:ann',
      JSON.stringify({ suggestionId: 'SUG-1', potentialReviewerId: 'PID-1' }),
    ]));
  });

  test('does not graduate an excluded/ineligible collision', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ann Lee' },
      {
        candidateKey: 'candidate:ann',
        suggestionId: 'SUG-1',
        potentialReviewerId: 'PID-1',
      },
    )).resolves.toEqual({ saved: false, candidateKey: 'candidate:ann' });
  });

  test('also retires active roster aliases with the same checksum-valid ORCID', async () => {
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ellen-legacy' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'orcid:0000-0001-6345-1907' }], rowCount: 1 });

    const result = await store.finalizeCandidatePromotion(
      REQ,
      {
        name: 'Ellen Zhong',
        candidateKey: 'candidate:ellen-legacy',
        email: 'zhonge@cs.princeton.edu',
        orcid: '0000-0001-6345-1907',
      },
      {
        candidateKey: 'candidate:ellen-legacy',
        suggestionId: 'SUG-ELLEN',
        potentialReviewerId: 'PID-ELLEN',
      },
    );

    expect(result).toEqual({ saved: true, candidateKey: 'candidate:ellen-legacy' });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(queryTextOf(1)).toMatch(/status = 'saved'/);
    expect(queryTextOf(1)).toMatch(/candidate->>'orcid'/);
    expect(queryTextOf(1)).toMatch(/candidate->'contactEnrichment'->>'orcidId'/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      '0000-0001-6345-1907',
      'candidate:ellen-legacy',
    ]));
  });

  test('does not reverse a committed promotion when best-effort ORCID alias cleanup fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    sql
      .mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ellen-legacy' }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('alias cleanup unavailable'));

    await expect(store.finalizeCandidatePromotion(
      REQ,
      { name: 'Ellen Zhong', orcid: '0000-0001-6345-1907' },
      {
        candidateKey: 'candidate:ellen-legacy',
        suggestionId: 'SUG-ELLEN',
        potentialReviewerId: 'PID-ELLEN',
      },
    )).resolves.toEqual({ saved: true, candidateKey: 'candidate:ellen-legacy' });
    expect(consoleError).toHaveBeenCalledWith(
      'reviewer-roster finalizeCandidatePromotion alias cleanup error:',
      'alias cleanup unavailable',
    );
    consoleError.mockRestore();
  });
});

describe('markPromotionBlocked', () => {
  test('moves only the exact active/blocked key into terminal blocked state with a durable reason', async () => {
    sql.mockResolvedValueOnce({ rows: [{ candidate_key: 'candidate:ann' }], rowCount: 1 });

    await expect(store.markPromotionBlocked(REQ, 'candidate:ann', {
      decision: 'blocked_applicant_excluded',
      code: 'applicant_excluded',
      reason: 'Applicant excluded this reviewer.',
    })).resolves.toEqual({ blocked: true, candidateKey: 'candidate:ann' });

    const text = queryTextOf(0);
    expect(text).toMatch(/SET status = 'blocked'/);
    expect(text).toMatch(/status IN \('active', 'blocked'\)/);
    expect(allInterpolations()).toContain('candidate:ann');
    expect(allInterpolations()).toContain(JSON.stringify({
      promotionDecision: 'blocked_applicant_excluded',
      promotionBlockCode: 'applicant_excluded',
      promotionBlockReason: 'Applicant excluded this reviewer.',
    }));
  });
});

describe('stampSuggestionAnchor', () => {
  test('updates the candidate JSON by request + exact candidate key with suggestion/person ids', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 123 }], rowCount: 1 });
    const out = await store.stampSuggestionAnchor(REQ, 'Prof. Anchor Name', {
      candidateKey: 'candidate:anchor',
      suggestionId: 'SUG-1',
      potentialReviewerId: 'PID-1',
    });

    expect(out).toEqual({ updated: 1 });
    const text = queryTextOf(0);
    expect(text).toMatch(/UPDATE reviewer_find_roster/);
    expect(text).toMatch(/candidate = candidate \|\|/);
    expect(text).toMatch(/request_id =/);
    expect(text).toMatch(/candidate_key =/);
    expect(allInterpolations()).toEqual(expect.arrayContaining([
      REQ,
      'candidate:anchor',
      JSON.stringify({ suggestionId: 'SUG-1', potentialReviewerId: 'PID-1' }),
    ]));
  });

  test('missing suggestionId or normalized name is a no-op', async () => {
    await expect(store.stampSuggestionAnchor(REQ, 'No Id', {})).resolves.toEqual({ updated: 0 });
    await expect(store.stampSuggestionAnchor(REQ, 'No Key', { suggestionId: 'SUG-1' })).resolves.toEqual({ updated: 0 });
    expect(sql).not.toHaveBeenCalled();
  });
});

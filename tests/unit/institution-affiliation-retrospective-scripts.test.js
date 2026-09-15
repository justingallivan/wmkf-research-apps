const {
  parseArgs,
  projectCase,
  summarize,
} = require('../../scripts/audit-institution-affiliation-retrospective');
const { skipReason } = require('../../scripts/replay-institution-affiliation-retrospective');

function rosterRow(overrides = {}) {
  return {
    request_id: 'private-request-id',
    candidate_key: 'private-candidate-key',
    status: 'active',
    source_kind: 'applicant_recommended',
    first_seen_at: '2026-07-09T12:00:00Z',
    updated_at: '2026-07-10T12:00:00Z',
    candidate: {
      name: 'Private Person',
      email: 'private@example.org',
      institutionMismatch: true,
      affiliation: 'Department, Example University private@example.org',
      suggestedInstitution: 'Example University',
      publications: [{ title: 'Private work', year: 2025 }],
      contactEnrichment: { identity: { status: 'probable', anchors: [{ type: 'name' }] } },
    },
    ...overrides,
  };
}

test('case projection keeps private person and roster identifiers out of local output', () => {
  const projected = projectCase(rosterRow());
  const serialized = JSON.stringify(projected);
  expect(projected.caseId).toMatch(/^roster-[a-f0-9]{16}$/);
  expect(serialized).not.toMatch(/Private Person|private-request-id|private-candidate-key|private@example.org|Private work/);
  expect(projected.candidateAffiliation).toContain('[email removed]');
  expect(projected.publicationReferences).toBe(1);
});

test('retained roster summary counts current row states without deriving staff actions', () => {
  const rows = [rosterRow(), rosterRow({
    candidate_key: 'another-key',
    status: 'saved',
    candidate: { institutionMismatch: false },
  })];
  const summary = summarize(rows, rows.map(projectCase), { from: '2026-06-01', to: '2026-09-01' });
  expect(summary).toMatchObject({
    retainedRows: 2,
    distinctRequests: 1,
    byStatus: { active: 1, saved: 1 },
    institutionMismatchRows: 1,
    mismatchWithBothOperands: 1,
    mismatchWithTypedAssessment: 0,
  });
  expect(summary).not.toHaveProperty('staffActions');
});

test('calendar args reject normalized invalid dates and reversed intervals', () => {
  expect(parseArgs(['--from=2026-06-01', '--to=2026-09-01', '--cases'])).toMatchObject({
    from: '2026-06-01', to: '2026-09-01', cases: true,
  });
  expect(() => parseArgs(['--from=2026-02-30'])).toThrow('YYYY-MM-DD');
  expect(() => parseArgs(['--from=2026-09-01', '--to=2026-06-01'])).toThrow('precede');
});

test('text-pair probe skips missing, decision-text, and slash-joined affiliations', () => {
  const pair = { candidateAffiliation: 'UCLA', suggestedInstitution: 'UC San Diego' };
  expect(skipReason(pair)).toBeNull();
  expect(skipReason({ ...pair, candidateAffiliation: null })).toBe('missing_operand');
  expect(skipReason({ ...pair, suggestedInstitution: 'Not a fit' })).toBe('suggested_text_not_institution');
  expect(skipReason({ ...pair, suggestedInstitution: 'UCLA / UC San Diego' })).toBe('unparsed_slash_affiliations');
});

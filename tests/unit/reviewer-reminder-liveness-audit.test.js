const fs = require('node:fs');
const path = require('node:path');
const {
  buildReviewerReminderLivenessReport,
} = require('../../lib/services/reviewer-reminder-liveness-audit');
const {
  reviewDueCandidateFilter,
} = require('../../lib/services/reviewer-reminder-candidate');

const NOW = Date.parse('2026-09-01T12:00:00Z');
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function row(id, over = {}) {
  return {
    wmkf_appreviewersuggestionid: id,
    _wmkf_request_value: REQUEST_ID,
    wmkf_externaltokenhash: 'stored-hash',
    wmkf_externaltokenexpires: '2026-10-01T00:00:00Z',
    wmkf_externaltokenrevoked: false,
    ...over,
  };
}

test('audit report applies cycle scope and counts eligible and blocked outcomes', () => {
  const report = buildReviewerReminderLivenessReport({
    rows: [
      row('eligible'),
      row('invalid', { wmkf_externaltokenexpires: null }),
      row('other-cycle', { _wmkf_request_value: 'other' }),
    ],
    requestById: {
      [REQUEST_ID]: {
        akoya_requestid: REQUEST_ID,
        akoya_requestnum: '1001',
        wmkf_meetingdate: '2026-12-01',
        wmkf_reviewduedate: '2026-09-09',
      },
      other: {
        akoya_requestid: 'other',
        akoya_requestnum: '1002',
        wmkf_meetingdate: '2027-06-01',
        wmkf_reviewduedate: '2027-05-01',
      },
    },
    cycleCode: 'D26',
    nowMs: NOW,
  });

  expect(report.totalRowsExamined).toBe(2);
  expect(report.tokenStates).toMatchObject({ active: 1, invalid: 1 });
  expect(report.reminderEligibility).toMatchObject({ eligible: 1, token_invalid_data: 1 });
  expect(report.blockedRows).toEqual([
    expect.objectContaining({ requestNumber: '1001', suggestionId: 'invalid', reason: 'token_invalid_data' }),
  ]);
  expect(report.candidateFilter).toBe(reviewDueCandidateFilter());
});

test('CLI imports only read-only audit/query seams and never maintenance or send seams', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts/audit-reviewer-reminder-token-liveness.mjs'),
    'utf8',
  );
  expect(source).not.toMatch(/reviewer-reminder-sweep|token-lifecycle|updateLifecycle|MaintenanceService|maintenance-service|createAndSendEmail/);
  expect(source).toContain('reviewer-reminder-candidate.js');
  expect(source).toContain("client.get(");
  expect(source).not.toContain('client.patch(');
  expect(source).not.toContain('client.post(');
  expect(source).not.toContain('client.delete_(');
});

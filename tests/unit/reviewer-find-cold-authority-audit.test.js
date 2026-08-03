/** @jest-environment node */

const {
  normalizeAuthoritySnapshot,
  publicAuthoritySummary,
  validateColdAuthorityBaseline,
  validateAuthorityUnchanged,
  validateRosterAnchors,
} = require('../../scripts/lib/reviewer-find-cold-authority-audit');

const ids = Array.from({ length: 5 }, (_, index) => (
  `${index + 1}1111111-1111-1111-1111-111111111111`
));
const suggestions = ids.map((id, index) => ({
  wmkf_appreviewersuggestionid: id,
  _wmkf_request_value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  _wmkf_potentialreviewer_value: `${index + 1}2222222-2222-2222-2222-222222222222`,
  wmkf_applicantdisposition: 100000000,
  wmkf_selected: false,
  wmkf_invited: false,
  wmkf_accepted: false,
  wmkf_declined: false,
  wmkf_externaltokenrevoked: false,
  wmkf_externaltokenhash: null,
}));

describe('Reviewer Find cold authority audit', () => {
  test('requires the exact pristine applicant-recommended fixture without exposing identities', () => {
    expect(validateColdAuthorityBaseline({ suggestions, emailActivities: [] }, {
      requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })).toEqual({ ok: true, failures: [] });
    expect(validateColdAuthorityBaseline({ suggestions: suggestions.slice(0, 4), emailActivities: [] }, {
      requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    }).failures).toContain('authority_suggestion_count_mismatch');
  });

  test.each([
    ['missing suggestion anchor', () => ({ ...suggestions[0], wmkf_appreviewersuggestionid: null }), 'authority_suggestion_anchor_missing'],
    ['duplicate suggestion anchor', () => ({ ...suggestions[0], wmkf_appreviewersuggestionid: ids[1] }), 'authority_suggestion_anchor_duplicate'],
    ['missing potential reviewer anchor', () => ({ ...suggestions[0], _wmkf_potentialreviewer_value: '' }), 'authority_potential_reviewer_anchor_missing'],
    ['duplicate potential reviewer anchor', () => ({ ...suggestions[0], _wmkf_potentialreviewer_value: suggestions[1]._wmkf_potentialreviewer_value }), 'authority_potential_reviewer_anchor_duplicate'],
    ['wrong request linkage', () => ({ ...suggestions[0], _wmkf_request_value: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }), 'authority_request_linkage_mismatch'],
    ['wrong applicant disposition', () => ({ ...suggestions[0], wmkf_applicantdisposition: null }), 'authority_applicant_disposition_mismatch'],
    ['engaged boolean', () => ({ ...suggestions[0], wmkf_selected: true }), 'authority_lifecycle_boolean_not_pristine'],
    ['revoked external token boolean', () => ({ ...suggestions[0], wmkf_externaltokenrevoked: true }), 'authority_lifecycle_boolean_not_pristine'],
    ['response lifecycle', () => ({ ...suggestions[0], wmkf_responsetype: 100000000 }), 'authority_lifecycle_not_pristine'],
    ['outreach field', () => ({ ...suggestions[0], wmkf_emailsentat: '2026-08-02T00:00:00Z' }), 'authority_outreach_not_pristine'],
    ['review field', () => ({ ...suggestions[0], wmkf_reviewstatus: 100000004 }), 'authority_review_not_pristine'],
    ['token field', () => ({ ...suggestions[0], wmkf_externaltokenhash: 'unexpected' }), 'authority_token_or_acknowledgement_not_pristine'],
  ])('rejects %s without emitting row identifiers', (_label, mutate, expectedFailure) => {
    const altered = suggestions.map((row, index) => index === 0 ? mutate() : row);
    const result = validateColdAuthorityBaseline({ suggestions: altered, emailActivities: [] }, {
      requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(expectedFailure);
    expect(JSON.stringify(result)).not.toContain(ids[0]);
  });

  test('allows omitted untouched booleans but rejects request email activity', () => {
    const withOmittedBooleans = suggestions.map(({
      wmkf_selected,
      wmkf_invited,
      wmkf_accepted,
      wmkf_declined,
      wmkf_externaltokenrevoked,
      ...row
    }) => row);
    expect(validateColdAuthorityBaseline({ suggestions: withOmittedBooleans, emailActivities: [] }, {
      requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })).toEqual({ ok: true, failures: [] });
    expect(validateColdAuthorityBaseline({
      suggestions,
      emailActivities: [{ activityid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }],
    }, { requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }).failures)
      .toContain('authority_email_activity_not_empty');
  });

  test('rejects an invalid expected request anchor without exposing input', () => {
    const result = validateColdAuthorityBaseline({ suggestions, emailActivities: [] }, { requestId: '' });
    expect(result.failures).toEqual(expect.arrayContaining([
      'authority_request_id_invalid',
      'authority_request_linkage_mismatch',
    ]));
    expect(JSON.stringify(result)).not.toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  test('keeps public summaries bounded to counts and digests', () => {
    const snapshot = normalizeAuthoritySnapshot({
      suggestions,
      emailActivities: [{ activityid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', senton: null }],
    });
    const summary = publicAuthoritySummary(snapshot);
    expect(summary).toMatchObject({ suggestionCount: 5, emailActivityCount: 1 });
    expect(summary.suggestionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(summary)).not.toContain(ids[0]);
    expect(JSON.stringify(summary)).not.toContain('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  });

  test('requires exact suggestion lifecycle/token and email activity snapshots', () => {
    const before = { suggestions, emailActivities: [] };
    expect(validateAuthorityUnchanged(before, before)).toEqual({ ok: true, failures: [] });
    expect(validateAuthorityUnchanged(before, {
      suggestions: suggestions.map((row, index) => index === 0
        ? { ...row, wmkf_externaltokenhash: 'unexpected-token-hash' }
        : row),
      emailActivities: [],
    }).failures).toContain('suggestion_lifecycle_or_token_state_changed');
    expect(validateAuthorityUnchanged(before, {
      suggestions,
      emailActivities: [{ activityid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }],
    }).failures).toContain('request_email_activity_changed');
  });

  test('requires the roster to anchor exactly the five authoritative suggestions', () => {
    const snapshot = { suggestions, emailActivities: [] };
    expect(validateRosterAnchors(snapshot, ids)).toEqual({ ok: true, failures: [] });
    expect(validateRosterAnchors(snapshot, ids.slice(0, 4)).failures).toEqual(expect.arrayContaining([
      'roster_anchor_count_mismatch',
      'roster_anchor_set_mismatch',
    ]));
    expect(validateRosterAnchors(snapshot, [...ids.slice(0, 4), 'ffffffff-ffff-ffff-ffff-ffffffffffff']).failures)
      .toContain('roster_anchor_set_mismatch');
  });
});

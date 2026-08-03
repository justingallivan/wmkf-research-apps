/** @jest-environment node */

const {
  normalizeAuthoritySnapshot,
  publicAuthoritySummary,
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
  wmkf_selected: false,
  wmkf_invited: false,
  wmkf_accepted: false,
  wmkf_declined: false,
  wmkf_externaltokenhash: null,
}));

describe('Reviewer Find cold authority audit', () => {
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

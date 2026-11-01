import {
  STAFF_OUTCOME_NOTE_MAX,
  normalizeStaffWithdrawal,
} from '../../shared/utils/reviewer-staff-outcome';

describe('normalizeStaffWithdrawal', () => {
  test('a missing payload keeps the pre-dialog behavior', () => {
    for (const input of [undefined, null]) {
      expect(normalizeStaffWithdrawal(input)).toEqual({
        reasonPicklist: 'other',
        reasonText: 'Program Director recorded that the reviewer could not complete the assignment.',
        endedBy: 'reviewer_after_accepting',
      });
    }
  });

  test('Reviewer withdrew always records the reviewer as ending it, whatever endedBy says', () => {
    expect(normalizeStaffWithdrawal({ kind: 'withdrew', reason: 'bad-timing', endedBy: 'foundation', note: ' Sabbatical ' }))
      .toEqual({ reasonPicklist: 'bad-timing', reasonText: 'Sabbatical', endedBy: 'reviewer_after_accepting' });
  });

  test('Reviewer withdrew cannot claim a conflict of interest through the reason', () => {
    expect(normalizeStaffWithdrawal({ kind: 'withdrew', reason: 'conflict-of-interest' }).error).toMatch(/reason/);
  });

  test('conflict of interest records who raised it and a default note', () => {
    expect(normalizeStaffWithdrawal({ kind: 'coi', endedBy: 'reviewer_after_accepting' })).toEqual({
      reasonPicklist: 'conflict-of-interest',
      reasonText: 'Program Director recorded a conflict of interest.',
      endedBy: 'reviewer_after_accepting',
    });
  });

  test('Other requires a note and a who-ended-it choice', () => {
    expect(normalizeStaffWithdrawal({ kind: 'other', endedBy: 'foundation' }).error).toMatch(/note is required/);
    expect(normalizeStaffWithdrawal({ kind: 'other', note: 'Moved' }).error).toMatch(/endedBy/);
    expect(normalizeStaffWithdrawal({ kind: 'other', endedBy: 'foundation', note: 'Moved' }))
      .toEqual({ reasonPicklist: 'other', reasonText: 'Moved', endedBy: 'foundation' });
  });

  test.each([
    ['a non-object', 'withdrew'],
    ['an array', []],
    ['a non-text note', { kind: 'coi', endedBy: 'foundation', note: 7 }],
    ['an over-long note', { kind: 'coi', endedBy: 'foundation', note: 'x'.repeat(STAFF_OUTCOME_NOTE_MAX + 1) }],
    ['a pre-acceptance ended-by', { kind: 'coi', endedBy: 'reviewer_before_accepting' }],
  ])('rejects %s', (_name, input) => {
    expect(normalizeStaffWithdrawal(input).error).toBeTruthy();
  });
});

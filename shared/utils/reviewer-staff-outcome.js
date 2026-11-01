/**
 * Staff-recorded ending of an accepted reviewer's engagement
 * (docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md, slice 3b-3).
 *
 * Browser-safe: the Track Reviewers "Record reviewer withdrawal" dialog builds
 * its choices from these constants, and the terminal-transition route
 * re-validates whatever it receives with normalizeStaffWithdrawal, so the two
 * cannot drift.
 *
 *   withdrew → the reviewer withdrew: a reason other than conflict of
 *              interest; Ended by is always "Reviewer after accepting".
 *   coi      → conflict of interest: staff choose who raised it. A conflict is
 *              not a reliability mark (owner rule).
 *   other    → required note; staff choose who ended it.
 */

export const STAFF_WITHDRAWAL_KINDS = Object.freeze(['withdrew', 'coi', 'other']);

export const STAFF_WITHDRAWAL_REASONS = Object.freeze([
  { value: 'too-busy', label: 'Too busy' },
  { value: 'outside-expertise', label: 'Outside their expertise' },
  { value: 'bad-timing', label: 'Bad timing' },
  { value: 'other', label: 'Other reason' },
]);

export const STAFF_ENDED_BY_CHOICES = Object.freeze([
  { value: 'reviewer_after_accepting', label: 'Reviewer' },
  { value: 'foundation', label: 'Foundation' },
]);

export const STAFF_OUTCOME_NOTE_MAX = 2000;

const DEFAULT_TEXT = Object.freeze({
  withdrew: 'Program Director recorded that the reviewer could not complete the assignment.',
  coi: 'Program Director recorded a conflict of interest.',
});

/**
 * Normalize the dialog payload into the adapter's decline fields, or return
 * `{ error }`. A missing payload keeps the pre-dialog behavior (reason Other,
 * Ended by Reviewer after accepting) for a client deployed before the dialog.
 */
export function normalizeStaffWithdrawal(input) {
  if (input === undefined || input === null) {
    return { reasonPicklist: 'other', reasonText: DEFAULT_TEXT.withdrew, endedBy: 'reviewer_after_accepting' };
  }
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'withdrawal must be an object' };
  const { kind } = input;
  if (!STAFF_WITHDRAWAL_KINDS.includes(kind)) return { error: 'withdrawal.kind must be withdrew, coi or other' };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') {
    return { error: 'withdrawal.note must be text' };
  }
  if (note.length > STAFF_OUTCOME_NOTE_MAX) return { error: `withdrawal.note must be at most ${STAFF_OUTCOME_NOTE_MAX} characters` };

  if (kind === 'withdrew') {
    if (!STAFF_WITHDRAWAL_REASONS.some((r) => r.value === input.reason)) {
      return { error: 'withdrawal.reason must be one of the listed reasons' };
    }
    return { reasonPicklist: input.reason, reasonText: note || DEFAULT_TEXT.withdrew, endedBy: 'reviewer_after_accepting' };
  }
  if (!STAFF_ENDED_BY_CHOICES.some((c) => c.value === input.endedBy)) {
    return { error: 'withdrawal.endedBy must be reviewer_after_accepting or foundation' };
  }
  if (kind === 'coi') {
    return { reasonPicklist: 'conflict-of-interest', reasonText: note || DEFAULT_TEXT.coi, endedBy: input.endedBy };
  }
  if (!note) return { error: 'withdrawal.note is required for Other' };
  return { reasonPicklist: 'other', reasonText: note, endedBy: input.endedBy };
}

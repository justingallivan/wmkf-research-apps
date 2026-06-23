/**
 * @jest-environment node
 *
 * deriveWorkRemaining tier logic. REVIEWERS_NEEDED = 3.
 *
 * The hold/finalize step was RETIRED (S279): `held` is no longer a work stage. A
 * historical held row is counted in `invited`, so it folds into 'awaiting' rather
 * than surfacing a "Slate secured — finalize them" cue. These tests guard that fold.
 */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));

// deriveWorkRemaining moved from the dashboard route to the shared rollup service
// (S260, shared with the per-request Overview rollup endpoint).
const { deriveWorkRemaining } = require('../../lib/services/reviewer-rollup');

const c = (over) => ({ candidates: 0, invited: 0, accepted: 0, declined: 0, held: 0, completed: 0, ...over });

describe('deriveWorkRemaining — tier logic', () => {
  test('enough completed → done (outranks all)', () => {
    expect(deriveWorkRemaining(c({ completed: 3, accepted: 3, held: 3, invited: 5 }))).toBe('done');
  });
  test('enough accepted → review', () => {
    expect(deriveWorkRemaining(c({ accepted: 3, held: 1, invited: 5 }))).toBe('review');
  });
  test('retired hold step: held rows fold into awaiting, not a "held" stage (S279)', () => {
    // Was 'held' pre-S279; held rows count in `invited` and now read as 'awaiting'.
    expect(deriveWorkRemaining(c({ held: 3, invited: 4 }))).toBe('awaiting');
    expect(deriveWorkRemaining(c({ accepted: 2, held: 1, invited: 5 }))).toBe('awaiting');
    expect(deriveWorkRemaining(c({ held: 1, invited: 3 }))).toBe('awaiting');
  });
  test('invited but no commitments → awaiting', () => {
    expect(deriveWorkRemaining(c({ invited: 4 }))).toBe('awaiting');
  });
  test('candidates but none invited → invite; none at all → find', () => {
    expect(deriveWorkRemaining(c({ candidates: 5 }))).toBe('invite');
    expect(deriveWorkRemaining(c({}))).toBe('find');
  });
});

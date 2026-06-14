/**
 * @jest-environment node
 *
 * Reviewer "hold step" chunk 8 — deriveWorkRemaining tier logic, incl. the held tier
 * and the mixed accepted+held case (Codex chunk-8 MED: a slate whose shortfall is made
 * up by holds must read 'held', not fall through to 'awaiting'). REVIEWERS_NEEDED = 3.
 */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: (_l, fn) => fn && fn() }));

const { deriveWorkRemaining } = require('../../pages/api/workbench/dashboard');

const c = (over) => ({ candidates: 0, invited: 0, accepted: 0, declined: 0, held: 0, completed: 0, ...over });

describe('deriveWorkRemaining — held tier', () => {
  test('enough completed → done (outranks all)', () => {
    expect(deriveWorkRemaining(c({ completed: 3, accepted: 3, held: 3, invited: 5 }))).toBe('done');
  });
  test('enough accepted → review (outranks held)', () => {
    expect(deriveWorkRemaining(c({ accepted: 3, held: 1, invited: 5 }))).toBe('review');
  });
  test('enough held alone → held', () => {
    expect(deriveWorkRemaining(c({ held: 3, invited: 4 }))).toBe('held');
  });
  test('MIXED accepted+held reaching the threshold → held (not awaiting)', () => {
    expect(deriveWorkRemaining(c({ accepted: 2, held: 1, invited: 5 }))).toBe('held');
  });
  test('committed short of threshold (1 held) → awaiting', () => {
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

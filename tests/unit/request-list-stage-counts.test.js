/**
 * Request list secondary metrics line. The `done` stage means "enough completed
 * reviews" (REVIEWERS_NEEDED), not "every accepted reviewer has returned one",
 * so the copy must say coverage and never "complete".
 */
import { describeStageCounts } from '../../shared/components/workbench/RequestListPanel';

describe('describeStageCounts', () => {
  it('omits the line when nothing is at Find or Done', () => {
    expect(describeStageCounts({ find: 0, invite: 2, awaiting: 1, review: 3, done: 0 })).toBeNull();
    expect(describeStageCounts(undefined)).toBeNull();
  });

  it('describes sufficient coverage, singular and plural', () => {
    expect(describeStageCounts({ done: 1 })).toBe('1 has sufficient review coverage');
    expect(describeStageCounts({ done: 2 })).toBe('2 have sufficient review coverage');
  });

  it('joins Find and Done counts with a middle dot', () => {
    expect(describeStageCounts({ find: 3, done: 2 })).toBe('3 need reviewers · 2 have sufficient review coverage');
    expect(describeStageCounts({ find: 1 })).toBe('1 need reviewers');
  });

  it('never says "complete"', () => {
    expect(describeStageCounts({ find: 1, done: 4 })).not.toMatch(/complete/i);
  });
});

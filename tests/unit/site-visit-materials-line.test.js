/** @jest-environment node */
import { siteVisitMaterialsLine } from '../../shared/utils/site-visit-materials-line';

const base = { state: 'missing', receivedCount: 2, requiredCount: 3, dueAt: '2026-10-05T19:00:00Z', overdue: false, invited: true };
const due = new Date('2026-10-05T19:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

test('no collection renders no line', () => {
  expect(siteVisitMaterialsLine(null)).toBeNull();
  expect(siteVisitMaterialsLine(undefined)).toBeNull();
});

test('counts plus due date while items are missing; overdue is called out', () => {
  expect(siteVisitMaterialsLine(base)).toBe(`Materials: 2 of 3 received · due ${due}.`);
  expect(siteVisitMaterialsLine({ ...base, overdue: true })).toBe(`Materials: 2 of 3 received · overdue (due ${due}).`);
});

test('received, ready, closed, and not-invited states read distinctly', () => {
  expect(siteVisitMaterialsLine({ ...base, state: 'received', receivedCount: 3 })).toBe('Materials: 3 of 3 received, awaiting confirmation.');
  expect(siteVisitMaterialsLine({ ...base, state: 'ready', receivedCount: 3 })).toBe('Materials: ready (3 of 3 received).');
  expect(siteVisitMaterialsLine({ ...base, state: 'closed', receivedCount: 1 })).toBe('Materials: closed, 1 of 3 received.');
  expect(siteVisitMaterialsLine({ ...base, invited: false, receivedCount: 0 })).toBe('Materials: invitation not sent (0 of 3 received).');
});

test('every required item waived is 0 of 0, not a division or a blank', () => {
  expect(siteVisitMaterialsLine({ ...base, state: 'received', receivedCount: 0, requiredCount: 0 })).toBe('Materials: 0 of 0 received, awaiting confirmation.');
});

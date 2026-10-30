/** @jest-environment node */
import { priorRequestCycleLabel, priorRequestReference } from '../../shared/utils/reviewer-prior-request-context';

describe('priorRequestCycleLabel', () => {
  test('uses the linked Grant Cycle label, then the fiscal year', () => {
    expect(priorRequestCycleLabel({ cycleLabel: ' December 2026 ', fiscalYear: 'FY 2027' })).toBe('December 2026');
    expect(priorRequestCycleLabel({ cycleLabel: null, fiscalYear: ' June 2026 ' })).toBe('June 2026');
    expect(priorRequestCycleLabel({ cycleLabel: '  ', fiscalYear: '' })).toBeNull();
    expect(priorRequestCycleLabel(null)).toBeNull();
  });

  test('a meeting date alone is never a cycle label', () => {
    expect(priorRequestCycleLabel({ meetingDate: '2026-12-11' })).toBeNull();
    expect(priorRequestCycleLabel({ meetingDate: '2026-12-11', fiscalYear: 'FY 2027' })).toBe('FY 2027');
  });

  test('ignores non-string labels', () => {
    expect(priorRequestCycleLabel({ cycleLabel: 202612, fiscalYear: 'FY 2027' })).toBe('FY 2027');
  });
});

test('priorRequestReference names the linked cycle', () => {
  expect(priorRequestReference({ requestNumber: '1002278', title: 'A Study', cycleLabel: 'June 2026' }))
    .toBe('#1002278 — A Study (June 2026)');
});

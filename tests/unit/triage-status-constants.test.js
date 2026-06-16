/**
 * @jest-environment node
 *
 * shared/config/triageStatus — value/label integrity + isValidTriageValue.
 */
import { TRIAGE_STATUS, TRIAGE_LABEL, isValidTriageValue } from '../../shared/config/triageStatus';

test('values are the agreed numeric option-set codes', () => {
  expect(TRIAGE_STATUS.ADVANCING).toBe(100000000);
  expect(TRIAGE_STATUS.SET_ASIDE).toBe(100000001);
});

test('every value has a label', () => {
  for (const v of Object.values(TRIAGE_STATUS)) {
    expect(typeof TRIAGE_LABEL[v]).toBe('string');
    expect(TRIAGE_LABEL[v].length).toBeGreaterThan(0);
  }
});

test('isValidTriageValue accepts the option values (number and numeric string)', () => {
  expect(isValidTriageValue(100000000)).toBe(true);
  expect(isValidTriageValue(100000001)).toBe(true);
  expect(isValidTriageValue('100000000')).toBe(true);
});

test('isValidTriageValue rejects null/undefined/empty (clearing is not settable here)', () => {
  expect(isValidTriageValue(null)).toBe(false);
  expect(isValidTriageValue(undefined)).toBe(false);
  expect(isValidTriageValue('')).toBe(false);
});

test('isValidTriageValue rejects out-of-set and non-integer values', () => {
  expect(isValidTriageValue(999)).toBe(false);
  expect(isValidTriageValue(0)).toBe(false);
  expect(isValidTriageValue(100000000.5)).toBe(false);
  expect(isValidTriageValue('abc')).toBe(false);
  expect(isValidTriageValue({})).toBe(false);
});

/** @jest-environment node */
import { isWeekendInZone, subtractBusinessDays, zonedDateKey } from '../../lib/utils/business-days';

const LA = 'America/Los_Angeles';

test('two business days before a Wednesday visit is the Monday; before a Monday it is the prior Thursday', () => {
  // Wed 2026-10-07 10:00 PDT
  const wed = new Date('2026-10-07T17:00:00Z');
  expect(zonedDateKey(subtractBusinessDays(wed, 2, LA), LA)).toBe('2026-10-05');
  // Mon 2026-10-05 10:00 PDT → Thu 2026-10-01
  const mon = new Date('2026-10-05T17:00:00Z');
  expect(zonedDateKey(subtractBusinessDays(mon, 2, LA), LA)).toBe('2026-10-01');
  // Tue → Fri of the prior week
  const tue = new Date('2026-10-06T17:00:00Z');
  expect(zonedDateKey(subtractBusinessDays(tue, 2, LA), LA)).toBe('2026-10-02');
});

test('weekend evaluation follows the zone, not UTC', () => {
  // Sat 2026-10-10 23:30 PDT is Sun 06:30 UTC.
  const lateSaturdayLa = new Date('2026-10-11T06:30:00Z');
  expect(isWeekendInZone(lateSaturdayLa, LA)).toBe(true);
  // Fri 2026-10-09 23:30 PDT is Sat 06:30 UTC: a weekday in LA.
  const lateFridayLa = new Date('2026-10-10T06:30:00Z');
  expect(isWeekendInZone(lateFridayLa, LA)).toBe(false);
  expect(isWeekendInZone(lateFridayLa, 'UTC')).toBe(true);
});

test('zero days returns the same instant; invalid input returns null', () => {
  const d = new Date('2026-10-07T17:00:00Z');
  expect(subtractBusinessDays(d, 0, LA).getTime()).toBe(d.getTime());
  expect(subtractBusinessDays('not a date', 2, LA)).toBeNull();
  expect(subtractBusinessDays(d, -1, LA)).toBeNull();
  expect(subtractBusinessDays(d, 1.5, LA)).toBeNull();
  // Unknown zone falls back to UTC rather than throwing.
  expect(subtractBusinessDays(d, 1, 'Mars/Olympus')).toBeInstanceOf(Date);
});

import {
  formatZonedLocalInput,
  resolveZonedDateTime,
  validateZonedRange,
} from '../../lib/utils/zoned-date-time';

describe('zoned-date-time', () => {
  test('resolves and round-trips an ordinary Chicago wall time', () => {
    const iso = resolveZonedDateTime('2026-08-24T09:30', 'America/Chicago');
    expect(iso).toBe('2026-08-24T14:30:00.000Z');
    expect(formatZonedLocalInput(iso, 'America/Chicago')).toBe('2026-08-24T09:30');
  });

  test('rejects a nonexistent spring-forward wall time', () => {
    expect(() => resolveZonedDateTime('2026-03-08T02:30', 'America/Chicago'))
      .toThrow(expect.objectContaining({ code: 'nonexistent_local_time' }));
  });

  test('requires explicit choice for a repeated fall-back wall time', () => {
    expect(() => resolveZonedDateTime('2026-11-01T01:30', 'America/Chicago'))
      .toThrow(expect.objectContaining({ code: 'ambiguous_local_time' }));
    expect(resolveZonedDateTime('2026-11-01T01:30', 'America/Chicago', 'earlier'))
      .toBe('2026-11-01T06:30:00.000Z');
    expect(resolveZonedDateTime('2026-11-01T01:30', 'America/Chicago', 'later'))
      .toBe('2026-11-01T07:30:00.000Z');
  });

  test('rejects malformed zones, impossible dates, and reversed ranges', () => {
    expect(() => resolveZonedDateTime('2026-02-31T10:00', 'America/Chicago'))
      .toThrow(expect.objectContaining({ code: 'invalid_local_date_time' }));
    expect(() => resolveZonedDateTime('2026-08-24T10:00', 'Not/AZone'))
      .toThrow(expect.objectContaining({ code: 'invalid_time_zone' }));
    expect(() => validateZonedRange({
      startLocal: '2026-08-24T10:00',
      endLocal: '2026-08-24T09:00',
      timeZone: 'America/Chicago',
    })).toThrow(expect.objectContaining({ code: 'invalid_time_range' }));
  });
});

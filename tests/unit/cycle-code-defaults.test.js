import {
  conventionalCycles,
  resolveLastDecidedCycle,
  resolveWorkingCycle,
} from '../../lib/utils/cycle-code';

const SEP_8_2026 = new Date('2026-09-08T22:00:00-07:00'); // late evening Pacific = 2026-09-09 UTC

describe('conventionalCycles', () => {
  test('six June/December codes around today, ascending', () => {
    expect(conventionalCycles(SEP_8_2026)).toEqual(['J25', 'D25', 'J26', 'D26', 'J27', 'D27']);
  });
});

describe('resolveWorkingCycle (the upcoming meeting)', () => {
  test('September resolves to the December meeting, from codes alone', () => {
    expect(resolveWorkingCycle(conventionalCycles(SEP_8_2026), SEP_8_2026)).toBe('D26');
  });

  test('June and December are still the working cycle for the whole month when only the month is known', () => {
    expect(resolveWorkingCycle(['J26', 'D26'], new Date('2026-06-30T12:00:00Z'))).toBe('J26');
    expect(resolveWorkingCycle(['J26', 'D26'], new Date('2026-12-31T12:00:00Z'))).toBe('D26');
    expect(resolveWorkingCycle(['J26', 'D26'], new Date('2026-07-01T00:00:00Z'))).toBe('D26');
  });

  test('an exact meeting date flips the working cycle the day after the meeting', () => {
    const cycles = [
      { code: 'D26', meetingDate: '2026-12-11' },
      { code: 'J27', meetingDate: '2027-06-10' },
    ];
    expect(resolveWorkingCycle(cycles, new Date('2026-12-11T20:00:00Z'))).toBe('D26');
    expect(resolveWorkingCycle(cycles, new Date('2026-12-12T00:00:00Z'))).toBe('J27');
  });

  test('falls back to the newest cycle once every listed meeting has passed', () => {
    expect(resolveWorkingCycle(['J25', 'D25', 'J26'], SEP_8_2026)).toBe('J26');
  });

  test('accepts unordered input and dashboard-shaped objects', () => {
    expect(resolveWorkingCycle([{ code: 'j27' }, { code: 'D26' }, { code: 'J26' }], SEP_8_2026)).toBe('D26');
  });

  test('empty list resolves to null; an unclassifiable code fails loud', () => {
    expect(resolveWorkingCycle([], SEP_8_2026)).toBeNull();
    expect(() => resolveWorkingCycle(['D26', 'M27'], SEP_8_2026)).toThrow(/Unclassifiable cycle code "M27"/);
  });
});

describe('resolveLastDecidedCycle (the most recent past meeting)', () => {
  test('September resolves to the June meeting', () => {
    expect(resolveLastDecidedCycle(conventionalCycles(SEP_8_2026), SEP_8_2026)).toBe('J26');
  });

  test('January resolves to the previous December', () => {
    const jan = new Date('2027-01-15T12:00:00Z');
    expect(resolveLastDecidedCycle(conventionalCycles(jan), jan)).toBe('D26');
  });

  test('with exact dates, the meeting day itself is not yet decided', () => {
    const cycles = [{ code: 'J26', meetingDate: '2026-06-04' }, { code: 'D26', meetingDate: '2026-12-11' }];
    expect(resolveLastDecidedCycle(cycles, new Date('2026-12-11T12:00:00Z'))).toBe('J26');
    expect(resolveLastDecidedCycle(cycles, new Date('2026-12-12T00:00:00Z'))).toBe('D26');
  });

  test('null when nothing has been decided yet', () => {
    expect(resolveLastDecidedCycle(['D26', 'J27'], SEP_8_2026)).toBeNull();
  });

  test('working and last-decided cycles never coincide for the same day and list', () => {
    const list = conventionalCycles(SEP_8_2026);
    expect(resolveWorkingCycle(list, SEP_8_2026)).not.toBe(resolveLastDecidedCycle(list, SEP_8_2026));
  });
});

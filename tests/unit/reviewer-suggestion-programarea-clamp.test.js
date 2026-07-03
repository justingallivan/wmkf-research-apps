/**
 * @jest-environment node
 *
 * Regression: `wmkf_programarea` is capped at 100 chars in Dataverse, but the value
 * flows from the LLM-extracted `analysis.proposalInfo.programArea` (free text). Req
 * 1002916 produced a >100-char program area that hard-failed the save with a 400
 * ("length ... exceeded the maximum allowed length of '100'"). `clampProgramArea`
 * degrades an over-long value to a truncated label at the write boundary instead.
 */

const { clampProgramArea, PROGRAM_AREA_MAX_LENGTH } = require('../../lib/dataverse/adapters/reviewer-suggestion');

describe('clampProgramArea', () => {
  test('caps a >100-char value at exactly the field max', () => {
    const long = 'A'.repeat(180);
    const out = clampProgramArea(long);
    expect(out.length).toBe(PROGRAM_AREA_MAX_LENGTH);
    expect(PROGRAM_AREA_MAX_LENGTH).toBe(100);
  });

  test('leaves a valid short program area unchanged (only trims)', () => {
    expect(clampProgramArea('Science and Engineering Research Program'))
      .toBe('Science and Engineering Research Program');
    expect(clampProgramArea('  Medical Research Program  ')).toBe('Medical Research Program');
  });

  test('a value at exactly 100 chars passes through', () => {
    const exactly = 'B'.repeat(100);
    expect(clampProgramArea(exactly)).toBe(exactly);
  });

  test('passes non-strings through untouched (null/undefined dropped later by pruneEmpty)', () => {
    expect(clampProgramArea(null)).toBeNull();
    expect(clampProgramArea(undefined)).toBeUndefined();
  });

  test('the 1002916-style over-long value no longer violates the 100 cap', () => {
    const gnome = 'Geosciences: Greenland Oldest ice exploration and modeling — cryosphere, '
      + 'paleoclimate, ice-sheet dynamics and subglacial processes program area';
    expect(gnome.length).toBeGreaterThan(100);
    expect(clampProgramArea(gnome).length).toBeLessThanOrEqual(100);
  });
});

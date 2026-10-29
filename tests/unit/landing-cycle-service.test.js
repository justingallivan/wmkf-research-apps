/**
 * Landing cycle service (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md):
 * bounded validated reader, editor view, save path, Board default.
 */
import {
  LANDING_CYCLE_KEY,
  getLandingCycle,
  loadLandingCycleEditor,
  resolveBoardDefaultCycle,
  saveLandingCycle,
} from '../../lib/services/landing-cycle-service.js';

const EDITOR = { profileId: 7, systemUserId: '11111111-1111-1111-1111-111111111111' };

function deps(overrides = {}) {
  return {
    getSettingStrict: jest.fn(async () => ({ found: true, value: 'J27', revision: 'W/"5"' })),
    listSettingsWithMetaStrict: jest.fn(async () => ({})),
    setSettingIfUnchanged: jest.fn(async () => true),
    findCycleByCode: jest.fn(async (code) => ({ wmkf_grantcycleid: 'id', wmkf_cyclecode: code })),
    listModernCycles: jest.fn(async () => [
      { wmkf_cyclecode: 'D26', wmkf_name: 'December 2026', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
      { wmkf_cyclecode: 'J27', wmkf_name: 'June 2027', wmkf_meetingdate: '2027-06-10T00:00:00Z' },
      { wmkf_cyclecode: 'Sept2019', wmkf_name: 'Old' },
    ]),
    canEditCalendar: jest.fn(async () => true),
    now: () => new Date('2026-11-01T18:00:00Z'),
    log: jest.fn(),
    ...overrides,
  };
}

describe('getLandingCycle', () => {
  test('returns a valid stored code after confirming the Grant Cycle row, passing a deadline to both reads', async () => {
    const d = deps();
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: 'J27', reason: null });
    expect(d.getSettingStrict).toHaveBeenCalledWith(LANDING_CYCLE_KEY, { timeoutMs: expect.any(Number) });
    expect(d.findCycleByCode).toHaveBeenCalledWith('J27', { timeoutMs: expect.any(Number) });
    expect(d.log).not.toHaveBeenCalled();
  });

  test.each([
    ['absent row', { found: false, value: null, revision: null }],
    ['empty value (cleared)', { found: true, value: '', revision: 'W/"6"' }],
  ])('%s is unset with no reason and no Grant Cycle lookup', async (_label, row) => {
    const d = deps({ getSettingStrict: jest.fn(async () => row) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: null, reason: null });
    expect(d.findCycleByCode).not.toHaveBeenCalled();
  });

  test('a malformed value edited outside the app is treated as unset and never reaches the lookup', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'June 2027', revision: 'W/"6"' })) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: null, reason: 'landing_setting_invalid' });
    expect(d.findCycleByCode).not.toHaveBeenCalled();
  });

  test('a valid-pattern code with no Grant Cycle row is treated as unset', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'D27', revision: 'W/"6"' })), findCycleByCode: jest.fn(async () => null) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: null, reason: 'landing_cycle_missing' });
  });

  test('settings and lookup failures fall back with reason codes', async () => {
    await expect(getLandingCycle({}, deps({ getSettingStrict: jest.fn(async () => { throw new Error('503'); }) })))
      .resolves.toEqual({ code: null, reason: 'landing_setting_error' });
    await expect(getLandingCycle({}, deps({ findCycleByCode: jest.fn(async () => { throw new Error('500'); }) })))
      .resolves.toEqual({ code: null, reason: 'landing_validation_error' });
  });

  test('a hanging settings read or lookup resolves by the deadline', async () => {
    const never = () => new Promise(() => {});
    const started = Date.now();
    await expect(getLandingCycle({ deadlineMs: 30 }, deps({ getSettingStrict: jest.fn(never) })))
      .resolves.toEqual({ code: null, reason: 'landing_setting_timeout' });
    await expect(getLandingCycle({ deadlineMs: 30 }, deps({ findCycleByCode: jest.fn(never) })))
      .resolves.toEqual({ code: null, reason: 'landing_setting_timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('loadLandingCycleEditor', () => {
  test('reports the active value, who set it, and modern cycles only, ordered by Board date', async () => {
    const d = deps({ listSettingsWithMetaStrict: jest.fn(async () => ({ [LANDING_CYCLE_KEY]: { updatedByName: 'Grants Manager', updatedAt: '2026-11-01T17:00:00Z' } })) });
    const view = await loadLandingCycleEditor(EDITOR, d);
    expect(view).toMatchObject({ landingCycleCode: 'J27', status: 'active', setBy: 'Grants Manager', revision: 'W/"5"', canEdit: true });
    expect(view.cycles.map((c) => c.code)).toEqual(['D26', 'J27']);
  });

  test('an orphaned stored value is reported as missing, not active', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'D27', revision: 'W/"6"' })) });
    await expect(loadLandingCycleEditor(EDITOR, d)).resolves.toMatchObject({ landingCycleCode: null, status: 'missing', storedValue: 'D27' });
  });

  test('a read failure is a 503, not a silent empty view', async () => {
    const d = deps({ listModernCycles: jest.fn(async () => { throw new Error('down'); }) });
    await expect(loadLandingCycleEditor(EDITOR, d)).rejects.toMatchObject({ httpStatus: 503, code: 'landing_unavailable' });
  });
});

describe('saveLandingCycle', () => {
  test('saves a code with the editor as updater and the revision the editor saw', async () => {
    const d = deps();
    await saveLandingCycle(EDITOR, { cycleCode: 'J27', revision: 'W/"5"' }, d);
    expect(d.setSettingIfUnchanged).toHaveBeenCalledWith(LANDING_CYCLE_KEY, 'J27', 'W/"5"', 7);
  });

  test('clearing writes an empty value; a first save sends a null revision', async () => {
    const d = deps();
    await saveLandingCycle(EDITOR, { cycleCode: null, revision: null }, d);
    expect(d.setSettingIfUnchanged).toHaveBeenCalledWith(LANDING_CYCLE_KEY, '', null, 7);
    expect(d.findCycleByCode).not.toHaveBeenCalled();
  });

  test.each([
    [{ cycleCode: 'J27', revision: null, extra: 1 }, 'landing_body_invalid'],
    [{ cycleCode: 'june', revision: null }, 'landing_cycle_invalid'],
    [{ cycleCode: 'J27', revision: 'abc' }, 'landing_revision_invalid'],
  ])('rejects %j with %s before any write', async (body, code) => {
    const d = deps();
    await expect(saveLandingCycle(EDITOR, body, d)).rejects.toMatchObject({ httpStatus: 400, code });
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('a non-editor is refused before any lookup or write', async () => {
    const d = deps({ canEditCalendar: jest.fn(async () => false) });
    await expect(saveLandingCycle(EDITOR, { cycleCode: 'J27', revision: null }, d)).rejects.toMatchObject({ httpStatus: 403, code: 'landing_edit_denied' });
    expect(d.findCycleByCode).not.toHaveBeenCalled();
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('a code with no Grant Cycle row is refused', async () => {
    const d = deps({ findCycleByCode: jest.fn(async () => null) });
    await expect(saveLandingCycle(EDITOR, { cycleCode: 'D27', revision: null }, d)).rejects.toMatchObject({ httpStatus: 404, code: 'landing_cycle_missing' });
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('a concurrent change becomes a 409 conflict', async () => {
    const conflict = Object.assign(new Error('changed'), { code: 'setting_conflict' });
    const d = deps({ setSettingIfUnchanged: jest.fn(async () => { throw conflict; }) });
    await expect(saveLandingCycle(EDITOR, { cycleCode: 'J27', revision: 'W/"4"' }, d)).rejects.toMatchObject({ httpStatus: 409, code: 'landing_conflict' });
  });
});

describe('resolveBoardDefaultCycle', () => {
  const setups = (entries) => jest.fn(async (prefix) => (prefix === LANDING_CYCLE_KEY ? {} : Object.fromEntries(
    entries.map(([code, boardEnds]) => [`board_writeups.cycle.${code}`, { value: JSON.stringify({ cycle: code, boardEnds }) }]),
  )));

  test('the landing cycle wins when it has a dated Board setup', async () => {
    const d = deps({ listSettingsWithMetaStrict: setups([['D26', '2026-12-10'], ['J27', '2027-06-10']]) });
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('J27');
  });

  test('without a setup for the landing cycle, the nearest upcoming dated setup wins (D26 through Board day)', async () => {
    const d = deps({ listSettingsWithMetaStrict: setups([['D26', '2026-12-10']]) });
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('D26');
  });

  test('an inactive setup with no end date is not a candidate', async () => {
    const d = deps({
      getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })),
      listSettingsWithMetaStrict: setups([['D26', '2026-12-10'], ['J27', null]]),
    });
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('D26');
  });

  test('the Board day is judged by the Pacific calendar day, not the UTC day', async () => {
    // 2026-12-11T05:00Z is still Dec 10 in Los Angeles: D26's Board day has not passed.
    const d = deps({
      getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })),
      listSettingsWithMetaStrict: setups([['D26', '2026-12-10'], ['J27', '2027-06-10']]),
      now: () => new Date('2026-12-11T05:00:00Z'),
    });
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('D26');
    d.now = () => new Date('2026-12-11T09:00:00Z');
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('J27');
  });

  test('when every dated setup is past, the latest one wins', async () => {
    const d = deps({
      getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })),
      listSettingsWithMetaStrict: setups([['J26', '2026-06-10'], ['D26', '2026-12-10']]),
      now: () => new Date('2027-01-15T18:00:00Z'),
    });
    await expect(resolveBoardDefaultCycle(d)).resolves.toBe('D26');
  });

  test('no dated setups, or a failed setup read, falls back to the conventional rule', async () => {
    await expect(resolveBoardDefaultCycle(deps({ listSettingsWithMetaStrict: setups([]) }))).resolves.toBe('D26');
    const broken = jest.fn(async (prefix) => { if (prefix !== LANDING_CYCLE_KEY) throw new Error('down'); return {}; });
    await expect(resolveBoardDefaultCycle(deps({ listSettingsWithMetaStrict: broken }))).resolves.toBe('D26');
  });
});

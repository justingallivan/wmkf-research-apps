/**
 * Landing cycle service (docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md):
 * bounded validated reader, editor view, save path, Board default.
 */
import {
  LANDING_CYCLE_KEY,
  automaticLandingCycle,
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
    listBoardDates: jest.fn(async () => [
      { wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
      { wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10T00:00:00Z' },
    ]),
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
  test('a valid override wins after confirming the Grant Cycle row, passing a deadline to both reads', async () => {
    const d = deps();
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: 'J27', reason: null, source: 'manual' });
    expect(d.getSettingStrict).toHaveBeenCalledWith(LANDING_CYCLE_KEY, { timeoutMs: expect.any(Number) });
    expect(d.findCycleByCode).toHaveBeenCalledWith('J27', { timeoutMs: expect.any(Number) });
    expect(d.listBoardDates).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  test.each([
    ['absent row', { found: false, value: null, revision: null }],
    ['empty value (automatic)', { found: true, value: '', revision: 'W/"6"' }],
  ])('%s is automatic: the next Board meeting, no override lookup', async (_label, row) => {
    const d = deps({ getSettingStrict: jest.fn(async () => row) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: 'D26', reason: null, source: 'automatic' });
    expect(d.findCycleByCode).not.toHaveBeenCalled();
    expect(d.listBoardDates).toHaveBeenCalledWith({ timeoutMs: expect.any(Number) });
  });

  test('a malformed override edited outside the app falls back to automatic and never reaches the lookup', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'June 2027', revision: 'W/"6"' })) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: 'D26', reason: 'landing_setting_invalid', source: 'automatic' });
    expect(d.findCycleByCode).not.toHaveBeenCalled();
  });

  test('a valid-pattern override with no Grant Cycle row falls back to automatic', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'D27', revision: 'W/"6"' })), findCycleByCode: jest.fn(async () => null) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: 'D26', reason: 'landing_cycle_missing', source: 'automatic' });
  });

  test('settings and lookup failures fall back to automatic with reason codes', async () => {
    await expect(getLandingCycle({}, deps({ getSettingStrict: jest.fn(async () => { throw new Error('503'); }) })))
      .resolves.toEqual({ code: 'D26', reason: 'landing_setting_error', source: 'automatic' });
    await expect(getLandingCycle({}, deps({ findCycleByCode: jest.fn(async () => { throw new Error('500'); }) })))
      .resolves.toEqual({ code: 'D26', reason: 'landing_validation_error', source: 'automatic' });
  });

  test('a failed Board-date read leaves no landing cycle (each app keeps its own rule)', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: false })), listBoardDates: jest.fn(async () => { throw new Error('500'); }) });
    await expect(getLandingCycle({}, d)).resolves.toEqual({ code: null, reason: 'landing_automatic_error', source: null });
  });

  test('a hanging settings read, override lookup or Board-date read resolves by the deadline', async () => {
    const never = () => new Promise(() => {});
    const started = Date.now();
    const timedOut = { code: null, reason: 'landing_setting_timeout', source: null };
    await expect(getLandingCycle({ deadlineMs: 30 }, deps({ getSettingStrict: jest.fn(never) }))).resolves.toEqual(timedOut);
    await expect(getLandingCycle({ deadlineMs: 30 }, deps({ findCycleByCode: jest.fn(never) }))).resolves.toEqual(timedOut);
    await expect(getLandingCycle({ deadlineMs: 30 }, deps({ getSettingStrict: jest.fn(async () => ({ found: false })), listBoardDates: jest.fn(never) }))).resolves.toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('automaticLandingCycle (D45: the next Board meeting, switching the Pacific day after)', () => {
  const rows = [
    { wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-10T00:00:00Z' },
    { wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
    { wmkf_cyclecode: 'D27', wmkf_meetingdate: null },
    { wmkf_cyclecode: 'Sept2019', wmkf_meetingdate: '2019-09-10T00:00:00Z' },
  ];

  test('stays on D26 through its Board day in Pacific time, then switches to J27', () => {
    expect(automaticLandingCycle(rows, new Date('2026-12-10T18:00:00Z'))).toEqual({ code: 'D26', boardDate: '2026-12-10', switchesOn: '2026-12-11' });
    // 07:59Z on Dec 11 is still 11:59 pm Dec 10 in Los Angeles.
    expect(automaticLandingCycle(rows, new Date('2026-12-11T07:59:00Z')).code).toBe('D26');
    // 08:00Z on Dec 11 is midnight Pacific: the day after the Board meeting.
    expect(automaticLandingCycle(rows, new Date('2026-12-11T08:00:00Z'))).toEqual({ code: 'J27', boardDate: '2027-06-10', switchesOn: '2027-06-11' });
  });

  test('ignores cycles without a Board date and non-modern codes; when every Board date has passed, keeps the latest', () => {
    expect(automaticLandingCycle(rows, new Date('2027-07-01T12:00:00Z'))).toEqual({ code: 'J27', boardDate: '2027-06-10', switchesOn: null });
  });

  test('no dated cycles means no automatic choice', () => {
    expect(automaticLandingCycle([{ wmkf_cyclecode: 'J27', wmkf_meetingdate: null }], new Date())).toBeNull();
    expect(automaticLandingCycle([], new Date())).toBeNull();
  });
});

describe('loadLandingCycleEditor', () => {
  test('reports the active value, who set it, and modern cycles only, ordered by Board date', async () => {
    const d = deps({ listSettingsWithMetaStrict: jest.fn(async () => ({ [LANDING_CYCLE_KEY]: { updatedByName: 'Grants Manager', updatedAt: '2026-11-01T17:00:00Z' } })) });
    const view = await loadLandingCycleEditor(EDITOR, d);
    expect(view).toMatchObject({ landingCycleCode: 'J27', status: 'active', setBy: 'Grants Manager', revision: 'W/"5"', canEdit: true });
    expect(view.automatic).toEqual({ code: 'D26', boardDate: '2026-12-10', switchesOn: '2026-12-11' });
    expect(view.cycles.map((c) => c.code)).toEqual(['D26', 'J27']);
  });

  test('no override is automatic, and the effective code is the automatic one', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: '', revision: 'W/"6"' })) });
    await expect(loadLandingCycleEditor(EDITOR, d)).resolves.toMatchObject({ landingCycleCode: 'D26', status: 'automatic', storedValue: null });
  });

  test('an orphaned override is reported as missing, and the effective code falls back to automatic', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: 'D27', revision: 'W/"6"' })) });
    await expect(loadLandingCycleEditor(EDITOR, d)).resolves.toMatchObject({ landingCycleCode: 'D26', status: 'missing', storedValue: 'D27' });
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

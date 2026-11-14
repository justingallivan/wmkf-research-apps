/** @jest-environment node */
import {
  PHASE_ROLLOUT_KEY, PHASE_ROLLOUT_READ_DEADLINE_MS, parsePhaseRollout, readPhaseRollout,
  rolloutAdmitsRequest, resolvePhaseAdmission, phaseRouteAdmitted, loadPhaseAdmission,
} from '../../lib/services/workbench/phase-admission';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const guids = (n) => Array.from({ length: n }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);

function deps(overrides = {}) {
  return {
    getSettingStrict: jest.fn(async () => ({ found: true, value: '{"mode":"on"}', revision: 'W/"1"' })),
    classifyDeployment: () => 'production',
    workbenchPhaseReleaseAdmitted: () => true,
    reviewSummaryFieldsReady: () => true,
    log: jest.fn(),
    ...overrides,
  };
}

describe('parsePhaseRollout accepts exactly the three forms', () => {
  test.each([
    ['{"mode":"off"}', 'off'],
    ['{"mode":"on"}', 'on'],
    [`{"mode":"pilot","requestIds":["${A.toUpperCase()}"," ${B} "]}`, 'pilot'],
  ])('%s reads as %s', (value, mode) => {
    expect(parsePhaseRollout(value)?.mode).toBe(mode);
  });

  test('pilot ids are normalised to lower case, trimmed and de-duplicated', () => {
    expect(parsePhaseRollout(`{"mode":"pilot","requestIds":["${A.toUpperCase()}","${A}"," ${B} "]}`).requestIds).toEqual([A, B]);
  });

  test.each([
    ['not JSON', 'on'],
    ['an array', '[{"mode":"on"}]'],
    ['a JSON string', '"on"'],
    ['null', 'null'],
    ['an unknown mode', '{"mode":"all"}'],
    ['extra keys on on', '{"mode":"on","requestIds":[]}'],
    ['extra keys on off', '{"mode":"off","note":"x"}'],
    ['pilot without ids', '{"mode":"pilot"}'],
    ['pilot with an empty list', '{"mode":"pilot","requestIds":[]}'],
    ['pilot with a non-GUID', `{"mode":"pilot","requestIds":["${A}","1002794"]}`],
    ['pilot with a non-string id', `{"mode":"pilot","requestIds":[${JSON.stringify(A)},7]}`],
    ['pilot with extra keys', `{"mode":"pilot","requestIds":["${A}"],"x":1}`],
    ['pilot over 200 ids', JSON.stringify({ mode: 'pilot', requestIds: guids(201) })],
  ])('%s is not a rollout', (_label, value) => {
    expect(parsePhaseRollout(value)).toBeNull();
  });

  test('a non-string value is not a rollout', () => {
    expect(parsePhaseRollout(null)).toBeNull();
    expect(parsePhaseRollout({ mode: 'on' })).toBeNull();
  });

  test('200 pilot ids is the limit', () => {
    expect(parsePhaseRollout(JSON.stringify({ mode: 'pilot', requestIds: guids(200) }))?.mode).toBe('pilot');
  });
});

describe('readPhaseRollout', () => {
  test('reads the one key with a deadline, on every call (no cache)', async () => {
    const d = deps();
    await readPhaseRollout(d);
    await readPhaseRollout(d);
    expect(d.getSettingStrict).toHaveBeenCalledTimes(2);
    expect(d.getSettingStrict).toHaveBeenCalledWith(PHASE_ROLLOUT_KEY, { timeoutMs: PHASE_ROLLOUT_READ_DEADLINE_MS });
  });

  test('an absent setting is off in Production and on elsewhere', async () => {
    const absent = async () => ({ found: false, value: null, revision: null });
    expect((await readPhaseRollout(deps({ getSettingStrict: absent }))).mode).toBe('off');
    for (const where of ['preview', 'local', 'test']) {
      expect((await readPhaseRollout(deps({ getSettingStrict: absent, classifyDeployment: () => where }))).mode).toBe('on');
    }
  });

  test('a failed read is off everywhere, and is logged', async () => {
    for (const where of ['production', 'preview']) {
      const d = deps({ getSettingStrict: async () => { throw new Error('Dataverse unavailable'); }, classifyDeployment: () => where });
      expect((await readPhaseRollout(d)).mode).toBe('off');
      expect(d.log).toHaveBeenCalled();
    }
  });

  test('an unrecognised value is off everywhere, and is logged', async () => {
    const d = deps({ getSettingStrict: async () => ({ found: true, value: '{"mode":"yes"}' }), classifyDeployment: () => 'preview' });
    expect((await readPhaseRollout(d)).mode).toBe('off');
    expect(d.log).toHaveBeenCalled();
  });

  test('a read that never answers is off once the deadline passes', async () => {
    jest.useFakeTimers();
    try {
      const pending = readPhaseRollout(deps({ getSettingStrict: () => new Promise(() => {}), classifyDeployment: () => 'preview' }));
      jest.advanceTimersByTime(PHASE_ROLLOUT_READ_DEADLINE_MS + 300);
      expect((await pending).mode).toBe('off');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('rolloutAdmitsRequest', () => {
  const pilot = parsePhaseRollout(JSON.stringify({ mode: 'pilot', requestIds: [A] }));
  test('pilot admits only the named requests, in any letter case', () => {
    expect(rolloutAdmitsRequest(pilot, A)).toBe(true);
    expect(rolloutAdmitsRequest(pilot, ` ${A.toUpperCase()} `)).toBe(true);
    expect(rolloutAdmitsRequest(pilot, B)).toBe(false);
    expect(rolloutAdmitsRequest(pilot, '1002794')).toBe(false);
    expect(rolloutAdmitsRequest(pilot, undefined)).toBe(false);
  });
  test('on admits any request; off and anything else admit none', () => {
    expect(rolloutAdmitsRequest(parsePhaseRollout('{"mode":"on"}'), B)).toBe(true);
    expect(rolloutAdmitsRequest(parsePhaseRollout('{"mode":"off"}'), A)).toBe(false);
    expect(rolloutAdmitsRequest(null, A)).toBe(false);
    expect(rolloutAdmitsRequest({ mode: 'pilot' }, A)).toBe(false);
  });
});

describe('resolvePhaseAdmission (request context)', () => {
  test('admits a 2027-or-later request the setting admits', async () => {
    expect(await resolvePhaseAdmission({ requestId: A, cycleCode: 'J27' }, deps())).toBe(true);
    expect(await resolvePhaseAdmission({ requestId: A, cycleCode: 'D28' }, deps())).toBe(true);
  });

  test.each([
    ['the cycle page release is off', { workbenchPhaseReleaseAdmitted: () => false }, 'J27'],
    ['the fields are not ready', { reviewSummaryFieldsReady: () => false }, 'J27'],
    ['the cycle is before 2027', {}, 'D26'],
    ['there is no linked cycle', {}, null],
  ])('refuses without reading the setting when %s', async (_label, overrides, cycleCode) => {
    const d = deps(overrides);
    expect(await resolvePhaseAdmission({ requestId: A, cycleCode }, d)).toBe(false);
    expect(d.getSettingStrict).not.toHaveBeenCalled();
  });

  test('pilot admits the named request and refuses another in the same cycle', async () => {
    const value = JSON.stringify({ mode: 'pilot', requestIds: [A] });
    const d = deps({ getSettingStrict: async () => ({ found: true, value }) });
    expect(await resolvePhaseAdmission({ requestId: A, cycleCode: 'J27' }, d)).toBe(true);
    expect(await resolvePhaseAdmission({ requestId: B, cycleCode: 'J27' }, d)).toBe(false);
  });

  test('off refuses a 2027 request', async () => {
    const d = deps({ getSettingStrict: async () => ({ found: true, value: '{"mode":"off"}' }) });
    expect(await resolvePhaseAdmission({ requestId: A, cycleCode: 'J27' }, d)).toBe(false);
  });
});

describe('phaseRouteAdmitted (field routes)', () => {
  test('needs the release gate, the route field and the setting', async () => {
    expect(await phaseRouteAdmitted(A, () => true, deps())).toBe(true);
    const noRelease = deps({ workbenchPhaseReleaseAdmitted: () => false });
    expect(await phaseRouteAdmitted(A, () => true, noRelease)).toBe(false);
    expect(noRelease.getSettingStrict).not.toHaveBeenCalled();
    const noField = deps();
    expect(await phaseRouteAdmitted(A, () => false, noField)).toBe(false);
    expect(noField.getSettingStrict).not.toHaveBeenCalled();
    const off = deps({ getSettingStrict: async () => ({ found: true, value: '{"mode":"off"}' }) });
    expect(await phaseRouteAdmitted(A, () => true, off)).toBe(false);
  });
});

describe('loadPhaseAdmission (one read per server read)', () => {
  test('reads the setting once; the predicate needs a 2027-or-later cycle and the setting', async () => {
    const value = JSON.stringify({ mode: 'pilot', requestIds: [A] });
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value })) });
    const admits = await loadPhaseAdmission(d);
    expect(admits(A, 'J27')).toBe(true);
    expect(admits(A, 'D26')).toBe(false);
    expect(admits(A, null)).toBe(false);
    expect(admits(B, 'J27')).toBe(false);
    expect(d.getSettingStrict).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['the cycle page release is off', { workbenchPhaseReleaseAdmitted: () => false }],
    ['the fields are not ready', { reviewSummaryFieldsReady: () => false }],
  ])('refuses every request without reading when %s', async (_label, overrides) => {
    const d = deps(overrides);
    const admits = await loadPhaseAdmission(d);
    expect(admits(A, 'J27')).toBe(false);
    expect(d.getSettingStrict).not.toHaveBeenCalled();
  });

  test('a failed read refuses every request', async () => {
    const admits = await loadPhaseAdmission(deps({ getSettingStrict: async () => { throw new Error('down'); } }));
    expect(admits(A, 'J27')).toBe(false);
  });
});

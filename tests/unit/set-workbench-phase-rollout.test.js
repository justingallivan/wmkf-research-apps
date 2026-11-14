/** @jest-environment node */
import { parseArgs, buildValue, runRollout } from '../../scripts/set-workbench-phase-rollout.mjs';
import { parsePhaseRollout, PHASE_ROLLOUT_KEY } from '../../lib/services/workbench/phase-admission';
import { resolveTargetResource } from '../../scripts/lib/dataverse-script-target.cjs';

const A = '11111111-1111-4111-8111-111111111111';
const PROD = 'https://wmkf.crm.dynamics.com';
const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const TODAY = new Date().toISOString().slice(0, 10);
const argv = (...args) => ['node', 'set-workbench-phase-rollout.mjs', ...args];
const prodEnv = (over = {}) => ({
  DYNAMICS_URL: PROD, DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes',
  DATAVERSE_PROD_WRITE_ACK: `phase rollout ${TODAY}`, ...over,
});

function deps(over = {}) {
  return {
    resolveTargetResource, PHASE_ROLLOUT_KEY, parsePhaseRollout,
    getSettingStrict: jest.fn()
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}', revision: 'W/"5"' })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"on"}', revision: 'W/"6"' }),
    setSettingIfUnchanged: jest.fn(async () => true),
    resolveActorProfileId: jest.fn(async () => 7),
    resolveProfileToSystemUser: jest.fn(async () => ({ systemuserid: 'su-1', fullname: 'Staff Editor' })),
    log: jest.fn(),
    ...over,
  };
}
const execute = (target = 'prod') => parseArgs(argv(`--target=${target}`, 'on', '--execute', '--expected-revision=W/"5"', '--actor-email=x@example.org'));

describe('arguments', () => {
  test('a target is required', () => {
    expect(() => parseArgs(argv('on'))).toThrow(/--target=prod or --target=sandbox/);
    expect(() => parseArgs(argv('--target=live', 'on'))).toThrow(/--target=prod or --target=sandbox/);
  });

  test('no mode only shows the current value; a mode without --execute is a dry run', () => {
    expect(parseArgs(argv('--target=prod'))).toMatchObject({ mode: null, execute: false });
    expect(parseArgs(argv('--target=prod', 'on'))).toMatchObject({ mode: 'on', execute: false });
    expect(parseArgs(argv('--target=prod', 'pilot', `${A}, ${A.toUpperCase()}`))).toMatchObject({ mode: 'pilot', requestIds: [A, A.toUpperCase()] });
  });

  test('--execute needs a mode, the expected revision and the editor', () => {
    expect(() => parseArgs(argv('--target=prod', '--execute'))).toThrow(/needs a mode/);
    expect(() => parseArgs(argv('--target=prod', 'off', '--execute', '--actor-email=x@example.org'))).toThrow(/--expected-revision/);
    expect(() => parseArgs(argv('--target=prod', 'off', '--execute', '--expected-revision=none'))).toThrow(/--actor-email/);
  });

  test('unknown modes, flags and stray arguments are refused', () => {
    expect(() => parseArgs(argv('--target=prod', 'all'))).toThrow(/Unknown mode/);
    expect(() => parseArgs(argv('--target=prod', 'on', '--force'))).toThrow(/Unknown flag/);
    expect(() => parseArgs(argv('--target=prod', 'on', A))).toThrow(/takes no further arguments/);
    expect(() => parseArgs(argv('--target=prod', 'pilot'))).toThrow(/pilot needs/);
  });

  test('the written value is exactly what the app accepts', () => {
    expect(buildValue({ mode: 'off' }, parsePhaseRollout)).toBe('{"mode":"off"}');
    expect(buildValue({ mode: 'pilot', requestIds: [A.toUpperCase()] }, parsePhaseRollout)).toBe(`{"mode":"pilot","requestIds":["${A}"]}`);
    expect(() => buildValue({ mode: 'pilot', requestIds: ['1002794'] }, parsePhaseRollout)).toThrow(/read as off/);
  });
});

describe('run', () => {
  test('Production execute: writes once with the dry run revision and the editor, then reads back', async () => {
    const d = deps();
    expect(await runRollout({ options: execute(), env: prodEnv(), deps: d })).toEqual({ written: true, value: '{"mode":"on"}' });
    expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(1);
    expect(d.setSettingIfUnchanged).toHaveBeenCalledWith(PHASE_ROLLOUT_KEY, '{"mode":"on"}', 'W/"5"', 7);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('wmkf.crm.dynamics.com'));
  });

  test.each([
    ['the interlock is unset', { DATAVERSE_TARGET_INTERLOCK: undefined }, /DATAVERSE_TARGET_INTERLOCK=on/],
    ['the interlock is off', { DATAVERSE_TARGET_INTERLOCK: 'off' }, /DATAVERSE_TARGET_INTERLOCK=on/],
    ['the interlock is warn', { DATAVERSE_TARGET_INTERLOCK: 'warn' }, /DATAVERSE_TARGET_INTERLOCK=on/],
    ['Production reads are not allowed', { DATAVERSE_ALLOW_PROD_READS: undefined }, /DATAVERSE_ALLOW_PROD_READS=yes/],
    ['the write acknowledgement is missing', { DATAVERSE_PROD_WRITE_ACK: undefined }, /DATAVERSE_PROD_WRITE_ACK/],
    ['the write acknowledgement is from another day', { DATAVERSE_PROD_WRITE_ACK: 'phase rollout 2020-01-01' }, /DATAVERSE_PROD_WRITE_ACK/],
    ['the settings store points at the sandbox', { DYNAMICS_SANDBOX_URL: SANDBOX }, /settings store would use orgd9e66399/],
    ['DYNAMICS_URL is not the Production host', { DYNAMICS_URL: SANDBOX }, /not a registered production/],
  ])('Production execute is refused before any Dataverse call when %s', async (_label, over, message) => {
    const d = deps();
    await expect(runRollout({ options: execute(), env: prodEnv(over), deps: d })).rejects.toThrow(message);
    expect(d.getSettingStrict).not.toHaveBeenCalled();
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('a Production dry run needs the interlock but no write acknowledgement, and writes nothing', async () => {
    const d = deps();
    const options = parseArgs(argv('--target=prod', 'on'));
    expect(await runRollout({ options, env: prodEnv({ DATAVERSE_PROD_WRITE_ACK: undefined }), deps: d })).toEqual({ written: false });
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
    await expect(runRollout({ options, env: prodEnv({ DATAVERSE_TARGET_INTERLOCK: undefined }), deps: deps() })).rejects.toThrow(/INTERLOCK/);
  });

  test('a sandbox run uses the sandbox host and needs no Production guards', async () => {
    const d = deps();
    await runRollout({ options: execute('sandbox'), env: { DYNAMICS_URL: PROD, DYNAMICS_SANDBOX_URL: SANDBOX }, deps: d });
    expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(1);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('orgd9e66399'));
  });

  test('a revision that changed since the dry run is refused without writing', async () => {
    const d = deps({ getSettingStrict: jest.fn(async () => ({ found: true, value: '{"mode":"off"}', revision: 'W/"9"' })) });
    await expect(runRollout({ options: execute(), env: prodEnv(), deps: d })).rejects.toThrow(/revision changed/);
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('an editor without a Dynamics user is refused without writing', async () => {
    const d = deps({ resolveProfileToSystemUser: jest.fn(async () => null) });
    await expect(runRollout({ options: execute(), env: prodEnv(), deps: d })).rejects.toThrow(/no active Dynamics user/);
    expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  test('a read-back that does not match is reported as a failure', async () => {
    const d = deps({ getSettingStrict: jest.fn()
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}', revision: 'W/"5"' })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}', revision: 'W/"6"' }) });
    await expect(runRollout({ options: execute(), env: prodEnv(), deps: d })).rejects.toThrow(/read-back does not match/);
  });

  test('no row yet: the expected revision is none and the create passes a null revision', async () => {
    const d = deps({ getSettingStrict: jest.fn()
      .mockResolvedValueOnce({ found: false, value: null, revision: null })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"on"}', revision: 'W/"1"' }) });
    const options = parseArgs(argv('--target=prod', 'on', '--execute', '--expected-revision=none', '--actor-email=x@example.org'));
    await runRollout({ options, env: prodEnv(), deps: d });
    expect(d.setSettingIfUnchanged).toHaveBeenCalledWith(PHASE_ROLLOUT_KEY, '{"mode":"on"}', null, 7);
  });
});

/**
 * Test Request Factory cast modes (cast-and-status plan, slices A + B): the
 * CLI's --create-cast / --bind-reviewer parsing, and --create-cast's
 * plan-only path, which reads the allowlist from the target org and writes
 * nothing without --confirm.
 *
 * Importing the script is safe: `main()` is guarded behind an
 * `import.meta.url === argv[1]` entrypoint check.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { parseArgs, runCastMode } from '../../scripts/rehearse-test-request-sandbox.mjs';

const RUN = '11111111-1111-4111-8111-111111111111';
const argv = (...args) => ['node', 'rehearse-test-request-sandbox.mjs', ...args];
const castArgs = ['--create-cast', '--cast-pi=pi@example.test', '--cast-liaison=liaison@example.test', '--cast-reviewer=reviewer@example.test'];

describe('cast mode parsing', () => {
  test('accepts --create-cast with three addresses on production, and --bind-reviewer with a run ID', () => {
    expect(parseArgs(argv('--target=production', ...castArgs, '--confirm'))).toMatchObject({
      createCast: true, castPi: 'pi@example.test', castLiaison: 'liaison@example.test', castReviewer: 'reviewer@example.test', confirm: true,
    });
    expect(parseArgs(argv('--target=production', `--bind-reviewer=${RUN}`)).bindReviewer).toBe(RUN);
  });

  test.each([
    ['a sandbox target', [...castArgs]],
    ['a missing address', ['--target=production', '--create-cast', '--cast-pi=pi@example.test', '--cast-liaison=liaison@example.test']],
    ['--confirm without --create-cast', ['--target=production', `--bind-reviewer=${RUN}`, '--confirm']],
    ['a cast address without --create-cast', ['--target=production', '--cast-pi=pi@example.test']],
    ['a non-GUID run', ['--target=production', '--bind-reviewer=1003302']],
    ['two modes', ['--target=production', ...castArgs, `--bind-reviewer=${RUN}`]],
  ])('refuses %s', (_label, args) => {
    expect(() => parseArgs(argv(...args))).toThrow();
  });
});

describe('--create-cast plan-only', () => {
  const clientWith = (value) => ({
    baseUrl: 'https://wmkf.crm.dynamics.com/api/data/v9.2',
    get: jest.fn(async () => ({ ok: true, status: 200, body: { value: value === null ? [] : [{ wmkf_settingvalue: value }] } })),
    post: jest.fn(),
  });
  const args = { createCast: true, castPi: 'pi@example.test', castLiaison: 'liaison@example.test', castReviewer: 'reviewer@example.test', confirm: false };
  const ledgerUrl = 'postgres://nobody@127.0.0.1:1/unused';

  afterEach(() => jest.restoreAllMocks());

  test('reads the allowlist from the target org, prints the plan, and writes nothing', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const client = clientWith(JSON.stringify({ addresses: ['pi@example.test', 'liaison@example.test', 'reviewer@example.test'] }));
    await runCastMode(client, args, ledgerUrl);
    expect(client.get.mock.calls[0][0]).toMatch(/^\/wmkf_appsystemsettings\?/);
    expect(client.post).not.toHaveBeenCalled();
    const out = JSON.parse(log.mock.calls[0][0]);
    expect(out.mode).toBe('CAST_PLAN_ONLY');
    expect(out.members.map((m) => m.role)).toEqual(['pi', 'liaison', 'suggested_reviewer']);
    expect(JSON.stringify(out)).not.toMatch(/example\.test/);
  });

  test('refuses an address that is not on the target allowlist', async () => {
    const client = clientWith(JSON.stringify({ addresses: ['pi@example.test', 'liaison@example.test'] }));
    await expect(runCastMode(client, args, ledgerUrl)).rejects.toMatchObject({ code: 'cast_address_not_allowlisted' });
    expect(client.post).not.toHaveBeenCalled();
  });
});

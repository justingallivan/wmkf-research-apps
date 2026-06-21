const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

describe('reviewer invite smoke script guards', () => {
  test('browser rehearsal refuses EMERGENCY_AUTH_BYPASS=true before starting a server', () => {
    const result = spawnSync(process.execPath, ['scripts/rehearse-pd-invite-browser.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, EMERGENCY_AUTH_BYPASS: 'true' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to run with EMERGENCY_AUTH_BYPASS=true');
  });

  test('live email smoke requires explicit live gates', () => {
    const result = spawnSync(process.execPath, [
      'scripts/live-reviewer-invite-smoke.mjs',
      'prepare',
      '--email',
      'berets.eyeful-0f@icloud.com',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        LIVE_REVIEWER_EMAIL_SMOKE: '',
        TEST_REVIEWER_EMAIL_ALLOWLIST: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LIVE_REVIEWER_EMAIL_SMOKE=true');
  });
});

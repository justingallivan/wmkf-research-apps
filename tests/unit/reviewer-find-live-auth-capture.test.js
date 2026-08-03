/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const authCapture = fs.readFileSync(
  path.join(process.cwd(), 'scripts/save-playwright-auth-state.mjs'),
  'utf8',
);
const coldPreflight = fs.readFileSync(
  path.join(process.cwd(), 'scripts/live-reviewer-find-cold-prepare.mjs'),
  'utf8',
);

describe('Reviewer Find live auth capture and preflight safety', () => {
  test('Reviewer Find auth capture verifies normal session and reviewer access before storage state', () => {
    expect(authCapture).toContain("const requireReviewersAccess = hasFlag('require-reviewers-access');");
    expect(authCapture).toContain("await page.goto(`${baseUrl}/workbench`");
    expect(authCapture).toContain("await readJson('/api/auth/session')");
    expect(authCapture).toContain("await readJson('/api/app-access')");
    expect(authCapture).toContain("access.body.apps.includes('reviewers')");
    expect(authCapture.indexOf('const ready = await waitForVerifiedReadiness(page);'))
      .toBeLessThan(authCapture.indexOf('await context.storageState({ path: statePath });'));
  });

  test('auth capture confines state to a private direct .auth JSON file before disk or browser use', () => {
    expect(authCapture).toContain("const AUTH_STATE_DIRECTORY = path.resolve('.auth');");
    expect(authCapture).toContain('const AUTH_STATE_DIRECTORY_MODE = 0o700;');
    expect(authCapture).toContain('const AUTH_STATE_FILE_MODE = 0o600;');
    expect(authCapture).toContain('const relative = path.relative(AUTH_STATE_DIRECTORY, requested);');
    expect(authCapture).toContain("path.dirname(relative) !== '.'");
    expect(authCapture).toContain('relative.startsWith(`..${path.sep}`)');
    expect(authCapture).toContain('path.isAbsolute(relative)');
    expect(authCapture).toContain("path.extname(relative).toLowerCase() !== '.json'");
    expect(authCapture).toContain('fs.mkdirSync(AUTH_STATE_DIRECTORY, {');
    expect(authCapture).toContain('mode: AUTH_STATE_DIRECTORY_MODE,');
    expect(authCapture).toContain('fs.chmodSync(AUTH_STATE_DIRECTORY, AUTH_STATE_DIRECTORY_MODE);');
    expect(authCapture).toContain('fs.chmodSync(statePath, AUTH_STATE_FILE_MODE);');
    expect(authCapture.indexOf('const statePath = resolveAuthStatePath('))
      .toBeLessThan(authCapture.indexOf('ensureAuthStateTarget(statePath);'));
    expect(authCapture.indexOf('ensureAuthStateTarget(statePath);'))
      .toBeLessThan(authCapture.indexOf('const browser = await chromium.launch('));
    expect(authCapture.indexOf('await context.storageState({ path: statePath });'))
      .toBeLessThan(authCapture.indexOf('fs.chmodSync(statePath, AUTH_STATE_FILE_MODE);'));
  });

  test('cold preflight bounds blocked artifact entries and maps initial auth navigation failures', () => {
    expect(coldPreflight).toContain('const MAX_BLOCKED_BROWSER_REQUEST_ENTRIES = 25;');
    expect(coldPreflight).toContain('blockedBrowserRequestTotal: 0');
    expect(coldPreflight).toContain('blockedBrowserRequestTotal: state.blockedBrowserRequestTotal');
    expect(coldPreflight).toContain('recordBlockedBrowserRequest(state, {');
    expect(coldPreflight).toContain("throw new Error('authenticated_reviewer_access_unavailable');");
    expect(coldPreflight).toContain('readProductionAuthoritySnapshot({');
    expect(coldPreflight).toContain("throw new Error('cold_authority_prod_reads_not_explicit');");
    expect(coldPreflight).toContain("throw new Error('cold_authority_baseline_invalid');");
    expect(coldPreflight).toContain("const COLD_OBSERVATION_ID = 'rfw_coldprepare1002914';");
    expect(coldPreflight).toContain('observationId: COLD_OBSERVATION_ID');
    expect(coldPreflight).toContain("extraHTTPHeaders: { 'x-reviewer-find-observation-id': state.observationId }");
  });
});

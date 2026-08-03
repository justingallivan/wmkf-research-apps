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

  test('cold preflight bounds blocked artifact entries and maps initial auth navigation failures', () => {
    expect(coldPreflight).toContain('const MAX_BLOCKED_BROWSER_REQUEST_ENTRIES = 25;');
    expect(coldPreflight).toContain('blockedBrowserRequestTotal: 0');
    expect(coldPreflight).toContain('blockedBrowserRequestTotal: state.blockedBrowserRequestTotal');
    expect(coldPreflight).toContain('recordBlockedBrowserRequest(state, {');
    expect(coldPreflight).toContain("throw new Error('authenticated_reviewer_access_unavailable');");
    expect(coldPreflight).toContain('readProductionAuthoritySnapshot({');
    expect(coldPreflight).toContain("throw new Error('cold_authority_prod_reads_not_explicit');");
    expect(coldPreflight).toContain("throw new Error('cold_authority_baseline_invalid');");
  });
});

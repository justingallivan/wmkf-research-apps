// Browser E2E — reviewer authors a review in-browser on the stage2b surface.
//
// Replaces the old reviewer-return-upload spec: Phase 2 removed the file-upload
// card and replaced it with the in-browser ReviewAuthoringForm (tiptap rich-text
// answers + rating radios) that autosaves to the Postgres draft route. The
// /context and /draft routes are browser-mocked so the real page + components
// render with NO Dataverse/Postgres touch.

const { test, expect } = require('@playwright/test');
const { TOKEN, buildContext, mockPortal, portalUrl } = require('./helpers/reviewer-portal');

test.describe('Reviewer stage2b in-browser authoring', () => {
  test('renders the rich-text form, autosaves on edit, rehydrates on reload, submit disabled', async ({ page }) => {
    const draftCalls = { puts: [] };
    let savedDraft = null; // what the last PUT stored; GET returns it (rehydrate)

    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });

    // GET/PUT /draft — the Phase 1 autosave route.
    await page.route(`**/api/external/review/${TOKEN}/draft`, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, draftJson: savedDraft, submitted: false }),
        });
      }
      // PUT: record + store so a later GET rehydrates.
      const body = req.postDataJSON();
      draftCalls.puts.push(body);
      savedDraft = body.draftJson;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, draftId: 1, updatedAt: '2026-06-28T00:00:00Z' }),
      });
    });

    await page.goto(portalUrl(TOKEN));

    // (a) No file input anywhere on the stage2b surface.
    await expect(page.locator('input[name="files"]')).toHaveCount(0);

    // (b) The form renders: affiliation prefilled, rating radios, and 8 rich-text editors.
    await expect(page.getByLabel('Title & Organization')).toHaveValue('Example University');
    await expect(page.getByText('Q2 — What specific significant impacts do you foresee?')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Bold' }).first()).toBeVisible();

    // (d) Submit is disabled (final submit is Phase 3).
    await expect(page.getByRole('button', { name: 'Submit review' })).toBeDisabled();

    // (c) Editing a rich-text answer triggers a debounced autosave PUT.
    const q2 = page.locator('[aria-label^="Q2 —"]');
    await q2.click();
    await page.keyboard.type('This work could reshape the field.');
    await expect.poll(() => draftCalls.puts.length, { timeout: 5000 }).toBeGreaterThan(0);
    const lastPut = draftCalls.puts[draftCalls.puts.length - 1];
    expect(lastPut.draftJson.q2).toContain('This work could reshape the field.');

    // Also exercise a rating radio + bold formatting (toolbar wiring).
    await page.getByLabel('Will rewrite textbooks').check();
    await q2.click();
    await page.getByRole('button', { name: 'Bold' }).first().click();
    await page.keyboard.type('bolded');

    await page.screenshot({ path: 'test-results/stage2b-authoring.png', fullPage: true });

    // (e) Reload rehydrates the saved draft into the editor.
    await page.waitForTimeout(1500); // let the final autosave land
    await page.reload();
    await expect(page.locator('[aria-label^="Q2 —"]')).toContainText('This work could reshape the field.');
    await page.screenshot({ path: 'test-results/stage2b-authoring-rehydrated.png', fullPage: true });
  });

  test('no editable surface renders until the saved draft loads (P0 race fix)', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });

    // Delay GET /draft so we can observe the pre-load state; it returns a saved
    // answer the form must hydrate (not clobber).
    await page.route(`**/api/external/review/${TOKEN}/draft`, async (route) => {
      if (route.request().method() === 'GET') {
        await new Promise((r) => setTimeout(r, 800));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, draftJson: { q2: '<p>previously saved answer</p>' }, submitted: false }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftId: 1, updatedAt: 'TS' }) });
    });

    await page.goto(portalUrl(TOKEN));
    // While the draft loads: loading copy shown, and NO editors/inputs mounted
    // (so keystrokes can't be discarded by the late load).
    await expect(page.getByText('Loading your review…')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);

    // After load: the saved answer is hydrated into the editor.
    await expect(page.locator('[aria-label^="Q2 —"]')).toContainText('previously saved answer', { timeout: 5000 });
    await expect(page.locator('.ProseMirror')).toHaveCount(8);
  });

  test('submitted view is read-only — receipt notice, no editors, no autosave', async ({ page }) => {
    const context = {
      ...buildContext({ view: 'submitted' }),
      // computeEngagementState derives 'submitted' from receivedAt; the fixture
      // must set it so MaterialsView renders the read-only notice (not the form).
      submission: { receivedAt: '2026-06-20T15:00:00Z', filename: null },
    };
    await mockPortal(page, { context });

    let draftHit = false;
    await page.route(`**/api/external/review/${TOKEN}/draft`, async (route) => {
      draftHit = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftJson: null, submitted: true }) });
    });

    await page.goto(portalUrl(TOKEN));
    await expect(page.getByText('Review received')).toBeVisible();
    await expect(page.getByText(/Your review is final/i)).toBeVisible();
    // No authoring surface: no editors, no Submit button, no draft fetch.
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
    expect(draftHit).toBe(false);
  });
});

// Browser E2E — reviewer authors a review in-browser on the stage2b surface.
//
// Replaces the old reviewer-return-upload spec: Phase 2 removed the file-upload
// card and replaced it with the in-browser ReviewAuthoringForm (tiptap rich-text
// answers + rating radios) that autosaves to the Postgres draft route. The
// /context and /draft routes are browser-mocked so the real page + components
// render with NO Dataverse/Postgres touch.

const { test, expect } = require('@playwright/test');
const { TOKEN, buildContext, mockPortal, portalUrl, QUESTION_SET_VERSION } = require('./helpers/reviewer-portal');

function completeDraft() {
  return {
    priorWork: '<p>a</p>',
    foreseenImpacts: '<p>a</p>',
    impactAreas: [1, 3],
    riskLevel: 2,
    riskDetail: '<p>a</p>',
    methodsAppropriate: '<p>a</p>',
    teamCapacity: '<p>a</p>',
    questionsForPi: '<p>a</p>',
    traditionalFunding: '<p>a</p>',
    overallAssessment: 4,
    additionalComments: '',
  };
}

test.describe('Reviewer stage2b in-browser authoring', () => {
  test('renders the rich-text form, autosaves on edit, rehydrates on reload, submit gated until complete', async ({ page }) => {
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

    // (b) The form renders: affiliation, multiselect checkboxes, ratings, and rich-text editors.
    await expect(page.getByLabel('Title & Organization')).toHaveValue('Example University');
    await expect(page.getByText(/Q2 — What specific significant impacts do you foresee/)).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Bold' }).first()).toBeVisible();

    // (d) Submit is disabled until every required answer is filled (the draft
    // here starts empty, so the rich-text questions are blank → gated).
    await expect(page.getByRole('button', { name: 'Submit review' })).toBeDisabled();

    // (c) Editing a rich-text answer triggers a debounced autosave PUT.
    const q2 = page.locator('[aria-label^="Q2 —"]');
    await q2.click();
    await page.keyboard.type('This work could reshape the field.');
    await expect.poll(() => draftCalls.puts.length, { timeout: 5000 }).toBeGreaterThan(0);
    const lastPut = draftCalls.puts[draftCalls.puts.length - 1];
    expect(lastPut.draftJson.foreseenImpacts).toContain('This work could reshape the field.');

    // Also exercise a multiselect checkbox + bold formatting (toolbar wiring).
    await page.getByLabel('Revise textbooks').check();
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

  test('completing all required answers enables submit; submitting locks the form read-only', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });

    // The draft pre-fills every required answer so the form loads complete and
    // the Submit button is enabled without typing into 8 editors.
    const fullDraft = completeDraft();
    await page.route(`**/api/external/review/${TOKEN}/draft`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftJson: fullDraft, submitted: false }) }));

    let submitBody = null;
    await page.route(`**/api/external/review/${TOKEN}/submit`, (route) => {
      submitBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, receivedAt: '2026-06-28T12:00:00Z' }) });
    });

    await page.goto(portalUrl(TOKEN));

    const submitBtn = page.getByRole('button', { name: 'Submit review' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Submit transitions the UI to a final, read-only receipt — no editors, no
    // Submit button (the server has the snapshot; the draft is gone).
    await expect(page.getByText('Review received')).toBeVisible();
    await expect(page.getByText(/Your review is final/i)).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
    expect(submitBody.answers.foreseenImpacts).toContain('a');
    expect(submitBody.answers.impactAreas).toEqual([1, 3]);
    // B2: the client echoes the context-supplied question-set version so the
    // server can detect a mid-edit staff change (set_changed).
    expect(submitBody.setVersion).toBe(QUESTION_SET_VERSION);
  });

  test('a set_changed 409 prompts a reload (not a terminal conflict) and flushes debounce-window edits to the draft', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });
    const fullDraft = completeDraft();
    const draftPuts = [];
    await page.route(`**/api/external/review/${TOKEN}/draft`, (route) => {
      if (route.request().method() === 'PUT') {
        draftPuts.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftId: 1, updatedAt: 'TS' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftJson: fullDraft, submitted: false }) });
    });
    await page.route(`**/api/external/review/${TOKEN}/submit`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'set_changed', message: 'The review questions changed since you opened this form. Please reload to see the current questions.' }) }));

    await page.goto(portalUrl(TOKEN));

    // Type an edit, then click Submit INSIDE the 1200ms autosave debounce so the
    // scheduled autosave is cancelled by handleSubmit — the only way this edit
    // reaches the draft is the P1-B set_changed flush.
    const q2 = page.locator('[aria-label^="Q2 —"]');
    await q2.click();
    await page.keyboard.type(' debounced-edit');
    await page.getByRole('button', { name: 'Submit review' }).click();

    // Distinct, non-terminal reload prompt — NOT the "can no longer be submitted"
    // terminal conflict copy. Reload offered; editors gone while it shows.
    await expect(page.getByText('The review questions were updated')).toBeVisible();
    await expect(page.getByText(/your saved answers will be kept/i)).toBeVisible();
    await expect(page.getByText('This review can no longer be submitted here')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);

    // P1-B: the in-debounce edit was flushed to the draft before the reload
    // prompt, so "your saved answers will be kept" is actually true.
    expect(draftPuts.length).toBeGreaterThan(0);
    expect(draftPuts.some((p) => (p.draftJson?.foreseenImpacts || '').includes('debounced-edit'))).toBe(true);
  });

  test('type-aware draft reconciliation: a draft value whose shape mismatches the current field type is discarded', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });

    // Values left by prior question types are discarded; numeric arrays are
    // filtered to the current live multiselect domain and option order.
    const staleDraft = {
      foreseenImpacts: 3,
      riskLevel: '<p>x</p>',
      riskDetail: '<p>kept</p>',
      impactAreas: [4, '1', 999, 1, 4],
    };
    await page.route(`**/api/external/review/${TOKEN}/draft`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftJson: staleDraft, submitted: false }) }));

    await page.goto(portalUrl(TOKEN));

    await expect(page.locator('[aria-label^="Q5 —"]')).toContainText('kept');
    await expect(page.locator('[aria-label^="Q2 —"]')).not.toContainText('3');
    await expect(page.getByLabel('Low risk (will likely work in its entirety)')).not.toBeChecked();
    await expect(page.getByLabel('Provide enabling tools to the community')).toBeChecked();
    await expect(page.getByLabel('Revise textbooks')).toBeChecked();
    await expect(page.getByLabel('Result in publications of disciplinary interest')).not.toBeChecked();
  });

  test('a 409 from submit locks the form into a terminal conflict state (no resubmit)', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ view: 'stage2b' }) });
    const fullDraft = completeDraft();
    await page.route(`**/api/external/review/${TOKEN}/draft`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draftJson: fullDraft, submitted: false }) }));
    await page.route(`**/api/external/review/${TOKEN}/submit`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'review_received_locked', message: 'This review has already been submitted.' }) }));

    await page.goto(portalUrl(TOKEN));
    await page.getByRole('button', { name: 'Submit review' }).click();

    // Terminal: conflict notice + reload, no editors, no resubmit button.
    await expect(page.getByText('This review can no longer be submitted here')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
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
          body: JSON.stringify({ ok: true, draftJson: { foreseenImpacts: '<p>previously saved answer</p>' }, submitted: false }),
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

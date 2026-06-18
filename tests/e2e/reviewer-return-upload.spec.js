// Browser E2E — reviewer returns a completed review through the external portal.
//
// The upload route is browser-mocked so no file reaches SharePoint/Dataverse,
// but the real page, native file input, required structured fields, and success
// state all run in Chromium.

const { test, expect } = require('@playwright/test');
const { TOKEN, buildContext, mockPortal, portalUrl } = require('./helpers/reviewer-portal');

test.describe('Reviewer return upload rehearsal', () => {
  test('stage2b reviewer uploads a completed review with structured ratings', async ({ page }) => {
    const uploadCalls = [];
    const context = {
      ...buildContext({ view: 'stage2b' }),
      files: [{
        id: 'proposal-file-1',
        library: 'materials',
        name: 'Proposal Package.pdf',
        size: 245_760,
      }],
    };

    await mockPortal(page, { context });
    await page.route(`**/api/external/review/${TOKEN}/upload`, async (route) => {
      uploadCalls.push({
        contentType: route.request().headers()['content-type'] || '',
        body: route.request().postDataBuffer()?.toString('utf8') || '',
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          folder: 'Reviewer Uploads',
          files: [{ name: 'keck-review.pdf', size: 28 }],
        }),
      });
    });

    await page.goto(portalUrl(TOKEN));
    await expect(page.getByText('Proposal Package.pdf')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /proposal-file-1/);

    await page.setInputFiles('input[name="files"]', {
      name: 'keck-review.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nreview rehearsal\n%%EOF\n'),
    });
    await page.getByLabel('Title & Organization').fill('Professor, Example University');
    await page.getByLabel('Will result in publications of broad interest').check();
    await page.getByLabel('Medium risk (parts may succeed, others may fail)').check();
    await page.getByLabel('Very Good').check();
    await page.getByRole('button', { name: 'Submit review' }).click();

    await expect(page.getByText(/Submitted.*thank you/i)).toBeVisible();
    await expect.poll(() => uploadCalls.length).toBe(1);
    expect(uploadCalls[0].contentType).toContain('multipart/form-data');
    expect(uploadCalls[0].body).toContain('filename="keck-review.pdf"');
    expect(uploadCalls[0].body).toContain('name="affiliation"');
    expect(uploadCalls[0].body).toContain('Professor, Example University');
    expect(uploadCalls[0].body).toContain('name="impact"');
    expect(uploadCalls[0].body).toContain('name="risk"');
    expect(uploadCalls[0].body).toContain('name="overallRating"');
  });
});

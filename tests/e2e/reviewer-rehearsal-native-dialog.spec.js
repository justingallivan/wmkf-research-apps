// Browser-only contract for the headed rehearsal's native confirm prompts.
// The test page uses a data URL and does not call application APIs. The shared
// Playwright config still builds/starts Next: run only in the credential-free,
// network-guarded copy required by the rehearsal runbook.

const { test, expect } = require('@playwright/test');
const launcher = require('../../scripts/lib/reviewer-rehearsal-launcher.cjs');

test.describe('reviewer rehearsal native dialogs', () => {
  test('a fresh headless context without dialog registration keeps default dismissal', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('data:text/html,<title>dialog-default</title>');

      // This is the --headless/--smoke behavior: the helper must not install a listener.
      launcher.keepNativeDialogsForHuman(context, false);
      expect(await page.evaluate(() => window.confirm('default dismissal'))).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('headed registration stays pending until an explicit automated choice', async ({ context, page }) => {
    launcher.keepNativeDialogsForHuman(context, true);
    await page.goto('data:text/html,<title>dialog-human</title>');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');

    const completeDialog = async (decision, expectedResult) => {
      let settled = false;
      // CDP observes the native prompt without registering a Playwright
      // `dialog` listener, which would itself suppress Playwright's default dismissal.
      const event = new Promise((resolve) => cdp.once('Page.javascriptDialogOpening', resolve));
      const result = page.evaluate(() => window.confirm('human decision')).finally(() => {
        settled = true;
      });
      await event;

      // The helper observes the dialog but deliberately takes no action.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled).toBe(false);
      await cdp.send('Page.handleJavaScriptDialog', { accept: decision === 'accept' });
      await expect(result).resolves.toBe(expectedResult);
    };

    await completeDialog('accept', true);
    await completeDialog('dismiss', false);
    await cdp.detach();
  });
});

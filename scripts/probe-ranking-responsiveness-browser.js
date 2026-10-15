/** Loopback-only fictional UI timing probe; never calls live data services. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseline = process.argv.includes('--baseline');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${baseline ? 3136 : 3135}`);
    await page.getByRole('button', { name: 'Load 23 proposals / 4 PDs' }).click();
    await page.getByRole('button', { name: 'Start private preparation' }).click();
    await page.getByLabel('Delay saves by 2 seconds').check();
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: /Move Example Institution 1 to position/ }).click();
      await page.getByRole('spinbutton').fill(i % 2 === 0 ? '2' : '1');
      await page.getByRole('button', { name: 'Move', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Saving changes' }).waitFor();
      const sample = await page.locator('#proposal-example-1').evaluate((card, { i, baseline }) => {
        const radio = card.querySelectorAll('input[type=radio]')[i % 2];
        const started = performance.now();
        const initiallyDisabled = radio.matches(':disabled');
        return new Promise((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error('Confidence never became usable')), 10000);
          const choose = () => {
            radio.click();
            requestAnimationFrame(() => {
              clearTimeout(deadline);
              resolve({ ms: performance.now() - started, initiallyDisabled, checked: radio.checked,
                saving: document.body.innerText.includes('Saving changes…') });
            });
          };
          if (!baseline) choose();
          else {
            const timer = setInterval(() => {
              if (!radio.matches(':disabled')) { clearInterval(timer); choose(); }
            }, 10);
          }
        });
      }, { i, baseline });
      samples.push(sample);
      assert.equal(sample.checked, true);
      assert.equal(sample.initiallyDisabled, baseline);
      if (!baseline) assert.equal(sample.saving, true);
      await page.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 10000 });
    }
    assert.deepEqual(errors, []);
    const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ baseline, artificialSaveDelayMs: 2000, samples, errors,
      p50: sorted[3], p95: sorted[7] }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

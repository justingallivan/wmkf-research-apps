// Browser contract for the applicant materials scan rejection and transfer UX.
// Every API is served from fixtures before navigation; only same-origin page
// assets continue to the app. The Blob SDK endpoint is intercepted in the
// transfer-progress case, so no request reaches Vercel Blob storage.
const { test, expect } = require('@playwright/test');

const TOKEN = 'e2e-materials-scan-token';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const SLOT = 'presentation_pdf';
const PENDING_KEY = `site-visit-materials:pending:${TOKEN}:${SLOT}`;
const COORDINATOR_EMAIL = 'casey@wmkeck.org';

function buildContext({ jobs = [], received = true } = {}) {
  return {
    ok: true,
    institution: 'Caltech',
    proposalTitle: 'Neural dust',
    dueAt: '2026-12-04T23:59:00.000Z',
    closesAt: '2026-12-08T17:00:00.000Z',
    closed: false,
    maxMb: 500,
    programCoordinator: { name: 'Casey Coordinator', email: COORDINATOR_EMAIL },
    checklist: [{
      key: SLOT,
      label: 'Presentation',
      required: true,
      received: received ? { filename: 'earlier.pdf', receivedAt: '2026-09-20T12:00:00.000Z' } : null,
    }],
    other: [],
    jobs,
  };
}

function json(status, body) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function installFailClosedRoutes(context, baseURL, {
  getContext = () => buildContext(),
  finalize = async () => json(500, { ok: false, reason: 'unexpected_finalize' }),
  uploadToken = null,
  onBlobRequest = null,
} = {}) {
  const origin = new URL(baseURL).origin;
  const apiRequests = [];
  const unexpectedApiRequests = [];
  const blockedExternalRequests = [];
  const blobRequests = [];
  const finalizeRequests = [];

  // This one catch-all is installed before page.goto. Unknown APIs and every
  // third-party destination abort, even if the app gains an unexpected URL
  // override later. Only one exact Vercel Blob API route is fulfillable.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      if (onBlobRequest && url.origin === 'https://vercel.com'
        && (url.pathname === '/api/blob' || url.pathname === '/api/blob/')
        && request.method() === 'PUT') {
        blobRequests.push({ method: request.method(), url: url.toString() });
        return onBlobRequest(route, request);
      }
      blockedExternalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }

    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ method: request.method(), pathname: url.pathname });
      const contextPath = `/api/external/materials/${TOKEN}/context`;
      const uploadTokenPath = `/api/external/materials/${TOKEN}/upload-token`;
      const finalizePath = `/api/external/materials/${TOKEN}/finalize`;
      if (url.pathname === contextPath && request.method() === 'GET') {
        return route.fulfill(json(200, getContext()));
      }
      if (url.pathname === uploadTokenPath && request.method() === 'POST' && uploadToken) {
        return route.fulfill(json(200, uploadToken));
      }
      if (url.pathname === finalizePath && request.method() === 'POST') {
        const body = request.postDataJSON();
        finalizeRequests.push(body);
        return route.fulfill(await finalize(route, body));
      }
      unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }

    return route.continue();
  });

  return { apiRequests, unexpectedApiRequests, blockedExternalRequests, blobRequests, finalizeRequests };
}

async function openPage(page, baseURL) {
  await page.goto(`${baseURL}/external/materials/${TOKEN}`);
  await expect(page.getByRole('heading', { name: /Site visit materials/i })).toBeVisible();
}

test.describe('applicant materials scan rejection', () => {
  test('a refreshed failed background job explains the rejection and keeps the earlier receipt visible', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const state = { jobStatus: 'processing' };
    const fixture = await installFailClosedRoutes(context, baseURL, {
      getContext: () => buildContext({
        jobs: state.jobStatus === 'processing' ? [{
          jobId: 'job-e2e', stagingId: STAGING_ID, slot: SLOT, status: 'processing', filename: 'replacement.pdf',
        }] : [{
          jobId: 'job-e2e', stagingId: STAGING_ID, slot: SLOT, status: 'failed', errorCode: 'infected',
          scanRejection: { category: 'blocked_content', flags: ['embedded_macro'] },
        }],
      }),
    });

    await openPage(page, baseURL);
    await expect(page.getByText('Upload received. We’re checking and saving your file. You can close this page.')).toBeVisible();
    state.jobStatus = 'failed';
    await page.reload();

    await expect(page.getByText(/security scan rejected this file because it contains embedded macro/i)).toBeVisible();
    await expect(page.getByRole('link', { name: COORDINATOR_EMAIL })).toHaveAttribute('href', `mailto:${COORDINATOR_EMAIL}`);
    await expect(page.getByText(/Previously received .* earlier\.pdf/)).toBeVisible();
    expect(fixture.apiRequests.every(({ pathname }) => pathname === `/api/external/materials/${TOKEN}/context`)).toBe(true);
    expect(fixture.unexpectedApiRequests).toEqual([]);
    expect(fixture.blockedExternalRequests).toEqual([]);
  });

  test('sync 422 clears only the pending replacement and shows a safe reason plus coordinator contact', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const fixture = await installFailClosedRoutes(context, baseURL, {
      finalize: async () => json(422, {
        ok: false,
        reason: 'scan_infected',
        scanRejection: { category: 'signature_match', flags: [] },
      }),
    });
    await page.addInitScript(({ key, stagingId, slot }) => {
      window.sessionStorage.setItem(key, JSON.stringify({ stagingId, slot }));
    }, { key: PENDING_KEY, stagingId: STAGING_ID, slot: SLOT });
    await openPage(page, baseURL);
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText(/security scan identified a known threat/i)).toBeVisible();
    await expect(page.getByRole('link', { name: COORDINATOR_EMAIL })).toHaveAttribute('href', `mailto:${COORDINATOR_EMAIL}`);
    await expect(page.getByText(/Previously received .* earlier\.pdf/)).toBeVisible();
    await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
    expect(fixture.finalizeRequests).toEqual([{ stagingId: STAGING_ID, slot: SLOT }]);
    expect(fixture.apiRequests.some(({ pathname }) => pathname.endsWith('/upload-token'))).toBe(false);
    expect(fixture.blobRequests).toEqual([]);
    expect(fixture.unexpectedApiRequests).toEqual([]);
    expect(fixture.blockedExternalRequests).toEqual([]);
  });

  test('background rejection categories use bounded copy and keep coordinator contact available', async ({ page, context }, testInfo) => {
    const cases = [
      ['signature_match', [], /identified a known threat/i],
      ['blocked_content', ['embedded_macro'], /contains embedded macro/i],
      ['invalid_or_protected_file', ['password_protected_file'], /has password protection/i],
      ['unspecified', [], /scanner did not provide a specific reason/i],
    ];
    const baseURL = testInfo.project.use.baseURL;

    for (const [category, flags, copy] of cases) {
      await page.goto('about:blank');
      const fixture = await installFailClosedRoutes(context, baseURL, {
        getContext: () => buildContext({ jobs: [{
          jobId: `job-${category}`, stagingId: STAGING_ID, slot: SLOT, status: 'failed', errorCode: 'infected',
          scanRejection: { category, flags },
        }] }),
      });
      await openPage(page, baseURL);
      await expect(page.getByText(copy)).toBeVisible();
      await expect(page.getByRole('link', { name: COORDINATOR_EMAIL })).toHaveAttribute('href', `mailto:${COORDINATOR_EMAIL}`);
      await expect(page.getByText(/Previously received .* earlier\.pdf/)).toBeVisible();
      expect(fixture.blockedExternalRequests).toEqual([]);
      expect(fixture.unexpectedApiRequests).toEqual([]);
      await context.unrouteAll({ behavior: 'wait' });
    }
  });

  test('single-part progress uses the real Blob SDK while its request stays intercepted', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    let releaseBlobResponse;
    let markBlobRequestStarted;
    const blobRequestStarted = new Promise((resolve) => { markBlobRequestStarted = resolve; });
    const blobResponseGate = new Promise((resolve) => { releaseBlobResponse = resolve; });
    const fixture = await installFailClosedRoutes(context, baseURL, {
      uploadToken: {
        ok: true,
        stagingId: STAGING_ID,
        pathname: `portal-staging/site_visit_material/${STAGING_ID}/e2e.pdf`,
        clientToken: 'vercel_blob_client_e2e_test_token',
        contentType: 'application/pdf',
      },
      finalize: async () => json(200, { ok: true, slot: SLOT, filename: 'e2e.pdf', receivedAt: '2026-10-02T12:00:00.000Z' }),
      onBlobRequest: async (route, request) => {
        markBlobRequestStarted(request.method());
        await blobResponseGate;
        return route.fulfill(json(200, {
          url: 'https://example.invalid/e2e.pdf',
          downloadUrl: 'https://example.invalid/e2e.pdf?download=1',
          pathname: `portal-staging/site_visit_material/${STAGING_ID}/e2e.pdf`,
          contentType: 'application/pdf',
          contentDisposition: 'inline; filename="e2e.pdf"',
        }));
      },
    });
    await openPage(page, baseURL);
    await page.getByLabel('Presentation file').setInputFiles({
      name: 'e2e.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(8 * 1024 * 1024, 0x41),
    });

    const blobMethod = await Promise.race([
      blobRequestStarted,
      page.waitForTimeout(8_000).then(() => 'request_not_seen'),
    ]);
    expect(blobMethod).toBe('PUT');
    const progress = page.getByRole('progressbar', { name: 'File transfer progress' });
    await expect(progress).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Uploading…');
    const valueWhileRequestIsPending = Number(await progress.getAttribute('value'));
    expect(valueWhileRequestIsPending).toBeGreaterThanOrEqual(0);
    expect(valueWhileRequestIsPending).toBeLessThan(100);

    releaseBlobResponse();
    await expect(progress).toBeHidden();
    await expect.poll(() => fixture.finalizeRequests.length).toBe(1);
    expect(fixture.blobRequests).toHaveLength(1);
    expect(fixture.unexpectedApiRequests).toEqual([]);
    expect(fixture.blockedExternalRequests).toEqual([]);
    expect(fixture.apiRequests.every(({ pathname }) => [
      `/api/external/materials/${TOKEN}/context`,
      `/api/external/materials/${TOKEN}/upload-token`,
      `/api/external/materials/${TOKEN}/finalize`,
    ].includes(pathname))).toBe(true);
  });
});

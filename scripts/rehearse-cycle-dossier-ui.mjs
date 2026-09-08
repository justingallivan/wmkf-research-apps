import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const BASE_URL = process.env.CYCLE_DOSSIER_UI_URL || 'http://localhost:3004';
const SCREENSHOT_DIR = '/tmp/cycle-dossier-ui';
const ids = Array.from({ length: 44 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

function roster() {
  return ids.map((requestId, index) => ({
    requestId,
    requestNumber: String(26001 + index),
    title: `D26 scientific briefing ${index + 1}`,
    institution: index % 2 ? 'South Research University' : 'North Research University',
    pi: `Principal Investigator ${index + 1}`,
    programDirectorId: index < 22 ? 'pd-alpha' : 'pd-beta',
    programDirector: index < 22 ? 'PD Alpha' : 'PD Beta',
    latestRevision: index < 18 ? { id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, revision: 1, createdAt: '2026-08-21T12:00:00Z', createdBy: 9 } : null,
  }));
}

function runProjection(status, selected) {
  return {
    id: status === 'partial' ? 'run-partial' : 'run-retry',
    status,
    createdAt: '2026-09-07T12:00:00Z',
    spentUsd: status === 'partial' ? 8.75 : 0,
    reservedUsd: status === 'partial' ? 1.5 : 0,
    budgetUsd: 12,
    error: status === 'partial' ? 'One entry needs a retry.' : null,
    items: selected.map((requestId, index) => ({
      requestId,
      status: status === 'partial' && index === selected.length - 1 ? 'failed' : status === 'queued' ? 'queued' : 'ready',
      stage: status === 'partial' && index === selected.length - 1 ? 'source' : 'entry-ready',
      error: status === 'partial' && index === selected.length - 1 ? 'Research source unavailable.' : null,
      revisionId: null,
    })),
  };
}

function dossierBody(state) {
  const candidates = roster();
  const selected = state.selection === null ? candidates.map((candidate) => candidate.requestId) : state.selection;
  return {
    dossier: { id: 'dossier-fixture', cycle: 'D26', selection: state.selection, latestEditionId: state.edition?.id || null },
    candidates,
    runs: state.run ? [state.run] : [],
    editions: state.edition ? [state.edition] : [],
    configuration: { ready: true, prompts: [{ name: 'cycle-dossier.research-plan', version: 2, model: 'fixture-research-model' }, { name: 'cycle-dossier.entry', version: 3, model: 'fixture-entry-model' }] },
    selected,
  };
}

function jsonResponse(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const state = { selection: null, preview: null, run: null, edition: null, previewRequests: [], launchRequests: [], unknownApis: [], errors: [] };

  page.on('console', (message) => { if (message.type() === 'error') state.errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => state.errors.push(`pageerror: ${error.message}`));
  page.on('request', (request) => { if (request.url().includes('/api/')) console.log(`fixture request ${request.method()} ${request.url()}`); });
  await context.route('**/_next/static/development/_clientMiddlewareManifest.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* fixture middleware manifest */' }));
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/auth/status' && method === 'GET') return route.fulfill(jsonResponse({ enabled: false }));
    if (url.pathname === '/api/auth/session' && method === 'GET') return route.fulfill(jsonResponse({}));
    if (url.pathname === '/api/app-access' && method === 'GET') return route.fulfill(jsonResponse({ apps: [], isSuperuser: true }));
    if (url.pathname === '/api/admin/alerts' && method === 'GET') return route.fulfill(jsonResponse({ critical: 0, error: 0 }));
    if (url.pathname === '/api/user-profiles' && method === 'GET') return route.fulfill(jsonResponse({ profiles: [] }));
    if (url.pathname === '/api/cycle-dossier/download' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n% fixture preview\n%%EOF\n') });
    }
    if (url.pathname !== '/api/cycle-dossier' || !['GET', 'POST'].includes(method)) {
      state.unknownApis.push(`${method} ${url.pathname}`);
      return route.abort();
    }
    if (method === 'GET') {
      console.log(`fixture fulfill GET ${url.pathname}`);
      return route.fulfill(jsonResponse(dossierBody(state)));
    }
    const body = request.postDataJSON() || {};
    if (body.action === 'selection') {
      state.selection = body.selectedRequestIds;
      return route.fulfill(jsonResponse({ dossier: { id: 'dossier-fixture', cycle: 'D26', selection: state.selection, latestEditionId: state.edition?.id || null } }));
    }
    if (body.action === 'preview') {
      state.previewRequests.push(body);
      state.preview = { id: 'preview-fixture', expiresAt: '2026-09-07T13:00:00Z', items: body.selectedRequestIds.map((requestId) => ({ requestId, status: body.generateRequestIds.includes(requestId) ? 'queued' : 'ready', reuseId: body.generateRequestIds.includes(requestId) ? null : `reuse-${requestId}` })), estimate: { lowUsd: 8, highUsd: 12, newCount: body.generateRequestIds.length, reuseCount: body.selectedRequestIds.length - body.generateRequestIds.length }, errors: [] };
      return route.fulfill(jsonResponse({ preview: state.preview }));
    }
    if (body.action === 'launch') {
      state.launchRequests.push(body);
      if (body.previewId !== state.preview?.id) throw new Error(`unexpected preview ${body.previewId}`);
      const selected = state.preview.items.map((item) => item.requestId);
      state.run = runProjection('partial', selected);
      state.edition = { id: 'edition-partial', createdAt: '2026-09-07T12:05:00Z', status: 'partial', missing: ['PD Alpha · Request 26022'], fallback: ['PD Beta · Request 26023'] };
      return route.fulfill(jsonResponse({ run: state.run }));
    }
    if (['pause', 'resume', 'cancel', 'retry'].includes(body.action)) {
      if (body.action === 'retry') state.run = runProjection('queued', state.run.items.map((item) => item.requestId));
      return route.fulfill(jsonResponse({ run: state.run }));
    }
    state.unknownApis.push(`POST /api/cycle-dossier action=${body.action}`);
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown fixture action' }) });
  });

  await page.goto(`${BASE_URL}/cycle-dossier`, { waitUntil: 'domcontentloaded' });
  await expectText(page, '44 of 44 included');
  await expectText(page, 'PD Alpha');
  await expectText(page, 'PD Beta');

  await page.getByLabel('Include request 26001').uncheck();
  await page.getByLabel('Include request 26002').uncheck();
  await expectText(page, '42 of 44 included');
  await page.getByRole('button', { name: 'Excluded', exact: true }).click();
  await expectText(page, 'Excluded');
  if (await page.getByText('Request 26001').count() !== 1 || await page.getByText('Request 26002').count() !== 1) throw new Error('Excluded roster filter did not preserve both manually excluded requests.');

  await page.getByRole('button', { name: 'All', exact: true }).click();
  const rewriteCard = page.locator('article').filter({ hasText: 'Request 26003' });
  await rewriteCard.getByRole('button', { name: 'Generate new', exact: true }).click();
  await page.getByRole('button', { name: 'Review cost & sources', exact: true }).click();
  await expectText(page, 'Preview ready');
  const preview = state.previewRequests.at(-1);
  const expectedGenerated = [ids[2], ...ids.slice(18)];
  if (preview.selectedRequestIds.length !== 42 || preview.generateRequestIds.length !== expectedGenerated.length || expectedGenerated.some((id) => !preview.generateRequestIds.includes(id))) throw new Error(`Preview request IDs were incorrect: ${JSON.stringify(preview)}`);
  await page.getByLabel('Optional spending cap (USD)').fill('12');
  await page.getByRole('button', { name: 'Launch dossier run', exact: true }).click();
  await expectText(page, 'Run progress');
  const launch = state.launchRequests.at(-1);
  if (launch.previewId !== 'preview-fixture' || launch.budgetUsd !== 12 || launch.idempotencyKey.length < 20) throw new Error(`Launch args were incorrect: ${JSON.stringify(launch)}`);
  await expectText(page, 'partial');
  await expectText(page, 'Edition edition-partial');
  await page.getByRole('button', { name: 'Retry failed', exact: true }).click();
  if (!state.run || state.run.id !== 'run-retry' || state.run.status !== 'queued') throw new Error('Retry did not produce a fresh queued run.');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText(page, '42 of 44 included');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile.png`, fullPage: true });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (horizontalOverflow) throw new Error(`Mobile layout overflows horizontally: ${await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))}`);
  if (state.unknownApis.length) throw new Error(`Unknown API requests were attempted: ${state.unknownApis.join(', ')}`);
  if (state.errors.length) throw new Error(`Browser console errors: ${state.errors.join(' | ')}`);
  console.log(JSON.stringify({ baseURL: BASE_URL, screenshots: [`${SCREENSHOT_DIR}/desktop.png`, `${SCREENSHOT_DIR}/mobile.png`], preview: { selected: preview.selectedRequestIds.length, generated: preview.generateRequestIds }, launch: { budgetUsd: launch.budgetUsd, previewId: launch.previewId }, partialEdition: state.edition, retry: state.run, unknownApis: state.unknownApis, consoleErrors: state.errors }, null, 2));
  await browser.close();
}

async function expectText(page, text) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
  } catch (error) {
    console.error(`Fixture page did not render expected text ${JSON.stringify(text)} at ${page.url()}`);
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 2000));
    throw error;
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

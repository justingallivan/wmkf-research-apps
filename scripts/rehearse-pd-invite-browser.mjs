#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const launcher = require('./lib/reviewer-rehearsal-launcher.cjs');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keep the legacy refusal contract. This check occurs before reading project
// modules, creating a temporary checkout, or starting any process.
if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
  console.error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. This rehearsal does not need it.');
  process.exit(1);
}

const usage = `Usage: npm run rehearse:reviewer-invite:browser -- [--port 3110] [--scenario baseline] [--browser-cache /absolute/path] [--headless --smoke]

Exports committed HEAD to a private temporary directory, installs the lockfile
offline, builds the app, and serves the route-mocked rehearsal on loopback.
The owned server and temporary checkout are removed on normal exit and handled
signals. A failed private-receipt write retains the owned temp directory.
Without --browser-cache, the existing platform-default Playwright browser cache
is used; browser downloads are disabled.\n`;

async function runInIsolatedCandidate({ candidateDir, baseUrl, tempRoot, pathValue, options, onViolation, signal, reportStage = () => {} }) {
  const candidateRequire = createRequire(path.join(candidateDir, 'package.json'));
  const fixtureModule = candidateRequire('./scripts/lib/reviewer-rehearsal-fixtures.cjs');
  if (typeof fixtureModule.installMocks !== 'function'
      || typeof fixtureModule.isMockedApiRequest !== 'function'
      || typeof fixtureModule.isMockedPassiveRequest !== 'function'
      || !fixtureModule.SCENARIOS || typeof fixtureModule.SCENARIOS !== 'object') {
    throw new Error('Committed rehearsal fixture module does not expose the required safe fixture contract');
  }
  if (!Object.values(fixtureModule.SCENARIOS).includes(options.scenario)) {
    throw new Error(`Unknown rehearsal scenario: ${options.scenario}`);
  }

  reportStage('browser-module');
  const { chromium } = candidateRequire('playwright');
  reportStage('browser-binary');
  const executablePath = launcher.resolveBrowserExecutable(chromium, options.browserCache);
  const browserEnv = {
    PATH: pathValue,
    TMPDIR: path.join(tempRoot, 'tmp'),
    REHEARSAL_PRIVATE_HOME: path.join(tempRoot, 'home'),
    XDG_CONFIG_HOME: path.join(tempRoot, 'home/config'),
    XDG_CACHE_HOME: path.join(tempRoot, 'home/cache'),
    XDG_DATA_HOME: path.join(tempRoot, 'home/data'),
    LANG: 'C',
    LC_ALL: 'C',
  };
  if (options.browserCache) browserEnv.PLAYWRIGHT_BROWSERS_PATH = launcher.validateBrowserCacheDirectory(options.browserCache);
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (process.env[key]) browserEnv[key] = process.env[key];
  }
  reportStage('browser-launch');
  const browser = await chromium.launch({
    executablePath,
    env: browserEnv,
    headless: options.headless,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      '--disable-extensions',
      ...(options.headless ? [] : ['--window-size=1240,820', '--window-position=80,80']),
    ],
  });
  let context;
  let fixtureRun;
  const result = { browserVersion: browser.version(), navigationStatus: null, mockedApiCount: 0 };
  try {
    reportStage('mock-setup');
    const buildId = fs.readFileSync(path.join(candidateDir, '.next/BUILD_ID'), 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) {
      throw new Error('Built candidate does not expose a safe Next.js build ID');
    }
    context = await browser.newContext({
      viewport: { width: 1240, height: 740 },
      serviceWorkers: 'block',
    });
    launcher.keepNativeDialogsForHuman(context, !options.headless);
    fixtureRun = await fixtureModule.installMocks(context, {
      baseUrl,
      buildId,
      scenario: options.scenario,
      onViolation: (reason) => {
        onViolation(reason);
        if (typeof process.send === 'function') process.send({ type: 'violation', reason });
      },
    });

    // Installed after the named mocks so this single dispatcher sees every
    // request first. It validates origin and the fixture API method/path before
    // falling through to any mock; unknown local APIs never reach Next routes.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const isMockedApiRequest = fixtureModule.isMockedApiRequest(request, {
        baseUrl,
        scenario: options.scenario,
      });
      const isMockedPassiveRequest = fixtureModule.isMockedPassiveRequest(request, { baseUrl, buildId });
      const decision = launcher.browserRequestDecision(
        request.url(), baseUrl, isMockedApiRequest, request.method(), isMockedPassiveRequest,
      );
      if (!decision.allow) {
        onViolation(decision.reason);
        if (typeof process.send === 'function') process.send({ type: 'violation', reason: decision.reason });
        await route.abort('blockedbyclient');
        return;
      }
      if (new URL(request.url()).pathname.startsWith('/api/')) result.mockedApiCount += 1;
      await route.fallback();
    });

    // The app has no WebSocket feature in this flow. Fail closed if one is
    // attempted rather than letting a non-HTTP channel bypass route auditing.
    if (typeof context.routeWebSocket !== 'function') {
      throw new Error('This Playwright version cannot enforce the WebSocket deny boundary; update the locked harness before rehearsal');
    }
    await context.routeWebSocket('**/*', (socket) => {
      onViolation('network:websocket_blocked');
      if (typeof process.send === 'function') process.send({ type: 'violation', reason: 'network:websocket_blocked' });
      socket.close({ code: 1008, reason: 'Reviewer rehearsal permits no WebSockets' });
    });

    const page = await context.newPage();
    const targetPath = options.scenario === 'reviewer-authoring'
      ? '/external/review/pd-reviewer-rehearsal-token'
      : '/workbench/00000000-0000-4000-8000-000000000001?tab=reviewers&sub=candidates&n=1002788';
    if (options.scenario !== 'reviewer-authoring') {
      reportStage('staff-session');
      await installSyntheticStaffSession(context, baseUrl, fixtureModule, candidateRequire);
    }
    const targetUrl = `${baseUrl}${targetPath}`;
    reportStage('navigation');
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    result.navigationStatus = response?.status() ?? null;
    const pagePath = new URL(page.url()).pathname;
    if (pagePath.startsWith('/api/auth/signin') || pagePath.startsWith('/auth/signin')) {
      const error = new Error('The synthetic staff session was not accepted');
      error.rehearsalFailureCode = 'staff_session_rejected';
      throw error;
    }
    if (!response?.ok()) throw new Error(`Local rehearsal page returned HTTP ${result.navigationStatus}`);
    if (options.scenario !== 'reviewer-authoring'
        && await page.getByRole('heading', { name: 'Sign In Required' }).count() > 0) {
      const error = new Error('The synthetic staff session was not accepted');
      error.rehearsalFailureCode = 'staff_session_rejected';
      throw error;
    }
    if (page.url().startsWith(baseUrl) !== true) throw new Error('Browser left the isolated loopback origin');
    reportStage('page-ready');
    const pageReady = options.scenario === 'reviewer-authoring'
      ? page.getByRole('heading', { name: 'W. M. Keck Foundation Reviewer Portal' })
      : page.locator('main');
    await pageReady.waitFor({ state: 'visible', timeout: 15000 });

    if (options.smoke) {
      reportStage('smoke-idle');
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); }
      catch { throw new Error('Smoke navigation did not reach an idle, mock-backed page'); }
      result.mockedApiCount = fixtureRun.state.calls.length;
      if (result.mockedApiCount < 1) throw new Error('Smoke navigation did not reach a declared mock API route');
      if (onViolation.count > 0) throw new Error('Smoke run encountered a blocked network request');
      return result;
    }

    console.log('\nProgram Director invite rehearsal is open in the isolated mock.');
    console.log('Use synthetic fixture data only. Close the browser when finished; the owned server and temporary checkout will then be removed.');
    if (options.headless) return result;
    reportStage('headed-session');
    await new Promise((resolve) => {
      browser.once('disconnected', resolve);
      page.once('close', () => browser.close().catch(() => {}));
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    return result;
  } finally {
    result.mockedApiCount = fixtureRun?.state?.calls?.length ?? result.mockedApiCount;
    if (fixtureRun?.reset) fixtureRun.reset();
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (process.argv[2] === '--__reviewer-browser-child') {
    const options = launcher.parseArgs(process.argv.slice(3));
    const controller = new AbortController();
    let childStage = 'child-environment';
    const onSignal = () => controller.abort('supervisor-signal');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      assertBrowserChildEnvironment(options);
      childStage = 'fixture-module';
      const result = await runInIsolatedCandidate({
        candidateDir: repoRoot,
        baseUrl: `http://127.0.0.1:${options.port}`,
        tempRoot: process.env.REHEARSAL_TEMP_ROOT,
        pathValue: process.env.PATH,
        options,
        onViolation: () => {},
        signal: controller.signal,
        reportStage: (stage) => { childStage = stage; },
      });
      if (typeof process.send === 'function') process.send({ type: 'result', result });
    } catch (error) {
      const failureCode = {
        'child-environment': 'child_environment_invalid',
        'fixture-module': 'fixture_module_unavailable',
        'browser-module': 'browser_module_unavailable',
        'browser-binary': 'browser_binary_unavailable',
        'browser-launch': 'browser_launch_failed',
        'mock-setup': 'mock_setup_failed',
        'staff-session': 'staff_session_setup_failed',
        navigation: 'navigation_failed',
        'page-ready': 'page_ready_failed',
        'smoke-idle': 'smoke_not_idle',
        'headed-session': 'browser_session_failed',
      }[childStage] || 'browser_rehearsal_failed';
      const safeFailureCode = error?.rehearsalFailureCode === 'staff_session_rejected'
        ? error.rehearsalFailureCode
        : failureCode;
      if (typeof process.send === 'function') process.send({ type: 'failure', stage: childStage, code: safeFailureCode });
      console.error(`Isolated browser rehearsal stopped (${childStage}/${safeFailureCode}).`);
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      if (typeof process.send === 'function') process.disconnect();
    }
    return;
  }

  let options;
  try {
    options = launcher.parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage);
    return;
  }
  try {
    await launcher.launchRehearsal({
      repoRoot,
      options,
      runBrowser: runBrowserChild,
    });
  } catch (error) {
    console.error(`Reviewer rehearsal stopped safely (${error.stage || 'startup'}).`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function installSyntheticStaffSession(context, baseUrl, fixtureModule, candidateRequire) {
  if (fixtureModule.PD_ID !== '77777777-7777-4777-8777-777777777777'
      || fixtureModule.PD_EMAIL !== 'program.director@example.test'
      || process.env.NEXTAUTH_SECRET !== 'reviewer-rehearsal-nextauth-secret-not-a-credential') {
    throw new Error('Synthetic staff identity contract is unavailable');
  }
  const { encode } = candidateRequire('next-auth/jwt');
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: {
      sub: 'pd-e2e-user',
      name: 'Program Director',
      email: fixtureModule.PD_EMAIL,
      azureId: 'pd-e2e-azure-id',
      userType: 'staff',
      profileId: 1,
      dynamicsSystemuserId: fixtureModule.PD_ID,
      lastActivity: Date.now(),
      iat: Math.floor(Date.now() / 1000),
      exp: expires,
    },
  });
  await context.addCookies([{
    name: 'next-auth.session-token',
    value: token,
    domain: new URL(baseUrl).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    expires,
  }]);
}

function assertBrowserChildEnvironment(options) {
  const expectedGuard = path.join(repoRoot, 'scripts/lib/reviewer-rehearsal-network-guard.cjs');
  const tempRoot = process.env.REHEARSAL_TEMP_ROOT;
  const privateHome = path.join(tempRoot || '', 'home');
  const markerPath = path.join(tempRoot || '', '.rehearsal-owner');
  if (typeof process.send !== 'function'
      || !tempRoot
      || !path.isAbsolute(tempRoot)
      || process.env.REHEARSAL_PRIVATE_HOME !== privateHome
      || process.env.NODE_OPTIONS !== `--require=${expectedGuard}`
      || process.env.HOME
      || !fs.existsSync(markerPath)) {
    throw new Error('Browser child can only run under the isolated rehearsal supervisor');
  }
  const forbiddenEnvironment = Object.keys(process.env).filter((name) => {
    if (name === 'NEXTAUTH_SECRET' || name === 'EXTERNAL_LINK_SECRET') return false;
    if (['DATAVERSE_TARGET_INTERLOCK', 'DATAVERSE_DAL_ENFORCEMENT'].includes(name) && process.env[name] === 'on') return false;
    return /TOKEN|SECRET|DATAVERSE|BLOB|SHAREPOINT|VERCEL|AUTH0|AZURE|API_KEY|DATABASE|POSTGRES|OAUTH/i.test(name);
  });
  if (forbiddenEnvironment.length > 0) {
    throw new Error('Browser child environment contains a credential-shaped variable');
  }
  if (process.env.NEXTAUTH_SECRET !== 'reviewer-rehearsal-nextauth-secret-not-a-credential'
      || process.env.EXTERNAL_LINK_SECRET !== 'reviewer-rehearsal-external-link-secret-not-a-credential') {
    throw new Error('Browser child environment does not contain the isolated synthetic secrets');
  }
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on' || process.env.DATAVERSE_DAL_ENFORCEMENT !== 'on') {
    throw new Error('Browser child environment does not preserve the fail-closed Dataverse guards');
  }
  const expectedBrowserCache = options.browserCache ? launcher.validateBrowserCacheDirectory(options.browserCache) : null;
  if (!expectedBrowserCache || process.env.PLAYWRIGHT_BROWSERS_PATH !== expectedBrowserCache) {
    throw new Error('Browser child path does not match the explicit sanitized browser cache option');
  }
}

function runBrowserChild({ candidateDir, baseUrl, options, childEnv, onViolation, onChild, signal }) {
  const args = [path.join(candidateDir, 'scripts/rehearse-pd-invite-browser.mjs'), '--__reviewer-browser-child'];
  args.push('--port', String(options.port), '--scenario', options.scenario);
  if (options.browserCache) args.push('--browser-cache', options.browserCache);
  if (options.smoke) args.push('--smoke');
  const browserChildEnv = { ...childEnv };
  if (options.browserCache) {
    browserChildEnv.PLAYWRIGHT_BROWSERS_PATH = launcher.validateBrowserCacheDirectory(options.browserCache);
  }
  let child;
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, {
      cwd: candidateDir,
      env: browserChildEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
      shell: false,
    });
    let result = null;
    let failureDetails = null;
    child.stdout.on('data', (chunk) => process.stdout.write(`[reviewer-browser] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[reviewer-browser] ${chunk}`));
    child.once('error', () => reject(new Error('Could not start the isolated browser rehearsal process')));
    child.on('message', (message) => {
      if (message?.type === 'violation') {
        onViolation(message.reason);
        return;
      }
      if (message?.type === 'result') result = message.result;
      if (message?.type === 'failure') failureDetails = message;
    });
    child.once('exit', (code, signal) => {
      if (code === 0 && result) resolve(result);
      else {
        const failure = new Error(failureDetails
          ? `Isolated browser rehearsal failed at ${failureDetails.stage} (${failureDetails.code})`
          : `Isolated browser rehearsal process exited ${signal || `with code ${code}`}`);
        if (failureDetails) {
          failure.rehearsalStage = failureDetails.stage;
          failure.rehearsalCode = failureDetails.code;
        }
        reject(failure);
      }
    });
    onChild?.(child);
    if (signal.aborted) launcher.killProcessGroup(child, 'SIGTERM');
    else signal.addEventListener('abort', () => launcher.killProcessGroup(child, 'SIGTERM'), { once: true });
  });
}

await main();

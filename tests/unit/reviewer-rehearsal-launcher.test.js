'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const launcher = require('../../scripts/lib/reviewer-rehearsal-launcher.cjs');

const guardPath = path.resolve(__dirname, '../../scripts/lib/reviewer-rehearsal-network-guard.cjs');

function runNode(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=commonjs', '-e', source], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (part) => { stdout += part; });
    child.stderr.on('data', (part) => { stderr += part; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('reviewer rehearsal launcher boundaries', () => {
  test('accepts only bounded options and requires smoke for headless mode', () => {
    expect(launcher.parseArgs(['--port', '3210', '--scenario', 'pd-drift'])).toMatchObject({
      port: 3210,
      scenario: 'pd-drift',
      smoke: false,
    });
    expect(launcher.parseArgs(['--smoke'])).toMatchObject({ headless: true, smoke: true });
    expect(() => launcher.parseArgs(['--keep-server'])).toThrow('Unsupported rehearsal option');
    expect(() => launcher.parseArgs(['--headless'])).toThrow('requires --smoke');
    expect(() => launcher.parseArgs(['--browser-cache', 'relative/path'])).toThrow('absolute directory');
  });

  test('builds a clean child environment without inheriting credentials or PATH', () => {
    const tempRoot = path.join(os.tmpdir(), 'rehearsal-test-root');
    const env = launcher.sanitizeEnvironment({
      PATH: '/poisoned/project/bin',
      HOME: '/real/home',
      DATAVERSE_URL: 'https://secret.invalid',
      DATAVERSE_API_TOKEN: 'must-not-copy',
      BLOB_READ_WRITE_TOKEN: 'must-not-copy',
      AUTH0_CLIENT_SECRET: 'must-not-copy',
      VERCEL_OIDC_TOKEN: 'must-not-copy',
    }, {
      tempRoot,
      port: 3110,
      cachePath: path.join(tempRoot, 'cache'),
      userConfig: path.join(tempRoot, 'user.npmrc'),
      globalConfig: path.join(tempRoot, 'global.npmrc'),
      guardPath,
      pathValue: '/trusted/node:/usr/bin',
    });

    expect(env.PATH).toBe('/trusted/node:/usr/bin');
    expect(env).not.toHaveProperty('HOME');
    expect(env.REHEARSAL_PRIVATE_HOME).toBe(path.join(tempRoot, 'home'));
    expect(env.NODE_OPTIONS).toBe(`--require=${guardPath}`);
    expect(env.DATAVERSE_TARGET_INTERLOCK).toBe('on');
    expect(env.DATAVERSE_DAL_ENFORCEMENT).toBe('on');
    const serverEnv = launcher.sanitizeEnvironment({}, {
      tempRoot,
      port: 3110,
      cachePath: path.join(tempRoot, 'cache'),
      userConfig: path.join(tempRoot, 'user.npmrc'),
      globalConfig: path.join(tempRoot, 'global.npmrc'),
      guardPath,
      mode: 'server',
    });
    expect(serverEnv.NODE_ENV).toBe('production');
    expect(serverEnv.AUTH_REQUIRED).toBe('true');
    for (const name of ['DATAVERSE_URL', 'DATAVERSE_API_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'AUTH0_CLIENT_SECRET', 'VERCEL_OIDC_TOKEN']) {
      expect(env).not.toHaveProperty(name);
    }
  });

  test('allows exact Workbench document routes, static GETs, and declared API mocks', () => {
    const origin = 'http://127.0.0.1:3110';
    const decision = (url, mocked = false, method = 'GET', passive = false) => launcher.browserRequestDecision(url, origin, mocked, method, passive);
    expect(decision(`${origin}/workbench`)).toMatchObject({ allow: true, reason: 'declared_document' });
    expect(decision(`${origin}/workbench/00000000-0000-4000-8000-000000000001`).allow).toBe(true);
    expect(decision(`${origin}/_next/static/chunks/app.js`).allow).toBe(true);
    expect(decision(`${origin}/api/reviewer-finder/my-candidates`, true, 'POST')).toMatchObject({ allow: true, reason: 'declared_mock_api' });
    for (const url of [
      `${origin}/api`,
      `${origin}/api/unlisted`,
      `${origin}/%61pi/unlisted`,
      `${origin}/%2fapi/unlisted`,
      `${origin}/workbench/another-request`,
      `${origin}/workbench/`,
      'https://example.invalid/api/reviewer-finder/my-candidates',
      'http://localhost:3110/workbench/00000000-0000-4000-8000-000000000001',
    ]) {
      expect(decision(url).allow).toBe(false);
    }
    expect(decision(`${origin}/workbench/00000000-0000-4000-8000-000000000001`, false, 'POST').allow).toBe(false);
    expect(decision(`${origin}/workbench`, false, 'POST')).toMatchObject({ allow: false, reason: 'unmocked_local_method' });
  });

  test('allows only finite passive asset and prefetch paths when declared by a mock', () => {
    const origin = 'http://127.0.0.1:3110';
    const decision = (path, method = 'GET', declared = true) => launcher.browserRequestDecision(
      `${origin}${path}`, origin, false, method, declared,
    );
    for (const path of [
      '/_vercel/insights/script.js',
      '/_next/data/0123456789abcdef/index.json',
      '/_next/data/0123456789abcdef/workbench.json',
      '/_next/data/0123456789abcdef/workbench/00000000-0000-4000-8000-000000000001.json',
      '/_next/data/0123456789abcdef/guide.json',
      '/_next/data/0123456789abcdef/profile-settings.json',
    ]) {
      expect(decision(path)).toMatchObject({ allow: true, reason: 'declared_passive_mock' });
      expect(decision(path, 'HEAD')).toMatchObject({ allow: true, reason: 'declared_passive_mock' });
      expect(decision(path, 'POST')).toMatchObject({ allow: false, reason: 'unmocked_local_method' });
    }
    for (const path of [
      '/_vercel/insights/collect',
      '/_next/data/0123456789abcdef/not-in-allowlist.json',
      '/_next/data/0123456789abcdef/workbench.json/extra',
      '/_next/data/0123456789abcdef/workbench/00000000-0000-4000-8000-000000000002.json',
    ]) {
      expect(decision(path)).toMatchObject({ allow: false, reason: 'unmocked_local_route' });
    }
    expect(decision('/_vercel/insights/script.js', 'GET', false).allow).toBe(false);
    expect(decision('/_next/data/other-segment/workbench.json', 'GET', false).allow).toBe(false);
  });

  test('normalizes fixture violations without retaining endpoint or token text', () => {
    expect(launcher.normalizeViolationReason('origin mismatch at https://secret.invalid/api/x?token=private'))
      .toBe('api_origin_violation');
    expect(launcher.normalizeViolationReason('network:non-loopback https://secret.invalid/private'))
      .toBe('network_blocked');
    expect(launcher.normalizeViolationReason('POST /api/external/review/private-token')).toBe('unmocked_api');
    const normalized = launcher.normalizeViolationReason('network:non-loopback https://secret.invalid/private?token=private');
    expect(normalized).not.toContain('secret.invalid');
    expect(normalized).not.toContain('/private');
    expect(normalized).not.toContain('token');
  });

  test('requires an existing non-symlink browser cache and resolves only within it', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-browser-cache-test-'));
    const cache = path.join(tempRoot, 'cache');
    fs.mkdirSync(cache);
    const executable = path.join(cache, 'chrome');
    fs.writeFileSync(executable, 'browser');
    const chromium = { executablePath: () => executable };
    const elsewhere = path.join(tempRoot, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const externalExecutable = path.join(elsewhere, 'chrome');
    fs.writeFileSync(externalExecutable, 'browser');
    const link = path.join(tempRoot, 'cache-link');
    fs.symlinkSync(cache, link, 'dir');
    expect(() => launcher.resolveBrowserExecutable(chromium, link)).toThrow('non-symlink directory');
    const prior = process.env.PLAYWRIGHT_BROWSERS_PATH;
    try {
      process.env.PLAYWRIGHT_BROWSERS_PATH = fs.realpathSync(cache);
      expect(launcher.resolveBrowserExecutable(chromium, cache)).toBe(executable);
      expect(() => launcher.resolveBrowserExecutable(chromium, path.join(tempRoot, 'missing'))).toThrow();
      expect(() => launcher.resolveBrowserExecutable({ executablePath: () => externalExecutable }, cache)).toThrow('outside the selected directory');
    } finally {
      if (prior === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = prior;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('resolves only an existing safe platform-default browser cache', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-default-browser-cache-'));
    const macHome = path.join(tempRoot, 'mac-home');
    const macCache = path.join(macHome, 'Library', 'Caches', 'ms-playwright');
    fs.mkdirSync(macCache, { recursive: true });
    expect(launcher.defaultBrowserCacheDirectory({ platform: 'darwin', home: macHome })).toBe(macCache);
    expect(launcher.resolveBrowserCacheDirectory(null, { platform: 'darwin', home: macHome })).toBe(fs.realpathSync(macCache));

    const linuxHome = path.join(tempRoot, 'linux-home');
    expect(launcher.defaultBrowserCacheDirectory({ platform: 'linux', home: linuxHome }))
      .toBe(path.join(linuxHome, '.cache', 'ms-playwright'));
    const windowsCache = launcher.defaultBrowserCacheDirectory({
      platform: 'win32',
      home: 'C:\\Users\\Example',
      localAppData: 'D:\\Profile\\Local App Data',
    });
    expect(windowsCache).toBe('D:\\Profile\\Local App Data\\ms-playwright');

    const missingHome = path.join(tempRoot, 'missing-home');
    expect(() => launcher.resolveBrowserCacheDirectory(null, { platform: 'darwin', home: missingHome }))
      .toThrow('pass --browser-cache with an existing matching browser directory');
    const symlinkHome = path.join(tempRoot, 'symlink-home');
    const symlinkTarget = path.join(tempRoot, 'real-cache');
    const symlinkCache = path.join(symlinkHome, 'Library', 'Caches', 'ms-playwright');
    fs.mkdirSync(symlinkTarget);
    fs.mkdirSync(path.dirname(symlinkCache), { recursive: true });
    fs.symlinkSync(symlinkTarget, symlinkCache, 'dir');
    expect(() => launcher.resolveBrowserCacheDirectory(null, { platform: 'darwin', home: symlinkHome }))
      .toThrow('No safe Playwright browser cache exists');
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('selects the real Playwright module cache before importing its registry', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-cache-registry-test-'));
    const cache = path.join(tempRoot, 'playwright-real-module-cache');
    fs.mkdirSync(cache);
    const result = await runNode(`
      const fs = require('node:fs');
      const path = require('node:path');
      const { chromium } = require('playwright');
      const executable = chromium.executablePath();
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, 'fixture-only browser path');
      const launcher = require('./scripts/lib/reviewer-rehearsal-launcher.cjs');
      process.stdout.write(launcher.resolveBrowserExecutable(chromium, process.env.PLAYWRIGHT_BROWSERS_PATH));
    `, { PATH: process.env.PATH, PLAYWRIGHT_BROWSERS_PATH: cache });
    expect(result.code).toBe(0);
    expect(path.relative(cache, result.stdout)).not.toMatch(/^\.\./);
    expect(result.stderr).toBe('');
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('removes only its owned workspace and refuses a changed ownership marker', () => {
    const workspace = launcher.createOwnedWorkspace();
    expect(fs.statSync(workspace.root).mode & 0o777).toBe(0o700);
    launcher.cleanupOwnedWorkspace(workspace.root, workspace.marker);
    expect(fs.existsSync(workspace.root)).toBe(false);

    const forged = launcher.createOwnedWorkspace();
    fs.writeFileSync(path.join(forged.root, '.rehearsal-owner'), 'changed');
    expect(() => launcher.cleanupOwnedWorkspace(forged.root, forged.marker)).toThrow('ownership marker');
    expect(fs.existsSync(forged.root)).toBe(true);
    fs.rmSync(forged.root, { recursive: true, force: true });
  });

  test('a route violation aborts the headed run and signals every owned child', () => {
    const child = { exitCode: null, pid: null, kill: jest.fn() };
    const boundary = launcher.createAbortBoundary(new Set([child]));
    boundary.onViolation('POST /api/private-token');
    expect(boundary.controller.signal.aborted).toBe(true);
    expect(boundary.controller.signal.reason).toBe('network-boundary-violation');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    const signalBoundary = launcher.createAbortBoundary(new Set());
    signalBoundary.onSignal('SIGINT');
    expect(signalBoundary.controller.signal.aborted).toBe(true);
    expect(signalBoundary.controller.signal.reason).toBe('SIGINT');
  });

  test('refuses an already occupied loopback port before starting a server', async () => {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await expect(launcher.assertLoopbackPortAvailable(port)).rejects.toThrow();
    await new Promise((resolve) => server.close(resolve));
  });

  test('does not probe an unrelated listener until the owned server signals readiness', async () => {
    let hits = 0;
    const server = http.createServer((_request, response) => { hits += 1; response.end('unrelated'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const child = new EventEmitter();
    child.exitCode = null;
    await expect(launcher.waitForServer(`http://127.0.0.1:${server.address().port}`, child, new Promise(() => {}), 20))
      .rejects.toThrow('readiness signal');
    expect(hits).toBe(0);
    await new Promise((resolve) => server.close(resolve));
  });
});

describe('reviewer rehearsal Node network guard', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-network-guard-test-'));
  const env = {
    PATH: process.env.PATH,
    TMPDIR: tempRoot,
    REHEARSAL_PRIVATE_HOME: path.join(tempRoot, 'home'),
    NODE_OPTIONS: `--require=${guardPath}`,
  };

  afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  test('blocks an external HTTPS attempt before making a connection', async () => {
    const result = await runNode(`
      try { require('node:https').request('https://credentials.example.invalid/private'); process.exit(4); }
      catch (error) { process.stdout.write(error.message); }
    `, env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('blocked HTTPS');
    expect(result.stdout).not.toContain('example.invalid');
  });

  test('allows loopback HTTP while rejecting public binds', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: 'https://external.invalid/redirected' });
        response.end();
        return;
      }
      response.end('ok');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const result = await runNode(`
      (async () => {
        const response = await fetch('http://127.0.0.1:${address.port}/');
        process.stdout.write(await response.text());
        let redirectDenied = false;
        try { await fetch('http://127.0.0.1:${address.port}/redirect'); }
        catch (error) { redirectDenied = error.message.includes('blocked an HTTP redirect'); }
        process.stdout.write(redirectDenied ? '|redirect-blocked' : '|redirect-allowed');
        try { require('node:http').createServer().listen(0, '0.0.0.0'); process.exitCode = 4; }
        catch (error) { process.stdout.write('|' + error.message); }
      })().catch((error) => { process.stderr.write(error.message); process.exitCode = 5; });
    `, env);
    await new Promise((resolve) => server.close(resolve));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok|redirect-blocked|Reviewer rehearsal blocked');
  });

  test('rejects hostless TCP binds and external DNS resolver surfaces before I/O', async () => {
    const result = await runNode(`
      (async () => {
        const blocked = [];
        for (const listen of [() => require('node:net').createServer().listen(0),
          () => require('node:net').createServer().listen({ port: 0 })]) {
          try { listen(); blocked.push('allowed'); }
          catch (error) { blocked.push(error.message.includes('blocked') ? 'blocked' : 'unexpected-error'); }
        }
        for (const resolve of [
          () => require('node:dns/promises').resolve4('external.invalid'),
          () => new (require('node:dns').Resolver)().resolve4('external.invalid'),
        ]) {
          try { await resolve(); blocked.push('allowed'); }
          catch (error) { blocked.push(error.message.includes('blocked') ? 'blocked' : 'unexpected-error'); }
        }
        process.stdout.write(JSON.stringify(blocked));
      })().catch((error) => { process.stderr.write(error.message); process.exitCode = 5; });
    `, env);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  });

  test('sanitized browser-child env drops an inherited credential and loads the guard', async () => {
    const childEnv = launcher.sanitizeEnvironment({ DATAVERSE_API_TOKEN: 'poisoned' }, {
      tempRoot,
      port: 3110,
      cachePath: path.join(tempRoot, 'cache'),
      userConfig: path.join(tempRoot, 'user.npmrc'),
      globalConfig: path.join(tempRoot, 'global.npmrc'),
      guardPath,
      mode: 'server',
      pathValue: process.env.PATH,
    });
    const result = await runNode(`
      let denied = false;
      try { require('node:https').request('https://private.invalid'); }
      catch (error) { denied = error.message.includes('blocked HTTPS'); }
      process.stdout.write(JSON.stringify({ token: process.env.DATAVERSE_API_TOKEN || null, denied }));
    `, childEnv);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ token: null, denied: true });
  });

  test('sends TERM and then KILL to a non-exiting owned process', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {})"], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    await launcher.stopOwnedProcess(child, 40);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }, 5000);

  test('escalates the owned process group when the leader exits but a child ignores TERM', async () => {
    const child = spawn(process.execPath, ['--input-type=commonjs', '-e', `
      const { spawn } = require('node:child_process');
      const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
      process.stdout.write(String(worker.pid));
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    let descendantPid;
    child.stdout.on('data', (part) => { descendantPid = Number(part.toString()); });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const deadline = Date.now() + 3000;
    while (!descendantPid && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(descendantPid).toBeGreaterThan(0);
    await launcher.stopOwnedProcess(child, 50);
    expect(child.exitCode).toBe(0);
    const groupRemains = launcher.isProcessGroupAlive(child.pid);
    expect(groupRemains).toBe(false);
  }, 6000);
});

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const DEFAULT_SCENARIO = 'baseline';
const ALLOWED_FLAGS = new Set(['--port', '--scenario', '--browser-cache', '--headless', '--smoke', '--help', '-h']);

function parseArgs(args) {
  const result = { port: 3110, scenario: DEFAULT_SCENARIO, browserCache: null, headless: false, smoke: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!ALLOWED_FLAGS.has(flag)) throw new Error(`Unsupported rehearsal option: ${flag}`);
    if (flag === '--help' || flag === '-h') { result.help = true; continue; }
    if (flag === '--headless') { result.headless = true; continue; }
    if (flag === '--smoke') { result.smoke = true; result.headless = true; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be an integer from 1024 through 65535');
      result.port = port;
    } else if (flag === '--browser-cache') {
      if (!path.isAbsolute(value)) throw new Error('--browser-cache must be an absolute directory path');
      result.browserCache = value;
    } else {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(value)) throw new Error('--scenario must be a short lowercase fixture name');
      result.scenario = value;
    }
  }
  if (result.headless && !result.smoke) throw new Error('--headless requires --smoke so the run exits and cleans up automatically');
  return result;
}

function resolveBrowserExecutable(chromium, requestedCache) {
  const cacheRoot = requestedCache ? validateBrowserCacheDirectory(requestedCache) : null;
  if (!cacheRoot && process.env.PLAYWRIGHT_BROWSERS_PATH) {
    throw new Error('Set --browser-cache to an explicit absolute Playwright browser directory; inherited browser paths are not used');
  }
  if (cacheRoot && process.env.PLAYWRIGHT_BROWSERS_PATH !== cacheRoot) {
    throw new Error('Playwright browser path must be selected before importing Playwright; restart through the isolated supervisor');
  }
  const executable = chromium.executablePath();
  if (!fs.existsSync(executable)) {
    throw new Error('The locked Playwright Chromium executable is absent; provide --browser-cache for an existing matching browser install (downloads are disabled)');
  }
  const realExecutable = fs.realpathSync(executable);
  if (cacheRoot) {
    const relative = path.relative(cacheRoot, realExecutable);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('--browser-cache resolved a browser executable outside the selected directory');
    }
  }
  return realExecutable;
}

function validateBrowserCacheDirectory(requestedCache) {
  const stat = fs.lstatSync(requestedCache);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('--browser-cache must name an existing non-symlink directory');
  return fs.realpathSync(requestedCache);
}

function defaultBrowserCacheDirectory({ platform = process.platform, home = os.homedir(), localAppData = process.env.LOCALAPPDATA } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (platform === 'darwin') return pathApi.join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'linux') return pathApi.join(home, '.cache', 'ms-playwright');
  if (platform === 'win32') return pathApi.join(localAppData || pathApi.join(home, 'AppData', 'Local'), 'ms-playwright');
  return null;
}

function resolveBrowserCacheDirectory(requestedCache, options = {}) {
  const candidate = requestedCache || defaultBrowserCacheDirectory(options);
  if (!candidate) {
    throw new Error('Cannot determine the standard Playwright browser cache on this platform; pass --browser-cache with an existing matching browser directory');
  }
  if (!path.isAbsolute(candidate)) {
    if (requestedCache) throw new Error('--browser-cache must name an absolute directory path');
    throw new Error('The platform standard Playwright browser cache path is not absolute; pass --browser-cache with an existing matching browser directory');
  }
  try {
    return validateBrowserCacheDirectory(candidate);
  } catch (error) {
    if (requestedCache) throw error;
    throw new Error('No safe Playwright browser cache exists in the standard user cache directory; pass --browser-cache with an existing matching browser directory (downloads are disabled)');
  }
}

function sanitizeEnvironment(_sourceEnv, { tempRoot, port, cachePath, userConfig, globalConfig, guardPath, mode = 'build', pathValue = [path.dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter) }) {
  const temp = path.join(tempRoot, 'tmp');
  const env = {
    PATH: pathValue,
    LANG: 'C',
    LC_ALL: 'C',
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    REHEARSAL_PRIVATE_HOME: path.join(tempRoot, 'home'),
    REHEARSAL_TEMP_ROOT: tempRoot,
    XDG_CONFIG_HOME: path.join(tempRoot, 'home/config'),
    XDG_CACHE_HOME: path.join(tempRoot, 'home/cache'),
    XDG_DATA_HOME: path.join(tempRoot, 'home/data'),
    NODE_OPTIONS: `--require=${guardPath}`,
    NEXT_TELEMETRY_DISABLED: '1',
    CI: '1',
    NPM_CONFIG_CACHE: cachePath,
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXTAUTH_SECRET: 'reviewer-rehearsal-nextauth-secret-not-a-credential',
    EXTERNAL_LINK_SECRET: 'reviewer-rehearsal-external-link-secret-not-a-credential',
    REVIEWER_PORTAL_BASE_URL: `http://127.0.0.1:${port}`,
    AUTH_REQUIRED: 'true',
    DATAVERSE_TARGET_INTERLOCK: 'on',
    DATAVERSE_DAL_ENFORCEMENT: 'on',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
  };
  if (mode === 'server') env.NODE_ENV = 'production';
  return env;
}

function assertLoopbackHttp(url, expectedOrigin) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'http:'
    && parsed.hostname === '127.0.0.1'
    && parsed.origin === expectedOrigin;
}

function browserRequestDecision(url, expectedOrigin, isMockedApiRequest, method = 'GET', isMockedPassiveRequest = false) {
  let parsed;
  try { parsed = new URL(url); } catch { return { allow: false, reason: 'invalid_url' }; }
  if (parsed.protocol !== 'http:' || parsed.origin !== expectedOrigin || parsed.hostname !== '127.0.0.1') {
    return { allow: false, reason: 'non_local_origin' };
  }
  const pathname = parsed.pathname;
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); } catch { return { allow: false, reason: 'ambiguous_path' }; }
  if (pathname.includes('%') || pathname.includes('\\') || decodedPath.includes('\\') || /%2f|%5c|%2e/i.test(pathname)) {
    return { allow: false, reason: 'ambiguous_path' };
  }
  if (pathname === '/api' || decodedPath.toLowerCase() === '/api'
      || pathname.startsWith('/api/') || decodedPath.toLowerCase().startsWith('/api/')) {
    return isMockedApiRequest
      ? { allow: true, reason: 'declared_mock_api' }
      : { allow: false, reason: 'unmocked_api' };
  }
  if (method !== 'GET' && method !== 'HEAD') return { allow: false, reason: 'unmocked_local_method' };
  const passivePath = pathname === '/_vercel/insights/script.js'
    || /^\/_next\/data\/[A-Za-z0-9_-]{1,128}\/(?:index|workbench|guide|profile-settings)\.json$/.test(pathname);
  if (isMockedPassiveRequest && passivePath) return { allow: true, reason: 'declared_passive_mock' };
  if (pathname === '/workbench/00000000-0000-4000-8000-000000000001'
      || pathname === '/external/review/pd-reviewer-rehearsal-token') {
    return { allow: true, reason: 'declared_document' };
  }
  if (/^\/_next\/static\/[A-Za-z0-9/_\-.]+$/.test(pathname)
      || pathname === '/favicon.ico'
      || pathname === '/robots.txt') {
    return { allow: true, reason: 'local_static_asset' };
  }
  return { allow: false, reason: 'unmocked_local_route' };
}

function normalizeViolationReason(reason) {
  const value = String(reason || 'unknown');
  if (value.includes('origin')) return 'api_origin_violation';
  if (/\b(GET|POST|PATCH|PUT|DELETE) \/api\//.test(value)) return 'unmocked_api';
  if (['unmocked_api', 'unmocked_local_method', 'ambiguous_path', 'invalid_url', 'unmocked_local_route'].includes(value)) return value;
  if (value.startsWith('network:')) return 'network_blocked';
  return 'fixture_boundary_violation';
}

function killProcessGroup(child, signal = 'SIGTERM') {
  if (!child) return false;
  if (process.platform === 'win32' && (child.exitCode != null || child.signalCode != null)) return false;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else if (child.exitCode == null && child.signalCode == null) child.kill(signal);
    else return false;
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  return true;
}

function createAbortBoundary(activeChildren) {
  const controller = new AbortController();
  const stop = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
    for (const child of activeChildren) killProcessGroup(child, 'SIGTERM');
  };
  return {
    controller,
    onViolation(reason) {
      void reason;
      stop('network-boundary-violation');
    },
    onSignal(signal) { stop(signal); },
  };
}

async function stopOwnedProcess(child, graceMs = 3000) {
  if (!child) return;
  const processGroup = process.platform !== 'win32' && Boolean(child.pid);
  if (processGroup && !isProcessGroupAlive(child.pid)) return;
  if (!processGroup && (child.exitCode != null || child.signalCode != null)) return;
  killProcessGroup(child, 'SIGTERM');
  if (processGroup) await waitForProcessGroupExit(child.pid, graceMs);
  else if (child.exitCode == null && child.signalCode == null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(graceMs),
    ]);
  }
  if (processGroup ? isProcessGroupAlive(child.pid) : child.exitCode == null && child.signalCode == null) {
    killProcessGroup(child, 'SIGKILL');
    if (processGroup) await waitForProcessGroupExit(child.pid, 1000);
    else await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(1000)]);
  }
}

function isProcessGroupAlive(pid) {
  if (!pid || process.platform === 'win32') return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(pid) && Date.now() < deadline) await delay(50);
  return !isProcessGroupAlive(pid);
}

function createOwnedWorkspace(base = os.tmpdir()) {
  const root = fs.mkdtempSync(path.join(base, 'wmkf-reviewer-rehearsal-'));
  fs.chmodSync(root, 0o700);
  const marker = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(root, '.rehearsal-owner'), marker, { mode: 0o600, flag: 'wx' });
  for (const directory of ['candidate', 'tmp', 'home', 'cache', 'home/config', 'home/cache', 'home/data']) {
    fs.mkdirSync(path.join(root, directory), { mode: 0o700 });
  }
  return { root, marker };
}

function cleanupOwnedWorkspace(root, marker) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('wmkf-reviewer-rehearsal-')) {
    throw new Error('Refusing to remove a path outside the owned reviewer-rehearsal temporary directory');
  }
  const markerPath = path.join(resolved, '.rehearsal-owner');
  if (!fs.existsSync(markerPath) || fs.readFileSync(markerPath, 'utf8') !== marker) {
    throw new Error('Refusing to remove a rehearsal directory without its ownership marker');
  }
  fs.rmSync(resolved, { recursive: true, force: false });
}

function resolveExecutable(name, pathValue) {
  for (const directory of String(pathValue || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next PATH entry */ }
  }
  throw new Error(`Cannot find required executable ${name} on PATH`);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: false,
    });
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (chunk) => process.stdout.write(`[${options.label || path.basename(command)}] ${chunk}`));
    if (child.stderr) child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
      process.stderr.write(`[${options.label || path.basename(command)}] ${chunk}`);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ child, code, signal });
      else reject(new Error(`${options.label || path.basename(command)} exited ${signal || `with code ${code}`}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    options.onChild?.(child);
  });
}

function runGit(args, repoRoot, env) {
  return spawnSync('git', args, { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function assertNoSymlinks(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error('The default npm content cache contains a symlink; refusing to copy it into the rehearsal workspace');
    }
    if (stat.isDirectory()) assertNoSymlinks(fullPath);
  }
}

function assertLauncherCommitted(repoRoot, pathValue) {
  const files = [
    'scripts/rehearse-pd-invite-browser.mjs',
    'scripts/lib/reviewer-rehearsal-launcher.cjs',
    'scripts/lib/reviewer-rehearsal-network-guard.cjs',
    'scripts/lib/reviewer-rehearsal-fixtures.cjs',
  ];
  for (const file of files) {
    const check = runGit(['cat-file', '-e', `HEAD:${file}`], repoRoot, { PATH: pathValue, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
    if (check.status !== 0) throw new Error(`Cannot rehearse yet: commit ${file} to HEAD first so the isolated candidate includes it`);
    const committed = runGit(['show', `HEAD:${file}`], repoRoot, { PATH: pathValue, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
    if (committed.status !== 0) throw new Error(`Cannot read committed ${file}`);
    const working = fs.readFileSync(path.join(repoRoot, file));
    if (!working.equals(Buffer.from(committed.stdout))) throw new Error(`Cannot rehearse yet: working ${file} differs from HEAD; commit it before execution`);
  }
}

function privateChildEnv(pathValue, globalConfig) {
  return {
    PATH: pathValue,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
}

function getDefaultNpmCache(npmPath, pathValue, userConfig, globalConfig) {
  const result = spawnSync(npmPath, [
    'config', 'get', 'cache',
    '--userconfig', userConfig,
    '--globalconfig', globalConfig,
  ], {
    cwd: os.tmpdir(),
    env: privateChildEnv(pathValue, globalConfig),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Unable to determine the default npm cache: ${(result.stderr || '').trim()}`);
  const cachePath = result.stdout.trim();
  if (!path.isAbsolute(cachePath) || !fs.statSync(cachePath).isDirectory()) {
    throw new Error('The default npm cache is unavailable; offline installation cannot proceed');
  }
  return cachePath;
}

async function launchRehearsal({ repoRoot, options, runBrowser }) {
  if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
    throw new Error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. This rehearsal does not need it.');
  }
  options.browserCache = resolveBrowserCacheDirectory(options.browserCache);
  const trustedPath = [...new Set([
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ])].join(path.delimiter);
  const npmPath = resolveExecutable(process.platform === 'win32' ? 'npm.cmd' : 'npm', trustedPath);
  const pathValue = [...new Set([
    path.dirname(npmPath),
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ])].join(path.delimiter);
  const gitEnv = privateChildEnv(pathValue, '/dev/null');
  assertLauncherCommitted(repoRoot, pathValue);

  const workspace = createOwnedWorkspace();
  const candidateDir = path.join(workspace.root, 'candidate');
  const userConfig = path.join(workspace.root, 'npm-user-emptyrc');
  const globalConfig = path.join(workspace.root, 'npm-global-emptyrc');
  const cachePath = path.join(workspace.root, 'cache');
  const guardPath = path.join(candidateDir, 'scripts/lib/reviewer-rehearsal-network-guard.cjs');
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const installEnv = sanitizeEnvironment({}, {
    tempRoot: workspace.root, port: options.port, cachePath, userConfig, globalConfig, guardPath, mode: 'install', pathValue,
  });
  const activeChildren = new Set();
  const violations = [];
  const boundary = createAbortBoundary(activeChildren);
  const abortController = boundary.controller;
  const onViolation = (reason) => {
    violations.push(normalizeViolationReason(reason));
    onViolation.count = violations.length;
    boundary.onViolation(reason);
  };
  onViolation.count = 0;
  let stage = 'preflight';
  let candidateCommit = null;
  let server = null;
  let browserResult = null;
  let failure = null;
  const signalHandler = (signal) => {
    boundary.onSignal(signal);
  };
  const onSigint = () => signalHandler('SIGINT');
  const onSigterm = () => signalHandler('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    fs.writeFileSync(userConfig, '', { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(globalConfig, '', { mode: 0o600, flag: 'wx' });
    const defaultCache = getDefaultNpmCache(npmPath, pathValue, userConfig, globalConfig);
    const defaultContentCache = path.join(defaultCache, '_cacache');
    const cacheStat = fs.lstatSync(defaultContentCache);
    if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) {
      throw new Error('The default npm content cache is not a real directory; offline installation cannot proceed');
    }
    assertNoSymlinks(defaultContentCache);
    fs.cpSync(defaultContentCache, path.join(cachePath, '_cacache'), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      mode: fs.constants.COPYFILE_FICLONE,
    });
    fs.chmodSync(cachePath, 0o700);

    stage = 'export';
    candidateCommit = await archiveCandidate(repoRoot, candidateDir, gitEnv, (child) => activeChildren.add(child));
    stage = 'offline-install';
    await runProcess(npmPath, [
      'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      '--cache', cachePath,
      '--userconfig', userConfig,
      '--globalconfig', globalConfig,
    ], {
      cwd: candidateDir,
      env: installEnv,
      label: 'npm-ci-offline',
      onChild: (child) => activeChildren.add(child),
    });

    stage = 'canonical-build';
    const buildEnv = sanitizeEnvironment({}, {
      tempRoot: workspace.root, port: options.port, cachePath, userConfig, globalConfig, guardPath, mode: 'build', pathValue,
    });
    buildEnv.NPM_CONFIG_IGNORE_SCRIPTS = 'false';
    await runProcess(npmPath, [
      'run', 'build', '--offline',
      '--cache', cachePath,
      '--userconfig', userConfig,
      '--globalconfig', globalConfig,
    ], {
      cwd: candidateDir,
      env: buildEnv,
      label: 'npm-run-build',
      onChild: (child) => activeChildren.add(child),
    });

    stage = 'local-server';
    const startEnv = sanitizeEnvironment({}, {
      tempRoot: workspace.root, port: options.port, cachePath, userConfig, globalConfig, guardPath, mode: 'server', pathValue,
    });
    await startServer(process.execPath, [
      path.join(candidateDir, 'node_modules/next/dist/bin/next'),
      'start', '--hostname', '127.0.0.1', '--port', String(options.port),
    ], {
      cwd: candidateDir,
      env: startEnv,
      baseUrl,
      onChild: (child) => activeChildren.add(child),
    });

    stage = 'browser';
    browserResult = await runBrowser({
      candidateDir,
      baseUrl,
      tempRoot: workspace.root,
      pathValue,
      options,
      childEnv: startEnv,
      onViolation,
      onChild: (child) => activeChildren.add(child),
      signal: abortController.signal,
    });
    if (violations.length > 0) throw new Error('A browser request was blocked by the fail-closed rehearsal boundary');
  } catch (error) {
    failure = error;
    error.stage = error.stage || stage;
  } finally {
    if (!failure && abortController.signal.aborted) {
      failure = new Error(abortController.signal.reason === 'network-boundary-violation'
        ? 'Rehearsal stopped after a blocked network request'
        : 'Rehearsal was interrupted');
      failure.stage = stage;
    }
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    for (const child of activeChildren) await stopOwnedProcess(child).catch(() => {});
    const receipt = {
      format: 'wmkf-reviewer-rehearsal-receipt-v1',
      candidateCommit,
      scenario: options.scenario,
      mode: options.smoke ? 'headless-smoke' : 'headed-local-mock',
      stage,
      result: failure || abortController.signal.aborted
        ? 'stopped'
        : (options.smoke ? 'navigation-only' : 'browser-session-ended'),
      humanScenarioPassRecorded: false,
      failureClass: failure?.name || null,
      failureStage: failure?.rehearsalStage || null,
      failureCode: failure?.rehearsalCode || null,
      browserVersion: browserResult?.browserVersion || null,
      navigationStatus: browserResult?.navigationStatus ?? null,
      mockedApiCount: browserResult?.mockedApiCount ?? 0,
      blockedRequestReasons: violations,
      completedAt: new Date().toISOString(),
    };
    try {
      const receiptPath = await preserveReceipt(receipt);
      console.log(`Private aggregate rehearsal receipt: ${receiptPath}`);
      cleanupOwnedWorkspace(workspace.root, workspace.marker);
    } catch (receiptError) {
      console.error(`Could not preserve/clean the rehearsal safely. Owned temporary directory retained: ${workspace.root}`);
      if (!failure) failure = receiptError;
    }
  }

  if (failure) throw failure;
}

function archiveCandidate(repoRoot, candidateDir, env, onChild = () => {}) {
  const revision = runGit(['rev-parse', '--verify', 'HEAD^{commit}'], repoRoot, env);
  if (revision.status !== 0) throw new Error(`Cannot resolve committed candidate HEAD: ${revision.stderr.trim()}`);
  const commit = revision.stdout.trim();
  const git = spawn('git', ['archive', '--format=tar', commit], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const tar = spawn('tar', ['-xf', '-', '-C', candidateDir], { cwd: candidateDir, env, stdio: ['pipe', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
  onChild(git);
  onChild(tar);
  git.stdout.pipe(tar.stdin);
  return new Promise((resolve, reject) => {
    let stderr = '';
    git.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    tar.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    let done = 0;
    let failed = false;
    const finish = () => {
      if (failed || ++done < 2) return;
      if (git.exitCode !== 0 || tar.exitCode !== 0) reject(new Error(`Could not export committed candidate: ${stderr.trim()}`));
      else resolve(commit);
    };
    git.once('error', reject); tar.once('error', reject);
    git.once('exit', (code) => { if (code !== 0) { failed = true; tar.kill('SIGTERM'); reject(new Error(`git archive failed: ${stderr.trim()}`)); } else finish(); });
    tar.once('exit', (code) => { if (code !== 0) { failed = true; git.kill('SIGTERM'); reject(new Error(`tar extraction failed: ${stderr.trim()}`)); } else finish(); });
  });
}

async function preserveReceipt(receipt, base = os.tmpdir()) {
  const directory = path.join(base, 'wmkf-reviewer-rehearsal-receipts');
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Refusing to write a private rehearsal receipt outside a real directory');
  }
  fs.chmodSync(directory, 0o700);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}

async function assertLoopbackPortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForServer(url, child, ready, timeoutMs = 120000) {
  let timer;
  await Promise.race([
    ready,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for the owned Next server readiness signal')), timeoutMs);
    }),
    new Promise((_, reject) => child.once('exit', (code, signal) => reject(new Error(`Next server exited before readiness (${signal || code})`)))),
  ]).finally(() => clearTimeout(timer));
  const response = await fetch(`${url}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (response.status >= 500) throw new Error('The owned loopback server returned an error after its readiness signal');
}

async function startServer(command, args, options = {}) {
  const serverUrl = new URL(options.baseUrl);
  await assertLoopbackPortAvailable(Number(serverUrl.port));
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    shell: false,
  });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let readinessOutput = '';
  child.stdout.on('data', (chunk) => {
    const output = chunk.toString();
    process.stdout.write(`[next-start] ${chunk}`);
    readinessOutput = (readinessOutput + output).slice(-4000);
    if (/\bready in\b/i.test(readinessOutput)) readyResolve();
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[next-start] ${chunk}`));
  child.once('exit', (code, signal) => readyReject(new Error(`Next server exited before readiness (${signal || code})`)));
  options.onChild?.(child);
  await waitForServer(options.baseUrl, child, ready, options.timeoutMs);
  return child;
}

module.exports = {
  ALLOWED_FLAGS,
  DEFAULT_SCENARIO,
  archiveCandidate,
  assertNoSymlinks,
  assertLoopbackPortAvailable,
  assertLauncherCommitted,
  assertLoopbackHttp,
  browserRequestDecision,
  cleanupOwnedWorkspace,
  createOwnedWorkspace,
  createAbortBoundary,
  killProcessGroup,
  isProcessGroupAlive,
  launchRehearsal,
  normalizeViolationReason,
  parseArgs,
  preserveReceipt,
  resolveExecutable,
  resolveBrowserExecutable,
  validateBrowserCacheDirectory,
  defaultBrowserCacheDirectory,
  resolveBrowserCacheDirectory,
  runProcess,
  sanitizeEnvironment,
  startServer,
  stopOwnedProcess,
  waitForServer,
};

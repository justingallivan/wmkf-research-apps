#!/usr/bin/env node

/**
 * Isolated server launcher for deterministic Reviewer Find Playwright tests.
 *
 * The usual local Next start can load this checkout's .env.local before a
 * browser route mock has a chance to intercept anything. That is unsuitable
 * for a deterministic test: instrumentation may read Postgres or try to raise
 * an alert at cold start. This launcher builds from a fresh temporary root
 * copied exclusively from tracked files and starts Next with a closed,
 * explicitly allowlisted environment.
 *
 * This is deliberately not a runtime feature flag. It is only a test-process
 * boundary, and it rejects service credentials or targets before both build
 * and start.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_PORT = 3217;
const NEXTAUTH_SECRET = 'reviewer-find-e2e-throwaway-nextauth-secret-32-chars';

// These are effect-capable configuration names or prefixes. The child receives
// none of them: NEXTAUTH_SECRET is the one intentional synthetic exception,
// and its exact throwaway value is checked separately below.
const FORBIDDEN_ENV = [
  /^DYNAMICS(?:_|$)/,
  /^DATAVERSE(?:_|$)/,
  /^POSTGRES(?:_|$)/,
  /^DATABASE_URL$/,
  /^PG[A-Z0-9_]*$/,
  /^AZURE_AD(?:_|$)/,
  /^EXTERNAL_AZURE_AD(?:_|$)/,
  /^BLOB(?:_|$)/,
  /^INTAKE_BLOB(?:_|$)/,
  /^DVX_BLOB(?:_|$)/,
  /^ANTHROPIC(?:_|$)/,
  /^CLAUDE(?:_|$)/,
  /^OPENAI(?:_|$)/,
  /^OPENALEX(?:_|$)/,
  /^PERPLEXITY(?:_|$)/,
  /^SERP(?:_|$)/,
  /^ORCID(?:_|$)/,
  /^CROSSREF(?:_|$)/,
  /^SEMANTIC_SCHOLAR(?:_|$)/,
  /^GOOGLE(?:_|$)/,
  /^CLOUDMERSIVE(?:_|$)/,
  /^SMTP(?:_|$)/,
  /^SENDGRID(?:_|$)/,
  /^EMAIL(?:_|$)/,
  /^MAIL(?:_|$)/,
  /^CRON(?:_|$)/,
  /^QSTASH(?:_|$)/,
  /^UPSTASH(?:_|$)/,
  /^VERCEL(?:_|$)/,
];

const EXCLUDED_TRACKED_PATH = (relativePath) => {
  const segments = relativePath.split('/');
  const base = segments.at(-1);
  // The production instrumentation hook performs Postgres-backed cold-start
  // monitoring before Playwright can install a route. Omitting it only from
  // this generated test root prevents even credential-free connection attempts
  // without adding a runtime flag or production bypass to application source.
  return relativePath === 'instrumentation.js'
    || base.startsWith('.env')
    || segments.includes('.auth')
    || segments.includes('playwright-report')
    || segments.includes('test-results');
};

function parsePort(argv) {
  const portIndex = argv.indexOf('--port');
  const raw = portIndex === -1 ? String(DEFAULT_PORT) : argv[portIndex + 1];
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Expected a local TCP port from 1024 through 65535; received ${raw || '(missing)'}.`);
  }
  return port;
}

function childEnvironment(port) {
  // Do not spread process.env. In particular, do not inherit HOME (which could
  // locate user configuration), proxy credentials, or any application target.
  // The Node executable is absolute, and PATH is only retained so subprocesses
  // used by Next can find standard platform tools.
  const env = {
    PATH: process.env.PATH || '',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXTAUTH_SECRET,
    NEXTAUTH_URL: `http://localhost:${port}`,
    PORT: String(port),
  };

  for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
    if (typeof process.env[key] === 'string' && process.env[key]) env[key] = process.env[key];
  }

  return env;
}

function forbiddenKeys(env) {
  return Object.keys(env).filter((key) => FORBIDDEN_ENV.some((pattern) => pattern.test(key)));
}

function assertSafeChildEnvironment(env, port) {
  const blocked = forbiddenKeys(env);
  if (blocked.length) {
    throw new Error(`Reviewer Find E2E child environment contains forbidden service configuration: ${blocked.join(', ')}`);
  }
  if (env.NEXTAUTH_SECRET !== NEXTAUTH_SECRET) {
    throw new Error('Reviewer Find E2E must use only its fixed synthetic NextAuth secret.');
  }
  if (env.NEXTAUTH_URL !== `http://localhost:${port}` || env.PORT !== String(port)) {
    throw new Error('Reviewer Find E2E must use a local-only NextAuth URL and matching port.');
  }
}

function trackedFiles() {
  const output = execFileSync('git', ['-C', SOURCE_ROOT, 'ls-files', '-z'], { encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean).filter((file) => !EXCLUDED_TRACKED_PATH(file));
}

function copyTrackedFiles(targetRoot) {
  for (const relativePath of trackedFiles()) {
    const source = path.join(SOURCE_ROOT, relativePath);
    const target = path.join(targetRoot, relativePath);
    const stat = fs.lstatSync(source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(source), target);
    } else if (stat.isFile()) {
      fs.copyFileSync(source, target);
    }
  }

  // Dependencies are deliberately reused, not copied. The app source remains
  // isolated in targetRoot, and Webpack (not Turbopack) supports this symlink.
  fs.symlinkSync(path.join(SOURCE_ROOT, 'node_modules'), path.join(targetRoot, 'node_modules'));
}

function makeTemporaryRoot() {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-reviewer-find-e2e-'));
  try {
    copyTrackedFiles(targetRoot);
    return targetRoot;
  } catch (error) {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    throw error;
  }
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve(child);
      reject(new Error(`${path.basename(command)} ${args.join(' ')} exited with ${signal || `code ${code}`}.`));
    });
  });
}

function startChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
  });
}

function environmentReport(port) {
  const env = childEnvironment(port);
  assertSafeChildEnvironment(env, port);
  return {
    childKeys: Object.keys(env).sort(),
    forbiddenChildKeys: forbiddenKeys(env),
    syntheticNextAuth: env.NEXTAUTH_SECRET === NEXTAUTH_SECRET,
    localOnlyUrl: env.NEXTAUTH_URL === `http://localhost:${port}`,
    startupInstrumentationExcluded: !trackedFiles().includes('instrumentation.js'),
    // A fingerprint lets the self-test prove a parent NEXTAUTH sentinel was
    // replaced without printing any secret value.
    nextAuthFingerprint: createHash('sha256').update(env.NEXTAUTH_SECRET).digest('hex').slice(0, 12),
  };
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  if (process.argv.includes('--inspect-child-env')) {
    process.stdout.write(`${JSON.stringify(environmentReport(port))}\n`);
    return;
  }

  const env = childEnvironment(port);
  // Check independently for each command. A later edit must not turn the
  // start phase into an accidental credential-bearing process.
  assertSafeChildEnvironment(env, port);
  const targetRoot = makeTemporaryRoot();
  const nextBin = path.join(targetRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  let server;
  let stopping = false;

  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    if (server?.exitCode == null) server.kill('SIGTERM');
    fs.rmSync(targetRoot, { recursive: true, force: true });
  };
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  process.once('exit', () => {
    if (!stopping) fs.rmSync(targetRoot, { recursive: true, force: true });
  });

  try {
    await runChild(process.execPath, [nextBin, 'build', '--webpack'], {
      cwd: targetRoot,
      env,
      stdio: 'inherit',
    });
    assertSafeChildEnvironment(env, port);
    server = await startChild(process.execPath, [nextBin, 'start', '-p', String(port)], {
      cwd: targetRoot,
      env,
      stdio: 'inherit',
    });
    server.once('exit', (code, signal) => {
      if (!stopping) {
        cleanup();
        process.exitCode = code || 1;
        console.error(`Reviewer Find E2E server stopped unexpectedly (${signal || `code ${code}`}).`);
      }
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Reviewer Find E2E isolated server failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { NEXTAUTH_SECRET, assertSafeChildEnvironment, childEnvironment, environmentReport, forbiddenKeys };

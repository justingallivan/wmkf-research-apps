#!/usr/bin/env node
'use strict';

// Read-only projection of shared-app environment routing metadata. Vercel's
// JSON may include environment-variable values; inspect them only in memory
// and emit hostnames plus target metadata, never values or credentials.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const PROJECT_NAME = 'wmkf_research_apps';
const PROJECT_ID = 'prj_56SJKzNer1aV38kKVoP8tl3X0lf3';
const TEAM = 'justin-gallivans-projects';
const ENV_KEYS = new Set(['DYNAMICS_URL', 'POSTGRES_URL', 'DATABASE_URL']);
const PREVIEW_BRANCHES = [
  'codex/feature-request',
  'codex/test-request-preview-integration',
  'codex/transcription-pilot',
];
const EXPECTED_TEST_ACCESS = 'test:4236c2b3-b053-f111-bec7-6045bd015cb0';
const REQUEST_ID = '4236c2b3-b053-f111-bec7-6045bd015cb0';
const SANDBOX_DYNAMICS_ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const EXPECTED_NEON_HOST = 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech';
const EXPECTED_DATABASE = 'neondb';

function runVercel(args, cwd = process.cwd()) {
  return execFileSync('vercel', [...args, '--scope', TEAM, '--non-interactive'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 4 * 1024 * 1024,
    cwd,
  });
}

function hostnameOf(value) {
  if (typeof value !== 'string' || !value || /^\[(?:SENSITIVE|ENCRYPTED)\]$/i.test(value)) return 'unavailable';
  try { return new URL(value).hostname; }
  catch { return 'unavailable'; }
}

function safeFlag(value) {
  return ['on', 'off'].includes(value) ? value : value ? 'other-redacted' : 'unset';
}

function projectIdentity() {
  const project = JSON.parse(runVercel(['project', 'inspect', PROJECT_NAME, '--format', 'json']));
  if (project.id !== PROJECT_ID || project.name !== PROJECT_NAME) {
    throw new Error('shared_project_identity_mismatch');
  }
}

function resolveHosts() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-transcription-audience.'));
  fs.chmodSync(tempDir, 0o700);
  const targets = [
    ...PREVIEW_BRANCHES.map((branch) => ({ environment: 'preview', branch })),
    { environment: 'preview', branch: null },
    { environment: 'production', branch: null },
  ];
  const tempFiles = [];
  let resolvedConfigs;
  try {
    resolvedConfigs = targets.map(({ environment, branch }, index) => {
      const filename = `env-${index}.env`;
      const envPath = path.join(tempDir, filename);
      tempFiles.push(envPath);
      const args = ['env', 'pull', envPath, `--environment=${environment}`];
      if (branch) args.push(`--git-branch=${branch}`);
      args.push('--project', PROJECT_ID, '--yes');
      runVercel(args, tempDir);
      const values = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      return {
        environment,
        branch: branch || 'default',
        dynamicsUrlHostname: hostnameOf(values.DYNAMICS_URL),
        dynamicsSandboxUrlHostname: hostnameOf(values.DYNAMICS_SANDBOX_URL),
        databaseHosts: {
          POSTGRES_URL: hostnameOf(values.POSTGRES_URL),
          DATABASE_URL: hostnameOf(values.DATABASE_URL),
        },
        postPresentationMaterials: {
          schemaReady: safeFlag(values.POST_PRESENTATION_MATERIALS_SCHEMA_READY),
          accessConfigured: Boolean(values.POST_PRESENTATION_MATERIALS_ACCESS),
          exactTestRequestPinPresent: values.POST_PRESENTATION_MATERIALS_ACCESS === EXPECTED_TEST_ACCESS,
        },
      };
    });
  } finally {
    for (const envPath of tempFiles) {
      if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
    }
    fs.rmdirSync(tempDir);
  }
  return {
    configs: resolvedConfigs,
    temporaryFilesRemoved: tempFiles.every((envPath) => !fs.existsSync(envPath)),
    temporaryDirectoryRemoved: !fs.existsSync(tempDir),
  };
}

function parsePinnedPostgresUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('preview_database_url_unavailable_or_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || url.hostname.toLowerCase() !== EXPECTED_NEON_HOST
      || url.pathname !== `/${EXPECTED_DATABASE}`
      || !url.username || !url.password || (url.port && url.port !== '5432')) {
    throw new Error('preview_database_target_mismatch');
  }
  const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('preview_database_tls_required');
  }
  return url;
}

function validateLinkCountEnvironment(env) {
  const validOrigin = (value, expected) => {
    try {
      const url = new URL(value);
      return url.origin === expected && (url.pathname === '' || url.pathname === '/')
        && !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
  };
  if (!validOrigin(env.DYNAMICS_URL, SANDBOX_DYNAMICS_ORIGIN)
      || (env.DYNAMICS_SANDBOX_URL !== undefined
        && !validOrigin(env.DYNAMICS_SANDBOX_URL, SANDBOX_DYNAMICS_ORIGIN))) {
    throw new Error('preview_dynamics_target_mismatch');
  }
  const urls = ['POSTGRES_URL', 'DATABASE_URL'].filter((key) => env[key]).map((key) => [key, parsePinnedPostgresUrl(env[key])]);
  if (!urls.length || urls.some(([, url]) =>
    url.hostname.toLowerCase() !== EXPECTED_NEON_HOST || url.pathname !== `/${EXPECTED_DATABASE}`)) {
    throw new Error('preview_database_target_mismatch');
  }
  return urls[0][1];
}

async function queryLinkCounts(checkLink = false) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-transcription-link-counts.'));
  fs.chmodSync(tempDir, 0o700);
  const envPath = path.join(tempDir, 'preview.env');
  let counts;
  try {
    runVercel([
      'env', 'pull', envPath, '--environment=preview', '--git-branch=codex/feature-request',
      '--project', PROJECT_ID, '--yes',
    ], tempDir);
    const env = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    const url = validateLinkCountEnvironment(env);
    const { Client } = require('pg');
    const client = new Client({
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: EXPECTED_DATABASE,
      ssl: { rejectUnauthorized: true, servername: EXPECTED_NEON_HOST },
      connectionTimeoutMillis: 10000,
      query_timeout: 15000,
      application_name: 'meeting-transcription-audience-link-counts-readonly',
    });
    let transactionOpen = false;
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      transactionOpen = true;
      const result = await client.query(
        `SELECT
           (SELECT COUNT(*)::integer
              FROM public.presentation_material_links
             WHERE request_id = $1::uuid
               AND revoked_at IS NULL
               AND expires_at > NOW()) AS active_presentation_material_links,
           (SELECT COUNT(*)::integer
              FROM public.deliberation_briefing_links
             WHERE request_id = $1::uuid
               AND revoked_at IS NULL
               AND expires_at > NOW()) AS active_deliberation_briefing_links`,
        [REQUEST_ID],
      );
      counts = result.rows[0];
      if (checkLink) {
        const links = await client.query(
          `SELECT token_ciphertext, token_digest, created_at, expires_at
             FROM public.presentation_material_links
            WHERE request_id = $1::uuid AND revoked_at IS NULL AND expires_at > NOW()
            LIMIT 2`, [REQUEST_ID],
        );
        if (links.rows.length !== 1) throw new Error('expected_exactly_one_live_link');
        const row = links.rows[0];
        counts.linkCheck = { createdAt: row.created_at, expiresAt: row.expires_at };
        const origin = new URL(env.DELIBERATION_BRIEFING_PUBLIC_BASE_URL || env.NEXTAUTH_URL);
        process.stdout.write(`${JSON.stringify({ configuredPublicHost: origin.hostname })}\n`);
        if (origin.protocol !== 'https:' || origin.username || origin.password
          || origin.pathname !== '/' || origin.search || origin.hash
          || !(origin.hostname === 'reviews.wmkeck.org' || origin.hostname === 'wmkfresearchapps-preview.vercel.app'
            || /^wmkf-research-apps-[a-z0-9-]+\.vercel\.app$/.test(origin.hostname))) {
          throw new Error('public_origin_not_approved');
        }
        counts.linkCheck.configuredPublicHost = origin.hostname;
        if (!env.USER_PREFS_ENCRYPTION_KEY) throw new Error('encryption_key_unavailable');
        const previousKey = process.env.USER_PREFS_ENCRYPTION_KEY;
        let token;
        try {
          process.env.USER_PREFS_ENCRYPTION_KEY = env.USER_PREFS_ENCRYPTION_KEY;
          token = require('../lib/utils/encryption').decrypt(row.token_ciphertext);
        } finally {
          if (previousKey === undefined) delete process.env.USER_PREFS_ENCRYPTION_KEY;
          else process.env.USER_PREFS_ENCRYPTION_KEY = previousKey;
        }
        if (!token || require('node:crypto').createHash('sha256').update(token).digest('hex') !== row.token_digest) {
          throw new Error('stored_link_unrecoverable');
        }
        // One normal context GET; no file-open/download request or redirects.
        // Normal endpoint rate-limit telemetry may be recorded by the server.
        const response = await fetch(`${origin.origin}/api/external/presentation/${encodeURIComponent(token)}/context`, {
          redirect: 'manual', signal: AbortSignal.timeout(15000),
        });
        counts.linkCheck.httpStatus = response.status;
        const location = response.headers.get('location');
        if (location) {
          const redirect = new URL(location, origin.origin);
          counts.linkCheck.redirectHost = redirect.hostname;
          counts.linkCheck.redirectIsSignIn = /(?:login|sign[-_]?in|sso|oauth|authorize)/i.test(redirect.pathname);
        }
        const body = await response.json().catch(() => null);
        counts.linkCheck.jsonResponse = Boolean(body);
        counts.linkCheck.ok = body?.ok === true;
        const knownReasons = ['not_found', 'expired', 'revoked', 'invalid_claim', 'invalid_signature', 'server_error', 'rate_limit_unavailable'];
        counts.linkCheck.reason = knownReasons.includes(body?.reason) ? body.reason : 'not_reported';
        counts.linkCheck.materialCount = Array.isArray(body?.materials) ? body.materials.length : null;
      }
    } finally {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  } finally {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
    fs.rmdirSync(tempDir);
  }
  return {
    scope: 'verified-shared-preview-codex-feature-request-neon',
    requestId: REQUEST_ID,
    ...counts,
    temporaryFileRemoved: !fs.existsSync(envPath),
    temporaryDirectoryRemoved: !fs.existsSync(tempDir),
  };
}

function parseArgs(argv) {
  if (argv.length > 1 || (argv.length === 1 && !['--resolve-hosts', '--link-counts', '--link-check'].includes(argv[0]))) {
    throw new Error('invalid_arguments');
  }
  return { resolveHosts: argv[0] === '--resolve-hosts', linkCounts: ['--link-counts', '--link-check'].includes(argv[0]), checkLink: argv[0] === '--link-check' };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  projectIdentity();

  if (options.linkCounts) {
    const counts = await queryLinkCounts(options.checkLink);
    process.stdout.write(`${JSON.stringify({
      project: { name: PROJECT_NAME, id: PROJECT_ID, team: TEAM },
      linkCounts: counts,
    }, null, 2)}\n`);
    return;
  }

  const entries = [];
  for (const environment of ['preview', 'production']) {
    const response = JSON.parse(runVercel([
      'env', 'ls', environment, '--project', PROJECT_ID, '--format', 'json',
    ]));
    for (const variable of response.envs || []) {
      if (!ENV_KEYS.has(variable.key) || !Array.isArray(variable.target)
          || !variable.target.includes(environment)) continue;
      entries.push({
        key: variable.key,
        environment,
        branch: variable.gitBranch || 'default',
        type: variable.type || 'unknown',
        hostname: hostnameOf(variable.value),
      });
    }
  }

  const unique = [...new Map(entries.map((entry) => [
    `${entry.environment}:${entry.key}:${entry.branch}:${entry.type}:${entry.hostname}`,
    entry,
  ])).values()].sort((a, b) =>
    a.environment.localeCompare(b.environment) || a.key.localeCompare(b.key) || a.branch.localeCompare(b.branch));
  process.stdout.write(`${JSON.stringify({
    project: { name: PROJECT_NAME, id: PROJECT_ID, team: TEAM },
    variableTargets: unique,
    note: 'Only environment, branch, variable type, and URL hostname are emitted; hidden or unreadable values are unavailable.',
    ...(options.resolveHosts ? { resolvedConfigs: resolveHosts() } : {}),
  }, null, 2)}\n`);
}

main().catch((error) => {
  const code = /^[a-z0-9_:-]{1,100}$/i.test(error?.message || '') ? error.message : 'probe_failed';
  process.stderr.write(`meeting_transcription_audience_config_probe_failed:${code}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
/** Read-only Vercel preflight for the Integrity rollout. Uses the existing
 * linked checkout and Vercel login, never links/deploys/sets env or runs routes.
 * Environment values are read only into a private temporary directory, reduced
 * to target identity/presence booleans, then removed. No secret is printed.
 * Neon recovery settings still require the Vercel → Open in Neon console path.
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const PROJECT = 'prj_56SJKzNer1aV38kKVoP8tl3X0lf3';
const TEAM = 'team_bAyoqgvSJhFJC3blheJgTMXQ';
const ROOT = path.resolve(__dirname, '..');
function command(executable, args, cwd = ROOT) {
  return cp.execFileSync(executable, args, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function api(endpoint) { return JSON.parse(command('vercel', ['api', endpoint, '--scope', TEAM])); }
function main() {
  const common = command('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const linked = path.dirname(common);
  const link = JSON.parse(fs.readFileSync(path.join(linked, '.vercel/project.json')));
  if (link.projectId !== PROJECT || link.orgId !== TEAM) throw new Error('linked_project_mismatch');
  const project = api(`/v9/projects/${PROJECT}`);
  if (project.id !== PROJECT || project.accountId !== TEAM) throw new Error('live_project_mismatch');
  const current = project.targets?.production;
  const deployment = current?.id ? api(`/v13/deployments/${current.id}`) : null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-production-target-'));
  let target;
  try {
    fs.chmodSync(tmp, 0o700);
    const file = path.join(tmp, 'production.env');
    command('vercel', ['env', 'pull', file, '--environment=production', '--yes'], linked);
    fs.chmodSync(file, 0o600);
    const env = dotenv.parse(fs.readFileSync(file));
    const local = dotenv.parse(fs.readFileSync(path.join(ROOT, '.env.local')));
    target = { neonProject: env.NEON_PROJECT_ID, urls: ['POSTGRES_URL', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING'].map(key => ({ key,
      host: env[key] ? new URL(env[key]).hostname : null, database: env[key] ? new URL(env[key]).pathname : null, matchesLocal: env[key] === local[key] })),
    cronSecretPresent: Boolean(env.CRON_SECRET), refreshFlag: env.RETRACTION_REFRESH_ENABLED || 'unset' };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project: { id: project.id, name: project.name }, target,
    production: current ? { id: current.id, url: current.url, readyState: current.readyState, gitSha: current.meta?.githubCommitSha } : null,
    schedulerDeployment: project.crons?.deploymentId, jobs: project.crons?.definitions,
    deployment: deployment ? { id: deployment.id, readyState: deployment.readyState, target: deployment.target, gitSource: deployment.gitSource, crons: deployment.crons } : null }, null, 2));
}
try { main(); } catch (error) { console.error(JSON.stringify({ error: 'platform_preflight_failed', name: error.name, code: error.code })); process.exitCode = 1; }

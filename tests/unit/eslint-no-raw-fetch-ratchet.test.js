/**
 * T6 (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5/§6, Stage 6
 * closeout ratchet): a lint fixture proving the `no-restricted-syntax` rule
 * against raw `fetch(` calls fires exactly where the plan scopes it —
 * `shared/components/**` and `pages/**`, excluding `pages/api/**` — and
 * respects a site-level (not file-level) `eslint-disable-next-line`
 * exemption, matching §2.6's allowlist mechanism.
 *
 * Runs the real `eslint.config.mjs` via `npx eslint --stdin` (child_process,
 * not the `ESLint` Node API) because the flat config file is an ES module;
 * `ESLint#lintText`'s dynamic import of it fails under Jest's CJS transform
 * without `--experimental-vm-modules` (project hazard:
 * project-vercel-node22-no-require-esm.md). The CLI subprocess loads it the
 * same way `npm run lint` does, so this exercises the real, wired-up config.
 * Fixtures are piped over stdin and never written to the repo.
 *
 * @jest-environment node
 */

import { spawnSync } from 'child_process';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');
const RULE_ID = 'no-restricted-syntax';

function lint(source, relativeFilePath) {
  const result = spawnSync(
    'npx',
    ['eslint', '--stdin', '--stdin-filename', relativeFilePath, '--format', 'json', '--no-config-lookup', '--config', 'eslint.config.mjs'],
    {
      cwd: REPO_ROOT,
      input: source,
      encoding: 'utf8',
      timeout: 30000,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`eslint exited ${result.status}: ${result.stderr}`);
  }
  const [report] = JSON.parse(result.stdout);
  return report;
}

function messagesFor(report, ruleId) {
  return (report.messages || []).filter((m) => m.ruleId === ruleId);
}

describe('T6: no-restricted-syntax ratchet on raw fetch(', () => {
  test('(a) fires on a raw fetch( in a shared/components client file', () => {
    const report = lint(
      "export async function load() {\n  return fetch('/api/x');\n}\n",
      'shared/components/fixture-a.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(1);
  });

  test('(a) fires on a raw fetch( in a pages/ (non-api) client file', () => {
    const report = lint(
      "export async function load() {\n  return fetch('/api/x');\n}\n",
      'pages/fixture-a.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(1);
  });

  test('(b) does NOT fire on the identical code under pages/api/', () => {
    const report = lint(
      "export default async function handler(req, res) {\n  const upstream = await fetch('https://example.test');\n  res.status(200).json(await upstream.json());\n}\n",
      'pages/api/fixture-b.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(0);
  });

  test('(c) does NOT fire on a site carrying the eslint-disable-next-line directive', () => {
    const report = lint(
      [
        'export async function download() {',
        '  // eslint-disable-next-line no-restricted-syntax -- allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6',
        "  return fetch('/api/download');",
        '}',
        '',
      ].join('\n'),
      'shared/components/fixture-c.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(0);
    // The directive must be USED (not "unused eslint-disable directive"), i.e. it actually
    // suppressed a real violation — not merely present over code that wouldn't have fired anyway.
    expect((report.messages || []).some((m) => /unused eslint-disable/i.test(m.message))).toBe(false);
  });

  test('(d) DOES fire on an un-annotated raw fetch( elsewhere in the same file as an annotated one (site-level, not file-level)', () => {
    const report = lint(
      [
        'export async function download() {',
        '  // eslint-disable-next-line no-restricted-syntax -- allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6',
        "  return fetch('/api/download');",
        '}',
        '',
        'export async function loadOther() {',
        "  return fetch('/api/other');",
        '}',
        '',
      ].join('\n'),
      'shared/components/fixture-d.js'
    );
    const hits = messagesFor(report, RULE_ID);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(7);
  });

  test('also fires on globalThis.fetch(/window.fetch( member-call forms', () => {
    const report = lint(
      "export async function load() {\n  return globalThis.fetch('/api/x');\n}\n",
      'shared/components/fixture-e.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(1);

    const report2 = lint(
      "export async function load() {\n  return window.fetch('/api/x');\n}\n",
      'shared/components/fixture-f.js'
    );
    expect(messagesFor(report2, RULE_ID)).toHaveLength(1);
  });

  test('does not fire on a call to a variable named fetchImpl or fetch used as a bare identifier (not called)', () => {
    const report = lint(
      "export async function load(fetchImpl) {\n  const f = fetch;\n  return fetchImpl('/api/x');\n}\n",
      'shared/components/fixture-g.js'
    );
    expect(messagesFor(report, RULE_ID)).toHaveLength(0);
  });
});

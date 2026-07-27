#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-fact-consistency.js.
 *
 * Layer A writes synthetic live-doc fixtures and verifies prose matching plus
 * strict same-line structured exemptions. Layer B cross-checks the production
 * derives with an independent lightweight scanner so the self-test does not
 * duplicate the production Babel-AST implementation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-fact-consistency.js');
const tempDir = path.join(repoRoot, 'docs', 'fact_consistency_selftest_tmp');
const syntheticDir = path.join(repoRoot, 'scripts', 'fact_consistency_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture(['docs/fact_consistency_selftest_tmp', 'scripts/fact_consistency_selftest_tmp']);

function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gate)}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        out += '  ';
        i += 2;
      } else if (c === '/' && n === '*') {
        state = 'block';
        out += '  ';
        i += 2;
      } else if (c === '"' || c === "'" || c === '`') {
        state = 'string';
        quote = c;
        out += ' ';
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        out += '  ';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    } else if (state === 'string') {
      if (c === '\\') {
        out += '  ';
        i += 2;
      } else if (c === quote) {
        state = 'code';
        quote = null;
        out += ' ';
        i += 1;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    }
  }
  return out;
}

function independentAppCountFromSource(src) {
  const stripped = stripCommentsAndStrings(src);
  const exportIdx = stripped.indexOf('export const APP_REGISTRY');
  if (exportIdx === -1) throw new Error('independent app scanner: APP_REGISTRY export not found');
  const start = stripped.indexOf('[', exportIdx);
  if (start === -1) throw new Error('independent app scanner: APP_REGISTRY array not found');
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length; i += 1) {
    if (stripped[i] === '[') depth += 1;
    if (stripped[i] === ']') depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('independent app scanner: APP_REGISTRY array not closed');
  const arrayText = src.slice(start, end + 1);
  const cleanArray = stripCommentsAndStrings(arrayText);
  let braceDepth = 0;
  let count = 0;
  for (let i = 0; i < cleanArray.length; i += 1) {
    const c = cleanArray[i];
    if (c === '{') {
      braceDepth += 1;
      if (braceDepth === 1) {
        const tail = cleanArray.slice(i);
        if (/^\{[\s\S]*?\bkey\s*:/.test(tail)) count += 1;
      }
    } else if (c === '}') {
      braceDepth -= 1;
    }
  }
  if (count === 0) throw new Error('independent app scanner: zero app keys found');
  return count;
}

function independentLiveAppCount() {
  return independentAppCountFromSource(fs.readFileSync(path.join(repoRoot, 'shared/config/appRegistry.js'), 'utf8'));
}

function independentEndpointCountInFiles(files) {
  let count = 0;
  for (const file of files) {
    const stripped = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    if (/\brequireAppAccess\s*\(/.test(stripped)) count += 1;
  }
  return count;
}

function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(full, out);
    else if (/\.(cjs|mjs|js|jsx|ts|tsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

function independentLiveEndpointCount() {
  return independentEndpointCountInFiles(walkJs(path.join(repoRoot, 'pages/api')));
}

function stripCommentsPreservingStrings(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        out += '  ';
        i += 2;
      } else if (c === '/' && n === '*') {
        state = 'block';
        out += '  ';
        i += 2;
      } else if (c === '"' || c === "'" || c === '`') {
        state = 'string';
        quote = c;
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        out += '  ';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    } else if (state === 'string') {
      out += c;
      if (c === '\\') {
        out += n || '';
        i += 2;
      } else if (c === quote) {
        state = 'code';
        quote = null;
        i += 1;
      } else {
        i += 1;
      }
    }
  }
  return out;
}

function independentWorkbenchCountsFromSource(src) {
  const clean = stripCommentsPreservingStrings(src);
  const declaration = clean.match(/\b(?:const|let|var)\s+TABS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!declaration) throw new Error('independent Workbench scanner: TABS array not found');
  const keys = [];
  const keyRe = /\bkey\s*:\s*(['"])([^'"]+)\1/g;
  let keyMatch;
  while ((keyMatch = keyRe.exec(declaration[1])) !== null) keys.push(keyMatch[2]);
  if (keys.length === 0) throw new Error('independent Workbench scanner: zero tab keys found');
  if (new Set(keys).size !== keys.length) throw new Error('independent Workbench scanner: duplicate tab key');

  const dispatched = new Set();
  const branchRe = /\bactiveTab\s*===\s*(['"])([^'"]+)\1|(['"])([^'"]+)\3\s*===\s*activeTab/g;
  let branchMatch;
  while ((branchMatch = branchRe.exec(clean)) !== null) {
    const key = branchMatch[2] || branchMatch[4];
    if (keys.includes(key)) dispatched.add(key);
  }
  return {
    total: keys.length,
    live: dispatched.size,
    placeholders: keys.length - dispatched.size,
  };
}

function independentLiveWorkbenchCounts() {
  return independentWorkbenchCountsFromSource(
    fs.readFileSync(path.join(repoRoot, 'pages', 'workbench', '[requestId].js'), 'utf8'),
  );
}

function assertSyntheticIndependentScanners() {
  fs.mkdirSync(syntheticDir, { recursive: true });
  const registryFixture = `
    export const APP_REGISTRY = [
      // { key: 'commented-old-app' },
      { key: 'one', meta: { key: 'nested-ignored' } },
      { key: "two" },
      /*
      { key: 'commented-block-app' },
      */
      { key: 'three' },
    ];
  `;
  const registryPath = path.join(syntheticDir, 'synthetic-appRegistry.js');
  fs.writeFileSync(registryPath, registryFixture);
  const appCount = independentAppCountFromSource(fs.readFileSync(registryPath, 'utf8'));
  if (appCount !== 3) throw new Error(`independent app scanner synthetic expected 3, got ${appCount}`);

  const apiFixtures = {
    'import-only.js': "import { requireAppAccess } from '../../lib/utils/auth';\nexport default function h() {}\n",
    'comment-only.js': "// requireAppAccess(req, res, 'x')\nexport default function h() {}\n",
    'string-only.js': "const s = \"requireAppAccess(req, res, 'x')\";\nexport default function h() {}\n",
    'suffix-name.js': "function requireAppAccessXYZ() {}\nrequireAppAccessXYZ();\n",
    'real-call.js': "import { requireAppAccess } from '../../lib/utils/auth';\nexport default async function h(req, res) { return requireAppAccess(req, res, 'x'); }\n",
  };
  const apiDir = path.join(syntheticDir, 'api');
  fs.mkdirSync(apiDir, { recursive: true });
  for (const [name, body] of Object.entries(apiFixtures)) fs.writeFileSync(path.join(apiDir, name), body);
  const endpointCount = independentEndpointCountInFiles(walkJs(apiDir));
  if (endpointCount !== 1) throw new Error(`independent endpoint scanner synthetic expected 1, got ${endpointCount}`);

  const workbenchFixture = `
    const TABS = [
      { key: 'one', label: 'One' },
      { key: 'two', label: 'Two' },
      // { key: 'commented', label: 'Commented' },
      { key: 'three', label: 'Three' },
    ];
    if (activeTab === 'one') renderOne();
    if ('two' === activeTab) renderTwo();
    // if (activeTab === 'three') renderThree();
    if (activeTab === tab.key) renderDynamic();
  `;
  const workbenchCounts = independentWorkbenchCountsFromSource(workbenchFixture);
  if (workbenchCounts.total !== 3 || workbenchCounts.live !== 2 || workbenchCounts.placeholders !== 1) {
    throw new Error(`independent Workbench scanner synthetic mismatch: ${JSON.stringify(workbenchCounts)}`);
  }
}

function buildProseFixtures() {
  const apps = independentLiveAppCount();
  const eps = independentLiveEndpointCount();
  const workbench = independentLiveWorkbenchCounts();
  const wrongAppsA = apps + 1000;
  const wrongAppsB = apps + 1001;
  const wrongAppsC = apps + 1002;
  const wrongEpsA = eps + 1000;
  const wrongEpsB = eps + 1001;
  const wrongEpsC = eps + 1002;
  const wrongPlaceholderCount = workbench.placeholders + 1000;
  return [
    {
      name: 'known miss: web-based tools phrasing is flagged',
      file: 'pos_known_tools.md',
      body: 'This remains a suite of 13 web-based tools.',
      expectFlagged: true,
      token: '13',
    },
    {
      name: 'known miss: applications phrasing is flagged',
      file: 'pos_known_apps.md',
      body: 'Used by All 14 applications.',
      expectFlagged: true,
      token: '14',
    },
    {
      name: 'known miss: plus app endpoints phrasing is flagged',
      file: 'pos_known_plus_eps.md',
      body: 'Protected by 30+ app endpoints.',
      expectFlagged: true,
      token: '30',
    },
    {
      name: 'known miss: API endpoints phrasing is flagged',
      file: 'pos_known_api_eps.md',
      body: 'Protected by 30 API endpoints.',
      expectFlagged: true,
      token: '30',
    },
    {
      name: 'session tag alone does not exempt',
      file: 'pos_session_not_exempt.md',
      body: `Updated in S166: ${wrongAppsA} app definitions remain.`,
      expectFlagged: true,
      token: String(wrongAppsA),
    },
    {
      name: 'correct value is not flagged',
      file: 'neg_correct.md',
      body: `Registry has all ${apps} app definitions today and ${eps} app endpoints.`,
      expectFlagged: false,
      token: String(apps),
    },
    {
      name: 'correct structured marker exempts',
      file: 'neg_marker_correct.md',
      body: `Historically there were ${wrongAppsB} app definitions. <!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->`,
      expectFlagged: false,
      token: String(wrongAppsB),
    },
    {
      name: 'wrong fact id marker does not exempt',
      file: 'pos_marker_wrong_fact.md',
      body: `Historically there were ${wrongAppsC} app definitions. <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count as-of=2026-05-19 -->`,
      expectFlagged: true,
      token: String(wrongAppsC),
    },
    {
      name: 'missing required marker fields does not exempt',
      file: 'pos_marker_missing_required.md',
      body: `Historically there were ${wrongEpsA} API endpoints. <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count -->`,
      expectFlagged: true,
      token: String(wrongEpsA),
    },
    {
      name: 'session marker exempts when fact-bound',
      file: 'neg_marker_session.md',
      body: `Historically there were ${wrongEpsB} app endpoints. <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count session=S166 -->`,
      expectFlagged: false,
      token: String(wrongEpsB),
    },
    {
      name: 'reason marker exempts when fact-bound',
      file: 'neg_marker_reason.md',
      body: `Historically there were ${wrongEpsC} app endpoints. <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count reason=historical -->`,
      expectFlagged: false,
      token: String(wrongEpsC),
    },
    {
      name: 'two markers on one line exempt two distinct facts',
      file: 'neg_marker_multi.md',
      body: `S166 narrative: 13 web-based tools and 30 app endpoints. <!-- fact-consistency:ignore fact=app-definition-count session=S166 reason=historical --> <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count session=S166 reason=historical -->`,
      expectFlagged: false,
      token: '13',
    },
    {
      name: 'single marker on multi-fact line still leaves the unmarked fact flagged',
      file: 'pos_marker_one_of_two.md',
      body: `S166 narrative: 13 web-based tools and 30 app endpoints. <!-- fact-consistency:ignore fact=app-definition-count session=S166 reason=historical -->`,
      expectFlagged: true,
      token: '30',
    },
    {
      name: 'pointer-wrapped stale value is flagged (regression guard for the keep-number conversion)',
      file: 'pos_pointer_stale.md',
      body: `Live docs claim all [${wrongAppsA}](docs/CANONICAL_COUNTS.md#app-definition-count) app definitions exist.`,
      expectFlagged: true,
      token: String(wrongAppsA),
    },
    {
      name: 'pointer-wrapped correct value is not flagged',
      file: 'neg_pointer_correct.md',
      body: `Registry currently has all [${apps}](docs/CANONICAL_COUNTS.md#app-definition-count) app definitions.`,
      expectFlagged: false,
      token: String(apps),
    },
    {
      name: 'pointer with empty link is still unwrapped and flagged',
      file: 'pos_pointer_empty_link.md',
      body: `Stale claim: [${wrongEpsA}]() app endpoints remain.`,
      expectFlagged: true,
      token: String(wrongEpsA),
    },
    {
      name: 'bold-wrapped stale value is flagged',
      file: 'pos_bold_stale.md',
      body: `Stale claim: **${wrongAppsA}** app definitions remain.`,
      expectFlagged: true,
      token: String(wrongAppsA),
    },
    {
      name: 'bold-wrapped stale Workbench placeholder count is flagged',
      file: 'pos_bold_workbench_placeholder.md',
      body: `Stale claim: **${wrongPlaceholderCount}** remaining placeholder tabs.`,
      expectFlagged: true,
      token: String(wrongPlaceholderCount),
    },
    {
      name: 'code-wrapped stale value is flagged',
      file: 'pos_code_stale.md',
      body: `Stale claim: \`${wrongEpsA}\` app endpoints remain.`,
      expectFlagged: true,
      token: String(wrongEpsA),
    },
    {
      name: 'marker exemption applies to pointer-wrapped stale value',
      file: 'neg_pointer_marker.md',
      body: `Historically there were [${wrongAppsB}](docs/CANONICAL_COUNTS.md#app-definition-count) app definitions. <!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->`,
      expectFlagged: false,
      token: String(wrongAppsB),
    },
    {
      name: 'broadened pattern: stale "app pages" is flagged',
      file: 'pos_app_pages.md',
      body: `Wrapper on all ${wrongAppsA} app pages today.`,
      expectFlagged: true,
      token: String(wrongAppsA),
    },
    {
      name: 'broadened pattern: stale "in current registry" is flagged',
      file: 'pos_current_registry.md',
      body: `Across all apps (${wrongAppsB} in current registry) the log grows.`,
      expectFlagged: true,
      token: String(wrongAppsB),
    },
    {
      name: 'broadened pattern: stale "across all N apps" is flagged',
      file: 'pos_across_all_apps.md',
      body: `Progress tracking is handled identically across all ${wrongAppsC} apps.`,
      expectFlagged: true,
      token: String(wrongAppsC),
    },
    {
      name: 'broadened pattern: bare "N apps" (no across/all) is not flagged',
      file: 'neg_bare_apps.md',
      body: `Today there are ${wrongAppsA} apps in the queue.`,
      expectFlagged: false,
      token: String(wrongAppsA),
    },
  ];
}

function assertProseFixtures() {
  fs.mkdirSync(tempDir, { recursive: true });
  const fixtures = buildProseFixtures();
  for (const fx of fixtures) fs.writeFileSync(path.join(tempDir, fx.file), fx.body + '\n');
  const { output } = runGate();

  const failures = [];
  for (const fx of fixtures) {
    const flagged = output.includes(fx.file) && output.includes(fx.token);
    if (flagged !== fx.expectFlagged) failures.push({ fx, flagged });
  }
  if (failures.length > 0) {
    const details = failures.map(({ fx, flagged }) => {
      return `  - ${fx.name}: expected flagged=${fx.expectFlagged}, got ${flagged}; body=${fx.body}`;
    }).join('\n');
    throw new Error(`prose fixture failures:\n${details}\n\nGate output tail:\n${output.slice(-1200)}`);
  }
}

function assertProductionDerives() {
  const expectedApps = independentLiveAppCount();
  const expectedEps = independentLiveEndpointCount();
  const expectedWorkbench = independentLiveWorkbenchCounts();
  const { status, output } = runGate();
  if (status !== 0) throw new Error(`gate must be clean before derive cross-check:\n${output}`);
  const m = output.match(
    /app-definition-count=(\d+), requireappaccess-endpoint-count=(\d+), api-route-file-count=\d+, workbench-tab-count=(\d+), workbench-placeholder-tab-count=(\d+), workbench-live-tab-count=(\d+)/,
  );
  if (!m) throw new Error(`could not parse gate summary:\n${output}`);
  const gotApps = Number(m[1]);
  const gotEps = Number(m[2]);
  const gotWorkbench = {
    total: Number(m[3]),
    placeholders: Number(m[4]),
    live: Number(m[5]),
  };
  if (gotApps !== expectedApps) throw new Error(`app derive mismatch: gate=${gotApps}, independent=${expectedApps}`);
  if (gotEps !== expectedEps) throw new Error(`endpoint derive mismatch: gate=${gotEps}, independent=${expectedEps}`);
  if (
    gotWorkbench.total !== expectedWorkbench.total
    || gotWorkbench.live !== expectedWorkbench.live
    || gotWorkbench.placeholders !== expectedWorkbench.placeholders
  ) {
    throw new Error(
      `Workbench derive mismatch: gate=${JSON.stringify(gotWorkbench)}, independent=${JSON.stringify(expectedWorkbench)}`,
    );
  }
}

function main() {
  cleanup();
  assertSyntheticIndependentScanners();
  assertProseFixtures();
  cleanup();
  assertProductionDerives();
  console.log('fact-consistency self-test OK — prose fixtures and independent derive cross-check passed.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}

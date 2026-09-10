/**
 * Shared registry of bounded canonical scalar facts.
 *
 * Consumed by:
 *   - scripts/check-fact-consistency.js     (value-drift gate)
 *   - scripts/generate-canonical-counts.js  (regenerates docs/CANONICAL_COUNTS.md)
 *   - scripts/check-canonical-pointers.js   (pointer-rot gate)
 *
 * Each fact entry owns its derive (executes against live code), its prose-match
 * patterns (for the value-drift gate), and its derive-path description (rendered
 * into the canonical-counts doc). The derive functions are intentionally exported
 * so consumers cannot diverge from the single source of truth.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const repoRoot = path.resolve(__dirname, '..', '..');

function failConfig(message) {
  throw new Error(`canonical-facts configuration error: ${message}`);
}

function readText(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function parseJavaScript(rel, source) {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'dynamicImport', 'objectRestSpread', 'classProperties'],
      errorRecovery: false,
    });
  } catch (e) {
    failConfig(`could not parse ${rel}: ${e.message}`);
  }
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'loc' ||
      key === 'start' ||
      key === 'end' ||
      key === 'leadingComments' ||
      key === 'trailingComments' ||
      key === 'innerComments'
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function jsFilesUnder(rootRel) {
  const root = path.join(repoRoot, rootRel);
  const out = [];
  (function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walkDir(full);
      else if (/\.(cjs|mjs|js|jsx|ts|tsx)$/.test(ent.name)) out.push(full);
    }
  })(root);
  return out;
}

function deriveAppDefinitionCount() {
  const rel = 'shared/config/appRegistry.js';
  const ast = parseJavaScript(rel, readText(rel));
  let registryArray = null;

  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const decl = node.declaration;
    if (!decl || decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id && d.id.type === 'Identifier' && d.id.name === 'APP_REGISTRY') {
        registryArray = d.init;
      }
    }
  }

  if (!registryArray) failConfig('APP_REGISTRY export not found in shared/config/appRegistry.js');
  if (registryArray.type !== 'ArrayExpression') failConfig('APP_REGISTRY is not an array literal');
  if (registryArray.elements.length === 0) failConfig('APP_REGISTRY is empty');

  const keys = [];
  registryArray.elements.forEach((entry, index) => {
    if (!entry || entry.type !== 'ObjectExpression') {
      failConfig(`APP_REGISTRY entry ${index} is not an object literal`);
    }
    const keyProp = entry.properties.find((prop) => {
      if (!prop || prop.type !== 'ObjectProperty' || prop.computed) return false;
      return prop.key.type === 'Identifier' && prop.key.name === 'key';
    });
    if (!keyProp) failConfig(`APP_REGISTRY entry ${index} is missing key`);
    if (!keyProp.value || keyProp.value.type !== 'StringLiteral' || !keyProp.value.value) {
      failConfig(`APP_REGISTRY entry ${index} has a non-string/empty key`);
    }
    keys.push(keyProp.value.value);
  });

  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length > 0) failConfig(`APP_REGISTRY has duplicate keys: ${[...new Set(dupes)].join(', ')}`);

  return keys.length;
}

function requireAppAccessLocalNames(ast) {
  const names = new Set();
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) {
        if (
          spec.type === 'ImportSpecifier' &&
          spec.imported &&
          spec.imported.type === 'Identifier' &&
          spec.imported.name === 'requireAppAccess'
        ) {
          names.add(spec.local.name);
        }
      }
    }
    if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.type === 'ObjectPattern' &&
      node.init &&
      node.init.type === 'CallExpression' &&
      node.init.callee.type === 'Identifier' &&
      node.init.callee.name === 'require'
    ) {
      for (const prop of node.id.properties || []) {
        if (
          prop.type === 'ObjectProperty' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'requireAppAccess' &&
          prop.value.type === 'Identifier'
        ) {
          names.add(prop.value.name);
        }
      }
    }
  });
  return names;
}

function deriveApiRouteFileCount() {
  // Mirror scripts/check-api-route-security-matrix.js exactly so the two
  // gates agree on what counts as a "route file" — diverging here would
  // create two truths about the same scalar.
  const apiRoot = path.join(repoRoot, 'pages', 'api');
  const out = [];
  (function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walkDir(full);
      else if (ent.name.endsWith('.js')) out.push(full);
    }
  })(apiRoot);
  if (out.length === 0) failConfig('no route files found under pages/api');
  return out.length;
}

function deriveRequireAppAccessEndpointCount() {
  let count = 0;
  for (const full of jsFilesUnder('pages/api')) {
    const rel = path.relative(repoRoot, full);
    const source = fs.readFileSync(full, 'utf8');
    const ast = parseJavaScript(rel, source);
    const importedNames = requireAppAccessLocalNames(ast);
    let calls = 0;

    walk(ast, (node) => {
      if (
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'Identifier' &&
        (node.callee.name === 'requireAppAccess' || importedNames.has(node.callee.name))
      ) {
        calls += 1;
      }
    });

    if (importedNames.size > 0 && calls === 0) {
      failConfig(`${rel} imports requireAppAccess but has zero call sites`);
    }
    if (calls > 0) count += 1;
  }

  if (count === 0) failConfig('no pages/api files call requireAppAccess');
  return count;
}

function deriveWorkbenchTabState() {
  const rel = 'pages/workbench/[requestId].js';
  const ast = parseJavaScript(rel, readText(rel));
  let tabsArray = null;

  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      if (d.id?.type === 'Identifier' && d.id.name === 'TABS') tabsArray = d.init;
    }
  }

  if (!tabsArray) failConfig(`${rel} does not declare TABS`);
  if (tabsArray.type !== 'ArrayExpression') failConfig(`${rel} TABS is not an array literal`);

  const tabKeys = tabsArray.elements.map((entry, index) => {
    if (!entry || entry.type !== 'ObjectExpression') {
      failConfig(`${rel} TABS entry ${index} is not an object literal`);
    }
    const keyProp = entry.properties.find((prop) => (
      prop?.type === 'ObjectProperty'
      && !prop.computed
      && prop.key?.type === 'Identifier'
      && prop.key.name === 'key'
    ));
    if (!keyProp?.value || keyProp.value.type !== 'StringLiteral' || !keyProp.value.value) {
      failConfig(`${rel} TABS entry ${index} has a non-string/empty key`);
    }
    return keyProp.value.value;
  });

  const dupes = tabKeys.filter((key, index) => tabKeys.indexOf(key) !== index);
  if (dupes.length > 0) failConfig(`${rel} TABS has duplicate keys: ${[...new Set(dupes)].join(', ')}`);

  // A literal `activeTab === '<key>'` branch is the shell's implementation
  // dispatch contract. The nav's selected-state comparison is dynamic
  // (`activeTab === t.key`) and therefore cannot make a placeholder look live.
  const dispatchedKeys = new Set();
  walk(ast, (node) => {
    if (node.type !== 'BinaryExpression' || node.operator !== '===') return;
    const pairs = [
      [node.left, node.right],
      [node.right, node.left],
    ];
    for (const [identifier, literal] of pairs) {
      if (
        identifier?.type === 'Identifier'
        && identifier.name === 'activeTab'
        && literal?.type === 'StringLiteral'
        && tabKeys.includes(literal.value)
      ) {
        dispatchedKeys.add(literal.value);
      }
    }
  });

  if (dispatchedKeys.size === 0) failConfig(`${rel} has no literal activeTab dispatch branches`);
  const placeholderKeys = tabKeys.filter((key) => !dispatchedKeys.has(key));
  return {
    total: tabKeys.length,
    live: dispatchedKeys.size,
    placeholders: placeholderKeys.length,
  };
}

function matchFrom(regex) {
  return (line) => {
    regex.lastIndex = 0;
    const out = [];
    let m;
    while ((m = regex.exec(line)) !== null) {
      out.push({ raw: m[0], asserted: Number(m[1]), index: m.index });
    }
    return out;
  };
}

const CANONICAL_FACTS = [
  {
    id: 'app-definition-count',
    describe: 'APP_REGISTRY application definitions',
    derivePath: '`shared/config/appRegistry.js` → `APP_REGISTRY.length`',
    derive: deriveAppDefinitionCount,
    patterns: [
      {
        name: 'app definitions',
        find: matchFrom(/\b(\d+)\s+app definitions?\b/gi),
      },
      {
        name: 'applications',
        find: matchFrom(/\b(?:all\s+)?(\d+)\s+applications\b/gi),
      },
      {
        name: 'web-based tools',
        find: matchFrom(/\b(?:suite of\s+)?(\d+)\s+web-based tools?\b/gi),
      },
      {
        name: 'app pages',
        find: matchFrom(/\b(?:all\s+)?(\d+)\s+app pages\b/gi),
      },
      {
        name: 'in current registry',
        find: matchFrom(/\b(\d+)\s+in current registry\b/gi),
      },
      {
        name: 'apps',
        // Narrow "N apps" — REQUIRE "across" or "all" as a scope marker so
        // we catch suite-scope phrasings without flagging unrelated "N apps"
        // counts (e.g. "30 apps in queue"). S167 audit pass-2 surfaced
        // "across all 13 apps" and "across 17 apps" as the live forms.
        find: matchFrom(/\b(?:across\s+(?:all\s+)?|all\s+)(\d+)\s+apps\b/gi),
      },
    ],
    knownMissFixtures: [
      'suite of 13 web-based tools',
      'All 14 applications',
      'all 14 app pages',
      '16 in current registry',
      'across all 13 apps',
      'across 17 apps',
    ],
    knownNonMatches: [
      'J26 application cycle',
      '2026-05-19 application audit',
      '17 application materials were uploaded',
      'application status changed 14 times',
      // The narrow "apps" pattern should not match these unrelated counts.
      '30 apps in queue',
      '5 mobile apps reviewed',
      '14 desktop apps',
      // Adjective-modified "N <adj> apps" — number not adjacent to "apps".
      'all 14 mobile apps',
    ],
  },
  {
    id: 'requireappaccess-endpoint-count',
    describe: 'pages/api files with requireAppAccess() call sites',
    derivePath: '`pages/api/**/*.{js,mjs,cjs,jsx,ts,tsx}` → count of files containing at least one `requireAppAccess(...)` call',
    derive: deriveRequireAppAccessEndpointCount,
    patterns: [
      {
        name: 'app endpoints',
        find: matchFrom(/\b~?(\d+)\+?\s+app endpoints?\b/gi),
      },
      {
        name: 'app-specific API endpoints',
        find: matchFrom(/\b~?(\d+)\+?\s+app-specific API endpoints?\b/gi),
      },
      {
        name: 'API endpoints',
        find: matchFrom(/\b~?(\d+)\+?\s+API endpoints?\b/gi),
      },
    ],
    knownMissFixtures: [
      '30+ app endpoints',
      '30 API endpoints',
    ],
    knownNonMatches: [
      '30 endpoints',
      '30 reviewer endpoints',
      '2026-05-19 endpoint audit',
      'J30 app cycle',
    ],
  },
  {
    id: 'api-route-file-count',
    describe: 'pages/api route files (matches check:api-routes walker)',
    derivePath: '`pages/api/**/*.js` → count of route files (same predicate `scripts/check-api-route-security-matrix.js` uses)',
    derive: deriveApiRouteFileCount,
    // Patterns are intentionally narrow. A bare "N routes" pattern would
    // false-positive on unrelated counts in the repo ("3 routes" for a
    // feature slice, "100 routes" as a verb, "77 routes" historical in
    // the Atlas). The constrained phrasings below match the canonical
    // restatement forms ("route file(s)", "N-route catalogue", "API
    // routes") and nothing else. Codex review identified this; do not
    // re-broaden without re-grepping the repo.
    patterns: [
      {
        name: 'route file(s)',
        find: matchFrom(/\b~?(\d+)\s+route\s+files?\b/gi),
      },
      {
        name: 'route catalogue',
        find: matchFrom(/\b~?(\d+)[-\s]route catalogue\b/gi),
      },
      {
        name: 'API routes',
        find: matchFrom(/\b~?(\d+)\s+API\s+routes?\b/gi),
      },
    ],
    knownMissFixtures: [
      '84 route files',
      '~84 route files',
      '84-route catalogue',
      '84 API routes',
    ],
    knownNonMatches: [
      // These would have matched a bare "routes" pattern but must NOT
      // match the narrow set. Codex grep surfaced each one in live docs.
      '3 routes',
      '100 routes',
      '77 routes',
      '84 routes',
      'S184 route',
      'J84 route',
      '2026-05-19 route audit',
      '84 reviewer-route plans',
      '84 routing rules',
    ],
  },
  {
    id: 'workbench-tab-count',
    describe: 'Request Workbench top-level tabs',
    derivePath: '`pages/workbench/[requestId].js` → `TABS.length`',
    derive: () => deriveWorkbenchTabState().total,
    patterns: [
      {
        name: 'Workbench tabs',
        find: matchFrom(/\b(\d+)\s+(?:top-level\s+)?Workbench tabs?\b/gi),
      },
    ],
    knownMissFixtures: [
      '10 Workbench tabs',
      '10 top-level Workbench tabs',
    ],
    knownNonMatches: [
      '3 Workbench sub-tabs',
      '4 request-lifecycle tabs are still placeholders',
      '10 browser tabs',
      'S10 Workbench tab',
    ],
  },
  {
    id: 'workbench-placeholder-tab-count',
    describe: 'Request Workbench placeholder tabs',
    derivePath: '`pages/workbench/[requestId].js` → `TABS` keys without a literal `activeTab === <key>` implementation branch',
    derive: () => deriveWorkbenchTabState().placeholders,
    patterns: [
      {
        name: 'placeholder tabs',
        find: matchFrom(/\b(\d+)\s+(?:remaining\s+)?(?:request-lifecycle\s+|lifecycle\s+)?placeholder tabs?\b/gi),
      },
      {
        name: 'tabs remain placeholders',
        find: matchFrom(/\b(\d+)\s+(?:request-lifecycle\s+|lifecycle\s+)?tabs? (?:remain|are still) placeholders\b/gi),
      },
      {
        name: 'other tabs remain placeholders',
        find: matchFrom(/\b(?:the\s+)?other\s+(\d+)\s+(?:request-lifecycle\s+|lifecycle\s+)?tabs? remain placeholders\b/gi),
      },
    ],
    knownMissFixtures: [
      '4 placeholder tabs',
      '**4** remaining placeholder tabs',
      '4 remaining lifecycle placeholder tabs',
      '4 request-lifecycle tabs remain placeholders',
      '4 request-lifecycle tabs are still placeholders',
      'the other 4 tabs remain placeholders',
    ],
    knownNonMatches: [
      '4 tabs remain live',
      '4 placeholder rows',
      'S4 placeholder tab',
    ],
  },
  {
    id: 'workbench-live-tab-count',
    describe: 'implemented Request Workbench top-level tabs',
    derivePath: '`pages/workbench/[requestId].js` → distinct literal `activeTab === <TABS key>` implementation branches',
    derive: () => deriveWorkbenchTabState().live,
    patterns: [
      {
        name: 'live Workbench tabs',
        find: matchFrom(/\b(\d+)\s+live Workbench tabs?\b/gi),
      },
      {
        name: 'live tabs',
        find: matchFrom(/\b(\d+)\s+live tabs?\b/gi),
      },
    ],
    knownMissFixtures: [
      '6 live Workbench tabs',
      '6 live tabs',
    ],
    knownNonMatches: [
      '6 live routes',
      'S6 live tab',
      '6 tabs remain placeholders',
    ],
  },
];

module.exports = {
  repoRoot,
  CANONICAL_FACTS,
  failConfig,
};

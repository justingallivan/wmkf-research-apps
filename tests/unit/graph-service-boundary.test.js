/** @jest-environment node */

const path = require('path');
const {
  analyzeSources,
  loadTrackedRuntimeSources,
  sourceMapFromRoot,
} = require('../helpers/graph-service-boundary');

const FACADE = 'lib/services/graph-service.js';
const GRAPH = 'lib/services/graph';
const METHODS = [
  'getAccessToken', 'buildHeaders', 'getSiteId', 'getDriveId', 'listFiles',
  'getFileMetadataById', 'listFileVersions', 'getFileVersionMetadata',
  'restoreFileVersion', 'downloadFile', 'downloadFileVersion',
  'downloadFileAsPdf', 'downloadFileByPath', 'getFileMetadataByPath',
  'ensureFolderPath', 'searchFiles', 'uploadFile', 'uploadFileLarge',
  'replaceFileContent', 'deleteFile', 'clearCaches',
];
const STATE = [
  'tokenCache', 'tokenPromise', 'tokenGeneration', 'siteCache', 'driveCache',
  'searchCooldownUntil', 'searchCooldownStatus',
];
const options = { facade: FACADE, graphDir: GRAPH, inventory: { methods: METHODS, state: STATE } };
// Explicit real-source stage inventory. Keep this separate from the generic
// fixture options above so fixture ownership cannot silently bless the live
// migration. Each later stage updates only its named owner/delegate entries.
const REAL_SOURCE_OPTIONS = {
  facade: FACADE,
  graphDir: GRAPH,
  inventory: {
    methods: [
      ...METHODS,
      'isRetryableSearchStatus', 'parseRetryAfterMs', 'planSearchRetry', 'resetSearchCooldown',
    ],
    state: [
      ...STATE,
      'SEARCH_MAX_ATTEMPTS', 'SEARCH_BACKOFF_CAP_MS', 'SEARCH_MAX_RETRY_WAIT_MS',
    ],
  },
  movedOwners: {
    getAccessToken: `${GRAPH}/auth.js`,
    tokenCache: `${GRAPH}/auth.js`,
    tokenPromise: `${GRAPH}/auth.js`,
    tokenGeneration: `${GRAPH}/auth.js`,
    getSiteId: `${GRAPH}/resolution.js`,
    getDriveId: `${GRAPH}/resolution.js`,
    siteCache: `${GRAPH}/resolution.js`,
    driveCache: `${GRAPH}/resolution.js`,
    listFiles: `${GRAPH}/files.js`,
    getFileMetadataById: `${GRAPH}/files.js`,
    getFileMetadataByPath: `${GRAPH}/files.js`,
    MAX_VERSION_PAGES: `${GRAPH}/versions.js`,
    MIN_VERSION_PAGE_BUDGET_MS: `${GRAPH}/versions.js`,
    listFileVersions: `${GRAPH}/versions.js`,
    getFileVersionMetadata: `${GRAPH}/versions.js`,
    restoreFileVersion: `${GRAPH}/versions.js`,
    downloadFile: `${GRAPH}/downloads.js`,
    downloadFileVersion: `${GRAPH}/downloads.js`,
    downloadFileAsPdf: `${GRAPH}/downloads.js`,
    downloadFileByPath: `${GRAPH}/downloads.js`,
    searchFiles: `${GRAPH}/search.js`,
    searchCooldownUntil: `${GRAPH}/search.js`,
    searchCooldownStatus: `${GRAPH}/search.js`,
    isRetryableSearchStatus: `${GRAPH}/search.js`,
    parseRetryAfterMs: `${GRAPH}/search.js`,
    planSearchRetry: `${GRAPH}/search.js`,
    resetSearchCooldown: `${GRAPH}/search.js`,
    SEARCH_MAX_ATTEMPTS: `${GRAPH}/search.js`,
    SEARCH_BACKOFF_CAP_MS: `${GRAPH}/search.js`,
    SEARCH_MAX_RETRY_WAIT_MS: `${GRAPH}/search.js`,
  },
  delegates: {
    getAccessToken: { target: `${GRAPH}/auth.js`, binding: 'getAccessToken' },
    getSiteId: { target: `${GRAPH}/resolution.js`, binding: 'getSiteId' },
    getDriveId: { target: `${GRAPH}/resolution.js`, binding: 'getDriveId' },
    listFiles: { target: `${GRAPH}/files.js`, binding: 'listFiles' },
    getFileMetadataById: { target: `${GRAPH}/files.js`, binding: 'getFileMetadataById' },
    getFileMetadataByPath: { target: `${GRAPH}/files.js`, binding: 'getFileMetadataByPath' },
    listFileVersions: { target: `${GRAPH}/versions.js`, binding: 'listFileVersions' },
    getFileVersionMetadata: { target: `${GRAPH}/versions.js`, binding: 'getFileVersionMetadata' },
    restoreFileVersion: { target: `${GRAPH}/versions.js`, binding: 'restoreFileVersion' },
    downloadFile: { target: `${GRAPH}/downloads.js`, binding: 'downloadFile' },
    downloadFileVersion: { target: `${GRAPH}/downloads.js`, binding: 'downloadFileVersion' },
    downloadFileAsPdf: { target: `${GRAPH}/downloads.js`, binding: 'downloadFileAsPdf' },
    downloadFileByPath: { target: `${GRAPH}/downloads.js`, binding: 'downloadFileByPath' },
    searchFiles: { target: `${GRAPH}/search.js`, binding: 'searchFiles' },
  },
};

const relative = (from, to) => {
  const result = path.posix.relative(path.posix.dirname(from), to);
  return result.startsWith('.') ? result : `./${result}`;
};

function validSources() {
  const sources = new Map([
    [FACADE, `import { auth } from './graph/auth.js'; import './graph/constants.js'; export { path } from './graph/paths.js';
      export class GraphService { static getAccessToken() { return auth(this); } ${METHODS.slice(1).map(name => `static ${name}() {}`).join(' ')} }
      let tokenCache = null; let tokenPromise = null; let tokenGeneration = 0; let siteCache = null; let driveCache = new Map();
      let searchCooldownUntil = 0; let searchCooldownStatus = null;`],
    [`${GRAPH}/auth.js`, `import { fetchWithTimeout } from './http.js'; export function auth() { return fetchWithTimeout(); }`],
    [`${GRAPH}/constants.js`, 'export const API_TIMEOUT = 30000;'],
    [`${GRAPH}/paths.js`, 'export const path = () => null;'],
    [`${GRAPH}/http.js`, 'export function fetchWithTimeout() { return fetch(); }'],
  ]);
  return sources;
}

test('the unchanged monolith has one public owner for every staged method/state item', () => {
  const sources = sourceMapFromRoot(path.resolve(__dirname, '../..'));
  const result = analyzeSources(sources, REAL_SOURCE_OPTIONS);
  expect(result.errors).toEqual([]);
  expect(sources.has(FACADE)).toBe(true);
});

test('tracked runtime census has no direct imports of nonexistent Graph internals', () => {
  const sources = loadTrackedRuntimeSources(path.resolve(__dirname, '../..'));
  const result = analyzeSources(sources, REAL_SOURCE_OPTIONS);
  expect(result.errors).toEqual([]);
});

test('valid facade, leaf imports, side-effect import, and receiver-free operations pass', () => {
  expect(analyzeSources(validSources(), options).errors).toEqual([]);
});

test('moved function ownership and the explicit facade delegate are checked', () => {
  const sources = new Map([
    [FACADE, `import { getAccessToken } from './graph/auth.js'; export class GraphService { static async getAccessToken() { return getAccessToken(this); } }`],
    [`${GRAPH}/auth.js`, 'export async function getAccessToken() { return "token"; }'],
  ]);
  const result = analyzeSources(sources, {
    facade: FACADE,
    graphDir: GRAPH,
    inventory: { methods: ['getAccessToken'] },
    movedOwners: { getAccessToken: `${GRAPH}/auth.js` },
    delegates: { getAccessToken: `${GRAPH}/auth.js` },
  });
  expect(result.errors).toEqual([]);
});

test('a delegate must call the imported target binding, not merely any function', () => {
  const sources = new Map([
    [FACADE, `import { getAccessToken } from './graph/auth.js'; export class GraphService { static async getAccessToken() { return unrelated(this); } }`],
    [`${GRAPH}/auth.js`, 'export async function getAccessToken() { return "token"; }'],
  ]);
  const errors = analyzeSources(sources, {
    facade: FACADE,
    graphDir: GRAPH,
    inventory: { methods: ['getAccessToken'] },
    movedOwners: { getAccessToken: `${GRAPH}/auth.js` },
    delegates: { getAccessToken: `${GRAPH}/auth.js` },
  }).errors;
  expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('invalid facade delegate')]));
});

test('a delegate must be a single receiver-forwarding return, including for namespace imports', () => {
  const sources = new Map([
    [FACADE, `import * as auth from './graph/auth.js'; export class GraphService { static async getAccessToken() { return auth.getAccessToken(this); return 'wrong'; } }`],
    [`${GRAPH}/auth.js`, 'export async function getAccessToken() { return "token"; }'],
  ]);
  const errors = analyzeSources(sources, {
    facade: FACADE,
    graphDir: GRAPH,
    inventory: { methods: ['getAccessToken'] },
    movedOwners: { getAccessToken: `${GRAPH}/auth.js` },
    delegates: { getAccessToken: `${GRAPH}/auth.js` },
  }).errors;
  expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('invalid facade delegate')]));
});

test('namespace delegate with the matching method and receiver is accepted', () => {
  const sources = new Map([
    [FACADE, `import * as auth from './graph/auth.js'; export class GraphService { static async getAccessToken() { return auth.getAccessToken(this); } }`],
    [`${GRAPH}/auth.js`, 'export async function getAccessToken() { return "token"; }'],
  ]);
  expect(analyzeSources(sources, {
    facade: FACADE,
    graphDir: GRAPH,
    inventory: { methods: ['getAccessToken'] },
    movedOwners: { getAccessToken: `${GRAPH}/auth.js` },
    delegates: { getAccessToken: `${GRAPH}/auth.js` },
  }).errors).toEqual([]);
});

test('a helper reachable through the facade cannot hide an unresolved local edge', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/constants.js`, "import './missing'; export const API_TIMEOUT = 30000;");
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('unresolved local edge'),
  ]));
});

test('the HTTP leaf cannot import an operation or authentication owner', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/http.js`, `import '${relative(`${GRAPH}/http.js`, `${GRAPH}/auth.js`)}'; export function fetchWithTimeout() { return fetch(); }`);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('operation-to-operation dependency'),
  ]));
});

test('a moved operation without a declared owner or valid facade delegate fails', () => {
  const sources = new Map([
    [FACADE, `import './graph/auth.js'; export class GraphService { static getAccessToken() { return undefined; } }`],
    [`${GRAPH}/auth.js`, 'export const unrelated = 1;'],
  ]);
  const errors = analyzeSources(sources, {
    facade: FACADE,
    graphDir: GRAPH,
    inventory: { methods: ['getAccessToken'] },
    movedOwners: { getAccessToken: `${GRAPH}/auth.js` },
    delegates: { getAccessToken: `${GRAPH}/auth.js` },
  }).errors;
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('method owner getAccessToken'),
    expect.stringContaining('invalid facade delegate'),
  ]));
});

test('operation modules cannot import one another', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/other.js`, `import '${relative(`${GRAPH}/other.js`, `${GRAPH}/auth.js`)}';`);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('operation-to-operation dependency'),
  ]));
});

test.each([
  ['relative', `import './graph/auth.js';`],
  ['side-effect', `import './graph/constants.js';`],
  ['re-export', `export * from './graph/paths.js';`],
  ['require', `require('./graph/auth.js');`],
  ['dynamic import', `import('./graph/auth.js');`],
])('%s edge is classified for a Graph module', (_name, edge) => {
  const sources = validSources();
  sources.set('lib/services/consumer.js', edge);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('external runtime import of Graph internals'),
  ]));
});

test('external modules cannot import operation internals', () => {
  const sources = validSources();
  sources.set('lib/services/consumer.js', `import { auth } from '${relative('lib/services/consumer.js', `${GRAPH}/auth.js`)}'; export { auth };`);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('external runtime import of Graph internals'),
  ]));
});

test('unresolved local, extensionless, and configured alias edges fail closed', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/other.js`, "import './missing'; import '@/lib/services/also-missing';");
  sources.set(FACADE, `${sources.get(FACADE)}\nimport './graph/other.js';`);
  const errors = analyzeSources(sources, options).errors;
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('unresolved local edge'),
  ]));
});

test('nonliteral dependency in a new Graph module fails closed', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/other.js`, 'export async function load(target) { return import(target); }');
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('nonliteral dependency'),
  ]));
});

test('duplicate state, receiver access, and direct fetch outside http are rejected', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/other.js`, 'let tokenCache = null; export function run() { return this.x + fetch("/x"); }');
  const errors = analyzeSources(sources, options).errors;
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('state owner tokenCache'),
    expect.stringContaining('receiver access in Graph module'),
    expect.stringContaining('raw fetch outside graph http owner'),
  ]));
});

test('the real search inventory rejects duplicate retry helpers and cooldown constants', () => {
  const sources = sourceMapFromRoot(path.resolve(__dirname, '../..'));
  expect(analyzeSources(sources, REAL_SOURCE_OPTIONS).errors).toEqual([]);
  const mutatedSources = new Map(sources);
  mutatedSources.set(FACADE, `${sources.get(FACADE)}
    function isRetryableSearchStatus() {} function parseRetryAfterMs() {}
    function planSearchRetry() {}
    const SEARCH_MAX_ATTEMPTS = 3; const SEARCH_BACKOFF_CAP_MS = 5000; const SEARCH_MAX_RETRY_WAIT_MS = 10000;`);
  const errors = analyzeSources(mutatedSources, REAL_SOURCE_OPTIONS).errors;
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('method owner isRetryableSearchStatus: expected one owner'),
    expect.stringContaining('state owner SEARCH_MAX_ATTEMPTS: expected one owner'),
  ]));
});

test('indirect helper cycle through Graph modules is reported', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/other.js`, `import '${relative(`${GRAPH}/other.js`, `${GRAPH}/helper.js`)}';`);
  sources.set(`${GRAPH}/helper.js`, `import '${relative(`${GRAPH}/helper.js`, `${GRAPH}/other.js`)}';`);
  sources.set(FACADE, `${sources.get(FACADE)}\nimport './graph/other.js';`);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('Graph dependency cycle'),
  ]));
});

test('facade-to-internal cycle is reported', () => {
  const sources = validSources();
  sources.set(`${GRAPH}/auth.js`, `import '${relative(`${GRAPH}/auth.js`, FACADE)}'; export function auth() {}`);
  expect(analyzeSources(sources, options).errors).toEqual(expect.arrayContaining([
    expect.stringContaining('internal facade dependency'),
  ]));
});

test('the analyzer returns the source map and edge graph for the receipt', () => {
  const result = analyzeSources(validSources(), options);
  expect(result.graph.get(FACADE).map(edge => edge.target)).toEqual(expect.arrayContaining([
    `${GRAPH}/auth.js`, `${GRAPH}/constants.js`, `${GRAPH}/paths.js`,
  ]));
});

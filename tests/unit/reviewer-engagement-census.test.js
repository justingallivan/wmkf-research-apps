/** @jest-environment node */

/**
 * Caller-boundary census for reviewer-engagement command extraction
 * (Stage 3 build plan). Each row records a legacy `lib/services/review-manager/`
 * module that has been (or is being) split into `lib/services/reviewer-engagement/`,
 * and the exact, recorded set of files outside the extracted module itself that
 * still import the legacy path. A new direct caller of the legacy path must be
 * recorded here deliberately — this test fails if one appears unrecorded, and
 * fails if the regex that finds callers stops matching anything (never passes
 * vacuously).
 *
 * Extend CENSUS with one row per slice as more commands move.
 *
 * Scanning is done by the shared `tests/helpers/import-census.js` helper
 * (also exercised directly by the adversarial fixture test below), which
 * detects static import / export-from / require() / dynamic import() of a
 * literal module specifier across .js .mjs .cjs .jsx .ts .tsx files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_EXTENSIONS,
  readSourceFiles,
  findImporters,
} = require('../helpers/import-census');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'scripts'];

const CENSUS = [
  {
    name: 'review-manager/close-review-service',
    // Matches static import, export-from, require(), and dynamic import()
    // of any specifier containing this fragment.
    pattern: /close-review-service/,
    expected: [
      'pages/api/review-manager/close-review.js',
    ],
  },
];

// Hoisted: every production file under SCAN_DIRS is read exactly once, up
// front, and every CENSUS row scans this same in-memory set.
const PRODUCTION_FILES = readSourceFiles(
  SCAN_DIRS.map((dir) => path.join(ROOT, dir)),
  { relativeTo: ROOT },
);

describe('reviewer-engagement caller-boundary census', () => {
  it('read at least one production file (scan roots resolved)', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0);
  });

  it.each(CENSUS)('$name callers match the recorded list exactly', ({ pattern, expected }) => {
    const matched = findImporters(PRODUCTION_FILES, pattern);
    // Non-vacuity: if the regex stops matching anything, fail loudly rather
    // than silently passing an empty comparison.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched).toEqual([...expected].sort());
  });
});

describe('import-census scanner: adversarial fixture', () => {
  const FRAGMENT = 'target-module';
  const PATTERN = new RegExp(FRAGMENT);
  let scratchDir;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-census-fixture-'));

    const write = (relPath, content) => {
      const full = path.join(scratchDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    };

    write('static-default-import.js', `import target from './target-module';\nexport default target;\n`);
    write('named-import.js', `import { thing } from './target-module.js';\nexport { thing };\n`);
    write('export-from.js', `export { thing } from './target-module.js';\n`);
    write('require-call.js', `const thing = require('./target-module');\nmodule.exports = thing;\n`);
    write('dynamic-import.js', `export async function load() {\n  return import('./target-module.js');\n}\n`);
    write('commonjs-file.cjs', `const thing = require('./target-module.js');\nmodule.exports = thing;\n`);
    write('typed-component.tsx', `import target from './target-module';\nexport default function C() { return target; }\n`);
    write('non-literal-require.js', `const modName = './target-module';\nconst thing = require(modName);\nmodule.exports = thing;\n`);
    write('unrelated.js', `import other from './something-else';\nexport default other;\n`);
  });

  afterAll(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('detects every literal-specifier import form and misses the non-literal require', () => {
    const files = readSourceFiles([scratchDir], { extensions: DEFAULT_EXTENSIONS, relativeTo: scratchDir });
    const matched = findImporters(files, PATTERN);

    const expectedDetected = [
      'commonjs-file.cjs',
      'dynamic-import.js',
      'export-from.js',
      'named-import.js',
      'require-call.js',
      'static-default-import.js',
      'typed-component.tsx',
    ].sort();

    expect(matched).toEqual(expectedDetected);

    // Documented limit: a `require(variable)` call with a non-literal
    // specifier is invisible to this regex-based scanner. It is not in the
    // detected list, and callers relying on that form must not assume the
    // census will catch them.
    expect(matched).not.toContain('non-literal-require.js');
    expect(matched).not.toContain('unrelated.js');
  });
});

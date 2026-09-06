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
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'scripts'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.next']);
const FILE_EXTENSION_RE = /\.(js|mjs)$/;

const CENSUS = [
  {
    name: 'review-manager/close-review-service',
    // Matches `from '...close-review-service'` and `require('...close-review-service')`,
    // regardless of relative-path prefix or quote style.
    pattern: /close-review-service/,
    expected: [
      'pages/api/review-manager/close-review.js',
    ],
  },
];

function collectSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (FILE_EXTENSION_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

function allSourceFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) collectSourceFiles(abs, files);
  }
  return files;
}

function findImporters(pattern) {
  const importRegex = new RegExp(
    `from\\s+['"][^'"]*${pattern.source}[^'"]*['"]|require\\(\\s*['"][^'"]*${pattern.source}[^'"]*['"]\\s*\\)`,
  );
  const matched = [];
  for (const file of allSourceFiles()) {
    const content = fs.readFileSync(file, 'utf8');
    if (importRegex.test(content)) {
      matched.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
  }
  return matched.sort();
}

describe('reviewer-engagement caller-boundary census', () => {
  it.each(CENSUS)('$name callers match the recorded list exactly', ({ pattern, expected }) => {
    const matched = findImporters(pattern);
    // Non-vacuity: if the regex stops matching anything, fail loudly rather
    // than silently passing an empty comparison.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched).toEqual([...expected].sort());
  });
});

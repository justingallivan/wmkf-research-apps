/** @jest-environment node */

/**
 * Caller-boundary census for reviewer-engagement command extraction
 * (Stage 3 build plan). Each row records either a legacy `lib/services/`
 * module path (one that has been, or is being, split into
 * `lib/services/reviewer-engagement/`) or one of the new `reviewer-engagement/`
 * module paths itself, and the exact, recorded set of files outside the
 * extracted module that import that path. A new direct importer must be
 * recorded here deliberately — this test fails if one appears unrecorded, and
 * fails if the regex that finds importers stops matching anything (never
 * passes vacuously).
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
  {
    name: 'review-manager/terminal-transition-service',
    // Matches static import, export-from, require(), and dynamic import()
    // of any specifier containing this fragment.
    pattern: /terminal-transition-service/,
    expected: [
      'pages/api/review-manager/terminal-transition.js',
    ],
  },
  {
    name: 'review-manager/reviewers-service',
    // Stage 3C is a PARTIAL-file extraction: only `patchReviewers` and
    // `ReviewerStatusMutationError` moved to `reviewer-engagement/correct-status.js`;
    // `getReviewers` and its projections stay here, so this legacy path keeps
    // legitimate direct importers (unlike the full-file 3A/3B moves above).
    // A negative lookbehind on the leading hyphen excludes the unrelated
    // `workbench/applicant-reviewers-service` module, whose specifier also
    // contains the bare substring "reviewers-service".
    pattern: /(?<!-)reviewers-service/,
    expected: [
      'lib/services/review-manager/export-reviews-service.js',
      'pages/api/review-manager/reviewers.js',
    ],
  },
  {
    name: 'reviewer-finder/my-candidates-service',
    // Stage 3D is a PARTIAL-file extraction: only the approved response-only
    // correction path (`correctResponse`) moved to
    // `reviewer-engagement/correct-response.js`; bulk-by-request, restore,
    // manual-invite-sent recording, and person/researcher edits stay here,
    // so this legacy path keeps its one legitimate direct importer.
    pattern: /my-candidates-service/,
    expected: [
      'pages/api/reviewer-finder/my-candidates.js',
    ],
  },
  {
    name: 'reviewer-engagement/correct-response',
    // The wrapper (`my-candidates-service.js`) is the sole importer of the
    // new path — the route's import of the old path is unchanged.
    pattern: /reviewer-engagement\/correct-response/,
    expected: [
      'lib/services/reviewer-finder/my-candidates-service.js',
    ],
  },
  {
    name: 'reviewer-suggestion-sweep',
    // Stage 3E extracted the sweep's per-row expire body internally
    // (to reviewer-engagement/expire-invitation.js); the sweep module
    // itself is unmoved and keeps its sole exported sweepStaleInvites, so
    // this row records the module's own callers, not a migration boundary.
    pattern: /reviewer-suggestion-sweep/,
    expected: [
      'pages/api/cron/sweep-stale-invites.js',
    ],
  },
  {
    name: 'reviewer-engagement/record-email-outcome',
    // New in Stage 3E (recordDeliveredEmail, extracted from
    // send-emails-service.js). Not re-exported from the old module — no
    // other production caller needed it.
    pattern: /reviewer-engagement\/record-email-outcome/,
    expected: [
      'lib/services/review-manager/send-emails-service.js',
    ],
  },
  {
    name: 'reviewer-engagement/expire-invitation',
    // New in Stage 3E (expireInvitation, extracted from
    // reviewer-suggestion-sweep.js). Only the sweep imports it (isPastCutoff
    // moved to lib/utils/past-cutoff.js 2026-09-06).
    pattern: /reviewer-engagement\/expire-invitation/,
    expected: [
      'lib/services/reviewer-suggestion-sweep.js',
    ],
  },
  {
    name: 'reviewer-engagement/claim-reminder',
    // Stage 3G: only the review-due (`kind !== 'respond'`) fire-once claim
    // moved. The sweep is the sole importer — the respond-kind claim stays
    // coupled to `mintAndStore` in the sweep, not this module.
    pattern: /reviewer-engagement\/claim-reminder/,
    expected: [
      'lib/services/reviewer-reminder-sweep.js',
    ],
  },
  {
    name: 'reviewer-engagement/change-review-deadline',
    // Stage 3H extracted only the deadline-override write itself; eligibility,
    // exact-date validation, the `_etag` presence check, `prepareNotification`
    // and the notification envelope stay in `reviewer-due-extension.js`, which
    // is the sole importer of the new command.
    pattern: /reviewer-engagement\/change-review-deadline/,
    expected: [
      'lib/services/reviewer-due-extension.js',
    ],
  },
  {
    name: 'reviewer-engagement/withdraw-pending-invitation',
    // Stage 3I: the caller (`withdraw-sufficient-service.js`) is the sole
    // importer of the new path.
    pattern: /reviewer-engagement\/withdraw-pending-invitation/,
    expected: [
      'lib/services/review-manager/withdraw-sufficient-service.js',
    ],
  },
  {
    name: 'reviewer-engagement/record-invitation',
    // New in Stage 3F (recordDeliveredInvitation, recordManualInvitation —
    // separately exported functions, each a verbatim move of exactly one
    // write call from its own caller). The third 3F importer,
    // generate-emails-service.js (markInvitationGenerated), was retired with
    // its route 2026-09-06 under owner decision D2.
    pattern: /reviewer-engagement\/record-invitation/,
    expected: [
      'lib/services/review-manager/send-emails-service.js',
      'lib/services/reviewer-finder/my-candidates-service.js',
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
    write('commented-static-import.js', `import target from /* eslint-disable-next-line */ './target-module';\nexport default target;\n`);
    write('commented-require.js', `const thing = require(/* c */ './target-module');\nmodule.exports = thing;\n`);
    write('commented-dynamic-import.js', `export async function load() {\n  return import(/* webpackChunkName: "x" */ './target-module.js');\n}\n`);
  });

  afterAll(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('detects every literal-specifier import form and misses the non-literal require', () => {
    const files = readSourceFiles([scratchDir], { extensions: DEFAULT_EXTENSIONS, relativeTo: scratchDir });
    const matched = findImporters(files, PATTERN);

    const expectedDetected = [
      'commented-dynamic-import.js',
      'commented-require.js',
      'commented-static-import.js',
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

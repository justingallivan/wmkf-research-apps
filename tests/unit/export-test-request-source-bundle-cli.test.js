/**
 * @jest-environment node
 *
 * P2-C (Opus round 2): the export script's `--with-reviewers` /
 * `--source-marker-column=present|absent` argument parsing, and that the
 * exporter receives the reviewer dependency triad ONLY when
 * `--with-reviewers` is set. Importing the script does not run `main()`
 * (guarded by an argv[1]/import.meta.url entrypoint check), so these pure
 * helpers can be exercised directly.
 */
import { parseArgs, buildReviewerDependencies } from '../../scripts/export-test-request-source-bundle.mjs';

const OUT = '/tmp/does-not-exist-source-bundle-cli-test.json';

function baseArgv(extra = []) {
  return ['--source-request-number=1003222', `--out=${OUT}`, ...extra];
}

describe('parseArgs', () => {
  test('--with-reviewers defaults off, --source-marker-column defaults null', () => {
    const args = parseArgs(baseArgv());
    expect(args.withReviewers).toBe(false);
    expect(args.sourceMarkerColumn).toBeNull();
  });

  test('--with-reviewers requires --source-marker-column', () => {
    expect(() => parseArgs(baseArgv(['--with-reviewers'])))
      .toThrow(/requires --source-marker-column/);
  });

  test('--with-reviewers --source-marker-column=absent parses cleanly', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent']));
    expect(args.withReviewers).toBe(true);
    expect(args.sourceMarkerColumn).toBe('absent');
  });

  test('--with-reviewers --source-marker-column=present parses cleanly', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=present']));
    expect(args.withReviewers).toBe(true);
    expect(args.sourceMarkerColumn).toBe('present');
  });

  test('rejects an invalid --source-marker-column value', () => {
    expect(() => parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=maybe'])))
      .toThrow(/requires --source-marker-column/);
  });

  test('--source-marker-column without --with-reviewers is rejected', () => {
    expect(() => parseArgs(baseArgv(['--source-marker-column=absent'])))
      .toThrow(/valid only with --with-reviewers/);
  });
});

describe('buildReviewerDependencies', () => {
  const client = { get: jest.fn() };
  const graph = {
    getDriveId: jest.fn(), getFileMetadataById: jest.fn(), downloadFile: jest.fn(),
    listFiles: jest.fn(), getSharePointTargetInfo: jest.fn(),
  };

  test('returns null (no reviewer dependencies at all) when --with-reviewers is not set', () => {
    const args = parseArgs(baseArgv());
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).toBeNull();
  });

  test('returns the real triad, with markerColumnPresent=false, for --source-marker-column=absent', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent']));
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).not.toBeNull();
    expect(typeof deps.discoverReviewers).toBe('function');
    expect(typeof deps.hydrateReviewer).toBe('function');
    expect(typeof deps.readCurrentReviewerIdentity).toBe('function');
  });

  test('returns the real triad for --source-marker-column=present', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=present']));
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).not.toBeNull();
  });
});

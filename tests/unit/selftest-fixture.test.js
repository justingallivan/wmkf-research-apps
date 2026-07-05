/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  registerTmpFixture,
  registerRepoFixture,
} = require('../../scripts/lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..', '..');

describe('registerTmpFixture', () => {
  test('creates a dir under os.tmpdir() and cleanup() removes it; cleanup is idempotent', () => {
    const { dir, cleanup } = registerTmpFixture('selftest-fixture-unit-');
    expect(dir.startsWith(fs.realpathSync(os.tmpdir())) || dir.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    cleanup();
    expect(fs.existsSync(dir)).toBe(false);
    expect(() => cleanup()).not.toThrow(); // idempotent (existsSync-guarded rmSync)
  });
});

describe('registerRepoFixture', () => {
  const relDir = 'tests/unit/__selftest_fixture_unit_tmp';
  const absDir = path.join(repoRoot, relDir);

  afterEach(() => {
    fs.rmSync(absDir, { recursive: true, force: true });
  });

  test('self-heals a pre-existing orphan on entry, creates the dir, disposer removes it', () => {
    fs.mkdirSync(absDir, { recursive: true });
    const orphan = path.join(absDir, 'orphan.txt');
    fs.writeFileSync(orphan, 'stale');
    const { paths, cleanup } = registerRepoFixture(relDir);
    expect(paths).toEqual([absDir]);
    expect(fs.existsSync(absDir)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false); // entry cleanup removed the orphan
    cleanup();
    expect(fs.existsSync(absDir)).toBe(false);
    expect(() => cleanup()).not.toThrow(); // idempotent double-call
  });

  test('array form handles multiple dirs plus a plain file', () => {
    const relDir2 = 'tests/unit/__selftest_fixture_unit_tmp2';
    const relFile = 'tests/unit/__selftest_fixture_unit_tmp_file.json';
    const absDir2 = path.join(repoRoot, relDir2);
    const absFile = path.join(repoRoot, relFile);
    try {
      const { paths, cleanup } = registerRepoFixture([relDir, relDir2, relFile], {
        filePaths: [relFile],
      });
      expect(paths).toEqual([absDir, absDir2, absFile]);
      expect(fs.existsSync(absDir)).toBe(true);
      expect(fs.existsSync(absDir2)).toBe(true);
      expect(fs.existsSync(absFile)).toBe(false); // file path: cleaned/disposed, not created
      fs.writeFileSync(absFile, '{}');
      cleanup();
      expect(fs.existsSync(absDir)).toBe(false);
      expect(fs.existsSync(absDir2)).toBe(false);
      expect(fs.existsSync(absFile)).toBe(false);
    } finally {
      fs.rmSync(absDir2, { recursive: true, force: true });
      fs.rmSync(absFile, { force: true });
    }
  });

  test('exit handler fires on normal exit and does not disturb an already-disposed fixture', () => {
    // Run in a child process so process exit handlers actually fire.
    const relA = 'tests/unit/__selftest_fixture_exit_tmp_a';
    const relB = 'tests/unit/__selftest_fixture_exit_tmp_b';
    const absA = path.join(repoRoot, relA);
    const absB = path.join(repoRoot, relB);
    try {
      const script = `
        const { registerRepoFixture } = require(${JSON.stringify(
          path.join(repoRoot, 'scripts/lib/selftest-fixture.js')
        )});
        const a = registerRepoFixture(${JSON.stringify(relA)}); // left for exit handler
        const b = registerRepoFixture(${JSON.stringify(relB)});
        b.cleanup(); // disposed in-body; exit handler must tolerate it
      `;
      execFileSync(process.execPath, ['-e', script], { cwd: repoRoot });
      expect(fs.existsSync(absA)).toBe(false); // removed by exit handler
      expect(fs.existsSync(absB)).toBe(false);
    } finally {
      fs.rmSync(absA, { recursive: true, force: true });
      fs.rmSync(absB, { recursive: true, force: true });
    }
  });
});

/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { walkTree } = require('../../scripts/lib/walk-files');

describe('walkTree', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-files-unit-'));
    // Synthetic tree:
    //   a.md
    //   b.txt
    //   sub/c.md
    //   sub/deeper/d.md
    //   excluded/e.md
    fs.writeFileSync(path.join(repoRoot, 'a.md'), 'a');
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'b');
    fs.mkdirSync(path.join(repoRoot, 'sub', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'sub', 'c.md'), 'c');
    fs.writeFileSync(path.join(repoRoot, 'sub', 'deeper', 'd.md'), 'd');
    fs.mkdirSync(path.join(repoRoot, 'excluded'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'excluded', 'e.md'), 'e');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function handRolled(root, { shouldExcludeRel }) {
    const out = [];
    (function walkDir(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(repoRoot, full);
        if (ent.isDirectory()) {
          if (!shouldExcludeRel(rel)) walkDir(full);
        } else {
          out.push(full);
        }
      }
    })(root);
    return out;
  }

  test('yields the same files in the same order as a hand-rolled readdirSync recurse', () => {
    const shouldExcludeRel = () => false;
    const expected = handRolled(repoRoot, { shouldExcludeRel });
    const actual = [];
    walkTree(repoRoot, { repoRoot, shouldExcludeRel, onFile: (f) => actual.push(f) });
    expect(actual).toEqual(expected); // exact order, not just set equality
    expect(actual.length).toBe(5);
  });

  test('honors shouldExcludeRel on directories (excluded subtree never walked)', () => {
    const shouldExcludeRel = (rel) => /^excluded(\/|$)/.test(rel);
    const seenRelDirs = [];
    const actual = [];
    walkTree(repoRoot, {
      repoRoot,
      shouldExcludeRel: (rel) => {
        seenRelDirs.push(rel);
        return shouldExcludeRel(rel);
      },
      onFile: (f) => actual.push(path.relative(repoRoot, f)),
    });
    expect(actual).not.toContain(path.join('excluded', 'e.md'));
    expect(actual).toEqual(expect.arrayContaining(['a.md', 'b.txt', path.join('sub', 'c.md'), path.join('sub', 'deeper', 'd.md')]));
    expect(actual.length).toBe(4);
    // predicate is consulted with repo-relative dir paths only
    expect(seenRelDirs).toEqual(expect.arrayContaining(['sub', path.join('sub', 'deeper'), 'excluded']));
  });

  test('calls onFile on every non-directory entry (no ext filtering of its own)', () => {
    const actual = [];
    walkTree(repoRoot, {
      repoRoot,
      shouldExcludeRel: () => false,
      onFile: (f) => actual.push(path.basename(f)),
    });
    expect(actual.sort()).toEqual(['a.md', 'b.txt', 'c.md', 'd.md', 'e.md']);
  });
});

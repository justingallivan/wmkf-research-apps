const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeStore, parseFrontmatter } = require('../../scripts/check-memory-health.js');

function memory({ name, modified, lastVerified, verifiedLabel = '[VERIFIED via probe, 2026-08-21]' }) {
  const metadata = [
    '  type: project',
    '  status: active',
    modified === undefined ? null : `  modified: ${modified}`,
    lastVerified === undefined ? null : `  last_verified: ${lastVerified}`,
  ].filter(Boolean).join('\n');
  return `---\nname: ${name}\nmetadata:\n${metadata}\n---\n\n## Recall Rule\nRead when testing memory health.\n\nDataverse rows ${verifiedLabel}\n`;
}

describe('check-memory-health weak-basis evidence', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-health-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function analyze(files) {
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Router\n');
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return analyzeStore(dir);
  }

  test('accepts a parseable modified timestamp paired with dated VERIFIED evidence', () => {
    const result = analyze({
      'grounded.md': memory({ name: 'grounded', modified: '2026-08-21T20:45:00.000Z' }),
    });

    expect(result.counts['weak-basis']).toBe(0);
  });

  test.each([
    ['missing modified timestamp', { modified: undefined }],
    ['malformed modified timestamp', { modified: 'not-a-date' }],
    ['undated VERIFIED evidence', { modified: '2026-08-21T20:45:00.000Z', verifiedLabel: '[VERIFIED via probe]' }],
    ['date outside VERIFIED brackets', { modified: '2026-08-21T20:45:00.000Z', verifiedLabel: '[VERIFIED via probe] checked 2026-08-21' }],
  ])('keeps weak-basis for %s', (_label, fields) => {
    const result = analyze({ 'weak.md': memory({ name: 'weak', ...fields }) });

    expect(result.findings).toEqual([
      expect.objectContaining({ file: 'weak.md', flags: expect.arrayContaining(['weak-basis']) }),
    ]);
  });

  test('explicitly weak last_verified text overrides alternative modified evidence', () => {
    const result = analyze({
      'explicitly-weak.md': memory({
        name: 'explicitly-weak',
        modified: '2026-08-21T20:45:00.000Z',
        lastVerified: 'unknown — not re-probed',
      }),
    });

    expect(result.counts['weak-basis']).toBe(1);
  });

  test('parseFrontmatter reads nested modified and last_verified fields', () => {
    expect(parseFrontmatter(memory({
      name: 'parsed',
      modified: '2026-08-21T20:45:00.000Z',
      lastVerified: '2026-08-20',
    }))).toMatchObject({
      status: 'active',
      modified: '2026-08-21T20:45:00.000Z',
      lastVerified: '2026-08-20',
    });
  });
});

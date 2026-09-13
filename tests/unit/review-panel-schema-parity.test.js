import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/047_review_panel.sql'), 'utf8');
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

function normalize(statement) {
  return statement.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every top-level `;`-terminated statement in the .sql migration file, comments stripped, respecting `;` inside single-quoted string literals (e.g. the COMMENT ON COLUMN text). */
function migrationStatements(sql) {
  const stripped = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const statements = [];
  let current = '';
  let inString = false;
  for (const ch of stripped) {
    if (ch === "'") inString = !inString;
    if (ch === ';' && !inString) {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}

/** Every backtick-delimited template string inside the `const v49Statements = [ ... ];` array in setup-database.js. */
function v49Statements(source) {
  const start = source.indexOf('const v49Statements = [');
  if (start === -1) throw new Error('v49Statements block not found in setup-database.js');
  const end = source.indexOf('\n];', start);
  const block = source.slice(start, end);
  return [...block.matchAll(/`([^`]*)`/gs)].map((m) => m[1]);
}

test('every statement in migration 047 has a normalised match in the v49 block, and vice versa (a dropped column or constraint fails this)', () => {
  const migrationNormalized = migrationStatements(migration).map(normalize).sort();
  const v49Normalized = v49Statements(setup).map(normalize).sort();
  expect(v49Normalized).toEqual(migrationNormalized);
});

test('the migrations manifest tracks 047', () => {
  expect(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8')).toContain('047_review_panel.sql');
});

/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalizeDefinition,
  compareLedgerFingerprint,
  formatLedgerDiff,
  listLedgerMigrationFiles,
  readApprovedAhead,
  readExpectedFingerprint,
  unapprovedExtras,
} from '../../lib/db/ledger-schema';

const col = (name, type, nullable, def = null) => ({ name, type, nullable, default: def });
const cons = (name, type, definition) => ({ name, type, definition });
const idx = (name, definition, unique = false, primary = false) => ({ name, unique, primary, definition });
const trg = (name, definition) => ({ name, definition });
const fn = (signature, { returnType = 'void', language = 'sql', volatile = 'i', bodyHash = 'a'.repeat(64) } = {}) => (
  { signature, returnType, language, volatile, bodyHash }
);

const base = () => ({
  tables: {
    test_request_runs: {
      relkind: 'r',
      relpersistence: 'p',
      rowSecurity: { enabled: false, forced: false },
      columns: [col('run_id', 'uuid', false), col('status', 'text', false, "'pending'::text")],
      constraints: [cons('test_request_runs_pkey', 'p', 'PRIMARY KEY (run_id)'), cons('test_request_runs_status_check', 'c', "CHECK (status = ANY (ARRAY['pending', 'done']))")],
      indexes: [idx('test_request_runs_pkey', 'CREATE UNIQUE INDEX ... USING btree (run_id)', true, true), idx('test_request_runs_status_idx', 'CREATE INDEX ... USING btree (status)')],
      triggers: [trg('test_request_runs_touch', 'CREATE TRIGGER test_request_runs_touch ...')],
    },
  },
  functions: [fn('test_request_receipt_ok(receipt jsonb)')],
});

test('identical fingerprints compare clean', () => {
  const d = compareLedgerFingerprint(base(), base());
  expect(d).toEqual({ missing: [], differing: [], extra: [], ok: true });
});

test('a ledger behind the checkout fails on every missing object kind', () => {
  const live = base();
  live.tables.test_request_runs.columns.pop();
  live.tables.test_request_runs.constraints.pop();
  live.tables.test_request_runs.indexes.pop();
  live.tables.test_request_runs.triggers = [];
  live.functions = [];
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.missing).toEqual([
    'column test_request_runs.status',
    'constraint test_request_runs.test_request_runs_status_check',
    'index test_request_runs.test_request_runs_status_idx',
    'trigger test_request_runs.test_request_runs_touch',
    'function test_request_receipt_ok(receipt jsonb)',
  ]);
  const withoutTable = { tables: {}, functions: base().functions };
  expect(compareLedgerFingerprint(base(), withoutTable).missing).toContain('table test_request_runs');
});

test('a changed column type, nullability, or default fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.columns[1] = col('status', 'varchar', true);
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('column test_request_runs.status');
  expect(formatLedgerDiff(d)).toContain('DIFFERS   column test_request_runs.status');
});

test('a changed relation persistence fails with a clear differing message', () => {
  const live = base();
  live.tables.test_request_runs.relpersistence = 'u';
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing).toContain('table test_request_runs relpersistence (p → u)');
  expect(formatLedgerDiff(d)).toContain('DIFFERS   table test_request_runs relpersistence (p → u)');
});

// Opus round-1 L5: one isolated mutation per column field, so deleting any
// single comparison (type, nullable, or default alone) in
// compareLedgerFingerprint fails a targeted assertion, not just a test that
// happens to also mutate another field.
describe('Opus round-1 L5: isolated column-field mutations', () => {
  test('type only', () => {
    const live = base();
    live.tables.test_request_runs.columns[1] = col('status', 'varchar', false, "'pending'::text");
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('column test_request_runs.status');
  });
  test('nullability only', () => {
    const live = base();
    live.tables.test_request_runs.columns[1] = col('status', 'text', true, "'pending'::text");
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('column test_request_runs.status');
  });
  test('default only', () => {
    const live = base();
    live.tables.test_request_runs.columns[1] = col('status', 'text', false, "'queued'::text");
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('column test_request_runs.status');
  });
});

test('a changed CHECK body fails as differing under the same constraint name', () => {
  const live = base();
  live.tables.test_request_runs.constraints[1] = cons('test_request_runs_status_check', 'c', "CHECK (status = ANY (ARRAY['pending', 'done', 'archived']))");
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('constraint test_request_runs.test_request_runs_status_check');
});

test('a changed index (uniqueness or definition, e.g. a partial predicate) fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.indexes[1] = idx('test_request_runs_status_idx', "CREATE INDEX ... USING btree (status) WHERE status = 'pending'");
  let d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('index test_request_runs.test_request_runs_status_idx');

  const live2 = base();
  live2.tables.test_request_runs.indexes[0] = idx('test_request_runs_pkey', base().tables.test_request_runs.indexes[0].definition, false, true);
  d = compareLedgerFingerprint(base(), live2);
  expect(d.ok).toBe(false);
});

test('a changed trigger definition fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.triggers[0] = trg('test_request_runs_touch', 'CREATE TRIGGER test_request_runs_touch ... EXECUTE FUNCTION other()');
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('trigger test_request_runs.test_request_runs_touch');
});

test('a changed function return type, language, volatility, or body hash fails as differing', () => {
  const live = base();
  live.functions[0] = fn('test_request_receipt_ok(receipt jsonb)', { bodyHash: 'b'.repeat(64) });
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('function test_request_receipt_ok(receipt jsonb)');
});

// Opus round-1 L5: one isolated mutation per function field, so deleting
// any single comparison (returnType, language, or volatile alone) at
// lib/db/ledger-schema.js fails a targeted assertion. bodyHash is already
// covered above.
describe('Opus round-1 L5: isolated function-field mutations', () => {
  test('returnType only', () => {
    const live = base();
    live.functions[0] = fn('test_request_receipt_ok(receipt jsonb)', { returnType: 'text' });
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('function test_request_receipt_ok(receipt jsonb)');
  });
  test('language only', () => {
    const live = base();
    live.functions[0] = fn('test_request_receipt_ok(receipt jsonb)', { language: 'plpgsql' });
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('function test_request_receipt_ok(receipt jsonb)');
  });
  test('volatile only', () => {
    const live = base();
    live.functions[0] = fn('test_request_receipt_ok(receipt jsonb)', { volatile: 'v' });
    const d = compareLedgerFingerprint(base(), live);
    expect(d.ok).toBe(false);
    expect(d.differing[0]).toContain('function test_request_receipt_ok(receipt jsonb)');
  });
});

test('a ledger ahead of the checkout (extra table, column, index, trigger, function) is ok with warnings', () => {
  const live = base();
  live.tables.test_request_runs.columns.push(col('later', 'text', true));
  live.tables.test_request_runs.indexes.push(idx('later_idx', 'CREATE INDEX later_idx ...'));
  live.tables.test_request_runs.triggers.push(trg('later_trigger', 'CREATE TRIGGER later_trigger ...'));
  live.tables.test_request_cast_slot_bindings = { columns: [], constraints: [], indexes: [], triggers: [] };
  live.functions.push(fn('test_request_other()'));
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(true);
  expect(d.extra).toEqual([
    'column test_request_runs.later',
    'index test_request_runs.later_idx',
    'trigger test_request_runs.later_trigger',
    'table test_request_cast_slot_bindings',
    'function test_request_other()',
  ]);
  expect(formatLedgerDiff(d)).toContain('extra     table test_request_cast_slot_bindings');
});

describe('canonicalizeDefinition', () => {
  test('strips the current schema qualification (quoted and bare) and collapses whitespace', () => {
    expect(canonicalizeDefinition('CHECK (("ledger_fp_ab12".status = ANY (ARRAY[\'a\'::text])))', 'ledger_fp_ab12'))
      .toBe("CHECK ((status = ANY (ARRAY['a'::text])))");
    expect(canonicalizeDefinition('SELECT * FROM ledger_fp_ab12.test_request_runs', 'ledger_fp_ab12'))
      .toBe('SELECT * FROM test_request_runs');
    expect(canonicalizeDefinition('a   b\n\tc', null)).toBe('a b c');
  });
  test('does not lowercase (case is semantic)', () => {
    expect(canonicalizeDefinition('SELECT Foo', null)).toBe('SELECT Foo');
  });
  test('passes through null/undefined', () => {
    expect(canonicalizeDefinition(null, 'x')).toBeNull();
    expect(canonicalizeDefinition(undefined, 'x')).toBeNull();
  });

  // Opus round-2 item 2 (Codex #2): whitespace collapsing and schema-prefix
  // stripping must never reach inside a string literal or dollar-quoted
  // block — a prior version ran both over the whole string, so two
  // semantically different accepted values canonicalized identically.
  describe('Opus round-2 low #3: comments and escape-string literals', () => {
    test('an apostrophe inside a -- or /* */ comment does not invert literal detection', () => {
      const a = canonicalizeDefinition("BEGIN -- it's fine\n  RETURN x = 'A  B';\nEND", null);
      const b = canonicalizeDefinition("BEGIN -- it's fine\n  RETURN x = 'A B';\nEND", null);
      expect(a).not.toBe(b);
      const c = canonicalizeDefinition("SELECT /* don't */ 'A  B'", null);
      const d = canonicalizeDefinition("SELECT /* don't */ 'A B'", null);
      expect(c).not.toBe(d);
      // Comment text itself is not semantic.
      expect(canonicalizeDefinition("SELECT 1 -- one", null)).toBe(canonicalizeDefinition("SELECT 1 -- uno", null));
    });
    test("E'' literals with backslash escapes stay byte-exact and do not swallow following code", () => {
      const a = canonicalizeDefinition("SELECT E'a\\'b  c'  ,   x", null);
      const b = canonicalizeDefinition("SELECT E'a\\'b c'  ,   x", null);
      expect(a).not.toBe(b);
      expect(a.endsWith(', x')).toBe(true);
      // An identifier ending in E followed by a quote is not an escape string.
      expect(canonicalizeDefinition("SELECT tablE'x  y'", null)).toBe("SELECT tablE'x  y'");
    });
  });

  describe('Opus round-2 item 2: literal-aware canonicalization', () => {
    test('different internal spacing inside a single-quoted literal is NOT collapsed — the two CHECK bodies differ', () => {
      const a = canonicalizeDefinition("CHECK (code = 'A  B')", null);
      const b = canonicalizeDefinition("CHECK (code = 'A B')", null);
      expect(a).not.toBe(b);
      expect(a).toBe("CHECK (code = 'A  B')");
      expect(b).toBe("CHECK (code = 'A B')");
    });

    test('a schema-like substring inside a string literal is preserved, not stripped as qualification', () => {
      const out = canonicalizeDefinition("CHECK (note = 'ledger_fp_ab12.something')", 'ledger_fp_ab12');
      expect(out).toBe("CHECK (note = 'ledger_fp_ab12.something')");
    });

    test('identical SQL with different spacing OUTSIDE any literal still canonicalizes equal', () => {
      const a = canonicalizeDefinition("CHECK (code  =  'A B')", null);
      const b = canonicalizeDefinition("CHECK (code = 'A B')", null);
      expect(a).toBe(b);
      expect(a).toBe("CHECK (code = 'A B')");
    });

    test('a dollar-quoted function body with internal double spaces differs from one with single spaces', () => {
      const a = canonicalizeDefinition('$$SELECT  receipt  IS NOT NULL;$$', null);
      const b = canonicalizeDefinition('$$SELECT receipt IS NOT NULL;$$', null);
      expect(a).not.toBe(b);
      expect(a).toBe('$$SELECT  receipt  IS NOT NULL;$$');
    });

    test('a tagged dollar-quoted block ($tag$...$tag$) is also treated as literal', () => {
      const out = canonicalizeDefinition('$body$SELECT  1$body$', null);
      expect(out).toBe('$body$SELECT  1$body$');
    });

    test("an escaped quote ('') inside a literal does not end the literal early", () => {
      const out = canonicalizeDefinition("CHECK (name <> 'it''s  here')", null);
      expect(out).toBe("CHECK (name <> 'it''s  here')");
    });

    test('schema qualification outside a literal is still stripped, alongside a literal elsewhere in the same string', () => {
      const out = canonicalizeDefinition("SELECT ledger_fp_ab12.f('A  B')", 'ledger_fp_ab12');
      expect(out).toBe("SELECT f('A  B')");
    });
  });

  // Codex round-3 #6: double-quoted identifiers must be protected the same
  // way string and dollar-quoted literals are — whitespace inside is
  // preserved, and schema-prefix stripping applies only to an EXACT
  // `"<schema>".` token pair, never to a schema-like substring inside a
  // longer quoted identifier.
  describe('Codex round-3 #6: quoted-identifier-aware canonicalization', () => {
    test('different internal spacing inside a double-quoted identifier is NOT collapsed — the two CHECK bodies differ', () => {
      const a = canonicalizeDefinition('CHECK ("a  b" = 1)', null);
      const b = canonicalizeDefinition('CHECK ("a b" = 1)', null);
      expect(a).not.toBe(b);
      expect(a).toBe('CHECK ("a  b" = 1)');
      expect(b).toBe('CHECK ("a b" = 1)');
    });

    test('a quoted identifier that merely CONTAINS the schema name as a substring is a different identifier from the bare one, not stripped', () => {
      const a = canonicalizeDefinition('SELECT "public.foo"', 'public');
      const b = canonicalizeDefinition('SELECT "foo"', 'public');
      expect(a).not.toBe(b);
      expect(a).toBe('SELECT "public.foo"');
      expect(b).toBe('SELECT "foo"');
    });

    test('an EXACT quoted schema qualification ("schema".t) and the bare form (schema.t) both canonicalize to the bare table name', () => {
      const quoted = canonicalizeDefinition('"public".t', 'public');
      const bare = canonicalizeDefinition('public.t', 'public');
      expect(quoted).toBe('t');
      expect(bare).toBe('t');
      expect(quoted).toBe(bare);
    });

    // Opus round-3 L5: the prior version of this test ('SELECT "a""b"')
    // could never fail — splitting an all-quoted string at the "" boundary
    // produces byte-identical output to treating it as one token, since
    // there is no unprotected code in between for the split to affect.
    // [VERIFIED by mutation: temporarily removing the "" lookahead in
    // tokenizeSqlLiterals's identifier scan (lib/db/ledger-schema.js:111)
    // and restoring it byte-for-byte afterward] changed THIS test's own
    // output from '"a  b""public".t' to '"a  b"t' but left the OLD test's
    // 'SELECT "a""b"' assertion passing unchanged — confirming the old
    // assertion had no teeth. This version places the embedded "" directly
    // before the bare schema name, so failing to honor the escape ends the
    // identifier early and re-opens a SEPARATE token that reads as exactly
    // "public" — which the schema-stripping rule below then strips,
    // silently deleting "public" and losing the leading dot. Honoring the
    // escape keeps it one token (never equal to the bare quoted schema), so
    // stripping never fires and the double-space inside the identifier
    // stays intact.
    test('an escaped double-quote ("") keeps the identifier one token: it is never mistaken for the bare quoted schema, and internal whitespace survives', () => {
      const out = canonicalizeDefinition('"a  b""public".t', 'public');
      expect(out).toBe('"a  b""public".t');
      expect(out).not.toBe('"a  b"t'); // what treating "" as two separate tokens would produce
    });

    test('a Unicode-escape identifier (U&"...") is also treated as a protected token', () => {
      const a = canonicalizeDefinition('SELECT U&"a  b"', null);
      const b = canonicalizeDefinition('SELECT U&"a b"', null);
      expect(a).not.toBe(b);
      expect(a).toBe('SELECT U&"a  b"');
    });

    test('code outside any quoted identifier still collapses whitespace normally', () => {
      const a = canonicalizeDefinition('SELECT   "x"   FROM   t', null);
      const b = canonicalizeDefinition('SELECT "x" FROM t', null);
      expect(a).toBe(b);
    });
  });

  // Opus round-3 L6: the bare (non-quoted) schema-qualification strip was a
  // plain substring `.split('public.').join('')`, which stripped
  // `public.` out of ANY identifier ending in those characters, not just a
  // genuine `public.` qualification — silently corrupting `xpublic.a` into
  // `xa`. It now strips only at an identifier boundary (start of the code
  // segment, or preceded by a non-identifier character).
  describe('Opus round-3 L6: bare schema stripping only applies at an identifier boundary', () => {
    test('xpublic.a is a different identifier from xa — not stripped', () => {
      const a = canonicalizeDefinition('xpublic.a', 'public');
      const b = canonicalizeDefinition('xa', 'public');
      expect(a).not.toBe(b);
      expect(a).toBe('xpublic.a');
      expect(b).toBe('xa');
    });

    test('a genuine public. qualification strips, whether or not it starts the text', () => {
      expect(canonicalizeDefinition('public.a', 'public')).toBe('a');
      expect(canonicalizeDefinition(' public.a', 'public')).toBe('a');
    });
  });
});

describe('approved-ahead extras (Codex round-1 Fix 4; Opus round-1 item 6: shape-verified, not name-only)', () => {
  const approvedShape = () => ({
    columns: [col('binding_id', 'uuid', false)],
    constraints: [cons('test_request_cast_slot_bindings_pkey', 'p', 'PRIMARY KEY (binding_id)')],
    indexes: [idx('test_request_cast_slot_bindings_pkey', 'CREATE UNIQUE INDEX ... (binding_id)', true, true)],
    triggers: [],
  });
  const approvedAhead = () => [{ migration: '058_test_request_cast_slot_bindings.sql', tables: { test_request_cast_slot_bindings: approvedShape() } }];

  test('a table extra with a name-only match (no objects entry, no tables entry) is unapproved', () => {
    const diff = { extra: ['table something_unexpected'] };
    expect(unapprovedExtras(diff, approvedAhead())).toEqual(['table something_unexpected']);
  });

  test('a table extra approved by shape, with a live fingerprint that compares clean, is NOT unapproved', () => {
    const diff = { extra: ['table test_request_cast_slot_bindings'] };
    const liveFingerprint = { tables: { test_request_cast_slot_bindings: approvedShape() } };
    expect(unapprovedExtras(diff, approvedAhead(), liveFingerprint)).toEqual([]);
  });

  test('a name-only match with a DIFFERENT live shape is unapproved (this is the point of shape verification)', () => {
    const diff = { extra: ['table test_request_cast_slot_bindings'] };
    const driftedLive = { tables: { test_request_cast_slot_bindings: { ...approvedShape(), columns: [col('binding_id', 'text', false)] } } };
    expect(unapprovedExtras(diff, approvedAhead(), driftedLive)).toEqual(['table test_request_cast_slot_bindings']);
  });

  test('a table extra approved by shape with NO live fingerprint supplied is unapproved (fail closed)', () => {
    const diff = { extra: ['table test_request_cast_slot_bindings'] };
    expect(unapprovedExtras(diff, approvedAhead())).toEqual(['table test_request_cast_slot_bindings']);
  });

  test('the legacy name-only "objects" list still covers non-table extras', () => {
    const diff = { extra: ['column test_request_runs.later'] };
    const legacy = [{ migration: 'x.sql', objects: ['column test_request_runs.later'] }];
    expect(unapprovedExtras(diff, legacy)).toEqual([]);
  });

  // Opus round-2 item 3: an approved table must compare EXACTLY (missing,
  // differing, AND extra all empty). A prior version ignored the sub-diff's
  // `extra`, so an approved shape plus one unapproved child object (column,
  // constraint, index, or trigger) still passed as approved.
  describe('Opus round-2 item 3: an approved table with one extra child object of each kind is unapproved', () => {
    const diff = { extra: ['table test_request_cast_slot_bindings'] };
    test('extra column', () => {
      const live = { tables: { test_request_cast_slot_bindings: { ...approvedShape(), columns: [...approvedShape().columns, col('later', 'text', true)] } } };
      expect(unapprovedExtras(diff, approvedAhead(), live)).toEqual(['table test_request_cast_slot_bindings']);
    });
    test('extra constraint', () => {
      const live = { tables: { test_request_cast_slot_bindings: { ...approvedShape(), constraints: [...approvedShape().constraints, cons('extra_check', 'c', 'CHECK (true)')] } } };
      expect(unapprovedExtras(diff, approvedAhead(), live)).toEqual(['table test_request_cast_slot_bindings']);
    });
    test('extra index', () => {
      const live = { tables: { test_request_cast_slot_bindings: { ...approvedShape(), indexes: [...approvedShape().indexes, idx('later_idx', 'CREATE INDEX later_idx ...')] } } };
      expect(unapprovedExtras(diff, approvedAhead(), live)).toEqual(['table test_request_cast_slot_bindings']);
    });
    test('extra trigger', () => {
      const live = { tables: { test_request_cast_slot_bindings: { ...approvedShape(), triggers: [trg('unexpected_side_effect', 'CREATE TRIGGER unexpected_side_effect ...')] } } };
      expect(unapprovedExtras(diff, approvedAhead(), live)).toEqual(['table test_request_cast_slot_bindings']);
    });
  });

  test('readApprovedAhead reads the tracked file as an array of entries', () => {
    const approved = readApprovedAhead();
    expect(Array.isArray(approved)).toBe(true);
    // Empty once every ledger migration is on main; while an entry exists it
    // must name its migration and carry table shapes, never a bare name list.
    for (const entry of approved) {
      expect(typeof entry.migration).toBe('string');
      expect(entry.tables && typeof entry.tables === 'object').toBe(true);
      for (const shape of Object.values(entry.tables)) expect(Array.isArray(shape.columns)).toBe(true);
    }
  });
  test('readApprovedAhead returns an empty array when the file is missing', () => {
    expect(readApprovedAhead('/nonexistent/path.json')).toEqual([]);
  });
});

test('the tracked fingerprint names exactly the ledger migration files in the checkout', () => {
  const expected = readExpectedFingerprint();
  expect(expected.generatedFrom).toEqual(listLedgerMigrationFiles());
  expect(Object.keys(expected.fingerprint.tables)).toContain('test_request_runs');
  expect(expected.fingerprint.functions.some((f) => f.signature === 'test_request_receipt_ok(receipt jsonb)')).toBe(true);
  // No NOT NULL pseudo-constraints (Postgres 18 lists them; 16 does not).
  for (const t of Object.values(expected.fingerprint.tables)) {
    expect(t.constraints.every((c) => c.type !== 'n')).toBe(true);
  }
  expect(fs.existsSync(path.join(process.cwd(), 'lib/db/ledger-schema-fingerprint.json'))).toBe(true);
});

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, 'lib/db/migrations/055_post_presentation_materials.sql'),
  'utf8',
);
const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-database.js'), 'utf8');

const TABLES = [
  'presentation_material_links',
  'presentation_material_uploads',
  'presentation_material_slot_leases',
];

const CONSTRAINTS = [
  'presentation_material_links_digest_shape',
  'presentation_material_links_ciphertext_shape',
  'presentation_material_links_revocation_shape',
  'presentation_material_links_expiry_shape',
  'presentation_material_uploads_artifact_type_check',
  'presentation_material_uploads_size_check',
  'presentation_material_uploads_fingerprint_shape',
  'presentation_material_uploads_ciphertext_shape',
  'presentation_material_uploads_state_check',
  'presentation_material_uploads_lease_shape',
  'presentation_material_uploads_error_bound',
  'presentation_material_uploads_candidate_shape',
  'presentation_material_uploads_finalized_shape',
  'presentation_material_slot_leases_artifact_type_check',
  'presentation_material_slot_leases_lease_shape',
  'presentation_material_slot_leases_fence_check',
];

const INDEX_CONTRACTS = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_material_links_live_request
     ON presentation_material_links (request_id)
     WHERE revoked_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_material_uploads_path
     ON presentation_material_uploads (library_name, folder_path, physical_filename)`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_material_uploads_actor_request
     ON presentation_material_uploads (actor_id, request_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_material_uploads_review
     ON presentation_material_uploads (intent_expires_at, state, lease_expires_at)
     WHERE state <> 'finalized'`,
];

function normalizeSql(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function extractCheckBody(source, constraintName) {
  const marker = `CONSTRAINT ${constraintName} CHECK (`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Constraint ${constraintName} not found`);
  let depth = 1;
  let index = start + marker.length;
  const bodyStart = index;
  while (depth > 0) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') depth -= 1;
    index += 1;
    if (index > source.length) throw new Error(`Unbalanced ${constraintName}`);
  }
  return source.slice(bodyStart, index - 1).replace(/\s+/g, ' ').trim();
}

test('migration 055 and fresh install declare the same durable tables and named constraints', () => {
  for (const source of [migration, setup]) {
    for (const table of TABLES) expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    for (const constraint of CONSTRAINTS) expect(source).toContain(`CONSTRAINT ${constraint}`);
  }
  expect(setup).toContain('const v56Statements = [');
  expect(setup).toContain('Applying v56 schema updates - post-presentation materials');
});

test('migration 055 and fresh install use identical durable CHECK predicates', () => {
  for (const constraint of CONSTRAINTS) {
    expect(extractCheckBody(setup, constraint)).toEqual(extractCheckBody(migration, constraint));
  }
});

test('migration 055 and fresh install preserve every durable index contract', () => {
  for (const source of [migration, setup].map(normalizeSql)) {
    for (const index of INDEX_CONTRACTS) {
      expect(source).toContain(normalizeSql(index));
    }
  }
});

test('upload intents preserve ciphertext-only URL state and exact candidate identity', () => {
  for (const source of [migration, setup]) {
    expect(source).toContain('upload_url_ciphertext TEXT');
    expect(source).not.toMatch(/\bupload_url\s+TEXT\b/);
    expect(source).toContain('presentation_material_uploads_ciphertext_shape');
    expect(source).toContain("upload_url_ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$'");
    for (const column of [
      'client_resume_fingerprint',
      'generation_key',
      'candidate_site_id',
      'candidate_drive_id',
      'candidate_item_id',
      'candidate_version_id',
      'candidate_etag',
      'candidate_size',
      'request_document_id',
    ]) expect(source).toContain(column);
  }
});

test('slot leases use the three governed artifact types and a positive Dataverse-sized fence', () => {
  for (const source of [migration, setup]) {
    expect(source).toContain('artifact_type IN (100000005, 100000006, 100000007)');
    expect(source).toContain('fence_version >= 1 AND fence_version <= 2147483647');
    expect(source).toContain('PRIMARY KEY (request_id, artifact_type)');
  }
});

test('migration and every fresh-install scope constraint contain the complete five-scope allowlist', () => {
  const exact = /CHECK \(scope IN \(\s*'grantee_image',\s*'staff_grantee_image',\s*'site_visit_material',\s*'consultant_feedback',\s*'post_presentation_transcript'\s*\)\)/g;
  expect(migration.match(exact)).toHaveLength(1);
  expect((setup.match(exact) || []).length).toBeGreaterThanOrEqual(3);
});

test('migration 055 is tracked by the generated manifest', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8');
  expect(manifest).toContain('055_post_presentation_materials.sql');
});

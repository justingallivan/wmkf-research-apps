# Scripts

Utility scripts for database management, testing, and development setup.

## Database Setup & Migrations

| Script | Description |
|--------|-------------|
| `setup-database.js` | Bootstrap a fresh, empty database only; refuses populated databases. |
| `apply-migrations.js` | Apply pending numbered migrations to an existing database. |

```bash
node scripts/setup-database.js       # fresh empty database only
node scripts/apply-migrations.js     # existing environment
```

## Database Cleanup

> **BLOCKED legacy surface:** migration 018 dropped the reviewer-finder
> Postgres tables. Several cleanup/reset scripts below still reference those
> tables and have not been reconciled to the current schema. Do not run them
> against a current environment until they are quarantined or repaired after an
> owner-approved scope review.

| Script | Description |
|--------|-------------|
| `cleanup-database.js` | **BLOCKED legacy script**; references retired reviewer-finder state. |
| `clear-all-database.js` | **BLOCKED and destructive**; contains statements against dropped tables. |
| `cleanup-duplicate-cycles.js` | **BLOCKED pending schema/caller reconciliation.** |

## User Profile Management

| Script | Description |
|--------|-------------|
| `export-proposals-for-migration.js` | Legacy export for the retired reviewer-finder Postgres assignment flow. |
| `import-user-assignments.js` | **BLOCKED legacy script**; writes retired reviewer-finder Postgres tables. |
| `manage-preferences.js` | View and delete user API key preferences |
| `test-profiles.js` | Test profile/preference database operations |

```bash
# View/delete API key preferences
node scripts/manage-preferences.js --list
node scripts/manage-preferences.js --delete-all-keys
node scripts/manage-preferences.js --delete-keys --profile 2
```

## Data Cleanup

| Script | Description |
|--------|-------------|
| `assign-orphan-records.js` | **DO NOT RUN:** targets `reviewer_suggestions` and `proposal_searches`, both dropped by migration 018. |

## Security

| Script | Description |
|--------|-------------|
| `rotate-encryption-key.js` | Rotate `USER_PREFS_ENCRYPTION_KEY` — re-encrypts all encrypted user preferences |

```bash
# Generate a new key
node scripts/rotate-encryption-key.js --generate-key

# Preview what will be re-encrypted (no changes)
OLD_KEY=<current_key> NEW_KEY=<new_key> node scripts/rotate-encryption-key.js --dry-run

# Execute rotation
OLD_KEY=<current_key> NEW_KEY=<new_key> node scripts/rotate-encryption-key.js
```

After rotating, update `USER_PREFS_ENCRYPTION_KEY` in Vercel and redeploy.

## Integrity Screener

| Script | Description |
|--------|-------------|
| `import-retraction-watch.js` | Import Retraction Watch CSV into database |
| `test-retractions.js` | Verify Retraction Watch database search functionality |
| `test-name-matching.js` | Test name matching variants and order swapping (41 tests) |

```bash
# Import Retraction Watch data (requires CSV file)
node scripts/import-retraction-watch.js path/to/retraction-watch.csv

# Test database search
node scripts/test-retractions.js

# Run name matching tests
node scripts/test-name-matching.js
```

## Email Template Settings

| Script | Description |
|--------|-------------|
| `migrate-email-token-syntax.mjs` | Rewrite legacy `[bracket]` email tokens to `{{mustache}}` in the live settings. Dry run by default; `--execute` writes. |
| `migrate-reviewer-email-copy.mjs` | Push the current `lib/seed/email-defaults/` reviewer body copy onto the four live global reviewer email settings. Dry run by default; `--execute` writes. |

The seed constants in `lib/seed/email-defaults/` are **init data, not a runtime
fallback** — `readRequiredEmailDefaults` reads the live `wmkf_appsystemsettings`
row and skips the send (with an ops alert) when it is blank. A code-only copy
change therefore never reaches a recipient; these scripts, or a staff edit in
`/admin` → Email Defaults, are the ways live copy actually changes.

`migrate-reviewer-email-copy.mjs` **overwrites staff-edited wording** on the four
global reviewer bodies (withdraw, acceptance, respond-by reminder, review-due
reminder). It does not touch per-PD invitation/materials templates. Capture the
dry run first — it prints each current value in full, and that transcript is the
restore path. Rows that are missing or blank are reported, never silently
populated; re-running after a successful migration writes nothing.

Both scripts talk to Dataverse, so the target/write interlock applies. Run from a
local checkout against production and every call is denied by default — reads
included. Reads need `DATAVERSE_ALLOW_PROD_READS=yes`; writes additionally need
the per-invocation operator ack `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"`,
whose date must be **today in UTC** (`resolveProdWriteAck` in
`lib/dataverse/core/interlock.js`) — a stale date fails closed and silently. Set
both in the operator shell only; never commit them and never set them in Vercel.
See `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.

```bash
# review and KEEP before.txt — it is the restore path (and is not gitignored)
DATAVERSE_ALLOW_PROD_READS=yes \
  node scripts/migrate-reviewer-email-copy.mjs > before.txt

DATAVERSE_ALLOW_PROD_READS=yes \
  DATAVERSE_PROD_WRITE_ACK="migrate reviewer email copy $(date -u +%F)" \
  node scripts/migrate-reviewer-email-copy.mjs --execute
```

## Reviewer Finder Testing

| Script | Description |
|--------|-------------|
| `test-reviewer-finder.js` | End-to-end test of reviewer finder pipeline |
| `test-contact-enrichment.js` | Test contact enrichment service |
| `test-verification.js` | Test candidate verification |
| `test-verification-flow.js` | Test full verification flow |
| `test-confidence-scores.js` | Test confidence score calculations |
| `test-relevance-parsing.js` | Test relevance parsing |
| `test-all-candidates.js` | Test all candidates processing |
| `debug-reviewer-finder.js` | Debug reviewer finder issues |

## Git/iCloud Setup

| Script | Description |
|--------|-------------|
| `setup-git-nosync.sh` | Configure .git.nosync for iCloud compatibility. Run once per Mac. |

```bash
./scripts/setup-git-nosync.sh
```

This renames `.git` to `.git.nosync` (which iCloud ignores) and creates a symlink. Git history syncs via GitHub push/pull, not iCloud.

## Environment Requirements

Most scripts require a `.env.local` file with database credentials:

```env
POSTGRES_URL=your_postgres_connection_string
```

Some scripts may require additional API keys depending on the functionality being tested.

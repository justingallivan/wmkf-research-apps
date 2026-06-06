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

| Script | Description |
|--------|-------------|
| `cleanup-database.js` | Remove researchers missing email OR website (keeps high-quality entries) |
| `clear-all-database.js` | Delete ALL data from all tables for a fresh start |
| `cleanup-duplicate-cycles.js` | Remove duplicate grant cycles |

```bash
node scripts/cleanup-database.js      # Clean up incomplete entries
node scripts/clear-all-database.js    # Full reset (destructive!)
```

## User Profile Management

| Script | Description |
|--------|-------------|
| `export-proposals-for-migration.js` | Export proposals to CSV for user profile assignment |
| `import-user-assignments.js` | Import user profile assignments from CSV |
| `manage-preferences.js` | View and delete user API key preferences |
| `test-profiles.js` | Test profile/preference database operations |

```bash
# Export proposals for user assignment
node scripts/export-proposals-for-migration.js

# Import user assignments from CSV (dry-run first)
node scripts/import-user-assignments.js --file proposals-for-migration.csv --dry-run
node scripts/import-user-assignments.js --file proposals-for-migration.csv

# View/delete API key preferences
node scripts/manage-preferences.js --list
node scripts/manage-preferences.js --delete-all-keys
node scripts/manage-preferences.js --delete-keys --profile 2
```

## Data Cleanup

| Script | Description |
|--------|-------------|
| `assign-orphan-records.js` | Assign legacy NULL `user_profile_id` rows in `reviewer_suggestions` and `proposal_searches` to a specified user profile |

```bash
# Preview orphan records (no changes)
node scripts/assign-orphan-records.js --profile-id 1 --dry-run

# Execute assignment
node scripts/assign-orphan-records.js --profile-id 1
```

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

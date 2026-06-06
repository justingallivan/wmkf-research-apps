---
paths:
  - "lib/db/**"
  - "scripts/setup-database.js"
  - "scripts/apply-migrations.js"
  - "scripts/audit-postgres-state.js"
  - "docs/atlas/**"
  - "docs/APPLICATION_STATE_ATLAS.md"
---

# Database And Migrations

`scripts/setup-database.js` bootstraps an empty database only. Existing environments use `node scripts/apply-migrations.js`. New durable schema needs a numbered migration, regenerated manifest, matching fresh-install shape where applicable, Atlas coverage, tests, and sequential relevant gates. Probe live state before destructive work and label unverified claims.

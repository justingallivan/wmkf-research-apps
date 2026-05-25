-- Migration 014: Drop playing_with_neon scratch table
--
-- Background: playing_with_neon was a Neon-console tutorial seed table
-- (canonical 10-row playground dataset with MD5-hash names + random
-- floats). It has been in prod since the Postgres provisioning, has
-- zero callers in source (confirmed via repo-wide grep), and has long
-- carried a "Drop" disposition in docs/atlas/postgres-other-reviewer-tables.md
-- line 47. S185 audit pass surfaced it as the sole real entry in the
-- reconcile-memory-claims postgres_table_mismatch bucket after we made
-- the bucket's source-of-truth complete (schema.sql + setup-database.js
-- + migrations).
--
-- Connor / production verification: 10 rows confirmed junk on 2026-05-25
-- (sample: id=1 name='c4ca4238a0' value≈0.91 — MD5 prefix of '1').

DROP TABLE IF EXISTS playing_with_neon;

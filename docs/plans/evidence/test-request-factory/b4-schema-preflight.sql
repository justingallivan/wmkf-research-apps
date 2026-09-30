-- Owner-run read-only B4 054/058 preflight. No application rows or credentials.
-- Run on each named target; preserve the result with source commit and UTC time.
-- Compare with 054 and 058 from that commit before any owner-run apply.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database, current_schema() AS schema,
       transaction_timestamp() AS observed_at,
       to_regclass('public.schema_migrations')::text AS migration_tracker;

SELECT table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND left(table_name, 13) = 'test_request_'
 ORDER BY table_name, ordinal_position;

SELECT n.nspname AS schema, t.relname AS table_name, c.conname, c.contype,
       c.convalidated, pg_get_constraintdef(c.oid, true) AS definition
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND left(t.relname, 13) = 'test_request_'
 ORDER BY t.relname, c.conname;

SELECT schemaname, tablename, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND left(tablename, 13) = 'test_request_'
 ORDER BY tablename, indexname;

-- Avoid an exception if the function is absent; report every installed overload.
SELECT n.nspname AS schema, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition, p.prosrc AS body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'test_request_receipt_ok'
 ORDER BY arguments;

ROLLBACK;

-- If migration_tracker above is non-null, separately run this read-only query:
-- SELECT name, applied_at, applied_by FROM public.schema_migrations ORDER BY name;
-- If absent, do not create a tracker containing only 058.

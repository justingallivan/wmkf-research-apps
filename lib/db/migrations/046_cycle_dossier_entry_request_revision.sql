-- Per-request revision number for Cycle Dossier entries. The existing
-- `revision` identity is table-wide (a global counter), so the sixth entry
-- ever generated read "revision 6" on its request card, in its SharePoint
-- filename, and inside the document. `request_revision` counts within a
-- request; `revision` stays as the append order. Backfill ranks existing rows
-- by that order; reservations (ready=FALSE) count too, so concurrent launches
-- for one request take distinct numbers and the unique index refuses a race.
ALTER TABLE cycle_dossier_entries ADD COLUMN IF NOT EXISTS request_revision INTEGER;
UPDATE cycle_dossier_entries e SET request_revision = r.rn
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY revision) AS rn FROM cycle_dossier_entries) r
  WHERE e.id = r.id AND e.request_revision IS NULL;
ALTER TABLE cycle_dossier_entries ALTER COLUMN request_revision SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cycle_dossier_entries_request_revision
  ON cycle_dossier_entries (request_id, request_revision);
COMMENT ON COLUMN cycle_dossier_entries.request_revision IS
  'Revision number within the request (1, 2, …); `revision` is the table-wide append order.';

# Expertise roster access: superseded API proposal

**Status: SUPERSEDED — November 19, 2026 owner decision.**

The owner and Connor chose a production-only Postgres-to-Dataverse migration,
with roster maintenance moved into Admin. The current plan is
[Expertise roster: production migration and Admin editor](EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md).

Do not implement the earlier read-only HTTP roster endpoint, custom connector,
or its authentication setup. Connor will read the migrated Dataverse table.
Backend matching automation is a separate later step, followed separately by
Expertise Finder retirement after replacement acceptance and caller verification.

This is a change of direction, not a completed migration. The original discussion
draft is preserved in this file's Git history. It recommended leaving Postgres
as the source and awaiting Connor's review; that recommendation is superseded.

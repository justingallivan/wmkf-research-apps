---
title: Reviewer Institution Measurement Events
domain: reviewer-identity
kind: atlas
status: planned
summary: "Source-built, opt-in prospective Find observations; migration 048 was not applied here and live schema is unprobed."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
  - lib/db/migrations/048_reviewer_institution_measurement_events.sql
---

# Atlas: `reviewer_institution_measurement_events` (Postgres)

**[VERIFIED via source, 2026-09-14]** Migration 048 and its fresh-install
mirror define a prospective, append-only observation table. **[PLANNED]** The
migration was not applied in this session, live schema was not probed,
`REVIEWER_INSTITUTION_MEASUREMENT` defaults off, and no Production or Preview
event count is claimed. Before enabling the exact
`on` flag, apply the migration with `node scripts/apply-migrations.js` in the
intended environment, then verify the table exists. Do not run the fresh-install
script on an existing database.

## Contract

- **Writer:** `lib/services/reviewer-institution-measurement.js`. It receives
  successful roster upserts, authenticated staff actions, and per-candidate
  save outcomes with a server-bound roster key from both Find save paths (ordinary
  `save-candidates` and applicant `promote-applicant-reviewer`). Early
  save rejections with only a client correlation key have no case event. Failed or skipped
  roster writes produce no upsert event. A telemetry read/insert failure is
  swallowed and must not change the reviewer response or Dataverse write.
  After five consecutive failed inserts, a 60-second circuit breaker avoids
  hammering an unready database; each attempted insert settles within two
  seconds, and batch observations are awaited concurrently. A single staff
  action can therefore wait up to two seconds for its observation; this
  latency is bounded but is not zero.
- **Reader:** `node scripts/report-reviewer-institution-measurement.js [days]`
  returns aggregate counts only. No selection or write path reads this table.
- **Cleanup:** daily maintenance removes rows older than
  `retention:reviewer_institution_measurement_days` (default 90) and caps the
  table at 200,000 newest rows. The cleanup tolerates an unapplied migration.
- **Privacy:** `case_key` is SHA-256 of request GUID plus exact roster key;
  `card_snapshot_digest` is a SHA-256 of a bounded rendered candidate-field tuple. They are
  pseudonymous, recomputable by a roster holder, and treated as personal data.
  No raw names, emails, institutions, request IDs, candidate keys, assertion
  text, actor IDs, provider payloads, identity anchors, or error messages enter
  this table. All other fields use server allowlists or fixed literals.
  The digest is **not** a complete Stage 2 assertion or provider-input version;
  a future same-input shadow comparison requires a separately bound version.
- **Trust:** `server_applicant` upserts may carry the server-computed Stage 2
  relationship, context, source type/currentness/author specificity, extra
  affiliation count, and legacy hold. Other upserts are `roster_unverified`:
  discovery clients can submit their render blobs, so their relationship and
  legacy-hold fields are null. `stored_roster` action/save events count the
  server-observed outcome without converting a stored render field into proof.
- **Authority:** `independent_identity=not_evaluable`,
  `additional_coi=not_screened`, and `proposed_action=not_evaluable` are
  schema-enforced. They cannot be read as prospective clear decisions.

## Limits and next prerequisites

This captures **observed actions**, not card impressions or counterfactual
actions avoided. Source type/currentness are partial: applicant Stage 2
currently supplies no publication/employment observation date and uses a
suggestion reference, not the exact upstream work/profile identifier. The
independent person proof and server screening of every extra affiliation are
still absent. Rows missing any of these inputs are excluded from auto-clear
scoring. Coverage also excludes failed telemetry inserts and cases that never
reached a roster row. The report names these limits and cannot estimate lost
events from its own table.
`institution_coi` outcome counts a save rejection at the institution-COI
gate, including a failed required screen; it is not a count of adjudicated
current COIs. `trusted_hold_with_staff_action` is an overlap, not proof that
the institution warning caused the staff action.

The blind, held-out label set must be created separately from this event log;
the June–August 2026 retrospective cannot be retroactively filled with staff
actions. A full producer→roster→card→save shadow comparison remains planned.

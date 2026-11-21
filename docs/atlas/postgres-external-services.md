# Postgres: external service register

[VERIFIED 2026-11-20 via branch source] The Admin → Operations → External services view records service inventory and dated decisions in private operational Postgres tables. Migration 106 is branch-built; application deployment and database application are not established by this source review. Production readiness has not been probed; isolated local database validation is recorded below.

## Authority and schema

- `external_services`: text primary key, object-shaped JSONB `data`, positive integer `version` (initially 1), nullable `updated_by` profile foreign key, and update timestamp.
- `external_service_reviews`: UUID primary key, service foreign key, object-shaped JSONB `data`, nullable creator/updater profile foreign keys, and creation/update timestamps. Indexed by service and creation time. Reviews are editable records, not an append-only audit log.
- Migration `106_external_service_reviews.sql` owns the initial schema and seed. Existing databases use `node scripts/apply-migrations.js`; fresh installation replays the manifest through the fresh-database bootstrap. Never run the fresh-install setup against an existing database.
- The checked-in seed contains public-source inventory for 24 services and one AssemblyAI review marked Implemented. These are initial reference records, not evidence of live account usage, private billing, or schema deployment. The mutable operational records live in Postgres after migration.

## Producer → persistence → consumer

| Hop | Contract |
|---|---|
| Entry | `pages/api/admin/external-services.js`: GET and PUT require `requireSuperuser`; actor attribution comes from the authenticated profile, not the request body. Responses are private/no-store; request body limit is 64 KB. |
| Validation | `lib/services/external-services/model.js`: bounded service/review fields, closed choices, valid calendar dates, at most 12 credential-free HTTPS reference links per record. Microsoft, GitHub, and Zoom retain corporate-managed excluded cost policy. |
| Writes | `lib/services/external-services/store.js`: create at expected version zero; existing saves update only the supplied current service version, incrementing it. A service and optional new/edited review commit in one transaction. Missing review or stale service version rolls back the entire save. Review updates are scoped by service ID. |
| Bounds | At most 500 services and 200 reviews per service through the store. Service creation takes a table lock before checking capacity; saves serialize on the service version. Service overflow fails explicitly; review history reads at most 200 rows. |
| Reads | Service list includes the maximum saved review date. Review history is ordered by review date, then creation time. The Admin Operations view consumes these DTOs and saves through the same guarded route. |
| Display | `serviceStatus` prioritizes Action needed; otherwise no review or a next-review date on/before today is Review due; remaining services are Current. These labels describe the register schedule, not live provider health or approval authority. |

## Operational boundaries

Service and review notes must not contain secrets. This is an operator content rule, not a credential-redaction guarantee: bounded text validation cannot identify every secret. Initial committed seed content contains no private billing figures. Reference URLs are stored and displayed; the register does not fetch them.

The feature records proposed, approved, or implemented decisions. It makes no provider calls, purchases, model changes, automatic updates, or scheduled notifications. Retire is a recorded decision, not a delete operation. A failed/unavailable database returns a safe 503; the UI does not pretend an empty seed fallback is authoritative. Version conflicts require reload before retry.

## Verification limits

Verified locally: the full fresh-database bootstrap applied migration 106 and read back 24 services and one review. Five isolated Postgres tests exercised seed parity, atomic review/service saves, stale retries, rollback, creation, and review updates. Unit/UI tests cover authorization, validation, failed saves, and stable creation IDs. The production build and type check passed. Desktop and narrow-width captures used mocked API data; they are not hosted authorization or live-save proof. Operations now has eight navigation entries; the scoped UI review accepted the scrollable extension despite the design guide’s seven-tab preference.

This page documents the source route, validator, store, migration, and Admin consumer. Production table existence, migration tracker state, row counts, hosted authorization, and a save/reload smoke remain unprobed here. The AssemblyAI seed review preserves its source evidence and limitations; its Implemented label does not establish that this register has shipped.

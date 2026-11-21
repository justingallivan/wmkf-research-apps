# Postgres: external service register

[VERIFIED 2026-11-20 via branch source] The Admin → Operations → External services view records service inventory and dated decisions in private operational Postgres tables. Migrations 106–107 are branch-built; application deployment and database application are not established by this source review. The production read-only preflight found the register tables absent; isolated local database validation is recorded below.

## Authority and schema

- `external_services`: text primary key, object-shaped JSONB `data`, positive integer `version` (initially 1), nullable `updated_by` profile foreign key, and update timestamp.
- `external_service_reviews`: UUID primary key, service foreign key, object-shaped JSONB `data`, nullable creator/updater profile foreign keys, and creation/update timestamps. Indexed by service and creation time. Reviews are editable records, not an append-only audit log.
- Migration `106_external_service_reviews.sql` owns the initial schema and seed. Migration `107_external_service_inventory_followups.sql` adds IRS Business Master File and Europe PMC without replacing existing records and appends the missing AssemblyAI benchmark reference without replacing review edits. Existing databases use `node scripts/apply-migrations.js`; fresh installation replays the manifest through the fresh-database bootstrap. Never run the fresh-install setup against an existing database.
- The checked-in seed contains public-source inventory for 26 services and one AssemblyAI review marked Implemented. These are initial reference records, not evidence of live account usage, private billing, or schema deployment. The mutable operational records live in Postgres after migration.

## Producer → persistence → consumer

| Hop | Contract |
|---|---|
| Entry | `pages/api/admin/external-services.js`: GET and PUT require `requireSuperuser`; actor attribution comes from the authenticated profile, not the request body. Responses are private/no-store; request body limit is 512 KB. |
| Validation | `lib/services/external-services/model.js`: bounded service/review fields, closed choices, Pacific-time calendar dates, at most 12 credential-free HTTPS reference links per record. Microsoft, GitHub, and Zoom retain corporate-managed excluded cost policy by seed ID and normalized provider name. |
| Writes | `lib/services/external-services/store.js`: create at expected version zero; existing saves update only the supplied current service version, incrementing it. A service and optional new/edited review commit in one transaction. Missing review or stale service version rolls back the entire save. Review updates are scoped by service ID. |
| Bounds | At most 500 services and 200 reviews per service through the store. Service creation takes a table lock before checking capacity; saves serialize on the service version. Service overflow fails explicitly; review history reads at most 200 rows. |
| Reads | Service list includes the maximum saved review date. Review history is ordered by review date, then creation time. The Admin Operations view consumes these DTOs and saves through the same guarded route. |
| Display | `serviceStatus` prioritizes Action needed; otherwise no review or a next-review date on/before today is Review due; remaining services are Current. Today is the Pacific calendar date on both server and client. A new review suggests its next date from the entered review date and cadence, preserving an explicit next-date edit. These labels describe the register schedule, not live provider health or approval authority. |

## Operational boundaries

Service and review notes must not contain secrets. This is an operator content rule, not a credential-redaction guarantee: bounded text validation cannot identify every secret. Initial committed seed content contains no private billing figures. Reference URLs are stored and displayed; the register does not fetch them.

The feature records proposed, approved, or implemented decisions. It makes no provider calls, purchases, model changes, automatic updates, or scheduled notifications. Retire is a recorded decision, not a delete operation. A failed/unavailable database returns a safe 503; the UI does not pretend an empty seed fallback is authoritative. Cancel after any failed save reloads the list and selected history, exposing committed-but-unacknowledged results and fresh versions before another edit.

## Verification limits

Verified locally: the canonical upgrade runner applied migration 107 to an isolated database already at 106; a separate fresh-database bootstrap also replayed both migrations. Both read back 26 services and one review. The 72 scoped tests cover seed parity, atomic saves, stale retries, rollback, cross-service ownership, both capacity limits, malformed requests, Pacific dates/DST, editable cadence defaults, ambiguous responses, and stable creation IDs. The production build and type check passed. Desktop and narrow-width captures used mocked API data; they are not hosted authorization or live-save proof. Operations now has eight navigation entries; the scoped UI review accepted the scrollable extension despite the design guide’s seven-tab preference.

This page documents the source route, validator, store, migration, and Admin consumer. Production migration application, populated row counts, hosted authorization, and a save/reload smoke remain unverified. The AssemblyAI seed review preserves its source evidence and limitations; its Implemented label does not establish that this register has shipped.

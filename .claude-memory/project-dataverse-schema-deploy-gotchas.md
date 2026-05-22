---
name: Dataverse schema-deploy gotchas
description: Recurring failure modes when running apply-dataverse-schema.js or batch-creating Dataverse rows; expect each one and plan around it
type: project
originSessionId: dbb306e7-a291-40e3-8509-b57067e842e0
---
Four Dataverse behaviors that bite multi-attribute deploys and bulk inserts. Each was rediscovered in S139–S147 after consuming real time; treat as standing knowledge.

**1. EntityCustomization 429 throttling between metadata writes (`apply-dataverse-schema.js`).**
- **Why:** Dataverse serializes solution-customization operations across the org. Two concurrent customizations (or one in flight when another arrives) fail the second with 429 / `0x80071151` "Cannot start another [EntityCustomization] because there is a previous one running". Surfaces between attribute creates, between relationship creates, and between alt-key + relationship steps.
- **How to apply:** Wrap the apply call in a 30s-backoff retry loop. The script is idempotent so reruns pick up where they stopped:
  ```bash
  until node scripts/apply-dataverse-schema.js --target=prod --wave=N --execute > /tmp/dv.log 2>&1; do echo retry; sleep 30; done
  ```
  Don't reduce the sleep below ~30s — the lock takes that long to clear under typical load.

**2. `@odata.bind` keys are case-sensitive (PascalCase nav-property).**
- **Why:** The OData write contract uses the navigation-property name from the schema spec (e.g. `wmkf_Request@odata.bind`), NOT the lowercase logical column name (`wmkf_request@odata.bind`). Lowercase produces a 0x80048d19 "Error identified in Payload" 400 that is hard to read because the actual error is in the truncated InnerException. Plain field reads/writes use lowercase logical names — only `@odata.bind` cares.
- **How to apply:** When binding lookups in a `createRecord`/`updateRecord` payload, use the `lookupSchemaName` from the JSON schema spec (PascalCase). Reference: `lib/services/execute-prompt.js` uses `wmkf_ai_Prompt@odata.bind` correctly. Smoke-test bulk inserts with `--limit 50` before committing to thousands of rows.

**3. Logical name ≠ schema name — Dataverse lowercases the whole schema name.**
- **Why:** Schema files declare attributes like `wmkf_SummaryBlobUrl` (PascalCase camel), but the *logical* name Dataverse exposes on read/write payloads is the full lowercase: `wmkf_summarybloburl`. Common pitfall: chopping at the underscore and lowercasing the prefix only (`wmkf_summaryblob`) → 400 / "field does not exist". Hit in W5 step 3 backfill: 177 errors on first commit-mode pass because the script wrote `wmkf_summaryblob`. PascalCase only matters for `@odata.bind` nav-property bindings (see #2).
- **How to apply:** When translating a schema-name to a logical-name, lowercase the entire string — don't try to preserve any boundary. Adapter FIELD_SELECT arrays and PATCH payloads always use the fully-lowercased form. When adding a new attribute to an adapter, also add it to that adapter's FIELD_SELECT — otherwise idempotency checks that compare to existing values will silently miss the field and re-write on every run.

**4. `DynamicsService.queryAllRecords` caps at 5000 records.**
- **Why:** Hardcoded `MAX_EXPORT_RECORDS = 5000` in the service, intended for export safety. Vendor entities like `akoya_request` (25,561 rows) blow through it.
- **How to apply:** For one-off backfills/reads that need to exceed the cap, do raw paginated fetch with `@odata.nextLink` + `Prefer: odata.maxpagesize=5000`. Reference implementation: `scripts/backfill-request-person-junction.js`. Bypassing the cap is fine for scripts; don't do it from request handlers.

---
name: Dataverse schema-deploy gotchas
description: Recurring failure modes when running apply-dataverse-schema.js or batch-creating Dataverse rows; expect each one and plan around it
type: project
originSessionId: dbb306e7-a291-40e3-8509-b57067e842e0
status: active
scope: dataverse
last_verified: S268 (2026-06-18) — added #7 (metadata-probe $select must be type-correct), live-hit deploying wave2-grantee-deliverables
---

## Recall Rule

Read this when: running `apply-dataverse-schema.js`, batch-creating/inserting Dataverse rows, or writing adapter PATCH/`@odata.bind` payloads.

Do:
- Wrap schema-apply in a 30s-backoff `until` retry loop (idempotent script picks up where it stopped); don't drop the sleep below ~30s.
- Use the PascalCase nav-property (`lookupSchemaName`) for `@odata.bind`; use the fully-lowercased logical name for plain reads/writes and FIELD_SELECT arrays.
- Smoke bulk inserts with `--limit 50` first; for >5,000-row reads use raw paginated fetch (`@odata.nextLink` + `Prefer: odata.maxpagesize=5000`), not `queryAllRecords`.

Do not:
- Lowercase only the prefix when translating schema-name → logical-name (chop-at-underscore is a 400 footgun).
- Run two solution-customization operations concurrently (429 / `0x80071151`).

Ground truth: `scripts/apply-dataverse-schema.js`, `lib/services/execute-prompt.js` (correct `@odata.bind`), `scripts/backfill-request-person-junction.js` (paged fetch). Durable behavioral rules; the 5000 cap in `queryAllRecords` is a code fact — verify in current source. See [[project-dataverse-odata-null-filter]].

Six Dataverse behaviors that bite multi-attribute deploys and bulk inserts. Each was rediscovered S139–S258 after consuming real time; treat as standing knowledge.

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

**5. UPDATING an existing attribute's metadata: PUT the full definition + PublishXml — `PATCH` returns 405.**
- **Why:** `apply-dataverse-schema.js` is **create-only, no updates** (header line 16), so changing a live column (e.g. widening a Double `MaxValue`) has no ready-made tool. The Web API rejects `PATCH` on `EntityDefinitions(LogicalName=…)/Attributes(LogicalName=…)` with **405 "does not support http method 'PATCH'"** (hit S237 widening `wmkf_relevancescore`).
- **How to apply:** GET the full attribute from the **non-cast** path (the cast path omits `@odata.type`), strip `@odata.*` annotations, set the changed property, set body `@odata.type` to the bare cast name (no leading `#`), **PUT** to the attribute path with header **`MSCRM.MergeLabels: true`**, then POST **`/PublishXml`** for the entity, then verify a read-back. Send the COMPLETE definition (only the one prop changed) — unspecified props reset to defaults; a malformed PUT 400s WITHOUT partially applying (fail-safe). Reference: `scripts/widen-relevancescore-max.mjs`. Adding a PICKLIST option is different — use the `InsertOptionValue` action (`scripts/extend-responsetype-picklist.mjs`).

**6. A full-wave re-run can CREATE DUPLICATE artifacts when the wave's schema-as-code has drifted from prod — deploy single new fields in an ISOLATED followup wave.**
- **Why:** `apply-dataverse-schema` is create-only and tests existence by **SchemaName**. If prod has an artifact under a *different* SchemaName than the wave spec (created out-of-band — UI / Connor PA / a different script), the ensure-check misses it and the script would **create a duplicate**. S258: a prod **dry-run** of `--wave=2` showed it would `✓ created  rel  wmkf_appreviewersuggestion_honorariumrequest` even though the honorarium lookup `_wmkf_honorariumrequest_value` is already live (Atlas: shipped 2026-05-28). So wave2 has drifted; `--wave=2 --execute` would duplicate that relationship.
- **How to apply:** To add ONE new attribute to an existing entity, do NOT append it to the big shared wave file and re-run the whole wave. Put it in its own followup wave dir (`wave{N}-<slug>/`) and run `--wave={N}-<slug>` so the blast radius is exactly that artifact. The loader supports string-suffixed waves for this. ALWAYS prod **dry-run first** (omit `--execute`) and read the FULL output — confirm it would create ONLY your artifact. Reference: `lib/dataverse/schema/wave2-fieldprimer/akoya_request-fieldprimer.json` (S258 `wmkf_ai_fieldprimer` add). **Open hazard:** wave2's honorarium-relationship drift is unreconciled — do NOT run full `--wave=2 --execute` until someone reconciles the SchemaName, or it'll create a duplicate relationship.

**7. A metadata-probe `$select` must be TYPE-CORRECT for the cast type, or it 400s instead of 404-ing on an absent field.**
- **Why:** When probing attribute metadata via the typed cast path (`EntityDefinitions(LogicalName='e')/Attributes(LogicalName='a')/Microsoft.Dynamics.CRM.<Type>AttributeMetadata?$select=…`), selecting a property the cast type does NOT expose returns a **400 "Could not find a property named 'X' on type …"** — and that 400 can surface *before* the 404-on-absence, so an absent field looks like an error. The property sets differ by type: `PicklistAttributeMetadata` has **no `MaxLength`**; `MemoAttributeMetadata` exposes **`Format`** (not String's **`FormatName`**); only `StringAttributeMetadata` has `FormatName`. Hit S268 building `scripts/preflight-grantee-deliverables-fields.mjs` — a shared `$select` with `MaxLength` for the picklist probe 400'd; the Memo/String fields had already 404'd cleanly because their selects happened to be valid.
- **How to apply:** Build `$select` per attribute type, not one shared string. Picklist → `$select=LogicalName,AttributeType&$expand=OptionSet` (no MaxLength); String → `…,MaxLength,FormatName`; Memo → `…,MaxLength` (and read `Format` if you compare it). The type names map to schema-apply's `typeMetadata` switch (`lib/dataverse/schema-apply.js`). Reference: `scripts/preflight-grantee-deliverables-fields.mjs` (3-way exit contract: ABSENT→proceed-create, EXACT→idempotent no-op, DIVERGENT→abort, since schema-apply is creation-only).

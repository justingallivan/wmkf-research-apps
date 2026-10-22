---
name: Dataverse schema-deploy gotchas
description: Dated Dataverse schema-deploy and batch-write failure modes; use current source and metadata to choose safe deploy/retry procedures
type: project
originSessionId: dbb306e7-a291-40e3-8509-b57067e842e0
status: active
scope: dataverse
last_verified: 2026-10-22 source review; S268 deploy/schema observations are historical and no live Dataverse metadata was re-probed
---

## Recall Rule

Read this when: running `apply-dataverse-schema.js`, batch-creating/inserting Dataverse rows, or writing adapter PATCH/`@odata.bind` payloads.

Do:
- Before any metadata probe, schema apply, or bulk-write smoke, establish the approved target and read/write scope under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Production probes remain owner-controlled; this memory does not authorize them.
- For a diagnosed transient EntityCustomization 429 / `0x80071151`, retry only that transient failure with at least 30s backoff after inspecting the output, within an explicitly agreed finite attempt budget. Stop on deterministic errors; after partial application, re-preflight before resuming. Never use an unbounded retry loop for nonzero exits.
- Use the exact, case-sensitive navigation-property name reported by Dataverse metadata (`ReferencingEntityNavigationPropertyName`) for each lookup's `@odata.bind` key. Its spelling is not guaranteed to be PascalCase; use fully-lowercased logical attribute names for plain reads/writes and FIELD_SELECT arrays.
- Smoke bulk inserts with `--limit 50` first; for reads beyond the `queryAllRecords` cap, use a reviewed bounded-pagination path that preserves the shared read restrictions, authorization, target interlock, and timeouts.

Do not:
- Lowercase only the prefix when translating schema-name → logical-name (chop-at-underscore is a 400 footgun).
- Run two solution-customization operations concurrently (429 / `0x80071151`).

Ground truth: inspect current behavior in `scripts/apply-dataverse-schema.js`, `lib/services/dynamics/read-ops.js`, and the relationship metadata for the target lookup. `lib/services/execute-prompt.js` is one verified bind example; `scripts/backfill-request-person-junction.js` is only a historical pagination example, not a general bypass template. See [[project-dataverse-odata-null-filter]].

Seven Dataverse behaviors that bite multi-attribute deploys and bulk inserts. Each was rediscovered S139–S258 after consuming real time; treat as standing knowledge.

**1. EntityCustomization 429 throttling between metadata writes (`apply-dataverse-schema.js`).**
- **Why:** Dataverse serializes solution-customization operations across the org. Two concurrent customizations (or one in flight when another arrives) fail the second with 429 / `0x80071151` "Cannot start another [EntityCustomization] because there is a previous one running". Surfaces between attribute creates, between relationship creates, and between alt-key + relationship steps.
- **How to apply:** After confirming the failure is this transient 429 / `0x80071151`, inspect the full output and manually retry only that diagnosed transient failure after at least 30s. Agree a finite retry budget before execution; stop when it is exhausted. Don't retry deterministic errors. After any partial application, stop and re-preflight before resuming; don't wrap production writes in a retry loop. Don't retry the transient lock sooner than ~30s — it takes that long to clear under typical load.

**2. `@odata.bind` keys are case-sensitive and use the exact navigation-property name.**
- **Why:** The OData write contract uses the lookup's navigation-property name, not its attribute logical name. The authoritative spelling is Dataverse relationship metadata's `ReferencingEntityNavigationPropertyName`; spelling and case vary by relationship. For example, the persisted honorarium payload uses lowercase `akoya_programid@odata.bind` and `akoya_primarycontactid@odata.bind`, while `wmkf_GrantProgram@odata.bind` and `wmkf_Type@odata.bind` are PascalCase. The earlier PascalCase `akoya_ProgramId` / `akoya_PrimaryContactId` bindings were rejected with 400. Plain field reads/writes use fully-lowercased logical attribute names; navigation-property names are a separate metadata contract.
- **How to apply:** Resolve the exact navigation-property name from relationship metadata (`ReferencingEntityNavigationPropertyName`) for the relationship being written. A schema's `lookupSchemaName` is usable only when it is the verified navigation-property name; do not infer case from the lookup attribute or impose PascalCase. Reference: `lib/services/execute-prompt.js` uses `wmkf_ai_Prompt@odata.bind` correctly. Smoke-test bulk inserts with `--limit 50` before committing to thousands of rows.

**3. Logical name ≠ schema name — Dataverse lowercases the whole schema name.**
- **Why:** Schema files declare attributes like `wmkf_SummaryBlobUrl` (PascalCase camel), but the *logical* name Dataverse exposes on read/write payloads is the full lowercase: `wmkf_summarybloburl`. Common pitfall: chopping at the underscore and lowercasing the prefix only (`wmkf_summaryblob`) → 400 / "field does not exist". Hit in W5 step 3 backfill: 177 errors on first commit-mode pass because the script wrote `wmkf_summaryblob`. Lookup navigation-property spelling is a separate relationship-metadata contract (see #2); don't infer it from attribute casing.
- **How to apply:** When translating an attribute schema-name to a logical-name, lowercase the entire string — don't try to preserve any boundary. Adapter FIELD_SELECT arrays and plain attribute PATCH fields use the fully-lowercased form. This does not determine lookup navigation-property spelling; resolve that separately from relationship metadata as described in #2. When adding a new attribute to an adapter, also add it to that adapter's FIELD_SELECT — otherwise idempotency checks that compare to existing values will silently miss the field and re-write on every run.

**4. `DynamicsService.queryAllRecords` caps at 5000 records.**
- **Why:** Hardcoded `MAX_EXPORT_RECORDS = 5000` in the service, intended for export safety. The historical `akoya_request` population example (25,561 rows) exceeded it; that is not a current row count.
- **How to apply:** For a read that must exceed the cap, use a reviewed bounded-pagination path that preserves the shared read restrictions, target interlock, authorization, and request timeouts. Do not copy an old raw-fetch script as a general bypass pattern: `scripts/backfill-request-person-junction.js` predates or omits some of those shared controls. Do not bypass them in handlers or scripts.

**5. UPDATING an existing attribute's metadata: PUT the full definition + PublishXml — `PATCH` returns 405.**
- **Why:** `apply-dataverse-schema.js` is **create-only, no updates** (header line 16), so changing a live column (e.g. widening a Double `MaxValue`) has no ready-made tool. The Web API rejects `PATCH` on `EntityDefinitions(LogicalName=…)/Attributes(LogicalName=…)` with **405 "does not support http method 'PATCH'"** (hit S237 widening `wmkf_relevancescore`).
- **How to apply:** GET the full attribute from the **non-cast** path (the cast path omits `@odata.type`), strip `@odata.*` annotations, set the changed property, set body `@odata.type` to the bare cast name (no leading `#`), **PUT** to the attribute path with header **`MSCRM.MergeLabels: true`**, then POST **`/PublishXml`** for the entity, then verify a read-back. Send the COMPLETE definition (only the one prop changed) — unspecified props reset to defaults; a malformed PUT 400s WITHOUT partially applying (fail-safe). Reference: `scripts/widen-relevancescore-max.mjs`. Adding a PICKLIST option is different — use the `InsertOptionValue` action (`scripts/extend-responsetype-picklist.mjs`).

**6. Reconcile schema drift before a full-wave deploy; relationship/key existence checks use SchemaName.**
- **Why:** `apply-dataverse-schema` is create-only. Relationship and alternate-key existence checks use **SchemaName**, so an out-of-band artifact under a different schema name can evade those checks. Attribute existence is checked by logical name; do not generalize the relationship/key behavior to attributes. S258 recorded a production dry-run of `--wave=2` proposing `wmkf_appreviewersuggestion_honorariumrequest` while the honorarium lookup appeared live in the Atlas. That is historical evidence of a discrepancy, not a current schema measurement.
- **How to apply:** Before a full-wave deploy, review the complete dry-run against current metadata and stop on any unexpected create. For one new attribute, an isolated follow-up wave can limit scope, but it does not replace metadata preflight. The S258 wave2 discrepancy remains a historical open item; re-probe current relationship metadata before deciding whether a duplicate risk remains. Reference: `lib/dataverse/schema/wave2-fieldprimer/akoya_request-fieldprimer.json` (S258 `wmkf_ai_fieldprimer` add).

**7. A metadata-probe `$select` must be TYPE-CORRECT for the cast type, or it 400s instead of 404-ing on an absent field.**
- **Why:** When probing attribute metadata via the typed cast path (`EntityDefinitions(LogicalName='e')/Attributes(LogicalName='a')/Microsoft.Dynamics.CRM.<Type>AttributeMetadata?$select=…`), selecting a property the cast type does NOT expose returns a **400 "Could not find a property named 'X' on type …"** — and that 400 can surface *before* the 404-on-absence, so an absent field looks like an error. The property sets differ by type: `PicklistAttributeMetadata` has **no `MaxLength`**; `MemoAttributeMetadata` exposes **`Format`** (not String's **`FormatName`**); only `StringAttributeMetadata` has `FormatName`. Hit S268 building `scripts/preflight-grantee-deliverables-fields.mjs` — a shared `$select` with `MaxLength` for the picklist probe 400'd; the Memo/String fields had already 404'd cleanly because their selects happened to be valid.
- **How to apply:** Build `$select` per attribute type, not one shared string. Picklist → `$select=LogicalName,AttributeType&$expand=OptionSet` (no MaxLength); String → `…,MaxLength,FormatName`; Memo → `…,MaxLength` (and read `Format` if you compare it). The type names map to schema-apply's `typeMetadata` switch (`lib/dataverse/schema-apply.js`). Reference: `scripts/preflight-grantee-deliverables-fields.mjs` (3-way exit contract: ABSENT→proceed-create, EXACT→idempotent no-op, DIVERGENT→abort, since schema-apply is creation-only).

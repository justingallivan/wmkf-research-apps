# Budget Form Spec — Codex Review
Reviewed `docs/BUDGET_FORM_SPEC.md` against the requested intake portal design sections, the sibling memberships build plan, `DynamicsService`, migration `005_intake_portal.sql`, the `akoya_request` Atlas page, and the 2026-05-13 Track 1 memory. I also checked the existing schema-change catalog and repository references for the proposed budget entity and parent fields.

## Findings

### CRITICAL Dataverse `$batch` is not supported by the current service
**File/section:** `docs/BUDGET_FORM_SPEC.md:349`; `lib/services/dynamics-service.js:777`; `lib/services/dynamics-service.js:814`; `lib/services/dynamics-service.js:912`
**Finding:** The idempotency strategy requires delete-and-replace "inside a single Dataverse `$batch` request", but `DynamicsService` exposes individual `createRecord`, `updateRecord`, and `deleteRecord` helpers only, and repository search found no `$batch`, changeset, or multipart batch implementation under `lib/services/dynamics-service.js` or `lib/`. This means the spec's atomic delete/insert/aggregate update path is not implementable with the current service primitives; if implemented as separate calls, retries can strand deleted or duplicated children and stale parent aggregates.
**Suggestion:** Add and test an explicit Dataverse changeset helper, or rewrite the spec around non-batch-safe idempotency with durable progress markers and compensation.

### HIGH `submission_jobs` is not in migration 005
**File/section:** `docs/BUDGET_FORM_SPEC.md:9`; `docs/BUDGET_FORM_SPEC.md:305`; `lib/db/migrations/005_intake_portal.sql:12`; `lib/db/migrations/005_intake_portal.sql:41`; `docs/INTAKE_PORTAL_DESIGN.md:268`
**Finding:** The spec says drafts externalize through `submission_jobs`, and the review task asked whether `intake_drafts` and `submission_jobs` exist in `005_intake_portal.sql`. The migration creates `intake_drafts` and `intake_audit`, but no `submission_jobs`; the design document only describes a future table and says to add it to a later migration. The JSONB draft storage is compatible with `budget` as a sub-object, but the queue table the budget spec relies on is not present in this migration.
**Suggestion:** Either add `submission_jobs` in the migration/build slice the budget spec references, or change the spec to say the queue table is pending.

### HIGH Budget entity shape conflicts with the existing schema-change catalog
**File/section:** `docs/BUDGET_FORM_SPEC.md:296`; `docs/BUDGET_FORM_SPEC.md:307`; `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:22`
**Finding:** The budget spec defines one row per logical line item with `wmkf_year1amount`, `wmkf_year2amount`, `wmkf_year3amount`, `_wmkf_akoyarequest_value`, `wmkf_rolecode`, `wmkf_sourcetype`, and aggregate parent fields. The existing schema catalog for the same working entity defines one row per year with `_wmkf_request_value`, `wmkf_year`, `wmkf_category` values like Personnel/Equipment/Supplies/Travel/Other Direct/Indirect, `wmkf_amount`, and `wmkf_lineorder`. Those are not minor naming differences; they imply different row cardinality, PA template grouping, lookup bind keys, and drain logic.
**Suggestion:** Reconcile `BUDGET_FORM_SPEC.md` with `INTAKE_PORTAL_SCHEMA_CHANGES.md` before schema JSON is written.

### HIGH Choice fields are specified as string labels, but service conventions require numeric Dataverse values
**File/section:** `docs/BUDGET_FORM_SPEC.md:313`; `docs/BUDGET_FORM_SPEC.md:316`; `lib/services/dynamics-service.js:930`
**Finding:** `wmkf_category`, `wmkf_lineitemkind`, and `wmkf_sourcetype` are listed as Option Sets populated with strings such as `personnel` and `other-source`. Existing service comments for Dataverse choice writes state that numeric values are the API contract and labels are not accepted. The spec says choice values will be recorded later, but the implementation-ready claim is too strong until the numeric values and mappings are part of the contract.
**Suggestion:** Add the numeric choice values and a JSON-to-Dataverse mapping table for every option-set field.

### HIGH Drain attribution contradicts the `MSCRMCallerID` primitive
**File/section:** `docs/BUDGET_FORM_SPEC.md:292`; `lib/services/dynamics-service.js:166`; `lib/services/dynamics-service.js:771`; `lib/services/dynamics-service.js:774`
**Finding:** The budget spec says async drain writes go through `MSCRMCallerID` "tied to the system service principal". The service primitive is named `actingUserSystemId`, only sends `MSCRMCallerID` when given a Dynamics `systemuserid`, and its create-record docs say unattended cron writes pass null. That makes the spec internally contradictory unless there is a real Dataverse systemuser row intended for attribution; an app registration/service principal is not the same thing as an arbitrary `systemuserid` in this code's contract.
**Suggestion:** Decide whether drain writes are attributed to the service principal with no `MSCRMCallerID`, or to a named Dynamics application/system user GUID, and state the exact source of that GUID.

### MODERATE Batch atomicity is the only stated cross-entity integrity control
**File/section:** `docs/BUDGET_FORM_SPEC.md:331`; `docs/BUDGET_FORM_SPEC.md:351`
**Finding:** The spec says the drain writes child rows and parent aggregate fields atomically in one batch, but it does not define behavior if the child insert/delete operations succeed and the parent aggregate PATCH fails. Because `$batch` support is absent today, this is not just theoretical: a multi-call implementation would leave referentially attached children with stale or missing parent totals.
**Suggestion:** Specify the transaction boundary and, if true batch is unavailable, persist per-step results plus a repair/retry strategy that recomputes aggregates from the submitted payload.

### MODERATE Concurrent edit safety depends on an ambiguous lock boundary
**File/section:** `docs/BUDGET_FORM_SPEC.md:356`; `docs/INTAKE_PORTAL_DESIGN.md:317`; `docs/INTAKE_PORTAL_DESIGN.md:328`
**Finding:** The spec relies on the drain's per-`request_id` advisory lock to prevent interleaving writes, while the design doc says the drain advances one job step at a time and holds the lock for one job step. That is clean only if the entire Dataverse delete/insert/aggregate update is truly one step and one atomic request. If the budget externalization becomes multiple Web API calls because `$batch` is not available, the spec does not say whether the advisory lock remains held across every Dataverse call and retry.
**Suggestion:** Define the drain lock scope explicitly for the full budget externalization section, including all Dataverse calls and retry decisions.

### MODERATE Aggregate drift story is under-specified for AkoyaGO or PA child-row writes
**File/section:** `docs/BUDGET_FORM_SPEC.md:343`; `docs/INTAKE_PORTAL_DESIGN.md:408`
**Finding:** The spec says drain is the only normal-operation writer and accepts stale aggregates if staff manually edits a child row. The parent design's PA boundary says PA owns fan-out from state changes and portal owns applicant-originated writes, but it does not prove that AkoyaGO cannot expose inline child editing or that a PA flow will never touch `wmkf_proposalbudgetline`. If either happens, the cached fields on `akoya_request` become untrustworthy during normal operation, not just rare manual cleanup.
**Suggestion:** Either add a server-side recompute mechanism on budget-child writes or explicitly block/hide child-row edits outside the drain path for pilot.

### MODERATE Conditional null rule for `wmkf_sourcetype` has no enforcement point
**File/section:** `docs/BUDGET_FORM_SPEC.md:301`; `docs/BUDGET_FORM_SPEC.md:316`; `docs/BUDGET_FORM_SPEC.md:388`
**Finding:** The field table says `wmkf_sourcetype` is populated only when `wmkf_category='other-source'` and null otherwise, but the spec does not define a drain validator, server-side schema rule, or form validator for this conditional-null invariant. ASSUMED from absence: the current implementation plan would rely on mapping discipline only.
**Suggestion:** Add an explicit drain assertion and, if Dataverse supports it cleanly, a business rule or plug-in guard for the conditional null/value relationship.

### MODERATE The `$100K` multiple invariant is not stated as a drain-time hard gate
**File/section:** `docs/BUDGET_FORM_SPEC.md:219`; `docs/BUDGET_FORM_SPEC.md:284`; `docs/BUDGET_FORM_SPEC.md:335`
**Finding:** The UI validation table says the cumulative WMKF total must be a multiple of `$100,000` live and on submit, and the data notes say totals are recomputed during drain, but the externalization section does not say the drain re-validates and refuses to patch Dataverse if the recomputed total violates the invariant. If a stale cached submit result, bug, or payload mutation gets through, downstream PA flows could see an invalid parent aggregate.
**Suggestion:** Make the drain recomputation a hard validation gate before any Dataverse writes and mark the job failed/permanent on violation.

### MODERATE Budget spec omits required `intake_audit` writes
**File/section:** `docs/BUDGET_FORM_SPEC.md:232`; `docs/BUDGET_FORM_SPEC.md:349`; `docs/INTAKE_PORTAL_DESIGN.md:529`; `lib/db/migrations/005_intake_portal.sql:41`
**Finding:** The intake design requires every state-changing portal action to write an `intake_audit` row, and the migration creates that table with draft/submit action examples. The budget spec mentions autosave and submit queueing but does not say draft autosaves, budget row changes, submit, drain externalization, or validation failures write audit records. This is a gap because the budget section contains material financial data.
**Suggestion:** Add audit events for draft upsert, submit enqueue, drain Dataverse write success/failure, and any staff repair/cancel path.

### MODERATE Externalization does not explicitly cover empty arrays and all-zero fixed personnel
**File/section:** `docs/BUDGET_FORM_SPEC.md:111`; `docs/BUDGET_FORM_SPEC.md:220`; `docs/BUDGET_FORM_SPEC.md:296`
**Finding:** The UI says equipment can be empty and only requires at least one line item somewhere in the budget to be greater than zero, so zero-dollar fixed personnel rows are valid if another section has dollars. The externalized-shape table says `budget.personnel[]` and `budget.equipment[]` become one row per entry, but it does not specify whether empty arrays produce no rows, whether fixed zero personnel rows are always written like fixed operations, or whether zero-value personnel rows are omitted. Those choices affect AkoyaGO grids and reviewer packet output.
**Suggestion:** Add explicit serialization rules for empty dynamic arrays and all-zero fixed rows by section.

### LOW `wmkf_locked` is a mutable informational flag for a policy invariant
**File/section:** `docs/BUDGET_FORM_SPEC.md:288`; `docs/BUDGET_FORM_SPEC.md:325`; `docs/BUDGET_FORM_SPEC.md:360`
**Finding:** The spec uses `locked: true`/`wmkf_locked` to identify the Facilities/Overhead row and assert its amounts are zero. Because the row already has stable `code`/`roleCode` semantics, a mutable boolean in Dataverse is weaker than deriving the rule from `wmkf_rolecode='facilities-overhead'`; if an inline grid or data import toggles the flag, the policy signal becomes ambiguous.
**Suggestion:** Treat `wmkf_rolecode='facilities-overhead'` as the authoritative invariant and keep `wmkf_locked` only as derived/display metadata, or drop it.

### LOW Field-collision check on `akoya_request` is clean in the Atlas, but not conclusive
**File/section:** `docs/BUDGET_FORM_SPEC.md:302`; `docs/BUDGET_FORM_SPEC.md:335`; `docs/atlas/dataverse-akoya-request.md:13`; `docs/atlas/dataverse-akoya-request.md:68`
**Finding:** No collision with `wmkf_projectyears`, `wmkf_totalwmkfrequested`, `wmkf_totalothersources`, or `wmkf_totalprojectcost` appears in `docs/atlas/dataverse-akoya-request.md`, and repository search found those names only in the budget spec. However, the Atlas explicitly lists key/sample-probed fields and notes the entity had 364 fields, so absence from this doc is not proof that the live Dataverse entity lacks similarly named fields.
**Suggestion:** Before schema deploy, verify the live `akoya_request` attributes directly and update the Atlas with the result.

### LOW Navigation-property bind key remains unresolved
**File/section:** `docs/BUDGET_FORM_SPEC.md:312`; `lib/services/dynamics-service.js:979`; `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:28`
**Finding:** The spec correctly notes that lookups must be bound via the navigation property and that exact bind keys are recorded at deploy, and existing code shows case-sensitive nav-property names can be surprising. But the budget spec's lookup name `_wmkf_akoyarequest_value` conflicts with the schema catalog's `_wmkf_request_value`, so the future `@odata.bind` key cannot be inferred from the current documents.
**Suggestion:** Resolve the lookup logical name first, then record the exact PascalCase/case-sensitive navigation property in the spec before implementation.

### LOW No finding — 429 throttling is addressed by the parent async-drain design
**File/section:** `docs/INTAKE_PORTAL_DESIGN.md:262`; `docs/INTAKE_PORTAL_DESIGN.md:317`; `docs/INTAKE_PORTAL_DESIGN.md:573`; `docs/BUDGET_FORM_SPEC.md:345`
**Finding:** The specific question about 429 throttling does not surface a budget-spec issue. The intake design explicitly treats 429s as transient drain failures with backoff, calls for deadline rehearsal watching Dynamics/Graph 429s, and the budget spec points to that Postgres-first async-drain pattern rather than synchronous Dataverse writes.
**Suggestion:** Keep the budget drain wired to the shared queue/backoff behavior and include a budget-heavy replay case in the pre-launch rehearsal.

### LOW No finding — `queryAllRecords` 5,000-row cap does not break the per-request budget scenario
**File/section:** `lib/services/dynamics-service.js:616`; `lib/services/dynamics-service.js:661`; `docs/BUDGET_FORM_SPEC.md:351`
**Finding:** The specific question about `queryAllRecords`'s 5,000-row cap does not surface a practical budget-spec issue for pilot because delete-and-replace filters by one `akoya_request`, and a single application budget should not approach 5,000 child rows. The spec still should avoid unfiltered scans, but the cap itself is not the weak point.
**Suggestion:** Query/delete children by parent request id only, and treat unexpectedly large child counts as a data-quality alert.

## Summary
Counts by severity: CRITICAL 1, HIGH 4, MODERATE 7, LOW 5, NIT 0. Overall, the Postgres draft JSON shape is compatible with the existing `intake_drafts.draft_json` column, and the async-drain direction matches the intake portal design. The blocking problems are in the externalized layer: the spec assumes an atomic Dataverse `$batch` path the service does not provide, conflicts with the already-recorded budget entity sketch, and leaves several invariants enforced only by prose rather than by drain/server checks.

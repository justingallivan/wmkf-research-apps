# Optional Request narrative text — 2026-11-09

Owner: Codex. Branch: `codex/request-narratives-2026-11-09`.
Worktree: `/private/tmp/wmkf-request-narratives`.

## Scope and state

[VERIFIED via source and focused Jest tests] Two optional persistent plain-text
fields are implemented in branch source. Staff with Workbench access can read;
the assigned lead Program Director or a superuser with a linked Dynamics actor
can edit/save. The app never generates these values. No existing abstract,
AI summary, governed Initial Assessment document, or document pointer changes.

| App/API key | Dataverse logical column | Display name | Storage |
|---|---|---|---|
| `lay_abstract` | `wmkf_layabstract` | Lay Abstract | Optional Memo, 100,000 characters |
| `initial_assessment` | `wmkf_initialassessment` | Initial Assessment | Optional Memo, 100,000 characters |

[VERIFIED LIVE 2026-11-09 Pacific] After explicit owner approval, schema wave
`36-request-narratives` created both columns in Production (`wmkf.crm.dynamics.com`).
`scripts/probe-request-narrative-fields.js --target=prod --verify` independently
confirmed the exact schema/display names, Memo type, optional RequiredLevel,
100,000-character limits, and read/update capability. The runtime API accepted
both columns in a zero-row projection; no Request content was retrieved or changed.
Metadata IDs: Lay Abstract `b96d22b9-bcdc-f111-84e8-000d3a31b218`;
Initial Assessment `0f0c69cc-bcdc-f111-84e8-000d3a361d0a`.

The existing publisher and solution were reused. No broad publish operation was
needed: the new columns were already selectable after creation. Sandbox URL is
not configured locally, and local staff impersonation is disabled (read-only
editor until an authorized environment enables it). App deployment, live staff
save/readback, and the external Power Automate flow remain unverified.

## Contract and overwrite protection

Overview → `RequestNarrativesCard` → GET/PATCH `/api/workbench/request-narratives`
→ `request-narratives-service` → grant-request adapter → `akoya_request`.

GET is read-only and returns both texts, the concrete row version, and edit
eligibility. PATCH accepts `{requestId, version, changes}`. Only the two named
keys are allowed in `changes`; omitted keys are untouched. Null or empty string
clears a field; other text, including whitespace and line breaks, is preserved.
Unknown keys, wrong types, excessive length, absent/wildcard version, or invalid
request ID fail before writes. A no-change save does not PATCH.

Authorization is based on the fresh request's lead PD and the authenticated
session. PATCH uses that request's concrete ETag and actor with no impersonation
fallback; editing requires `DYNAMICS_IMPERSONATION_ENABLED=true`. A mismatched version or Dataverse 412 yields 409 with no retry. Preview
against production is read-only. Existing DAL restrictions and target interlock
remain in force.

The editor never polls, autosaves or regenerates. Dirty drafts survive save errors;
reload asks before discarding them. Navigation asks before discarding dirty text.
Request-keyed mounting plus generation guards prevent late success/error responses
from changing a different request. A successful PATCH followed by a failed reload
is reported as saved with reload required, not as a failed write. A transport error
may have an uncertain write outcome: reload and compare before another save.

## Power Automate owner contract — required before rollout

The external workflow is not stored or modified here. The app cannot constrain a
workflow that directly writes Dataverse. The flow owner must implement and verify:

1. Initialize only on the designated first submission/initialization event, with a
   durable workflow-owned idempotency receipt per Request. Do not run on every
   Request modification. A blank field alone is NOT proof of first initialization:
   staff may deliberately clear text.
2. Before generation/read-modify-write, read the Request and retain its concrete
   `@odata.etag`. Supply that exact value as `If-Match` on the initialization PATCH.
   If text already exists or initialization was recorded, do not overwrite it.
3. On 412, stop and route for review; never reread and blindly retry with a fresh
   ETag. Retrying the original conditional PATCH cannot overwrite a later edit.
4. Write only the intended new columns; preserve all other fields. Record successful
   initialization durably, including reconciliation of uncertain outcomes. Prevent
   retries from refilling a human-cleared field or overwriting a human revision.
5. Verify initial fill, repeat event, concurrent staff edit, deliberate clearing,
   and a timeout-after-write against owned test data before enabling the flow.

No automatic-overwrite guarantee is claimed for the external flow until these
checks pass. The app protects its own save path only.

## Provision and release

Use the existing Dataverse schema process; no Postgres migration or fresh-install
schema change applies. The isolated additive wave contains exactly these two
optional Memo attributes. Read-only commands:

```sh
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-narrative-fields.js --target=prod --verify
DATAVERSE_ALLOW_PROD_READS=yes node scripts/apply-dataverse-schema.js --target=prod --wave=36-request-narratives
```

Provisioning is complete under the owner's explicit approval. The apply used the
normal dated production-write acknowledgement and `--execute`; the subsequent
independent typed-metadata/runtime projection probe passed. No Request-record
mutation, main merge, application deployment, or external workflow edit was
performed. Remaining release work is workflow-owner verification, an approved
staff save/readback rehearsal, J27 integration review, and deliberate app promotion.

Review the one-card Overview integration against Claude's active J27 branch before
merge; the owner explicitly authorized the small independent integration. The
original main checkout and other sessions' dirty work were preserved.

## Bounded verification and fact reconciliation

Scope: the new text fields only; existing governed document workflows are unrelated.
Source, schema, route, editor, and tests agree on both field names and their
optional semantics. Atlas and API security inventory distinguish live schema from the
branch-built, not-yet-promoted app consumer. Historical Initial Assessment document and AI-summary
references remain unchanged because they describe distinct surfaces.

Partial-success unit: one atomic conditional Request PATCH, never a batch. No new
background job, stream, model call, Postgres table, cleanup policy, or helper
extraction. Stored text remains with its Request. Existing consumers do not select
these new columns; only the dedicated reader does, keeping unavailable schema from
breaking the existing request resolver. The new card reports a scoped error.

Startup ran all 72 defined checks/self-tests sequentially; the initial local-link
check raced the new memory-link setup and passed on rerun. Focused tests cover
authorization, session identity, validation, omitted fields, clearing, readback,
stale versions, concurrent changes, explicit-save behavior, read-only rendering,
and stale async responses. Live persistence and Power Automate behavior are NOT
proved by mocked tests. Independent review found SPA draft loss; the navigation
confirmation and regression test address it.

Final verification: 33 focused tests passed across service, route and editor suites;
18 existing Overview regression tests also passed. Production build passed. Scoped
lint has zero errors (one pre-existing Overview effect warning). All 26 affected
gates/self-tests passed, including local agent links, API inventory, Atlas,
fact consistency, canonical pointers, doc currency/symbols, route lifecycle/service
boundaries, GUID validation, DAL/context boundaries, type checking and secret scan.

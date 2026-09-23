# Test Request Factory — schema proposal

Status: **SANDBOX SCHEMA APPLIED; TWO MARKED REQUESTS CREATED; APP-OWNED FOLDER/LOCATION PROVEN; READ-ONLY PREVIEW DEPLOYED; no create/copy route, production apply, or document-ready fixture.** Sandbox readback proves the four rehearsal fields persist through create. Request 1000339 additionally proves the app suite can create and own its exact SharePoint folder and Dataverse location (`evidence/test-request-factory/app-owned-location-rehearsal-2026-09-23.json`). Its meeting date was rewritten. The deployed Admin preview is non-writing and does not change the schema rollout boundary below.

## Proposed schema wave

The local implementation adds an isolated `extensions-on-existing` wave named `wave29-test-request-isolation`, containing only the two new `akoya_request` attributes. This follows the repository's isolated-wave convention in `wave2-triagestatus`, `wave2-fieldprimer`, and `wave7-reviewer-engagement`: the JSON declares `kind`, `entityLogicalName`, an explicit no-automation/no-duplicate warning, and creation-only semantics. The wave must be dry-run and metadata-preflighted before any target apply. Schema application is creation-only and does not reconcile a divergent pre-existing field.

### `wmkf_IsTestRequest`

| Property | Proposed value |
|---|---|
| Logical name | `wmkf_istestrequest` (lowercase derived from SchemaName convention) |
| Type | `Boolean` |
| Display name | `Synthetic Test Request` |
| Required level | `None` |
| Default | `false` |
| Createable | Preflight absence/spec first; verify `IsValidForCreate` in post-apply target metadata before enabling any factory write |
| True/false labels | `Test request` / `Ordinary request` |
| Initial create value | `true`, supplied by the server-side factory in the same request INSERT |
| Update policy | Written only by the factory's creator (today the local operator CLI). Every deployed app write path refuses a create or update body that names the field (`assertTestRequestMarkerNotWritten`, wired into `DynamicsService.createRecord`, `updateRecord` and changeset POST/PATCH, 2026-09-23) |

The default false is a compatibility proposal for ordinary rows, not proof that existing rows will return false. Schema preflight and post-apply readback must establish that behavior before guard rollout. Readers must distinguish an authoritative selected value from a missing projection, absent schema or failed query. Test-only operations require marker true plus valid matching run ownership; verified ordinary false rows do not require a run ID. The default does not suppress plugins or flows.

### `wmkf_TestCreationRunId`

| Property | Proposed value |
|---|---|
| Logical name | `wmkf_testcreationrunid` |
| Type | `String` |
| Display name | `Test Creation Run ID` |
| Max length | `36` (canonical UUID text) |
| Required level | `None`; the factory supplies it at create time |
| Default | none |
| Createable | Preflight absence/spec first; verify `IsValidForCreate` in post-apply target metadata before enabling any factory write |
| Initial create value | server-owned run UUID, same INSERT as the marker |
| Update policy | Same write guard: no deployed app create or update may name it; never accepted from a browser payload |

The field is a correlation/ownership key, not an alternate request number or an authorization token. The operation ledger remains the durable authority for the run; this request field is only a bounded Dataverse-side join. No alternate key is proposed: uniqueness is per factory ledger/run and must not be inferred from a Dataverse field without an explicit concurrency design.

The marker and run ID must be written together in the initial request POST. A later PATCH is too late for create-triggered plugins or Power Automate. After create, the service must reread the exact GUID, verify marker `true`, exact run ID and server-returned `akoya_requestnum`, then continue. A mismatch becomes `needs_attention`; it must not be repaired by blindly PATCHing the marker.

## Existing fields and environment gaps

The existing metadata receipt at `docs/plans/evidence/test-request-factory/metadata-2026-09-20.json` reports the following. These are metadata facts, not authorization/default proof.

| Field/control | Production receipt | Sandbox receipt | Schema implication |
|---|---|---|---|
| `wmkf_istestrequest` | absent | applied/createable 2026-09-21 | Production remains blocked; sandbox exact Boolean type/createability verified; tracked create spec sets default false |
| `wmkf_testcreationrunid` | absent | applied/createable 2026-09-21 | Production remains blocked; sandbox exact String(36) verified |
| `wmkf_respondreminderenabled` | Boolean, createable | applied/createable 2026-09-21 | Existing reviewer-engagement contract applied through the isolated two-field parity wave; factory writes false |
| `wmkf_reviewduereminderenabled` | Boolean, createable | applied/createable 2026-09-21 | Same isolated parity wave; factory writes false |
| `wmkf_triagestatus` | Picklist, createable | absent | Not part of marker wave; triage-dependent recipes remain target-blocked |
| `akoya_applicantid` | ApplicationRequired | ApplicationRequired | Existing lookup must be supplied through verified `akoya_applicantid@odata.bind` → `accounts`; intake's `akoya_Account@odata.bind` is not the factory contract |
| Other create requiredness | Fiscal year in receipt | Request type and meeting date in receipt | Policy compiler supplies only explicit, verified recipe values; it never copies source lifecycle/cycle automatically |

The production reminder fields are existing schema, with documented default `true` in `wave7-reviewer-engagement`. Therefore the factory must explicitly write both to `false` on every supported create. Sandbox absence is a rollout blocker, not a reason to silently omit the fields. Metadata presence does not prove that an ordinary staff update, plugin, or flow will preserve the values.

The marker wave must not add reminder fields or triage fields by copy. If sandbox needs the existing reviewer-engagement fields, apply the already-owned reviewer-engagement schema contract in a separately reviewed additive step, preflight it independently, and verify no Power Automate trigger. Do not mix unrelated drifted relationships into the new wave.

## Marker semantics and unknown state

The resolver must return an explicit classification; it must never interpret `undefined` as ordinary:

| Authoritative read | Classification / behavior |
|---|---|
| Marker true, valid matching run | Synthetic: exclude from ordinary lists/actions; permitted test action still needs admin/ownership authorization. |
| Marker true, missing/invalid run | Synthetic anomaly: exclude and deny; never ordinary. |
| Marker false, no run | Ordinary: preserve normal authorized behavior; no run ID required. |
| Marker false or null with a run | Inconsistent: exclude/deny and report for investigation. |
| Explicit null, no run (selected projection) | Ordinary. [VERIFIED via read-only sandbox query, 2026-09-23] Existing rows read back null after the field is applied (0 false, 2 true among 5,000+); only the factory writes the marker, always `true` in the initial INSERT. See the design doc's *Stage 1 decisions and plan*. |
| Missing property, missing schema, failed query, malformed value or unproven null | Unknown: fail closed. A projection omission must not expose a marked row or allow dispatch. |

Transport/provider actions require a positively verified ordinary classification. The legacy-null normalization above is the reviewed rule (Stage 1a); a guard must never treat a selected null marker as unknown, or it would block every historical row. There is no client `testMode`, `verified` or bypass flag. Exclusion fragments must preserve this classification in OData, FetchXML, direct-ID and Search; a paged client filter is not a complete query.

## Metadata versus permission/default proof

Metadata GET proves logical names, types, createability flags, required-level declarations, lookup relationships and (where returned) defaults. It does not prove:

- that the authenticated app principal may create or update the field;
- that a vendor plugin accepts `wmkf_istestrequest=true` in the initial INSERT;
- that Power Automate/status-driven flows exclude the row;
- that `akoya_requestnum` is allocated and returned as expected;
- that reminder false values survive plugin/default processing;
- that the target SharePoint location is provisioned;
- that Dataverse Search, FetchXML, exports, workers and email/payment paths honor the marker.

The first controlled rehearsal was owner-authorized and rejected by the sandbox synchronous workflow chain before persistence. The owner then classified GoVerify as irrelevant to the exercise and authorized a temporary sandbox bypass plus one fresh create. Request 1000338 persisted the marker, run ID and both reminder-false values and received a server number. The requested meeting date did not survive processing, and no SharePoint location appeared in the original attempt window while sandbox background processing was disabled. A location and empty folder appeared later under a staff user; see the dated handoff and both receipts. A schema default of false is a compatibility default, not a security control.

The reproducible census receipt is `docs/plans/evidence/test-request-factory/platform-2026-09-20.json` (probe: `scripts/probe-test-request-platform.js`). Both targets report `{SEQNUM:7}` request-number metadata and document management enabled; neither proves a create or provisioning outcome.

The read-only process-definition census also found environment differences in active request/location definitions and vendor hooks. Production and sandbox must not be treated as equivalent: a production Request create/update hook set differs from the sandbox set, and a SharePoint-location health evaluator on location create/update does not prove that a request create provisions a location. The lack of a narrative/package match in the visible definitions does not prove those flows absent. The platform owner must identify which hooks are mandatory, how a marked initial INSERT is handled, and whether any request/status update can still produce narrative, package, email, payment, or location side effects.

## Minimum Stage 1 ordinary consumer inventory

**Superseded in part by owner decisions 8–9 (design doc, 2026-09-23).** Test requests are shown in Workbench lists and search with a TEST badge, and ordinary actions (including Reviewer Finder and staff-clicked AI generation) work on them. Rows below that say to exclude marked rows from Workbench or Reviewer Finder lists, or to deny ordinary or provider actions, no longer apply; exclusion now covers only reports, exports and cycle totals, and denial covers payments/BILL, Contact promotion, email (see *Reviewer email confinement*) and scheduled jobs. The design doc's *Stage 1 decisions and plan* is the current Stage 1 scope. Stage 1 must add marker-aware reads/guards at the following exact source surfaces. `shared/config/workbenchVisibility.js` remains the business eligibility contract and should not be changed to hide tests; marker exclusion is a separate filter/resolver layer.

### Lists, search, aggregates and exports

| File | Current surface | Required Stage 1 treatment |
|---|---|---|
| `lib/services/workbench/dashboard-service.js` | Workbench OData list and aggregate reads via `queryAllRequests` | Add server-built synthetic exclusion to list and aggregate paths; preserve complete counts |
| `lib/services/workbench/program-scope-service.js` | Program-scoped Workbench request query | Add the same exclusion fragment; do not alter `buildVisibilityFilter` eligibility |
| `lib/services/workbench/request-search-service.js` | OData filter leg, FetchXML cycle aggregation, Dataverse Search leg, ID hydration | Apply marker filtering independently to each leg; prove Search/index support or keep that leg blocked |
| `lib/services/reviewer-finder/my-proposals-service.js` | Request discovery scans | Exclude marked rows from ordinary reviewer-finder lists |
| `lib/services/reviewer-finder/contact-history-service.js` | Request history scan | Exclude marked rows from ordinary contact history |
| `lib/services/reviewer-finder/save-candidates-service.js` | Request-scoped discovery/read path | Exclude marked rows before candidate persistence decisions |
| `lib/services/reviewer-finder/remove-candidate-service.js` | Request query used by candidate removal | Preserve ordinary semantics and deny marked request actions |
| `lib/services/reviewer-merge.js` | Request scans used during merge | Exclude marked rows and reject direct marked-request merge |
| `lib/services/workbench/grantee-deliverables/awardees-service.js` | Awardee discovery | Exclude marked rows from awardee/report surfaces |
| `lib/services/workbench/grantee-deliverables/cycle-export-service.js` | Cycle export scan | Exclude marked rows while keeping true totals honest |
| `lib/services/cron/generate-grantee-titles-service.js` | Background request scan | Skip marked rows before provider work |

### Synchronous and scheduled transport/provider actions

| File | Current surface | Required Stage 1 treatment |
|---|---|---|
| `lib/services/site-visit-materials/collection-service.js` | `inviteMaterialsContributors` and `remindMaterialsContributors` send paths | Resolve marker before dispatch; deny marked requests in V1 |
| `pages/api/meeting-tracker/visits/[requestId]/materials.js` | Route dispatches invite/remind actions | Preserve route auth and map marked-request denial; service remains authoritative |
| `lib/services/site-visit/logistics-service.js` | Site-visit scheduling eligibility | Do not alter ordinary eligibility; deny synthetic scheduling unless a later recipe explicitly permits it |
| `lib/services/workbench/grantee-deliverables/send-invite-service.js` | Direct grantee invitation; the API supplies To/Cc and the service mints a grantee link before creating the email | Resolve marker and deny marked requests before token minting or email-activity creation |
| `lib/services/scheduled-email-service.js` | Scheduled grantee reminder coordinator; claims the row, mints a secure grantee link and creates/sends the Dynamics activity | Resolve marker and deny marked requests before claiming, token minting, recovery/activity creation or send |
| `lib/services/reviewer-reminder-sweep.js` | Scheduled reviewer reminder worker | Add marker to request projection and skip marked rows before claims/token mint/send |
| `lib/services/reviewer-manual-reminder.js` | Staff-triggered reviewer reminders | Resolve marker before claim/send; confined at the shared delivery seam (see *Reviewer email confinement* below) |
| `lib/services/review-manager/send-emails-service.js` | Reviewer invitation transport | Resolve parent request marker before any email activity; confined at the shared delivery seam (see *Reviewer email confinement* below) |
| `lib/services/reviewer-thankyou-sweep.js` (cron `send-review-thankyous`) | Scheduled thank-you email over all received, un-thanked suggestions | Skip marked requests before send (added 2026-09-23) |
| `lib/services/review-synthesis-drain.js` (cron `drain-review-syntheses`) | Scheduled AI review synthesis | Skip marked requests before provider work (added 2026-09-23) |
| `lib/services/review-documents/individual-file-service.js` (cron `file-review-docx`) | Scheduled review DOCX filing to SharePoint | Skip marked requests unless a later recipe explicitly files synthetic reviews (added 2026-09-23) |
| `lib/services/reviewer-suggestion-sweep.js` (cron `sweep-stale-invites`) | Scheduled stale-invite status change | Skip marked requests (added 2026-09-23) |
| `lib/services/external-review/respond-service.js` → `lib/services/reviewer-acceptance-drain.js` (cron `drain-reviewer-acceptances`) | Accept enqueues a job whose drain promotes the reviewer to a CRM Contact and runs honorarium/BILL onboarding | In production, marked requests must not promote a Contact or onboard for payment; the accept itself may record (added 2026-09-23) |
| `lib/services/initial-assessment/artifact-service.js` | Provider-backed IA generation | Deny generic paid generation for marked rows; future IA preset uses a separate synthetic artifact path |
| `pages/api/phase-i-dynamics/summarize-v2.js` | Phase-I provider route | Resolve marker before provider invocation; deny marked rows in V1 |
| `lib/bill/honorarium-onboard-orchestrator.js` | Honorarium/request creation and reminder defaults | Reject marked source requests from ordinary honorarium flow; no payment fixture in V1 |
| `lib/services/grantee-submit-notification.js` | Grantee email notification | Resolve marker before email dispatch; deny marked rows |

**Reviewer email confinement (owner amendment 2026-09-23, design doc decision 4).** Email concerning a marked request is **default-deny at the shared delivery seam**. The sole exception is reviewer engagement sent under the trusted server-owned purpose and recipient binding below. Synthetic reviewers use real staff-controlled throwaway inboxes so staff can exercise reviewer interactions; materials-contributor and grantee email remain denied. The seam owns this policy rather than each sender re-implementing it, because a hand-maintained inventory can miss send paths.

[VERIFIED 2026-09-23 via a mechanical caller census over `lib/`, `pages/` and `shared/`] The repository's reviewer-email senders reach `lib/services/dynamics/email.js` through the `DynamicsService` facade, either through `createAndSendEmail` or through `createEmailActivity` followed by `sendEmail`; the adapter preserves the same path (`lib/dataverse/adapters/email-activity.js:18-27`). Several senders currently make the regarding request optional (`lib/services/review-manager/send-emails-service.js:894-917`; `lib/services/reviewer-acceptance-email.js:170-177`), so a guard keyed only on a present regarding record would miss them. The direct grantee invite accepts To/Cc from the HTTP body and mints before delivery (`pages/api/workbench/grantee-deliverables/send-invite.js:46-60`; `lib/services/workbench/grantee-deliverables/send-invite-service.js:92-110`). The scheduled-email coordinator identifies itself as a secure-grantee-link flow and claims before mint/activity creation (`lib/services/scheduled-email-service.js:1-22,231-279`).

[VERIFIED via `lib/services/review-manager/withdraw-sufficient-service.js:326-363` and `lib/services/reviewer-engagement/terminal-transition.js:401-414`] `withdraw-sufficient-service.js` resolves and emails the reviewer directly; it does not dispatch through `terminal-transition.js`. They are separate senders and require separate coverage.

Required Stage 1 contract:

1. **Default-deny seam guard.** Before an email activity is created or sent, resolve the marker for an `akoya_request` regarding record. A marked request is refused unless the call carries the one permitted reviewer-engagement purpose. Unknown, missing or unreadable marker state fails closed. The guard must cover `createAndSendEmail`, `createEmailActivity` and `sendEmail` through `DynamicsService`; calling a lower primitive or the email-activity adapter must not bypass it.
2. **Trusted reviewer purpose and binding.** The exception is a server-owned reviewer-engagement purpose created inside trusted service code, never a value accepted from a route body or other client input. It identifies one reviewer suggestion and synthetic person, and the seam independently verifies that both belong to the regarding request. Missing, forged, stale or mismatched purpose/binding is refused.
3. **Recipient and address authority.** Every To and Cc recipient must normalize to the recorded address of that one synthetic person; no additional recipient is allowed. The run ledger's per-run reviewer assignment is authoritative once it exists, and a reviewer-editable field is never an address authority. The acceptance confirmation currently prefers `suggestion.wmkf_revieweremail`, which can reflect `contactEdits.email` (`lib/services/reviewer-acceptance-email.js:123-132`; `lib/services/external-review/respond-service.js:105-126`); an edited address must not become a marked-request recipient.
4. **Regarding is mandatory for reviewer sends.** Every reviewer-engagement sender must pass the specific request as `regardingId`/`akoya_request`; the seam refuses a reviewer purpose without it rather than treating the send as unmarked.
5. **Early grantee denial.** The direct invite and scheduled reminder paths must resolve the marker and deny a marked request before any token mint, row claim, email recovery, activity creation or send. They cannot request or manufacture the reviewer-engagement purpose.

Per-sender checklist. Every **Confined** reviewer sender needs the full matrix: positive synthetic recipient; negative mismatched address; negative reviewer-edited address; negative missing regarding request; and negative missing or forged reviewer-engagement purpose. Skipped/denied rows need tests proving refusal occurs before their named side effects.

| Sender | Send path | Marked-request behavior |
|---|---|---|
| `lib/services/review-manager/send-emails-service.js` | Invitations and staff-sent reviewer email | Confined; full reviewer matrix |
| `lib/services/reviewer-manual-reminder.js` → `sendOneReminder` in `reviewer-reminder-sweep.js` | Staff-triggered respond/review-due reminder | Confined; full reviewer matrix |
| `lib/services/reviewer-acceptance-email.js` via `reviewer-acceptance-drain.js` | Acceptance confirmation | Confined; full reviewer matrix; recipient is the ledger-recorded synthetic address, never an edited one |
| `lib/services/reviewer-due-extension.js` | Due-date extension notice | Confined; full reviewer matrix |
| `lib/services/review-manager/withdraw-sufficient-service.js` | Withdraw-sufficient courtesy email | Confined; full reviewer matrix |
| `lib/services/reviewer-engagement/terminal-transition.js` | Terminal release/withdraw email | Confined; full reviewer matrix |
| `lib/services/reviewer-reminder-sweep.js` (sweep candidate selection) | Scheduled reminder | Skipped at candidate selection, not inside the shared `sendOneReminder`, which manual reminders also use |
| `lib/services/reviewer-thankyou-sweep.js` | Scheduled thank-you | Skipped (scheduled worker) |
| `lib/services/workbench/grantee-deliverables/send-invite-service.js` | Direct grantee invite | Denied (grantee) before token mint or activity creation |
| `lib/services/scheduled-email-service.js` | Scheduled grantee reminder | Denied (grantee) before claim, token mint, activity recovery/creation or send |

The mechanically derived sender census is authoritative; this hand-written table is an implementation checklist. A structural gate must derive the census from actual callers of the `lib/services/dynamics/email.js` delivery primitives (`createAndSendEmail`, `createEmailActivity` and `sendEmail` through `DynamicsService`, including adapter/dependency indirection), require every caller to be classified, and fail when a sender is added, removed or bypasses the seam. A sender cannot silently disappear because the table was not updated.

`NotificationService` (`reviewer-quota.js`, `alert-reviewer-email-mismatch.js`) sends staff alerts, not reviewer email. The default-deny seam still applies whenever it names a marked request as the regarding record. Materials-contributor and grantee email on marked requests remain denied in V1.

This is the minimum Stage 1 inventory from current source fan-out. It is not a claim that off-platform flows, vendor plugins, Power Automate, or every report have been proven safe. Stage 1 must add a symbol/field census gate so newly found raw `akoya_request` readers cannot silently bypass the marker.

## Rollout and rollback order

1. **Preflight only:** validate both targets' metadata, relationship `akoya_applicantid@odata.bind` → `accounts`, create/update permissions, field defaults and trigger ownership. Keep production enablement disabled.
2. **Expand schema:** apply the isolated marker/run wave only after preflight approval, first to the approved sandbox. Verify exact logical names and no Power Automate trigger. Provision the existing reminder controls separately where absent; do not proceed with factory creation until both false writes are supported.
3. **Read compatibility:** deploy marker resolver and ordinary read exclusion code with no create UI. False and selected-null rows with no run remain ordinary; marked rows are excluded/denied according to the inventory above. Verify direct-ID, Search, FetchXML, exports and worker projections.
4. **Guard and rehearsal:** enable marked-request transport/provider denials, then run a bounded sandbox create only after suppression owner evidence and permission checks. Verify initial marker/run/reminder values, number readback, no trigger side effects, and exact downstream read behavior.
5. **Production promotion:** promote schema and guards deliberately under the campaign release strategy, with a last-known-good deployment and platform-owner evidence. Production clone creation remains disabled until the isolation and possible duplicate-location gates close.

Rollback is additive and leaves fields in place. First disable new factory creation and UI exposure. Keep marker-aware read exclusions and marked-request transport denials active so existing synthetic rows cannot leak or send while code is being reverted. Retire/reconcile owned synthetic rows through the future ledger before considering removal of guards. Never drop the fields, reset marker values globally, or remove the marker-aware reader before all marked rows are accounted for. A code rollback cannot undo Dataverse, SharePoint, email, or flow side effects.

## Required tests and gates before rollout

- Schema JSON shape test: exact logical names, types, max length/defaults, isolated wave, no unrelated files.
- Metadata preflight: both targets; createability, required levels, relationship target, reminder availability, and no unexpected existing divergent fields.
- Marker truth table: true/false/null/missing/invalid marker and valid/invalid/mismatched run ID.
- Initial INSERT contract test: marker true, run ID present, both reminder flags false, applicant binding to accounts, no source number/contact/annotation/workflow fields.
- Reader fan-out tests for every file in the Stage 1 inventory; direct-ID and aggregate totals must remain complete after exclusion.
- Mechanically derived sender-census gate over actual callers of the three `dynamics/email.js` delivery primitives; every caller is classified, every reviewer sender supplies a trusted purpose plus regarding request, and the hand-written checklist cannot replace or narrow the derived census.
- Reviewer-confinement tests for every derived reviewer sender: positive synthetic recipient using the current recorded-address authority (the run ledger once it exists); negative mismatched address, reviewer-edited address, missing regarding request, and missing/forged purpose. Ordinary unmarked regressions remain unchanged.
- Transport/provider negative tests proving marked rows cannot generate, pay or notify outside the reviewer exception. Direct and scheduled grantee paths must deny before token minting, claiming, recovery or email-activity creation; materials-contributor paths remain denied before dispatch.
- Trigger/flow disconfirming rehearsal owned by the platform owner; source tests cannot substitute for this evidence.
- Run sequentially: focused policy/consumer Jest tests, relevant gate and its self-test, `check:api-routes` and self-test for new routes, `check:atlas` and self-test after Atlas updates, `check:fact-consistency` and self-test, `check:doc-currency` and self-test, scoped lint, then build. No schema apply or production promotion until all relevant gates and platform evidence pass.

## Open decisions and blockers

- The initial sandbox dry-run verified publisher `WMKF_Publisher` with prefix `wmkf` and pre-apply absence of both proposed attributes. The subsequent controlled apply created them and metadata/readback verified them; explicit solution membership remains unverified because the dry-run check did not establish it.
- The two reviewer-engagement reminder controls are now applied in sandbox through the isolated parity wave and survived false-value create readback. Production already had those controls; production marker/run schema remains unapplied.
- Platform-owner suppression contract for initial create and every status/pointer update.
- Production duplicate-location and recovery contract for the sandbox-proven app-owned path.
- Deterministic meeting-date/default behavior: the manifest supplied `2099-12-01`, but create readback returned `2024-12-13`.

Until these are resolved, sandbox schema stays additive and runtime create/copy execution remains disabled. The compiler is used only by the read-only Admin preview, which strips actionable payloads and reports blockers. Production schema is unapplied. The sandbox rehearsal proves Request plus app-owned folder/location creation, not that the Test Request Factory is production-ready.

## Review disposition

Sol reviewed the source contract and proposal. Root incorporated the material corrections: absent projections never classify ordinary; requiredness/createability of new fields are checked after schema apply; verified ordinary rows need no run ID; wave naming is engineering work, not a user blocker. At that review checkpoint, schema was unapplied. The platform census rejects malformed/partial pages, bounds pagination and tests cross-origin/collection continuation rejection and omission of credential-bearing action inputs.

Previous proposal-only review (before the local isolation slice below): Sol **ACCEPTED the proposal/evidence scope** after the corrections. Root verified 35 focused tests (existing offline policy plus new probe), scoped ESLint, probe syntax and `git diff --check`. Doc-currency and fact-consistency with sequential self-tests, plus docs-catalog, passed. No runtime files were changed; the previous offline-slice build remains the last build evidence, not a fresh build claim for this proposal.

## Local isolation implementation — 2026-09-20 UTC

[VERIFIED via source and sandbox schema dry-run] `lib/dataverse/schema/wave29-test-request-isolation/akoya_request-test-request-isolation.json` contains only the two proposed attributes. `lib/services/test-requests/isolation.js` provides a pure classifier, ordinary assertion, and fixed parenthesized OData / AND FetchXML fragments. A selected false or null marker with a null run is ordinary (Stage 1a, 2026-09-23; originally only explicit false was). Unselected, malformed and inconsistent values deny dispatch. Classification does not establish actor authorization or matching ledger ownership. No runtime consumer imports this module yet; the Stage 1 inventory above is still outstanding.

The schema tests invoke the existing `ensureAttribute` engine with a mock client and verify emitted Dataverse payloads, rather than duplicating a schema builder. The existing engine is unchanged.

Sandbox dry-run command (exit 0; existing application authentication, no schema writes):

```sh
DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com node --env-file=/Users/gallivan/Code/WMKF_Apps/.env.local scripts/apply-dataverse-schema.js --target=sandbox --wave=29-test-request-isolation
```

The runner reported DRY-RUN, verified publisher prefix `wmkf`, and printed two proposed attribute POSTs. Its generic “created attr” messages are simulated in dry-run, not evidence of remote creation. This does not verify effective write privileges, solution membership, post-apply createability or existing-row defaults. No `--execute` was used.

Local-slice acceptance: Luna built and tested; Sol accepted the unwired/unapplied source; root checked the real schema-engine test, classifier and absence of runtime imports. All 56 focused tests across policy/isolation/platform-probe suites passed, scoped ESLint passed, and `npm run build` exited 0. Fact-consistency and doc-currency gates plus their sequential self-tests and docs-catalog passed. Stage 1 runtime integration and all live enablement gates remain outstanding.

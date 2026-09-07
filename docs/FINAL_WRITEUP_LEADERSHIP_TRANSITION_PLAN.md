---
title: Final Writeup — Leadership Review Transition Plan (Slice 4)
domain: workbench
kind: plan
status: active
summary: "PD-triggered Ready for leadership review: the current Final row moves from lifecycle Review to Final with explicit actor/time; every reader accepts the stage."
canonical: false
cataloged: 2026-09-07
last_verified: 2026-09-07
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/FINAL_WRITEUPS_DASHBOARD_VIEWS_AND_VERSION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Final Writeup — Leadership Review Transition Plan (Slice 4)

**Status: design closed after six Codex passes (§12), nothing built. D2 owner-confirmed
2026-09-07; D1, D3–D6 stand at their recommendations unless the owner objects (§10).** Mode A `/contract-reconcile` plan for the owner decision of
2026-09-06 recorded in queue item 4: *the Leadership stage transition is a PD action in the
Workbench, a new lifecycle-state write from Review to Final; plan-first, not built.* The
implementation plan already specifies the durable shape
(`docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:263,292,329-332`); this document turns it into a
buildable slice with the read-side consequences traced. Every state claim is labeled; `[PLANNED]`
marks intended behavior, never built state. Line numbers are as of `c4e256c8`.

**Cycle context.** D26 is the cycle this must serve: D26 reviews are arriving now and the D26 board
meets December 2026 (`docs/J27_TRANSITION_REGISTER.md:30`). The atlas snapshot records one Final
row, the Request `1002788` smoke row `[VERIFIED via docs/atlas/dataverse-wmkf-requestdocument.md:36-41]`,
so the transition must be Production-live before the first D26 writeup reaches leadership, which is
late in the cycle. "D26" in the queue title is the cycle code, not a decision id.

## 1. Why now

Group review is Production-live: the lead PD starts it from the Final Writeup tab, the Final row
sits in lifecycle `REVIEW`, and reviewers acknowledge versions
`[VERIFIED via lib/services/final-writeup/transition-service.js:564-680]`. The dashboards already
know about a second stage: a Final row in lifecycle `FINAL` renders as **Leadership review**
`[VERIFIED via lib/services/final-writeup/dashboard-service.js:259-270]`, and the persona filter
admits a Leadership-only viewer to `leadership-review` rows and nothing else
`[VERIFIED via dashboard-service.js:353-360; after the rollout-off/superuser pass-through the
function has three persona branches: PC, PD, Leadership]`. Nothing writes that state. Until it does, the President and CSO lens is permanently
empty and the leadership actor/time fields provisioned by Wave 22 stay unused
`[VERIFIED via lib/dataverse/schema/wave22-final-writeup-transition/wmkf_requestdocument_final_writeup_transition.json:17-40]`.

## 2. Surface (contract-reconcile Step 0)

- **Change surface:** one new governed write, Final row lifecycle `REVIEW` → `FINAL` with explicit
  leadership actor/time and the row's SharePoint observation refreshed to the verified current
  version, triggered by the responsible PD (or a superuser) from the Final Writeup tab; the status
  reader and tab gain a `leadership-review` phase.
- **Entry points:** `shared/components/workbench/FinalWriteupTab.js` (button, confirm dialog, new
  panel); new route `pages/api/workbench/final-writeup/leadership-review.js` (POST only).
- **Persistence:** Dataverse `wmkf_requestdocument`, the current Final row only. Fields written:
  `wmkf_lifecyclestate`, `wmkf_LeadershipReviewStartedBy@odata.bind`, `wmkf_leadershipreviewstartedat`,
  and the row's SharePoint observation fields refreshed to the verified current version
  (`wmkf_sharepointversionid`, `wmkf_sharepointetag`, `wmkf_sharepointlastmodified`, `wmkf_filesize`,
  `wmkf_contenthash`). The milestone triple and `wmkf_MilestoneCreatedBy` are not written (§4.1).
  The request row receives a conditional re-bind of `wmkf_CurrentFinalWriteup` to the same Final
  row, carrying the request `_etag`, in the same changeset, so the pointer is fenced atomically
  (§4.1). The group-review activation path is not changed. No SharePoint write. No new entity, no
  migration, no Postgres.
- **Consumers:** `getFinalWriteupStatus` and `startFinalWriteup` (transition-service), the Final
  Writeup tab, the acknowledgement service, the Final writeups dashboard and its persona filter,
  the Staff Deliberations receipt (reads the *source* row, unaffected), the security matrix,
  `check:api-routes`, `check:route-lifecycle-auth`, `check:atlas`, unit tests.
- **Prior findings being verified:** none. This is the first plan for the slice.

## 3. Current state (verified 2026-09-07)

### 3.1 The write does not exist

- No runtime path writes `wmkf_lifecyclestate: FINAL` onto a Final Writeup row. The only `FINAL`
  write targets the *source* Pre-Site row at group-review activation
  `[VERIFIED via transition-service.js:604-609]`. The leadership fields are selected
  `[VERIFIED via lib/dataverse/adapters/request-document.js:87-92]` and never written: the only
  other mention in runtime or scripts is the schema preflight, which reads metadata
  `[VERIFIED via rg -i leadershipreviewstarted lib pages shared scripts: adapter select plus
  scripts/preflight-final-writeup-schema.mjs:103,119]`.

### 3.2 The read side is half ready

- **Dashboard: ready.** `lifecycleStage` maps `REVIEW` → `group-review` and `FINAL` →
  `leadership-review`, and throws on anything else `[VERIFIED via dashboard-service.js:259-270]`.
  Bucket assignment does not branch on stage `[VERIFIED via dashboard-service.js:295-303]`, so a
  leadership-stage row lands in the same stewardship / open / history bucket it would otherwise. No
  dashboard change is needed.
- **Acknowledgement: ready.** `knownLifecycle` accepts `REVIEW` and `FINAL`
  `[VERIFIED via lib/services/final-writeup/acknowledgement-service.js:156-163]`, so reviewers keep
  acknowledging after the transition and the "Updated since review" comparison keeps working. The
  transition writes no SharePoint content, so the publication version is unchanged and no
  acknowledgement flips to Updated because of it.
- **Transition status reader: BLOCKED.** `committedFinal` requires the Final row to be in lifecycle
  `REVIEW` `[VERIFIED via transition-service.js:258-280, line 267]`. `getFinalWriteupStatus` calls it
  when a current Final pointer exists and throws a 500 `final_writeup_committed_state_invalid` when
  it returns null `[VERIFIED via transition-service.js:300-320]`. `startFinalWriteup` takes the same
  path for exact retry `[VERIFIED via transition-service.js:688-700]`, and `activate` uses it to
  detect a concurrent success `[VERIFIED via transition-service.js:564-575]`. **Consequence:** after
  a Review→Final write with today's code, the Final Writeup tab GET fails for every viewer and the
  transition's own confirmation would fail. This is the hidden blocker the slice must remove first.
- **Final Writeup tab: three couplings to `group-review`.** The acknowledgement section loads only
  when `status.phase === 'group-review'` `[VERIFIED via FinalWriteupTab.js:181-183]`; the
  post-start poll terminates only on `group-review` `[VERIFIED via FinalWriteupTab.js:249]`; the
  panel renders only for `group-review` `[VERIFIED via FinalWriteupTab.js:412]`. Without change the
  tab would show nothing at leadership stage and the "Reviewed by" block would vanish.

### 3.3 Authorization precedent

- Starting group review requires a session-derived Dynamics system-user id and either superuser or
  exact equality with the request's non-null lead PD `[VERIFIED via transition-service.js:208-212;
  pages/api/workbench/final-writeup.js:41-45,78-83]`. The security matrix records this as a hard
  manage gate `[VERIFIED via docs/API_ROUTE_SECURITY_MATRIX.md:273]`. The owner decision names the
  PD as the actor for the leadership transition; the same rule is the recommendation (§4.2).

### 3.4 Milestone fields on a Final row

- At claim, `wmkf_milestoneversionid` / `wmkf_milestonecontenthash` are set to the verified source
  version/hash and `wmkf_milestonecreatedat` is set at activation
  `[VERIFIED via transition-service.js:410-411,612]`. `wmkf_sourceversionid` /
  `wmkf_sourcecontenthash` hold the same handoff checkpoint `[VERIFIED via :408-409]`. No consumer
  reads the milestone triple from a Final Writeup row: every reader is Pre-Site, Initial
  Assessment, or reopen code `[VERIFIED via rg wmkf_milestone lib shared pages: adapter select,
  pre-site-visit/artifact-service.js, pre-site-visit/reopen-service.js,
  initial-assessment/artifact-service.js only]`, and `committedFinal` checks
  `wmkf_sourceversionid` / `wmkf_sourcecontenthash`, not the milestone fields `[VERIFIED via :273-274]`.
- **The milestone triple has an actor sibling and an audit reader.** Wave 24 added
  `wmkf_MilestoneCreatedBy`, selected as `_wmkf_milestonecreatedby_value`
  `[VERIFIED via request-document.js:94-98]` and written only by the Site Visit handoff
  `[VERIFIED via lib/services/pre-site-visit/site-visit-transition-service.js:288-291; rg MilestoneCreatedBy
  lib: that file only]`. The explicit-actor census treats any row whose `wmkf_milestonecreatedat`
  falls in its window and has no milestone actor as a violation unless a `site-visit-handoff` event
  explains it `[VERIFIED via scripts/probe-request-document-explicit-actor-census.js:64-78]`; the
  request inventory probe prints the milestone version and time per row
  `[VERIFIED via scripts/probe-request-1002379-test-inventory.js:114,131]`. Group-review activation
  already stamps `wmkf_milestonecreatedat` on the Final row without a milestone actor
  `[VERIFIED via transition-service.js:621; no MilestoneCreatedBy write in that file]`, so a census
  run over that window already reports the existing Final row as a milestone violation. That is a
  pre-existing gap, recorded here so the D2 decision is made with it in view (§10 D6, §12 F2, H1).
- **The milestone actor has a fixed meaning.** The explicit-actor contract defines
  `wmkf_MilestoneCreatedBy` as the "authenticated staff member who completed the Pre-Site → Site
  Visit handoff represented by the existing `wmkf_milestone*` fields"
  `[VERIFIED via docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md:136]`, and its write is gated on
  `REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY`, a different flag from `FINAL_WRITEUP_SCHEMA_READY`
  `[VERIFIED via :149-151; lib/services/request-document-actor-service.js:66-84]`. The implementation
  plan's instruction to "reuse its existing milestone version/hash/time fields" for the leadership
  checkpoint (`FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:292`) predates that contract and is
  `[STALE/CONFLICT]` with it: writing a leadership checkpoint into fields whose actor sibling means
  "Site Visit handoff" would misattribute provenance. §9 reconciles that line at build.
- **Actor resolution precedent.** `startFinalWriteup` resolves the acting user through
  `resolveRequestDocumentActor` with policy `REQUIRED` after authorization and uses the returned
  enabled id for every write; when the Wave 24 schema flag is off it falls back to the raw session
  id `[VERIFIED via transition-service.js:740-747]`. A stale or disabled user under `REQUIRED` is a
  403 `request_document_actor_unavailable` thrown by the resolver
  `[VERIFIED via request-document-actor-service.js:49-63,80-82]`.

## 4. Decisions

### 4.1 Durable write (follows the implementation plan)

`[PLANNED]` A single conditional PATCH to the current Final row:

| Field | Value | Why |
|---|---|---|
| `wmkf_lifecyclestate` | `REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL` (`100000004`) | The lifecycle is the stage discriminator (impl plan :292, :332). |
| `wmkf_LeadershipReviewStartedBy@odata.bind` | `/systemusers(<actingUserSystemId>)` | Explicit actor; `modifiedby` is not authoritative (impl plan :290). |
| `wmkf_leadershipreviewstartedat` | server `now()` ISO | Explicit time, same write as the actor. |
| `wmkf_sharepointversionid`, `wmkf_sharepointetag`, `wmkf_sharepointlastmodified`, `wmkf_filesize`, `wmkf_contenthash` | the verified current SharePoint metadata and governed DOCX hash | The exact leadership-ready checkpoint, recorded in the row's own observation fields; the Site Visit transition refreshes the same fields at its handoff `[VERIFIED via lib/services/pre-site-visit/site-visit-transition-service.js:280-288]`, and the claim already seeds them from the verified source `[VERIFIED via transition-service.js:411-427]`. |

**The milestone triple and its actor are left alone: a named decision.** Pass 1 and 2 of the
review moved toward overwriting `wmkf_milestone*` and writing `wmkf_MilestoneCreatedBy`; pass 3
showed the actor field's contract is Site Visit handoff only (§3.4), so any write from a Final
Writeup stage would misattribute provenance, and a census rename would not repair persisted data.
The leadership-ready checkpoint therefore lives in the leadership actor/time pair plus the row's
refreshed SharePoint observation fields. This still meets the implementation plan's promise that
"stable version/hash/time and explicit actor are recorded" (:263): version and hash in
`wmkf_sharepointversionid` / `wmkf_contenthash`, time and actor in the leadership pair.
Alternatives: (a) overwrite the milestone triple with or without the actor, rejected as above;
(b) new leadership version/hash columns, rejected for this slice as a schema wave with no consumer
beyond the confirm step. Owner confirms (§10 D2).

**Pre-existing census gap, out of this slice.** Group-review activation stamps
`wmkf_milestonecreatedat` on the Final row without a milestone actor (§3.4), and the census kind
`site-visit-milestone` does not filter by artifact type, so it reports that stamp as a violation.
This slice neither widens nor repairs that: it adds no milestone writes. The candidate fix is a
Tier 0 census change that classifies Final Writeup rows' milestone stamp as group-review-backed (or
excludes them from the site-visit kind), owner-decided separately (§10 D6).

**Two operations in one changeset, not a single PATCH.** The Final-row PATCH alone cannot fence the
request's current-Final pointer: a concurrent request update could re-point `wmkf_CurrentFinalWriteup`
between the re-read and the PATCH while the old row's `_etag` stays valid. The group-review
activation already solves this by PATCHing the request inside the same changeset with the request's
`ifMatch` `[VERIFIED via transition-service.js:626-635]`. The leadership transition uses the same
shape via `commitChangeset` (`runChangeset`, which asserts the DAL context
`[VERIFIED via lib/dataverse/core/changeset.js:116-119]`):

1. PATCH `wmkf_requestdocuments(<finalId>)`, `ifMatch: final._etag`, body per the table above.
2. PATCH `akoya_requests(<requestId>)`, `ifMatch: request._etag`, body
   `{ 'wmkf_CurrentFinalWriteup@odata.bind': '/wmkf_requestdocuments(<finalId>)' }`, a re-bind to
   the value already held, so a request whose pointer or version moved fails the changeset with 412
   and nothing is written.

The adapter's origin-field guard covers only the `initiatedat` / `initiatedby` pair
`[VERIFIED via request-document.js:120-133]` and is not on the changeset path anyway;
`check:request-document-writers` counts create seams only
`[VERIFIED via scripts/check-request-document-writers.js:16-23]`, so no allowlist change. The
interlock already classifies PATCH on both entity sets because the group-review changeset issues
both `[VERIFIED via transition-service.js:604-635]`.

### 4.2 Who may trigger

`[PLANNED]` Same rule as starting group review: session-derived system-user id required; superuser
or exact lead-PD equality; a request with no lead PD is superuser-only. Reuse `resolveAuthorization`
`[VERIFIED via transition-service.js:208-212]` and expose the result as `canAdvance` on the status
projection alongside `canStart`. No PC path, no persona inference, no acknowledgement-count
precondition: the implementation plan forbids approval gates between stages (:261). The UI hides
the button when `canAdvance` is false, and the server rejects with 403 regardless
(`feedback-ui-gates-must-mirror-server-guards`).

### 4.3 Service shape

`[PLANNED]` New export in `transition-service.js`, `advanceToLeadershipReview({ requestId,
expectedFinalArtifactId, isSuperuser, actingUserSystemId })`:

1. Schema gate: `schemaReady()` or 503 `final_writeup_schema_not_ready` (same as start).
2. GUID validation of `requestId`, `expectedFinalArtifactId`, `actingUserSystemId` (403 when the
   actor is missing, mirroring `:702-709`).
3. `readState` (one request read plus the request's document rows, the same single read the
   group-review start performs `[VERIFIED via transition-service.js:153-163]`). The only state
   inspected before authorization is the request's existence, which is a 404 for an authorized and
   an unauthorized caller alike.
4. Authorization (§4.2) from `state.request._wmkf_programdirector_value` → 403
   `final_writeup_leadership_forbidden`. Every pointer, fence, lifecycle, and retry inspection comes
   **after** this step, so an unauthorized caller learns nothing from POST beyond "request exists"
   and 403; the error codes below are unreachable without authorization. This is stricter than
   today's group-review start, which inspects the current Final pointer before authorizing
   `[VERIFIED via transition-service.js:700-733]`; the stricter order is the contract for the new
   path and is not retrofitted onto the existing one in this slice. (GET already returns committed
   Final state to every reviewers-app user `[VERIFIED via pages/api/workbench/final-writeup.js:50-58]`;
   that is a separate, existing contract.)
   Then `findCurrentFinal`: no current Final → 409-class `final_writeup_leadership_final_missing`;
   pointer mismatch with `expectedFinalArtifactId` → `final_writeup_leadership_stale_final` ("A
   different Final Writeup is now current. Reload before continuing.").
5. **Actor resolution.** `resolveRequestDocumentActor({ actingUserSystemId, policy: REQUIRED })`,
   exactly as `startFinalWriteup` does after its authorization check
   `[VERIFIED via transition-service.js:740-747]`. When the Wave 24 flag is on, the returned enabled
   id is the only id used for the `wmkf_LeadershipReviewStartedBy` bind and the `actingUserSystemId`
   write option; a stale or disabled user is the resolver's own 403
   `request_document_actor_unavailable`. When the flag is off, the raw session id is used, the same
   fallback the group-review path takes today. No Wave 24 field is written by this slice, so the
   Wave 24 readiness boundary is not crossed either way; the leadership fields are Wave 22 and are
   protected by step 1's `FINAL_WRITEUP_SCHEMA_READY` gate.
6. **Exact-retry convergence.** If the row is already `FINAL` and the generalized `committedFinal`
   (§4.4) accepts it, return the committed state with `reused: true` and 200. This is the
   idempotency guard: the write in step 10 is never reached for an already-advanced row
   `[PLANNED guard, to be pinned by test]`. A `FINAL` row that `committedFinal` rejects is not
   converged; it surfaces as 500 `final_writeup_committed_state_invalid` for reconciliation, never
   as success.
7. Eligibility: artifact type Final Writeup, operation status `READY`, lifecycle `REVIEW`, stable
   drive/item identity present, `_etag` present; else `final_writeup_leadership_ineligible`.
8. Verify the current SharePoint version in the `verifySource` pattern
   `[VERIFIED via transition-service.js:358-388]`: metadata before, download, governed hash,
   metadata after; unstable → `final_writeup_leadership_source_changed` ("The Word document changed
   while leadership review was starting. Retry to use the latest version."). Identity must match the
   row's persisted drive/item.
9. **Commit-time concurrency check.** Re-read request and rows (`readState`) and the SharePoint
   metadata immediately before the write, in the `activate` pattern `[VERIFIED via
   transition-service.js:564-600]`: the request's `_wmkf_currentfinalwriteup_value` must still name
   this row, the row must still be `READY` / `REVIEW` with the same `_etag`, and the metadata must
   match the row's drive/item identity and satisfy `stableMetadataMatches(verified.metadata, now)`
   (not `persistedIdentityMatches(row, now)`: the row's claim-time observation legitimately differs
   after group-review edits; that helper is used only in the post-commit confirm, §4.3 step 11);
   otherwise `final_writeup_leadership_source_changed` (metadata) or
   `final_writeup_leadership_conflict` (row or pointer) with no write. The fresh request `_etag` and
   row `_etag` from this read are the ones carried into step 10, so the interval between this read
   and the commit is closed by the conditional changeset, not by timing.
10. **Atomic changeset** (§4.1): Final-row PATCH with `ifMatch: final._etag` plus the request
   pointer re-bind with `ifMatch: request._etag`. Any 412 → `final_writeup_leadership_conflict`
   ("The writeup lifecycle changed while leadership review was starting. Reload and retry."), after
   the `activate`-style post-failure re-read that returns the committed state if this call's own
   write actually landed `[VERIFIED pattern via transition-service.js:636-652]`.
11. Post-commit `readState` and confirm via generalized `committedFinal`, including that the
   persisted `wmkf_sharepointversionid` / `wmkf_contenthash` equal the verified values
   (`persistedIdentityMatches` plus the hash); unconfirmed → 500 `final_writeup_leadership_unconfirmed`. Return `{ phase: 'leadership-review',
   artifact, reused: false }`.

Error codes are `[PLANNED]` names; the owner-voice copy rule applies to every message.

### 4.4 Generalize `committedFinal` and the status projection

`[PLANNED]` `committedFinal` accepts a Final row whose lifecycle is `REVIEW` **or** `FINAL`. When
`FINAL`, it additionally requires the complete leadership checkpoint: `wmkf_leadershipreviewstartedat`,
`_wmkf_leadershipreviewstartedby_value`, and every observation field the transition refreshes,
`wmkf_sharepointversionid`, `wmkf_sharepointetag`, `wmkf_sharepointlastmodified`, `wmkf_filesize`
(finite number), and `wmkf_contenthash`, mirroring how it requires the group-review pair today
(`:278-279`) and matching the field set `persistedIdentityMatches` compares
`[VERIFIED via transition-service.js:141-148]`. (The Wave 22 leadership fields
are in the select only under `FINAL_WRITEUP_SCHEMA_READY` `[VERIFIED via request-document.js:87-92,
100-113]`, the same flag that gates the whole service, so the check is never evaluated against an
unselected field.) A `FINAL` row missing any of these is rejected, so exact retry and `activate`'s concurrent-success branch never certify a half-written
transition; the caller's existing 500 reports it for reconciliation. Every other check (source
pointer, identity, source version/hash, group-review pair) is unchanged. The complement stays
fail-closed: any other lifecycle still returns null and the callers still throw. There are no legacy
leadership-stage rows to grandfather: the only Final Writeup row in Production is in `REVIEW`
`[VERIFIED via docs/atlas/dataverse-wmkf-requestdocument.md:39-41, where the single "Final"
lifecycle row is the source Pre-Site row moved at handoff, :36]`.

`getFinalWriteupStatus` returns `phase: 'leadership-review'` for a committed `FINAL` row and
`phase: 'group-review'` for a committed `REVIEW` row. Both carry `canStart: false`; `group-review`
carries `canAdvance` from `resolveAuthorization`; `leadership-review` carries `canAdvance: false`.
`projectArtifact` adds `leadershipReview: { startedAt, startedById }` beside `groupReview`
`[VERIFIED shape via :214-242]`. `startFinalWriteup`'s exact-retry branch and `activate`'s
concurrent-success branch inherit the generalization with no further change.

### 4.5 Route

`[PLANNED]` New sibling route `pages/api/workbench/final-writeup/leadership-review.js`, POST only,
exact body `{ requestId, expectedFinalArtifactId }`, mirroring
`pages/api/workbench/final-writeup/acknowledgement.js` `[VERIFIED via that file:61-80]`:
`requireAppAccess('reviewers')`, fresh `getUserRole` for the superuser flag (as in
`final-writeup.js:41-45`), `withDalContext('workbench-final-writeup-leadership-review')`, GUID
validation, `ServiceHttpError` passthrough, 16kb body limit, `maxDuration: 300`.

Alternative considered: extend the existing POST with an `action` discriminator. Rejected: it widens
the existing exact-body contract `['requestId','expectedArtifactId']` (`final-writeup.js:61-66`), muddies
one matrix row with two authorization stories, and the acknowledgement route already set the
sibling precedent. New matrix row required (§9); `check:api-routes` and `check:route-lifecycle-auth`
are the gates (`/api/workbench` has heterogeneous guards and the gate asserts each route carries a
parseable `requireAppAccess` `[VERIFIED via shared/config/appRegistry.js:325-331]`).

### 4.6 Final Writeup tab

`[PLANNED]` Three edits plus one panel:

1. `acknowledgementArtifactId` derives from `phase === 'group-review' || phase === 'leadership-review'`
   (`:181`). Same for the poll terminator (`:249`) and the render branch (`:412`). Use one
   `IN_REVIEW_PHASES` set so the three sites cannot drift.
2. Group-review panel gains a secondary action **Ready for leadership review** when
   `status.canAdvance`, opening the existing confirm dialog pattern (`:540-600`) with copy in the
   owner's voice: what it records (the current Word version), what it changes (the writeup appears
   for the President and CSO), and what it does not do (editing continues in the same document;
   nobody is notified by this action).
3. Leadership-review panel: stage chip **Leadership review**, "Started <date> by <name>" when the
   actor name is resolvable, the same **Edit writeup** link, and the same acknowledgement block. No
   backward action (§4.7). A non-owner sees the panel without the transition button in either stage.
4. Dashboard rows and the focused acknowledgement page need no change (§3.2). The stage chip they
   already render will read "Leadership review" once rows exist.

### 4.7 Reversibility

`[PLANNED]` No reverse action in this slice. The implementation plan states there is no
first-release backward-stage UI and that genuine pointer corruption has an operator recovery path
(:279). The recovery for a mistaken transition is owner-run in Dataverse: set the Final row lifecycle
back to `REVIEW` and clear the two leadership fields; the milestone triple may stay. This is recorded
in the atlas page at build time (§9). Owner to confirm (§10 D1).

### 4.8 What the lenses show before and after

| Viewer | Before (Final row `REVIEW`) | After (Final row `FINAL`) |
|---|---|---|
| Responsible PD | Stewardship row, "Group review", Edit in Word, Ready for leadership review button on the tab | Same row stays (lenses focus, they do not conceal), chip "Leadership review", no further stage action |
| Other PD / reviewer | Open or history row, may acknowledge | Unchanged; may still acknowledge |
| Program Coordinator | All rows, matrix | Same; stage chip changes |
| Leadership only (President, CSO) | Row not visible `[VERIFIED via dashboard-service.js:358-359]` | Row appears in Needs my review; may acknowledge; Open review |
| Superuser | Everything, may advance | Everything |

No email or notification is produced by the transition. Materials-on-acceptance and other
notification work stays parked.

## 5. Contract trace (Step 3)

1. **Caller:** responsible PD (or superuser) on the Final Writeup tab at group-review stage.
2. **Client state:** `status.phase`, `status.canAdvance`, `status.artifact.artifactId` as the fence.
3. **Payload:** `{ requestId, expectedFinalArtifactId }`, nothing else accepted.
4. **Route:** `requireAppAccess('reviewers')`; superuser via fresh `getUserRole`; exact-body
   allowlist; GUID checks; `withDalContext`.
5. **Service:** §4.3 steps 1-11; authorization is server-resolved from the request's lead PD lookup.
6. **Persistence:** one changeset: conditional Final-row PATCH plus a conditional re-bind of the
   request's current-Final pointer to the same row (value unchanged, `_etag` fenced); no
   SharePoint write.
7. **Response:** `{ success, phase: 'leadership-review', artifact, reused }`; errors carry
   `ServiceHttpError` bodies.
8. **Consumers:** tab re-renders the leadership panel and reloads acknowledgement state; dashboard
   picks up the stage on next load; Leadership persona gains the row.
9. **Docs/tests/gates:** §8 and §9.

## 6. Audits (Step 4)

1. **Whole-flow:** covered by §5. Staff Deliberations reads the source row, which does not change
   `[VERIFIED via FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:180]`.
2. **Partial success:** two operations in one Dataverse changeset, so both land or neither does.
   Confirmation is by re-read, never by the changeset response alone (§4.3 step 11). A lost
   response with a committed write converges on retry via step 6, after authorization.
3. **Async / stale state:** the tab already uses `activeController` generation guards for start and
   poll `[VERIFIED via FinalWriteupTab.js:255-297]`; the new action reuses the same controller and
   the `acknowledgementReload` counter to refresh the block after success. Every post-await
   `setStatus` stays behind the `activeController.current === controller` check.
4. **Helper extraction:** `committedFinal` widens its accepted lifecycle set; it must NOT loosen any
   identity, pointer, or group-review check. `resolveAuthorization` is reused unchanged.
   `verifySource` is reused for the Final row; it reads drive/item/site from the row, so it
   already works for a Final row that shares the source's identity `[VERIFIED via :358-362]`.
5. **Durable surface:** no migration, no new table, no Postgres. Atlas page update
   (`docs/atlas/dataverse-wmkf-requestdocument.md`): the leadership fields become runtime-written and
   the lifecycle semantics for Final rows gain `FINAL`. Security matrix row. No `CANONICAL_COUNTS`
   shift unless a route count is registered; check at build.
6. **Doc-reconcile:** §9, via `/sweep` at build.
7. **Symbol fan-out for `wmkf_lifecyclestate === FINAL` on a Final Writeup row:**
   - `dashboard-service.js:259-270` handles it `[VERIFIED]`.
   - `acknowledgement-service.js:156-163` handles it `[VERIFIED]`.
   - `transition-service.js:258-280` rejects it → fix in §4.4 `[PLANNED]`.
   - `FinalWriteupTab.js:181,249,412` ignores it → fix in §4.6 `[PLANNED]`.
   - `shared/components/final-writeups/FinalWriteupsViews.js:927-932` `stageMovedOnWarning` already
     warns a PD-without-leadership persona that group review has closed on a `leadership-review` row
     `[VERIFIED]`; it is the only other `stage.key` / `phase` consumer outside the two files above
     `[VERIFIED via rg "stage\.key|status\.phase|'leadership-review'|'group-review'" shared pages lib]`.
     No change; the existing assertion in `tests/unit/final-writeups-views.test.js:309` re-pins it
     and the build must keep it green.
   - Other lifecycle readers (`pre-site-visit/*`, `initial-assessment/*`,
     `site-visit/logistics-service.js`) branch on `SUPERSEDED` / `BOARD_READY` for their own
     artifact types `[VERIFIED via rg BOARD_READY|SUPERSEDED lib: 28 hits, zero files under
     lib/services/final-writeup]`.
   - `check:status-enum-parity` registers producer/consumer pairs by constant name; no
     `final-writeup` pair is registered today `[VERIFIED via rg group-review|leadership-review|final-writeup
     scripts/check-status-enum-parity.js: no hits]`. The tab's phase branches are string
     comparisons, not a map, so the gate stays silent; the tests in §8 carry the parity instead.

## 7. Invariant table (Mode B guardrail for the build)

| Invariant | Files likely touched | Verification |
|---|---|---|
| A Final row in `FINAL` with the complete leadership checkpoint is a committed Final; any other lifecycle is still rejected | transition-service.js `committedFinal` | Unit: `FINAL` + all fields passes; `DRAFT`/`BOARD_READY`/`SUPERSEDED` fail |
| Exact retry of the transition writes nothing and returns `reused: true` | transition-service.js | Unit: `updateDocument` not called when the row is already committed `FINAL` |
| A non-lead PD with a valid session gets 403 and no write | route + service | Route test with a mismatched system user; `updateDocument` not called |
| Missing lead PD is superuser-only | service | Unit mirrors the group-review case |
| Both changeset operations carry `ifMatch`; 412 maps to the reload-and-retry conflict | service | Unit with a 412 rejection from `commitChangeset`; assert both `ifMatch` values |
| A current-Final pointer change between the initial read and commit writes nothing | service | Unit: second `readState` returns a request whose `_wmkf_currentfinalwriteup_value` names another row → conflict, `commitChangeset` not called; and a request `_etag` change alone → the changeset's 412 path |
| A SharePoint version change between before/after aborts with no write | service | Unit with differing metadata |
| A SharePoint version change between verification and commit aborts with no write | service | Unit: commit-time metadata differs from verified → `source_changed`, `updateDocument` not called |
| No milestone field is written by the transition | service | Unit: the PATCH body has no `wmkf_milestone*` key and no `wmkf_MilestoneCreatedBy@odata.bind` |
| The leadership bind and the write option use the resolved enabled actor id; a stale or disabled user is 403 with no write | service | Unit: resolver returns `actorId` ≠ session id → bind uses `actorId`; resolver throws → `updateDocument` not called |
| Wave 24 flag off falls back to the raw session id, as group review does | service | Unit with `schemaReady: false` |
| The observation fields are refreshed to the verified metadata and hash | service | Unit: PATCH body carries `wmkf_sharepointversionid`, `wmkf_sharepointetag`, `wmkf_sharepointlastmodified`, `wmkf_filesize`, `wmkf_contenthash` equal to the verified values |
| A `FINAL` row missing any leadership-checkpoint field is not committed | transition-service.js `committedFinal` | Unit per missing field: leadership at/by, `wmkf_sharepointversionid`, `wmkf_sharepointetag`, `wmkf_sharepointlastmodified`, `wmkf_filesize`, `wmkf_contenthash` → null → caller 500 |
| Authorization precedes every pointer/fence/lifecycle inspection; an unauthorized caller sees only 403 | service | Unit: mismatched actor against (a) no current Final, (b) stale fence, (c) already-`FINAL` row → all 403, no state-specific code, `updateDocument` not called |
| PD-without-leadership warning on leadership-stage rows stays | FinalWriteupsViews.js (no edit) | `final-writeups-views.test.js:309` stays green |
| Success is confirmed by re-read, not by PATCH resolution | service | Unit: PATCH resolves but re-read shows `REVIEW` → 500 unconfirmed |
| Acknowledgement block loads and renders at leadership stage | FinalWriteupTab.js | Tab test: `phase: 'leadership-review'` fetches acknowledgement state and renders Reviewed by |
| Button hidden when `canAdvance` is false; server still rejects | tab + route | Tab test + route test |
| Dashboard `leadership-review` rows are unchanged by this slice | dashboard-service.js (no edit) | Existing tests stay green; no new assertions needed |
| Publication version is untouched by the transition | service | Unit: `downloadFile` and `getFileMetadataById` only; no Graph write dependency exists in `DEFAULT_DEPENDENCIES` `[VERIFIED via :62-72]` |
| The request pointer value is unchanged by the transition | service | Unit: the request operation's bind names the same `finalId` the fence resolved |

## 8. Tests (names to add or re-pin)

- `tests/unit/final-writeup-transition-service.test.js` (13 tests today): add the `committedFinal`
  generalization cases, the `leadership-review` status projection, `canAdvance` for lead PD /
  superuser / other, and the nine-step service happy path, retry, 403, ineligible, stale fence,
  source-changed at verification, source-changed at commit time, pointer moved at commit time,
  changeset 412 (with the post-failure re-read returning committed state when this call's write
  landed), unconfirmed (including a re-read whose `wmkf_sharepointversionid` differs from the
  verified one), actor resolution
  (resolved id used, resolver 403 propagates with no write, flag-off fallback), and a PATCH-body
  assertion that no milestone key is present.
- New `tests/unit/workbench-final-writeup-leadership-review-route.test.js`: method allowlist,
  exact body, GUID validation, superuser resolution, `ServiceHttpError` passthrough, following
  `workbench-final-writeup-acknowledgement-route.test.js`.
- `tests/unit/final-writeup-tab.test.js`: leadership panel renders; acknowledgement fetch fires for
  the new phase; button visibility follows `canAdvance`; confirm dialog and success transition;
  the mutation check is a `leadership-review` fixture with `mayAcknowledge: true` and one reviewer,
  proving the Reviewed by block is present (absent under today's code).
- `tests/unit/final-writeups-dashboard-service.test.js`: unchanged; confirm the existing
  leadership-stage fixture still passes.
- `tests/unit/final-writeups-views.test.js:309`: unchanged; the leadership-stage warning assertion
  must stay green.

## 9. Docs to reconcile at build (in place, never appended)

- `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`: status line `:38` ("LEADERSHIP-STAGE ... REMAIN
  STAGED WORK"), `:136`, `:290` ("Leadership fields remain schema-only until Slice 4"), `:329-332`.
- `docs/atlas/dataverse-wmkf-requestdocument.md`: leadership fields runtime-written; Final-row
  lifecycle `FINAL` semantics; owner-run reversal procedure (§4.7).
- `docs/API_ROUTE_SECURITY_MATRIX.md`: new row beside `:273-275`.
- `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:292`: **done 2026-09-07** on D2 confirmation;
  the "reuse its existing milestone version/hash/time fields" instruction now states the
  observation-field checkpoint and why the milestone fields are excluded.
- `docs/CURRENT_WORK_QUEUE.md` item 4 completion column.
- Agent wiki: Final Writeup has no section in `reviewer-workbench-lifecycle.md`
  `[VERIFIED via rg "Final Writeup|final-writeup" docs/agent-wiki: strategy-roadmap.md only]`. Add a
  short Final Writeup lifecycle entry to the workbench topic at build rather than promising an
  update to a section that does not exist.
- `SESSION_PROMPT.md` and memory `project-reviewer-apps-redesign-direction.md` via `/stop`.

## 10. Owner decisions

| # | Decision | Recommendation | Default if silent |
|---|---|---|---|
| D1 | Reverse path in this slice? | None; owner-run Dataverse repair documented in the atlas page | No reverse action |
| D2 | Where does the leadership-ready checkpoint live? | Leadership actor/time pair plus the row's refreshed SharePoint observation fields (`wmkf_sharepointversionid`, `wmkf_contenthash`, and siblings). No milestone triple or milestone actor write, because that actor field means Site Visit handoff (§3.4) | **[OWNER-CONFIRMED 2026-09-07]** as recommended; implementation plan :292 rewritten in place the same day |
| D6 | The census reports Final rows' group-review milestone stamp (no milestone actor) as a violation, pre-existing and untouched by this slice. Fix the census separately? | Yes, as a separate Tier 0 script change: classify Final Writeup rows' stamp as group-review-backed or exclude them from the `site-visit-milestone` kind. Request `1002788`'s row is the one instance today | Separate Tier 0 item, not in this slice |
| D3 | Superuser may advance, as with group review? | Yes, same `resolveAuthorization` | Yes |
| D4 | Acknowledgements continue after the transition? | Yes; today's `knownLifecycle` already allows it and Leadership acknowledges at this stage | Yes |
| D5 | Button placement: inside the group-review panel as a secondary action beside Edit writeup | Yes; keeps one stage card per phase like the Ready for group review card | Secondary action in the panel |

## 11. Gates and exit

Tier 1 runtime work: plan on `main` (Tier 0 docs), Codex adversarial plan review with dispositions
recorded in §12, then build on a branch `claude/final-writeup-leadership-review`, Codex diff review,
PR, Production deployment, owner-run signed-in smoke on the designated test request (Request
`1002788` holds the only Final row and is the test-request entry `[VERIFIED via
docs/J27_TRANSITION_REGISTER.md:42]`). Gates for touched surfaces: `check:api-routes`,
`check:route-lifecycle-auth`, `check:route-service-boundary`, `check:trust-boundary-guid`,
`check:request-document-writers`, `check:atlas`, `check:docs-catalog`, `check:doc-currency`,
`check:fact-consistency`, `check:types`, each with its self-test sequentially.

Smoke on Request `1002788` is a real Dataverse write to the smoke row; it is the one Final row in
Production, so after the smoke it will sit at leadership stage and appear in the Leadership lens.
The owner decides whether to leave it there or apply the §4.7 reversal.

## 12. Review disposition (Codex adversarial review, 2026-09-07, verdict NEEDS REWORK)

Three findings, all verified against source and all accepted.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | high | The verify-then-PATCH flow had no commit-time SharePoint check, so an edit between the second metadata read and the PATCH would be stamped as the older version while returning success. | **Accepted.** §4.3 gains the `activate`-pattern commit-time re-read of row and metadata (now step 9) `[VERIFIED via transition-service.js:590-600]`, and step 11 confirms the persisted observation fields equal the verified ones. Residual: the read-to-PATCH interval, identical to today's group-review activation; named in §4.3. |
| F2 | medium | The milestone overwrite was reconciled against runtime readers only; the explicit-actor census and the inventory probe read the raw fields, and the census expects a milestone actor beside the milestone time. | **Accepted; the pass-2 response (write the milestone actor, rename the census kind) was superseded by H1.** Active contract: no milestone field is written (§4.1); §3.4 records the census pairing rule and the pre-existing group-review stamp gap, which is D6, a separate Tier 0 item. |
| F3 | medium | `FinalWriteupsViews.js:927-932` `stageMovedOnWarning` is an existing `stage.key` consumer missing from the fan-out and the test contract. | **Accepted.** Added to §6.7 with the disconfirming grep; §7 and §8 pin the existing assertion at `final-writeups-views.test.js:309`. No code change needed. |

### Pass 2 (2026-09-07, verdict NEEDS REWORK)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| G1 | high | Exact-retry convergence ran before authorization, so an unauthorized reviewers-app user could read committed stage state from POST. | **Accepted; tightened further by I1.** §4.3 authorizes at step 4 immediately after the single `readState`, and every pointer, fence, and retry inspection follows it; §7 pins 403-only for three unauthorized shapes. |
| G2 | high | `committedFinal`'s `FINAL` branch required only the leadership pair, so a half-written transition or malformed row would be certified as committed and returned as `reused: true`. | **Accepted; the field list was re-based by H1 and completed by I2.** Active contract (§4.4): leadership at/by plus all five observation fields; §7 and §8 add per-missing-field tests. No legacy leadership rows exist `[VERIFIED via atlas :36-41]`. |
| G3 | medium | D2's fallback left the census gap open while the plan implied closure, and the pre-existing unattributed group-review stamp had no policy. | **Accepted; the pass-2 response (write the milestone actor in the activation changeset) was withdrawn under H1.** Active contract: this slice makes no milestone write and does not touch activation; the census gap is pre-existing and is D6, a separate Tier 0 item. D2 is explicit (§10) and the build waits on it. |

### Pass 3 (2026-09-07, verdict NEEDS REWORK)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | high | Writing the group-review or leadership actor into `wmkf_MilestoneCreatedBy` repurposes a field whose contract is "Site Visit handoff actor"; a census rename does not repair persisted provenance. | **Accepted; D2 reversed.** The transition writes no milestone field and the group-review activation path is untouched. The checkpoint moves to the leadership pair plus the row's SharePoint observation fields, following the Site Visit transition's own refresh precedent `[VERIFIED via site-visit-transition-service.js:280-288]`. Implementation plan :292 marked `[STALE/CONFLICT]` for reconcile at build (§9). |
| H2 | high | An unconditional `wmkf_MilestoneCreatedBy` write in the activation changeset would cross the Wave 24 readiness boundary in any environment with that flag off. | **Accepted, moot after H1.** No Wave 24 field is written by this slice; §4.3 step 5 states which flag protects which field. |
| H3 | high | The service validated the acting id as a GUID only; no `systemuser` re-read, no disabled check, before writing lookup binds. | **Accepted.** §4.3 step 5 adds `resolveRequestDocumentActor` with `REQUIRED` after authorization, exactly the `startFinalWriteup` pattern `[VERIFIED via transition-service.js:740-747]`; the resolved id is the only id used for the bind and the write option; §7 and §8 pin resolved-id, resolver-403, and flag-off cases. |

### Pass 4 (2026-09-07, verdict NEEDS REWORK)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| I1 | high | Pointer-missing and fence-mismatch errors were still reachable before authorization, giving an unauthorized caller a state oracle. | **Accepted.** §4.3 step 3 is the single `readState`; step 4 authorizes from the request's lead PD; `findCurrentFinal`, the fence, and every later inspection follow. Recorded that this is stricter than the existing group-review start `[VERIFIED via transition-service.js:700-733]`, which is not retrofitted here. |
| I2 | high | The `FINAL` branch of `committedFinal` required version and hash only, not the eTag, lastModified, and filesize the write refreshes and `persistedIdentityMatches` compares. | **Accepted.** §4.4 requires all five observation fields; §7 lists each as a missing-field test. |
| I3 | medium | F2, G2, and G3 still described superseded milestone-write requirements as the active contract. | **Accepted.** Those rows are rewritten in place to name the H1 supersession and the active contract. Pass 4 also confirmed the observation-field refresh collides with no Final-row claim-identity reader. |

### Pass 5 (2026-09-07, verdict NEEDS REWORK)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| J1 | high | A single Final-row PATCH cannot fence `_wmkf_currentfinalwriteup_value`; a concurrent re-point between re-read and PATCH would advance a row that is no longer current. | **Accepted.** §4.1 and §4.3 step 10 switch to the group-review activation's own shape: one changeset with the Final-row PATCH and a conditional re-bind of the request pointer carrying the request `_etag` `[VERIFIED via transition-service.js:626-635]`. Step 9 checks the pointer explicitly, step 10 fences it atomically; §7 and §8 add the pointer-moved and request-ETag tests. §2, §5, and §6.2 updated to match. |

### Pass 6 (2026-09-07, verdict: design closed, build blocked on owner D2)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| K1 | high | J1 is closed and §2, §4.1, §4.3, §5, §6, §7, §8 are mutually consistent; the only blocker is that the checkpoint contract (D2) awaits owner confirmation while `FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:292` still instructs builders to reuse the milestone fields. | **Accepted as the exit condition.** No design change. The build branch does not open until the owner answers D1–D6 (§10); on a D2 confirmation the first commit rewrites implementation plan :292 in place (§9) before any code. |

Codex passes 1–6 produced twelve findings (F1–F3, G1–G3, H1–H3, I1–I3, J1, K1); all accepted, none
rejected. Plan status: **design closed, awaiting owner decisions D1–D6 before the Tier 1 build.**

## 14. Build record (S493, branch `claude/final-writeup-leadership-review`)

**[BUILT S493 on branch `claude/final-writeup-leadership-review`; PRODUCTION PROMOTION PENDING.]** Built to §4 as revised through pass 6. Files: `lib/services/final-writeup/transition-service.js`
(`committedFinal` generalization, `leadershipCheckpointComplete`, `verifyDocument`, `advanceToLeadershipReview`,
`canAdvance`/`leadership-review` phase, `leadershipReview` on the artifact projection),
`pages/api/workbench/final-writeup/leadership-review.js`, `shared/components/workbench/FinalWriteupTab.js`
(`IN_REVIEW_PHASES`, stage presentation map, advance action, parametrized confirm dialog), tests
`final-writeup-leadership-transition-service.test.js` (32), `workbench-final-writeup-leadership-review-route.test.js`
(6), four new `final-writeup-tab.test.js` cases; existing `final-writeup-transition-service.test.js` shape
assertion gained `canAdvance: false`. One correction to §4.3 step 9 recorded in place (identity + verified
metadata pre-commit; `persistedIdentityMatches` post-commit only). Docs reconciled: security matrix row, atlas,
implementation plan status lines, queue item 4, wiki topic section.

**Codex diff review pass 1 (2026-09-07): one medium finding, accepted.** `leadershipCheckpointComplete` was
truthiness-based, so blank or malformed persisted values could pass the `FINAL` committed-state guard. It is
now a strict validator (parseable timestamps, GUID actor, non-blank strings, finite non-negative size) with
nine malformed-value regression cases beside the seven missing-field cases. Diff review pass 2, PR,
deployment, and owner-run smoke are recorded below as they happen.

## 13. Explicitly out of scope

PC backup transitions (owner closed 2026-09-06: PCs already see everything; transfer is a Dataverse
PD change); notifications or email on transition; a reverse-stage UI; any change to
`visibleToPersona`, buckets, or the matrix; supporting-material projection; anything that adds an
approval gate or reviewer denominator between stages.

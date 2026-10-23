---
title: Controlled Reviewer Rehearsal Plan
domain: reviewer-workbench
kind: plan
status: planned
summary: "Mode A human rehearsal plan and gated path to any later Dataverse integration for the unreleased reviewer candidate."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-22
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
---

# Controlled Reviewer Rehearsal Plan

**Status:** PLANNED — no rehearsal or live integration was performed for this plan.

**Candidate:** `c589cbb6e`; runtime changes are based on `4720980ed`.

**Default mode:** Mode A, with browser/API mocks and synthetic records only.

**Release state:** Local preparation is recorded in the [release receipt](release-preparation-private-store-2026-10-22.md). Targeted human rehearsal, target-specific readiness, and owner promotion decision remain outstanding.

This plan turns the current candidate's reviewer-flow repairs into a controlled
staff and first-time-user rehearsal. It preserves the existing owner decisions
and distinguishes scenarios already covered by mocks from edge fixtures that
still need to be prepared. It does not authorize data integration, a production
write, a real email, a push, or a deployment.

## Decision and evidence boundary

**[VERIFIED via current source and release receipt]** Use Mode A first. Current
browser coverage mocks the normal Program Director invitation and release flow.
The latest candidate also contains guarded identity persistence, Program
Director drift checks, saved-Find exclusion protection, first-manual-invitation
institution screening, due-date handling, and partial-materials safeguards.
These newer edge conditions are not all represented in the existing browser
mock harness; this plan labels the missing fixture coverage explicitly.

**[VERIFIED via source and rehearsal runbook]** Draft email rendering uses a
non-live link placeholder and does not persist a token. An actual captured send
can persist a token hash/expiry and invitation lifecycle state. Capture mode is
refused in Vercel Production. Therefore this plan's Mode A send is an in-browser
mock response only; it must not call a real send route or Dataverse API.

**[VERIFIED via rehearsal-script inspection]** The existing
`rehearse:reviewer-invite:browser` script builds with Webpack, starts the local
app, and inherits `process.env`. It mocks named routes but has no catch-all
deny for unmocked API requests. Running the bare command in a credentialed
checkout is not proven side-effect-free. A human Mode A session is blocked until
it runs from a temporary candidate copy with a sanitized environment, outbound
network guard, and a fail-closed browser/API boundary that rejects every request
outside the local origin and named fixtures. These safeguards are preconditions
for a future rehearsal, not controls this plan claims are already installed.

**[VERIFIED via the release strategy and prior sandbox probe]** Mode C is not
ready to use based on the last recorded probe: core reviewer entities and
policy rows were absent on 2026-07-26. Re-probe current schema and permissions,
then provision and validate the reviewer schema, policy rows, auth, files,
jobs, email, and reset procedure before calling the sandbox ready. Mode D remains
out of scope unless a specific integration fact cannot be established in A or
C. Mode B production reads, if separately authorized, cannot prove writes and
must retain the shared write interlock.

## Participants and roles

- **Facilitator/operator:** a staff member who knows the Workbench and can reset
  the local fixtures. This person does not coach the first-time participant.
- **Staff participant:** walks the Program Director tasks and records whether
  the system makes authorization, status, dates, and blocked actions clear.
- **First-time reviewers:** two non-builders, each new to the workflow, receive
  only the proposed reviewer instructions and a mock invitation. Do not count
  the staff participant toward these two reviewer participants. Run the
  reviewer tasks separately so one participant's explanation cannot coach the
  other.
- **Observer/scribe:** records task completion, hesitation, misunderstood copy,
  unexpected state, and the scenario/fixture ID. The observer does not capture
  real names, tokens, email addresses, proposal content, or secrets in the
  receipt.

Do not use a real reviewer identity, production request, real email address, or
real proposal content in Mode A. Use named synthetic personas and obviously
synthetic proposal material.

## Preflight for the Mode A human session

1. Pin the code under review to candidate `c589cbb6e` and record the actual
   checked-out commit. Do not mix in later source changes during the session.
2. Use a temporary export/copy of the candidate. Confirm it has no
   `.env.local`, production credentials, production auth state, or inherited
   browser storage. Supply only disposable local auth/link secrets and loopback
   URLs through a sanitized environment.
3. Put the entire app build and server process behind an outbound network guard,
   including child processes. Allow loopback traffic only. Verify telemetry is
   disabled for this session.
4. Install a fail-closed browser/API boundary before opening the app: each
   expected API route is explicitly mocked, requests outside the named mock set
   fail the scenario, and requests to non-local origins are blocked. If this
   cannot be established, stop; do not substitute a local server that merely
   lacks credentials.
5. Seed each scenario's state in in-memory mock fixtures with stable IDs and
   explicit initial values. Reset the fixtures and browser context between
   scenarios. Keep a request log so the observer can confirm which mocks ran.
   Before the human baseline, verify fixture parity for every participant
   action: the headed harness currently updates reviewer state for `accept`,
   while its `decline` mock returns success without recording declined state.
   Do not treat a decline/referral walkthrough as a truthful post-decline UX
   check until the headed fixture models that state and has a reset path.
6. Confirm that the invite mock returns a captured-artifact-shaped result and
   never invokes the real `send-emails` route. In this plan, “captured” is UI
   copy from the mock; it is not evidence that live capture mode is safe.
7. Record the operator, candidate commit, browser/version, fixture set,
   date/time, and the list of mocked routes in a rehearsal receipt before
   starting.

The standard human Mode A walkthrough is blocked until a guarded launcher and
fail-closed route boundary are available. The edge drills are separately
blocked until their listed mock fixtures are prepared and reviewed. This plan
does not add those harness features or fixtures.

The repository's current `program-director-invite.spec.js` already covers the
standard captured invite, opening the mocked link, campaign settings, accepted
reviewer materials release, no-longer-needed withdrawal, and partial email
failure. It does not establish the new edge scenarios below. The runbook names
`tests/e2e/reviewer-stage2b-authoring.spec.js` for Stage 2b authoring; it covers
autosave, rehydration, submit/conflict, and read-only submitted state, not file
upload. A reviewer file-upload walkthrough remains planned until a safe, mocked
fixture path exists.

## Runnable sequence

This is an execution order for a future authorized rehearsal; no step has been
run as part of authoring this plan.

1. **Preflight and mock audit.** Complete all seven preflight items. Capture the
   fixture and route-mock inventory. Do not proceed if any request can fall
   through to a real `/api/**` handler or an external origin.
2. **Staff baseline.** Use the existing Program Director mock flow to select a
   synthetic candidate, preview an invitation, edit response/review dates, and
   receive the mock captured result. Then exercise the accepted-reviewer
   materials release and pending-invitee withdrawal. The observer records task
   success without helping.
3. **First-time reviewer walkthrough.** Give the reviewer only the mock
   invitation and instructions. Each of the two reviewers independently opens
   the accept action, interprets policy acknowledgements, completes the mocked
   accept path, returns later, and finds the help route. Reset fixtures between
   participants. A decline/referral walkthrough is blocked until the headed
   decline fixture records declined state and can be reset; automated coverage
   of decline does not establish parity in this human harness. Do not represent
   a mock link as a live or deliverable invitation.
4. **Fixture contract drills.** Run the additional mock scenarios in the matrix
   below. These fixtures are planned additions where current coverage is
   absent; they must not be described as existing browser coverage until they
   have been implemented and reviewed.
5. **Debrief and reconcile.** Ask each first-time reviewer what they believed
   would happen before revealing the intended behavior. Record confusion as a
   defect, map each result to the matrix, and list unresolved outcomes. Then
   close the browser contexts, stop only the server started and owned for this
   session, reset the in-memory fixtures, and delete only temporary data created
   for this rehearsal. Do not clean up shared or live state. If any request
   escaped the mock boundary, preserve the receipt and logs and investigate
   before teardown or rerunning.
6. **Separate release review.** Attach the final receipt to the candidate
   review. Automated and human Mode A evidence do not satisfy target-specific
   readiness or the release-owner decision.

## Scenario matrix

All scenarios in this table are **PLANNED**. “Expected writes” describes what
the rehearsal may write to its in-memory mock only. Mode A must make zero
external or durable writes.

| Scenario | Setup and participant action | Expected result | Expected writes and evidence |
|---|---|---|---|
| Standard invitation and response | Staff selects a synthetic candidate, previews, uses the mock send, then the reviewer follows accept and decline links in separate reset runs | Paired actions and destinations are understandable; accept/decline is explicit; a GET/fetch alone does not record a response | Mock invite/result and fixture response only. Record observed copy, task completion, route mocks, and mock state transitions. Existing browser coverage provides the baseline. |
| Confirmed identity continuity | Fixture begins with a stored `confirmed` identity and anchors. Submit a compatible same-binding refresh, then separately submit an incompatible or missing-anchor candidate | Compatible continuity preserves the confirmed identity metadata; incompatible or missing anchor continuity cannot replace the stored binding and must abstain/fail guarded persistence | In-memory current-row/ETag fixture only. Record original and attempted status/anchor shapes and guarded-upsert outcome. Requires a new edge fixture; adapter behavior is not proven by the current UI rehearsal. |
| Sticky probable identity | Fixture begins with a stored `probable` identity. Submit unresolved and ambiguous candidates that each carry a valid person anchor overlapping the stored binding | Each candidate reaches the `probable_sticky` guard: the stored probable decision remains sticky and is not downgraded or replaced. Assert the sticky reason specifically, distinct from continuity abstention | In-memory current-row/ETag fixture only. Record each incoming verdict, overlapping anchor, returned guard reason, and unchanged stored decision/anchors. Requires a new edge fixture. Missing or non-overlapping anchors belong in the separate confirmed-identity continuity scenario and must not be used to claim this guard was exercised. |
| Program Director drift | Preview an invitation while PD A is assigned; change the fixture's assigned PD to B before send; attempt the stale preview, then reload as B | Send is skipped with the assigned-PD-changed message; no email dispatch or invitation lifecycle stamp occurs; staff must reopen preview and re-confirm authorization as B | Mock route events only. A token write can precede a late drift check in a live flow; the Mode A fixture records no real token. Any later C/D rehearsal must declare and reconcile token writes separately. Requires a new edge fixture. |
| Saved Find exclusion race | Save/promote a synthetic reviewer to Invite, then replay a stale Find exclusion action for that candidate | Server returns `candidate_already_saved`; stale card is removed and roster reloads; staff is told to use Invite removal. If reload fails, staff is told to reload before continuing | Mock Find/Invite fixtures only; saved Invite entry must remain. Record conflict response, roster reload, and final card state. Requires a new edge fixture. |
| First manual invite: confirmed COI | Fixture has a staff-confirmed current `mainInstitution` that conflicts with the proposal's PI institution. Staff starts the first manual invitation | First invite is blocked with `manual_institution_coi`; user-facing result says nothing was sent. Do not add an override in this plan | Mock check and response only; no token, invitation lifecycle, or send event. Requires fixtures for both the conflict and the unavailable-check result. |
| First manual invite: unknown institution | Fixture has no staff-confirmed `mainInstitution` but enrichment/history text appears to conflict. Staff starts the first manual invitation | Sparse/unknown main institution remains allowed by the existing policy; enrichment affiliation alone does not become a new block | Mock check and invite flow only. Record that the fixture's enrichment hint did not substitute for staff-confirmed current institution. Do not extend screening to later edits or re-invites. |
| Main institution save ordering | Attempt to record the first invitation in the same patch that changes the staff-confirmed main institution | Reject with `manual_institution_save_separately`; save the institution first, refresh, then retry the invitation step | In-memory fixture only. Record the 409 code, confirm no lifecycle/send transition, then show the separate-save instruction. Requires a new fixture. |
| Institution-check unavailable | Force request/PI/person context read failure during first manual invite | Fail closed with `manual_institution_coi_unavailable`; say nothing was sent and direct staff to check the records before retrying | Mock failure only; no token, lifecycle, or email event. Requires a new fixture. |
| Due-date integrity | Use two synthetic requests with distinct response/review dates. Extend a due date for request A, switch to request B while a delayed response is pending, and submit an extension bound to the wrong parent | Request mismatch is refused before notification/date write; a late response for A cannot repaint B's editor; displayed dates always match the active request | In-memory request-date fixtures only. Record expected request ID, rendered dates, stale-response rejection, and notification calls. Requires a new edge fixture. |
| Materials eligibility and partial availability | Keep one reviewer pending and one accepted. Attempt materials release for both; make the accepted review's SharePoint listing return a partial/error result | Pending reviewer receives no materials or attachment. Partial listing is reported as `materials_unavailable`, not as a valid empty folder. The staff can distinguish unavailable from zero files | Mock request/materials fixtures only; no SharePoint access or email. Existing standard release flow is covered, but partial-availability fixture is planned. |
| Read-only export, when in scope | Open the relevant export from synthetic data and download/inspect the fixture artifact | Export reflects the fixture and leaves the reviewer/request lifecycle unchanged | Mock export bytes only. Assert no mutation, token, email, Blob, or SharePoint route was called. If no export is in the release journey, mark N/A rather than inventing one. |
| Stage 2b return and upload UX | Reviewer returns to mocked materials, authors/edits, submits, then attempts the planned small mock upload when a route fixture is available | Saved draft rehydrates, conflicts are clear, submitted review is read-only, and upload validation/recovery is understandable | In-memory authoring and upload fixtures only. Current authoring spec does not cover file upload; mark upload incomplete until separately mocked and observed. |
| Additional candidate edge regressions | Fixture: competing first-access GETs, Project Leader absent while Research Leader is present, late Awardee response after request switch, omitted cycle-output rows, private DVX token failure | Winning identity/access state is preserved; no PI-role fallback makes the Project Leader control appear when that role is absent; stale responses do not cross requests; omitted rows warn; failed private-object action reports possible retention rather than claiming deletion | Mock state/logs only. These are fixture-level candidate checks, not extra human steps unless the corresponding UI is exposed. No private Blob operations in Mode A. |

## Stop conditions

Stop the session immediately and preserve its receipt if any of these occurs:

- The app targets a non-local origin, an API call escapes the named mock set,
  or an outbound request is attempted.
- A real or unapproved person, request, address, token, proposal, or file enters
  the flow.
- Any Dataverse, Postgres, SharePoint, Blob, Dynamics email, or background-job
  operation reaches a real service.
- A blocked identity, PD-drift, stale-exclusion, due-date, or first-invite
  scenario continues into an unauthorized state transition.
- Proposal materials appear before acceptance; a partial listing is shown as an
  empty complete folder; or an export performs a write.
- The fixture, target, actor, route inventory, or expected effect is uncertain.

Do not blindly retry after a stop. Determine whether the session crossed the
mock boundary, preserve logs without secrets or tokens, identify any possible
durable effect, and reconcile it before another attempt.

## Gate for later data integration

No C or D integration is ready by default. Before proposing one, complete and
record all of the following:

1. Name the exact deployment and Dataverse target, verify hostname
   classification through the shared interlock, and document whether the mode
   is sandbox or production. Never infer the target from an environment variable
   name.
2. For Mode C, re-probe the sandbox schema and permissions; provision the
   current reviewer entities and non-production policy/configuration rows
   through the supported process; verify auth, files, jobs, email behavior, and
   a reset procedure. The 2026-07-26 probe is historical and does not prove
   today's state.
3. For Mode D only, name the owner-approved test request and throwaway people,
   exact server-side request/record/recipient allowlists, actor, expected writes,
   retention window, and cleanup owner. Production reads do not authorize
   writes. Capture mode cannot run in Vercel Production, and local/preview
   capture can still write token and lifecycle fields.
4. Specify before/after evidence for person identity/ETag, suggestion, roster,
   request dates, token hash/expiry, invitation/materials lifecycle, Contact,
   Blob, SharePoint, Postgres, email, and queued/background work as applicable.
   Read-only flows must state which writes are expected to remain absent.
5. Verify the write interlock, independent email/file/background controls,
   authenticated actor, recipient allowlist, and explicit rollback plus
   durable-data reconciliation path. No client flag or environment-only bypass
   may stand in for the shared interlock.
6. Record a small step-by-step rehearsal, cleanup method, failure/partial-success
   handling, and receipt fields before touching the target. Real delivery is a
   separate owner choice; default is no real email.

If any prerequisite is missing, remain in Mode A. A Mode D exception is only
considered when the required behavior cannot be established in A or a validated
C environment, and it requires explicit owner authorization before execution.

## Receipt and completion criteria

For each future run, preserve an aggregate receipt with:

- candidate commit, operator, participants by role, date/time, browser/runtime,
  selected mode, target classification (or `local-mock`), and route-mock list;
- each scenario ID, initial fixture ID/state, participant task, observed result,
  pass/fail/blocked status, timing, and usability notes;
- allowed mock writes and observed mock writes; for C/D only, approved durable
  write classes, protected record references, before/after receipt references,
  and cleanup owner/result;
- stop events, unexpected requests, defects, workarounds, unresolved owner
  choices, and the disposition of every possible durable side effect.

Keep credentials, bearer tokens, recipient addresses, proposal text, and reviewer
identity data out of the receipt. Do not call the rehearsal complete until the
staff and first-time reviewer scenarios have outcomes, all stop events are
resolved, the receipt is reviewed, and the release owner has separately decided
whether the evidence supports the next release step. Completion of this plan
does not itself authorize promotion.

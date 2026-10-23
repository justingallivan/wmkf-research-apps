---
title: Controlled Reviewer Rehearsal Plan
domain: reviewer-workbench
kind: plan
status: active
summary: "Candidate 9b2ec0060 passed all nine declared Mode A scenarios in automation; the 5b internal-staff baseline remains partial and live integration remains incomplete."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-22
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
  - docs/audits/internal-staff-rehearsal-observations-2026-10-22.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
---

# Controlled Reviewer Rehearsal Plan

**Status:** The guided internal-staff baseline on rehearsal candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638` remains partial; see the [observation record](internal-staff-rehearsal-observations-2026-10-22.md). Later, candidate `9b2ec0060` passed an isolated Turbopack build, 51/51 browser tests, three focused unit suites (40 tests), scoped ESLint, and diff check. That is automated fixture evidence and does not complete the human rehearsal. Fully gated candidate `81b8a063b` retains its separate 44/44 browser and full-gate evidence in the release receipt. External first-time reviewer usability is unverified and is not an external-recruitment release prerequisite under the current owner direction.
Assistant-driven authoring UI evidence is recorded separately; the human `reviewer-authoring` worksheet item remains Not run.
Internal staff observation, Linux CI, hosted integration, and promotion remain separate.

**Candidate:** the launcher exports committed `HEAD` and records its exact SHA.
The last fully gated candidate is `81b8a063b`; the latest fixture-verification
candidate is `9b2ec0060`; the recorded guided human session remains on
`5b1656b3dfad110fb5d23fc4fa2514d573e6a638`. Application runtime remains at
checkpoint `4720980ed`. The earlier plan was prepared against `c589cbb6e`.
Launcher/test changes do not alter application runtime code.

**Mode:** A only — synthetic browser/API mocks. No real invitation, reviewer,
request, file service, or deployment is part of this rehearsal.

## Guarded launcher

Run with Node 22 and a populated offline npm content cache:

```bash
npm run rehearse:reviewer-invite:browser -- --scenario baseline
```

If the locked Playwright browser is in a separate existing cache, pass
`--browser-cache /absolute/path/to/locked-browser-cache`. There is no automatic
browser download. `--port 3110` selects an unused loopback port; an occupied port
is refused rather than reused. `--smoke` runs a headless navigation check and
exits; it does not certify a human task or service guard. `--headless` requires
`--smoke`. `--keep-server` and unknown flags are refused.

[VERIFIED via launcher source] The launcher checks that its four implementation
files match committed HEAD, exports that commit into a private temporary folder,
clones only npm's content cache, and installs the lockfile offline with dependency
lifecycle scripts disabled. It never copies the checkout's environment files,
installed packages, browser profile, ignored files, or unrelated untracked work.
Uncommitted application edits are not included in the exported candidate.

Build, server and browser driver use restricted environments, disposable local
secrets, private configuration/cache directories, and a Node network preload.
The server uses normal production authentication with a synthetic staff cookie;
no emergency auth bypass is enabled. Dataverse target and DAL enforcement stay
`on`. The build uses the canonical Turbopack command. The browser accepts only
the exact local document/assets and declared API method/path fixtures, blocks
service workers and WebSockets, and stops on a boundary violation. The Node
preload blocks external Node networking and redirects. This is layered test
containment, not a universal native-process firewall or a live-service sandbox.

Closing the browser ends the owned server/process groups, resets fixture state,
and removes only the marked temporary workspace. Handled interruptions and
errors also stop owned processes. Private aggregate receipts survive under the
system temporary directory with directory/file permissions 0700/0600; receipt
failure retains the owned workspace for investigation. Receipts exclude email
addresses, tokens, raw URLs, proposal text and arbitrary exception messages.
A launcher receipt never marks human scenarios passed.

## People and session sequence

Internal staff perform both the staff workflow and a role-played reviewer
workflow. Prefer staff who did not build the feature when available; there is no
fixed participant count or external recruitment requirement. Record each
operator, facilitator, and observer role and whether one person combined roles.
Record role familiarity and any coaching or intervention. Use synthetic proposal
content and only the provided `example.test` identities. Do not enter real names,
addresses, proposal content, or credentials. Internal role-play can expose
workflow issues but does not verify first-time external reviewer usability.

1. Copy the generated aggregate receipt's candidate SHA, scenario, browser and
   date into a separate human-observation receipt. Add the Node runtime version,
   operator/participant roles and declared mock-route inventory there; the
   launcher does not collect those human fields or a full route list. Keep
   participant identities out of the committed receipt.
2. Internal staff performs the baseline invitation preview/send, campaign-date
   edit, accepted-reviewer materials release, and pending-reviewer withdrawal.
   Captured email is a mock response here; it never calls the real send service.
3. An internal staff member takes the reviewer role and follows the paired
   Yes/No mock links, interprets policy acknowledgements, accepts or declines,
   returns later, and finds help. Close/relaunch for alternate responses so each
   starts with fresh fixture state. A fixture-controller reset is only an
   in-memory reset, not a new browser session. Record any instructions or
   coaching given during the role-play.
4. Staff runs the named edge scenarios below, one fresh launcher run per case.
   Run `reviewer-authoring` separately for the current Stage 2b draft/submit flow.
5. Record task outcomes, confusion, validation/recovery, and blocked outcomes;
   leave unrun items explicitly marked `Not run`. To test resumption, return to
   the same role-play task after a pause and record whether the workflow resumes
   as expected. At finality, record the observed accepted, declined, withdrawn,
   or submitted/read-only state without inferring a result from a mock setup.
   Close browser contexts and stop only this session's server; do not clean
   shared or live data. A boundary violation invalidates the session: preserve
   its receipt, stop the session, investigate, and reconcile possible effects
   before retrying.
6. Attach the observation receipt to release review. Automation and mock behavior
   do not substitute for human observation, target readiness, or owner promotion.

## Interactive scenario inventory

All outcomes below are synthetic UI fixtures. Browser tests prove how the real
UI handles these responses; existing service/adapter tests prove server guards.
They are not evidence that a real email, token, or Dataverse operation was tried.

| Scenario option | Participant task and expected outcome | Evidence boundary |
|---|---|---|
| `baseline` | Preview and mock-send an invitation; use paired Yes/No links; release materials to accepted reviewers; withdraw the pending invitee | Exact browser routes and in-memory lifecycle transitions. Draft preview makes no fixture send transition. Closing/relaunching resets all fixture state. The paired portal links belong to Dr. Saved Reviewer; preaccepted Dr. Accepted Reviewer has no portal link in this fixture. |
| `pd-drift` | Preview with PD A, send after the fixture changes assignment to B, read fresh-preview guidance | Fixture records preview A and current B and returns `program_director_changed`; invitation remains unsent. Real pre-mint/pre-dispatch protection is checked in service tests. |
| `saved-find-exclusion` | Exclude the stale Find card, read the Invite-removal message, verify the saved row remains | Starts with an active Find snapshot; PATCH returns `candidate_already_saved`, then reload supplies savedKeys and removes the stale card. It must not become an Excluded row. |
| `manual-coi-blocked` | Invite the preseeded staff-manual reviewer with a separately saved, trusted conflicting main institution | Mock send returns `manual_institution_coi`, with no invited transition. It does not reject manual Add or derive trusted institution from affiliation text. |
| `manual-coi-unavailable` | Attempt the first invitation when its institution check is unavailable | Mock send returns `manual_institution_coi_unavailable`; no token or live operation exists in this test. |
| `manual-coi-unknown-allowed` | Add a sparse manual reviewer, then send their first mock invitation | Add succeeds; enrichment/affiliation text does not become trusted main-institution evidence. Captured-send success is preserved. |
| `materials-partial` | Release to accepted reviewers while materials availability is unknown | Displays unavailable rather than zero files. Current policy allows preview/send; pending reviewers are excluded from the selected IDs and stay unchanged. Synthetic templates exercise supported placeholders, raw dates, and greeting text; production copy fidelity is not established. |
| `decline-reset` | Inspect and dismiss the synthetic decline referral; reset by closing/relaunching | Referral state is local to the fixture. Portal decline/reset is also exercised through the paired links. |
| `reviewer-authoring` | Open Stage 2b, edit answers, observe autosave, reload, submit, and return | In-memory GET/PUT draft and POST submit. Current reviewer UI replaced the old file-upload card with authoring; file upload is N/A, not an unbuilt fixture. |

**Automated fixture result:** On candidate `9b2ec0060`, an isolated Node
22.23.4/macOS run passed the Turbopack build and 51/51 browser tests with no
retries. Three focused unit suites passed 40 tests; scoped ESLint and diff check
passed. The run covers the nine declared scenarios and supported navigation
Back → Workbench list → request row. Exact passive prefetch routes are mocked;
an undeclared sibling path remains denied, and locator/search navigation is
outside the fixture. The earlier 5b blocked navigation path was not captured,
so it cannot be identified from this later run. This automation does not change
the worksheet below: the 5b guided staff observations stay partial, and
assistant-run browser checks do not count as human task outcomes.

## Internal staff observation worksheet

Complete this header before the session. A facilitator may also operate the
browser or observe if staffing is limited; note combined roles. Do not add
participant names or contact details.

| Session field | Record |
|---|---|
| Candidate SHA / date / browser / Node |  |
| Operator role and feature familiarity |  |
| Facilitator role and feature familiarity |  |
| Observer role and feature familiarity |  |
| Combined roles, if any |  |
| Staff workflow actor role / familiarity |  |
| Reviewer-role actor role / familiarity |  |
| Coaching, prompts, or interventions |  |
| Stop events / boundary violations |  |

For every scenario, record the observed result, confusion or recovery notes,
whether coaching occurred, and any follow-up. `Not run` is the initial status;
this worksheet does not define pass criteria.

| Scenario ID | Staff workflow observation | Internal reviewer-role observation | Outcome / notes |
|---|---|---|---|
| `baseline` | Preview/send, campaign dates, materials release, pending withdrawal | Follow paired Yes/No links; accept or decline; return and find help | Partial — guided invitation/portal/materials observations; campaign edit and withdrawal were assistant-driven and persistence/readback is incomplete. See observation record. |
| `pd-drift` | Preview with PD A; observe changed-assignment send response and fresh-preview guidance | N/A | Not run — |
| `saved-find-exclusion` | Exclude stale Find card; inspect saved-row result | N/A | Not run — |
| `manual-coi-blocked` | Attempt first invite for preseeded trusted conflict | N/A | Not run — |
| `manual-coi-unavailable` | Observe unavailable first-invite check | N/A | Not run — |
| `manual-coi-unknown-allowed` | Add sparse manual reviewer and send first mock invite | N/A | Not run — |
| `materials-partial` | Release to accepted reviewer while availability is unknown; verify the pending reviewer is excluded | N/A | Not run — |
| `decline-reset` | Inspect/dismiss referral and reset fixture | Decline through paired link and inspect final state | Not run — |
| `reviewer-authoring` | N/A | Edit, wait for autosave, reload, submit, confirm read-only return | Not run — |

The nine fixtures do not cover every campaign strategy scenario. Keep these
separate observations explicit; do not treat their absence as a pass:

| Broader scenario | Status | Reason / notes |
|---|---|---|
| Return on a different device or browser | Not run | The fixtures use one controlled browser context; no cross-device claim. |
| Expired or revoked link | Not run | Not among the nine current fixture scenarios. |
| Two tabs or an older link | Not run | Not among the nine current fixture scenarios. |
| Double-click or double-submit | Not run | Fixture coverage does not establish human behavior under repeated submission. |
| Deployment while a form is open | Not run | Synthetic local rehearsal does not exercise deployment replacement. |
| File upload in current Stage 2b | N/A | Current authoring UI has no file-upload control. |

## Contract checks kept outside the headed walkthrough

These do not need invented browser actions or extra participant burden:

| Contract | Existing verification surface |
|---|---|
| Confirmed identity continuity and sticky probable state | `researcher-identity-confirmed-sticky.test.js`: fresh row/anchors, ETag, compatible continuity, incompatible/missing anchors, and overlapping-anchor unresolved/ambiguous `probable_sticky` cases. |
| First-manual-invitation institution authority and same-patch ordering | First-manual COI/recompute and `my-candidates-service.test.js`; combined institution edit + first-invitation correction requires separate save. It is not a sparse-Add rejection. |
| PD authority and stale Find mutation | Send service/fingerprint, roster store, and roster action component tests; browser mock skips/409s do not prove persistence guards. |
| Due-date request binding and late response after request switch | Due-extension service and due-date editor component fixtures. Do not add an invented client `expectedRequestId` field to a route that derives it server-side. |
| Partial materials availability | Materials preflight service/route tests plus the browser warning/accepted-only send scenario. Unknown availability is not a new release-block policy. |
| First-access concurrency, missing Project Leader, Awardee stale response, cycle omissions, DVX failure retention warning | Existing isolated candidate tests. These are not additional human production-write tasks. |
| Read-only export | Outside the invitation journey; mark N/A for this walkthrough. Existing export contract tests remain separate, with no Blob inventory implied. |

## Historical correction and limits

The earlier plan treated every matrix entry as a missing browser fixture and
identified reviewer file upload as a coverage gap. Source investigation showed
that some entries are server/component contracts already tested, and the current
portal has no file-upload control. It also exposed the old headed harness's
inherited environment and accept-only state mutation. The guarded launcher and
shared decline/authoring fixtures replace that harness behavior while preserving
the owner decisions: hold automated identity changes until continuity, require a
fresh preview after PD drift, preserve saved rows against stale exclusions, allow
sparse manual Add, and screen trusted known conflicts before first invitation.

Historical rationale for independent first-time external reviewers remains
valid for measuring external usability. The current owner direction is to use
internal staff for staff and role-played reviewer workflows, with no external
recruitment prerequisite. That choice leaves first-time external reviewer
usability unverified; no internal rehearsal is claimed complete.

No other owner policy decision changed. Verification included an unintended
main-checkout startup. A later bounded read-only observation found no evidence
of durable impact in the checked `system_alerts` and recovery-event records for
the observed window; it does not establish that no write was attempted or rule
out effects outside those records. The evidence and limits are recorded in the
[release preparation receipt](release-preparation-private-store-2026-10-22.md).
Internal human observations are partial even after automated checks pass. The
baseline does not complete the plan; the other human scenarios remain pending.
Verification counts and retained limits belong in the linked release-preparation
receipt.

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
identity data out of the receipt. Do not call the internal rehearsal complete
until the staff and role-played reviewer scenarios have outcomes, all stop events are
resolved, the receipt is reviewed, and the release owner has separately decided
whether the evidence supports the next release step. Completion of this plan
does not itself authorize promotion. First-time external usability remains an
evidence gap when external reviewers do not participate and is not an external
recruitment prerequisite under the current owner direction.

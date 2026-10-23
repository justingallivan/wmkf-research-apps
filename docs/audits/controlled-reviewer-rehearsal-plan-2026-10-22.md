---
title: Controlled Reviewer Rehearsal Plan
domain: reviewer-workbench
kind: plan
status: active
summary: "Guarded Mode A launcher and synthetic rehearsal fixtures, with human observation and any live integration still pending."
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

**Status:** Launcher and fixtures implemented; isolated parent verification recorded in the release preparation receipt. Human rehearsal remains pending.
Human observation, Linux CI, hosted integration, and promotion remain separate.

**Candidate:** the launcher exports committed `HEAD` and records its exact SHA.
The application runtime checkpoint remains `4720980ed`; the earlier plan was
prepared against `c589cbb6e`. Launcher/test changes do not alter application code.

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

Use one staff participant and two first-time reviewers who did not build the
feature. Do not count the staff participant toward the two reviewers. A
facilitator operates/reset the harness; an observer records task outcomes without
coaching. Use synthetic proposal content and only the provided `example.test`
identities. Do not enter real names, addresses, proposal content, or credentials.

1. Copy the generated aggregate receipt's candidate SHA, scenario, browser and
   date into a separate human-observation receipt. Add the Node runtime version,
   operator/participant roles and declared mock-route inventory there; the
   launcher does not collect those human fields or a full route list. Keep
   participant identities out of the committed receipt.
2. Staff performs the baseline invitation preview/send, campaign-date edit,
   accepted-reviewer materials release, and pending-reviewer withdrawal. Captured
   email is a mock response here; it never calls the real send service.
3. Each first-time reviewer independently follows the paired Yes/No mock links,
   interprets policy acknowledgements, accepts or declines, returns later, and
   finds help. Close/relaunch between participants or alternative responses so
   each starts with fresh fixture state. A fixture-controller reset is only an
   in-memory reset, not a new browser session.
4. Staff runs the named edge scenarios below, one fresh launcher run per case.
   Run `reviewer-authoring` separately for the current Stage 2b draft/submit flow.
5. Record success, confusion, validation/recovery, and blocked outcomes. Close
   browser contexts and stop only this session's server; do not clean shared or
   live data. A boundary violation invalidates the session: preserve its receipt,
   investigate, and reconcile possible effects before retrying.
6. Attach the observation receipt to release review. Automation and mock behavior
   do not substitute for human observation, target readiness, or owner promotion.

## Interactive scenario inventory

All outcomes below are synthetic UI fixtures. Browser tests prove how the real
UI handles these responses; existing service/adapter tests prove server guards.
They are not evidence that a real email, token, or Dataverse operation was tried.

| Scenario option | Participant task and expected outcome | Evidence boundary |
|---|---|---|
| `baseline` | Preview and mock-send an invitation; use paired Yes/No links; release materials to accepted reviewers; withdraw the pending invitee | Exact browser routes and in-memory lifecycle transitions. Draft preview makes no fixture send transition. Closing/relaunching resets all fixture state. |
| `pd-drift` | Preview with PD A, send after the fixture changes assignment to B, read fresh-preview guidance | Fixture records preview A and current B and returns `program_director_changed`; invitation remains unsent. Real pre-mint/pre-dispatch protection is checked in service tests. |
| `saved-find-exclusion` | Exclude the stale Find card, read the Invite-removal message, verify the saved row remains | Starts with an active Find snapshot; PATCH returns `candidate_already_saved`, then reload supplies savedKeys and removes the stale card. It must not become an Excluded row. |
| `manual-coi-blocked` | Invite the preseeded staff-manual reviewer with a separately saved, trusted conflicting main institution | Mock send returns `manual_institution_coi`, with no invited transition. It does not reject manual Add or derive trusted institution from affiliation text. |
| `manual-coi-unavailable` | Attempt the first invitation when its institution check is unavailable | Mock send returns `manual_institution_coi_unavailable`; no token or live operation exists in this test. |
| `manual-coi-unknown-allowed` | Add a sparse manual reviewer, then send their first mock invitation | Add succeeds; enrichment/affiliation text does not become trusted main-institution evidence. Captured-send success is preserved. |
| `materials-partial` | Release to accepted reviewers while materials availability is unknown | Displays unavailable rather than zero files. Current policy allows preview/send; pending reviewers are excluded from the selected IDs and stay unchanged. |
| `decline-reset` | Inspect and dismiss the synthetic decline referral; reset by closing/relaunching | Referral state is local to the fixture. Portal decline/reset is also exercised through the paired links. |
| `reviewer-authoring` | Open Stage 2b, edit answers, observe autosave, reload, submit, and return | In-memory GET/PUT draft and POST submit. Current reviewer UI replaced the old file-upload card with authoring; file upload is N/A, not an unbuilt fixture. |

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

The first plan treated every matrix entry as a missing browser fixture and
identified reviewer file upload as a coverage gap. Source investigation showed
that some entries are server/component contracts already tested, and the current
portal has no file-upload control. It also exposed the old headed harness's
inherited environment and accept-only state mutation. The guarded launcher and
shared decline/authoring fixtures replace that harness behavior while preserving
the owner decisions: hold automated identity changes until continuity, require a
fresh preview after PD drift, preserve saved rows against stale exclusions, allow
sparse manual Add, and screen trusted known conflicts before first invitation.

No owner policy decision changed. Verification included an unintended main-checkout
startup whose operational-alert impact is unknown; see the release preparation
receipt. Human observations
remain pending even after automated checks pass. Verification counts and retained
limits belong in the linked release-preparation receipt.

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

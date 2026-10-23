---
title: Internal Staff Reviewer Rehearsal Observations
domain: reviewer-workbench
kind: audit
status: active
summary: "The 5b guided staff baseline remains partial; candidate 9b2ec0060 later passed all nine declared mock scenarios in automation, with no full human rehearsal or release pass."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-22
owner: product-engineering
related:
  - docs/audits/controlled-reviewer-rehearsal-plan-2026-10-22.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
---

# Internal Staff Reviewer Rehearsal Observations

**Status:** Partial guided `local-mock` baseline on candidate
`5b1656b3dfad110fb5d23fc4fa2514d573e6a638`, 2026-10-22 America/Los_Angeles
(retained event timestamps are UTC). Internal staff participated; the assistant
facilitated and performed later browser actions. No real email or live write was
performed. This is not a complete human rehearsal, external usability result, or
production release pass.

## Human participant observations

- **Invitation:** Preview opened for a synthetic reviewer. Minimal synthetic subject/body used a loopback link; no Program Director appeared. Copy clarity and production wording were not assessed. After the native confirmation behavior was repaired, the participant chose OK; the modal closed and the reviewer appeared invited/awaiting response. The captured artifact was not shown. An earlier send attempt had unclear transient feedback and was not retried before investigation.
- **Portal:** Initial acknowledgement gate disabled response buttons until terms were acknowledged. The participant then completed additional required inputs, confirmed acceptance, saw a thank-you, and after reload saw accepted state. Exact additional fields and per-checkbox enablement sequence were not recorded. The guided participant described the flow as clear; this is not external first-time usability evidence.
- **Materials:** Compose and preview opened for a synthetic accepted reviewer. The participant chose Cancel in the native confirmation and returned without success, then chose OK on a second attempt. Success banner/row appeared and the staff roster showed Materials Sent. The fixture returns no configured templates and generic render copy, so template fidelity was not evaluated. This mock transition is not delivery evidence.
- **Incomplete staff tasks:** The pending invitee was absent, so participant withdrawal did not run. Campaign settings opened with fixed fixture values and explanatory copy; the participant did not test persistence.

## Assistant-driven browser actions

- The assistant changed Days to Respond from 7 to 10 and saved; the modal closed. The fixture GET returns fixed campaign configuration, so persistence is unverified.
- After the pending-row gap, the assistant created a mock invitation for synthetic Dr. Saved Reviewer and used withdrawal confirmation. Success UI appeared, but roster still showed Invited — awaiting response. This inconsistent fixture readback is partial, not a successful withdrawal or participant observation.
- In a separate guarded authoring walkthrough on candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638`, Submit was initially disabled. The assistant entered Q2 rich text, Q3 checkbox, and Q4 risk answer; reload restored the values. It completed required Q1 and Q5–Q9, set the Q10 rating, and submitted. The page showed Review Submitted / Review Received, final state, and Program Director help; reload retained the read-only notice with no edit fields. Browser closed normally, process exited 0. The aggregate receipt records 18 mocked API calls, no blocked reasons, and `humanScenarioPassRecorded: false`. This is assistant evidence; the human `reviewer-authoring` worksheet item remains Not run. Receipt: `/private/tmp/wmkf-reviewer-rehearsal-receipts/2026-10-23T04-41-05-597Z-06a5278d-6024-469c-8d20-76857019e485.json`.
- Earlier navigation hit the fail-closed mock boundary for an unmocked Workbench request. The guard stopped the session and was not relaxed. The aggregate receipt lacks the exact path; source review suggests a missing dashboard fixture but does not confirm the blocked request. Empty-template/generic-render behavior is fixture-only, not a production finding.

## Historical fixture follow-up backlog at candidate 5b1656b3

The following backlog records fixture state observed during the 2026-10-22
guided baseline on candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638`. It is a
historical snapshot, not current fixture guidance. The five items were later
repaired in local mocks and verified separately as recorded below; the original
human observations above remain unchanged.

These are prioritized local-fixture tasks, not production-defect claims:

| Priority | Fixture limitation | Proposed local fixture fix | Verification |
|---|---|---|---|
| P1 | Pending candidate row is absent; withdrawal state and candidate/reviewer arrays diverge | Use one seeded pending candidate/reviewer state and update it consistently on mock invite and withdraw | Rehearse pending-row visibility and withdrawal readback; assert the candidate and reviewer projections stay synchronized |
| P1 | Portal staff/reviewer continuity is not modeled | Preserve portal acceptance in the scenario state used by staff roster and reviewer return | Verify accepted state in both views after reload; no hosted claim |
| P1 | Templates are blank and rendering substitutes generic copy | Supply synthetic materials templates and render the submitted subject/body/recipient inputs | Verify preview keeps the synthetic copy and accepted-only recipient selection |
| P2 | Campaign POST does not persist through fixed GET | Retain mock campaign config after POST and return it on GET | Save a setting, reload/open again, and verify the saved mock value |
| P2 | A required navigation request is outside the exact mock list; blocked path is unknown (dashboard is likely, unconfirmed) | Confirm the exact supported route, then add only its method/path fixture and a no-wildcard boundary test | Verify the declared route is fulfilled and an undeclared API still stops the run |

## Later assistant-run fixture verification

**[VERIFIED via parent-reported isolated Node 22.23.4/macOS run on candidate
`9b2ec0060`]** The Turbopack build passed. The isolated browser suite passed
51/51 tests in one invocation with no retries; three focused unit suites passed
40 tests; scoped ESLint and `git diff --check` passed. These are automated
fixture and guard results, not additional participant observations. Application
runtime remains at `4720980ed`; no live email or live write was performed.

The five historical fixture gaps now have local mock coverage:

| Historical gap | Current fixture resolution and evidence boundary |
|---|---|
| Pending candidate absent and invite/withdraw projections diverged | The pending reviewer is present and the mock candidate/reviewer state is updated consistently. The browser suite covers the supported invite and withdrawal paths; this proves fixture readback only. |
| Portal acceptance did not flow back to staff state | The synthetic portal response updates shared fixture state and can be read by the staff roster. The paired portal token links are for Dr. Saved Reviewer only; the preaccepted Dr. Accepted Reviewer has no portal link in this fixture. |
| Empty templates and generic rendering | Synthetic templates now use supported placeholders, raw dates, and greeting text. This does not establish production template copy or fidelity. |
| Campaign POST was not returned by later GET | The fixture retains the submitted campaign settings and returns them on subsequent reads. This proves in-memory fixture persistence only. |
| Required navigation request was outside the declared mocks | The supported Back → Workbench list → request-row path and its exact passive prefetch routes are covered; a sibling undeclared path remains denied. The earlier 5b blocked path was not captured and remains unknown, so this does not identify that historical request. Locator/search navigation remains undeclared. |

The automated run covers the nine declared fixture scenarios; it does not turn
the historical partial staff session into a completed human rehearsal or prove
hosted, cross-device, expired-link, multi-tab, or deployment-while-open behavior.

Cross-device, expired-link, two-tab/older-link, deployment-while-open, and other
broader human, sandbox, and hosted scenarios remain unproven. Keep the navigation
guard fail-closed. No production fix is claimed.

## Prior automated checks and remaining work

The earlier harness confirmation fix was followed by 35 focused unit tests,
scoped lint, two native-dialog contract checks, and 24 sequential
documentation/safety gates and self-tests. Candidate `9b2ec0060` later passed
the isolated checks recorded above. The earlier isolated candidate's 44/44
browser suite and release gates are recorded in the [release receipt](release-preparation-private-store-2026-10-22.md).
These are automated evidence, not human observations.

All nine declared scenarios have automated-fixture evidence, not native human
passes. As participant-observed human tasks, invitation copy, Program Director
clarity, production template fidelity, invitation-specific Cancel, and
participant-led pending withdrawal or campaign-setting persistence remain
unverified. Human reviewer-authoring, decline/reset, and remaining edge
scenarios are pending. External first-time usability is unverified. No full
human rehearsal or production release pass is claimed.

---
title: "E2E Reviewer Suite Re-baseline — Handoff"
domain: testing
kind: plan
status: active
summary: "E2E red 2+ days: 8/23 fail, all reviewer invite/accept. One safe selector bug fixed; rest parked (6/8 overlap Codex's active accept-flow rewrite)."
canonical: false
cataloged: 2026-07-04
owner: product-engineering
related:
  - tests/e2e/program-director-invite.spec.js
  - tests/e2e/reviewer-accept.spec.js
  - tests/e2e/reviewer-captured-invite.spec.js
  - tests/e2e/helpers/reviewer-portal.js
  - shared/components/reviewers/InviteEmailModal.js
  - shared/components/reviewers/ReviewerInvitePanel.js
---

# E2E Reviewer Suite Re-baseline — Handoff

**Status:** parked (2026-07-04). Open for a future session.
**Owner surface:** `tests/e2e/*` (Playwright) for the reviewer invite/accept flow.

## TL;DR

The Playwright E2E job (`.github/workflows/e2e.yml`) has failed on **every run
for 2+ days** — **8 of 23 tests fail** [VERIFIED via CI run 28690761878: "8 failed
/ 15 passed"], all in the reviewer invite/accept flow. This is accumulated UI
drift vs. the "rehearsal" E2E specs, **not** related to the repo going private or
to the CodeQL/Semgrep CI changes (commits `180e9046`, `198fbd97`). One safe,
confirmed test-selector bug was fixed; the rest are parked here because **6 of the
8 failures are in the reviewer-accept flow that Codex was actively rewriting** at
park time (see "Codex overlap") — fixing them then would have encoded behavior
that is itself changing.

## What was already fixed (2026-07-04)

`tests/e2e/program-director-invite.spec.js:351` — `getByText('Invite reviewers (1)')`
matched **two** elements (strict-mode violation [VERIFIED via run log: it resolved
to two `<p class="font-medium text-gray-900">` nodes]): the modal title
[VERIFIED via `shared/components/reviewers/InviteEmailModal.js:304`] "Invite
**r**eviewers (1)" (lowercase) **and** the Workbench sub-tab header [VERIFIED via
`shared/components/reviewers/ReviewerInvitePanel.js:249`] "Invite **R**eviewers (1)"
(capital R) rendered behind it. `getByText` is case-insensitive, so both matched.
Fix: added `{ exact: true }` (case-sensitive, whole-string) to target the modal
only. Pure test change; no app behavior touched. NOTE: this only clears the
strict-mode error at that line — the rest of that test (`:337`) was **not** run
green locally (Playwright not executed this session; see "How to verify").

## Remaining failures to re-baseline (7)

Failing test list [VERIFIED via CI run 28690761878 failed-log]. They reproduce
against **committed `main`** (i.e. without Codex's uncommitted tree).

### Invite panel — `tests/e2e/program-director-invite.spec.js`
- **`:337` "sends a captured invitation and opens the reviewer link"** — the
  strict-mode blocker at `:351` is fixed; re-run to confirm the downstream steps
  (fill timing fields, "Send 1 invitation" dialog, "captured 1 invitation email
  for rehearsal", `sentBodies` shape) still pass against the current
  `InviteEmailModal` / invite mocks. If any assert is stale, update the test.
- **`:384` "batch preview handles low-confidence email and no-email rows"** —
  `page.getByLabel('Select Dr. Missing Email').check()` **times out (10s)** at
  `:402` [VERIFIED via run log: "TimeoutError: locator.check ... waiting for
  getByLabel('Select Dr. Missing Email')"]. [ASSUMED] hypothesis: no-email rows
  in `ReviewerInvitePanel` are no longer selectable (checkbox disabled/removed)
  or the accessible label changed — verify the panel's current rendering for a
  candidate with `email: ''`.

### Reviewer accept (Stage 2a) — `tests/e2e/reviewer-accept.spec.js`
Drives the real portal page with `/context` + `/respond` route-mocked
[VERIFIED via spec header + `tests/e2e/helpers/reviewer-portal.js` import]. All
five fail around policy-ack / accept-gating / accept payload:
- **`:36`** "Accept is disabled until both policies are acknowledged" — after
  `acknowledgeBothPolicies()` + clicking "Accept and continue", `respondCalls`
  stays empty (POST to `/respond` never fires) [VERIFIED via run log:
  `expect(respondCalls[0].action)` failed at `:48-49`]. [ASSUMED] accept-gating or
  the policy-card ack interaction drifted.
- **`:63`** "address + phone required client-side when taking the honorarium"
- **`:86`** "accept with honorarium opt-out sends no payment address"
- **`:146`** "a complete accept POSTs the correct payload and transitions off Stage 2a"
- **`:164`** "a server 422 payment_contact_required renders inline (defensive path)"

### Captured invite → accept — `tests/e2e/reviewer-captured-invite.spec.js`
- **`:22`** "captured Respond to Invitation button opens the portal and reviewer
  accepts" — same accept flow as above; [ASSUMED] likely resolves with the
  `reviewer-accept` fixes.

## Codex overlap — READ BEFORE TOUCHING THE ACCEPT TESTS

At park time Codex was rewriting the accept surface these tests assert against
[VERIFIED via `git status` this session]: `pages/api/external/review/[token]/respond.js`
(modified) plus new `lib/services/reviewer-acceptance-*.js` and
`pages/api/cron/drain-reviewer-acceptances.js` (untracked). **Before fixing the
five `reviewer-accept.spec.js` tests + `reviewer-captured-invite.spec.js`, confirm
Codex's acceptance work has landed on `main`**, then re-baseline against the
*current* portal accept UI + `/respond` contract. If you fix them before that,
expect rework. The two `program-director-invite.spec.js` tests are lower-risk
(the invite panel/modal were not in Codex's dirty set).

## How to verify locally

- Run all: `npm run test:e2e`. Single spec:
  `npx playwright test tests/e2e/reviewer-accept.spec.js`. Add `--headed`,
  `--debug`, or `--ui` to watch the DOM and confirm current selectors.
- Dev server: the Playwright config boots the app on **port 3100**; no Dataverse
  is touched (context/respond are route-mocked in `tests/e2e/helpers/`).
- **Ignore this log noise** — expected under the e2e env, not the failure: missing
  `POSTGRES_URL` (`VercelPostgresError missing_connection_string`), Dynamics
  URL/creds not set, "Azure AD credentials missing in production" [VERIFIED via
  run log — these lines appear on passing and failing tests alike]. The real
  failures are the selector/gating assertions above.

## Definition of done

`npm run test:e2e` green (23/23), then decide whether E2E should be a required
merge gate (it is not effectively gating today — see `docs/CI_GATES_REFERENCE.md`).
Reconcile this file's `status` when closed.

---
title: Reviewer Lifecycle — Publication and Release Readiness
kind: audit
domain: reviewer-workbench
status: in-progress
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Reviewer lifecycle release

The owner approved publishing/releasing the completed milestone on 2026-09-05
after the public GitHub destination was stated. Public branch publication is
complete. Production promotion remains pending the release checks and rehearsal
disposition below; no merge to main or production deployment has been performed.

## Published candidate and release scope

[VERIFIED via successful push and `git ls-remote`] Branch
`codex/reviewer-lifecycle-approved-policies` was published to
`justingallivan/wmkf-research-apps` at
`d76b3bb5b82a9defcdf69d7a3c7274df47801320`, with its origin upstream set.
The earlier public-publication approval block is resolved.
[Draft PR 149](https://github.com/justingallivan/wmkf-research-apps/pull/149)
targets `main`.

[VERIFIED via refreshed Git refs and independent release investigation]
At first publication, `origin/main` was
`90053d11335c7ea0697d08892dfee3369143de23`, an ancestor of the
candidate: zero main-only and 23 branch-only commits at first publication.
The 47-file release includes the Stage 0 test harness and Stage 1A conditional
invitation expiry previously backed up on feature branches, as well as Stage
1B email bookkeeping, Stage 1D closed-history guards, Stage 1E status feedback
and Stage 6A explicit outcomes. Stage 1C confirms receipt behavior already on
main; its application edit is a comment only. The later publication handoff and
browser-fixture correction preserve the reviewed runtime.

Exact milestone comparisons show no executable drift: expiry is unchanged
since `721f4f3d`, email bookkeeping since `08752364`, closed-history code since
`c51fa34d`, and final status implementation/tests since `5b9964c8` apart from
the two AST-equivalent comment changes at `d76b3bb5`. Native review evidence:
`/tmp/reviewer-lifecycle-release-readiness.md`.

## Environment and rollback reference

[VERIFIED via Vercel list/inspect and browser observation]

| Role | Deployment and commit | Verification |
|---|---|---|
| Initial candidate preview | `dpl_Apwm2Mr42BwmeCy2HRxFmLMWv8ok`, commit `d76b3bb5` | READY; non-production Git branch |
| Current production / rollback target | `dpl_CxBa3Hc8niE6hLcryMMjhYfz54GL`, commit `90053d11` | READY; production aliases attached; Microsoft sign-in and Workbench request list rendered successfully |

Candidate URL:
[Vercel preview](https://wmkfresearchapps-3tyv7eql2-justin-gallivans-projects.vercel.app).
Production rollback URL:
[pre-release deployment](https://wmkfresearchapps-7v9ofudlc-justin-gallivans-projects.vercel.app).
Vercel confirms the production aliases include `applications.wmkeck.org`,
`reviews.wmkeck.org`, `grantees.wmkeck.org`, `submissions.wmkeck.org` and
`wmkfresearch.vercel.app`. The signed-in smoke used the existing Microsoft
session and read the Workbench list; it did not exercise lifecycle writes or
send email. This is the pre-release smoke, not post-promotion verification.

The installed Vercel CLI documents this rollback path:

```sh
vercel rollback dpl_CxBa3Hc8niE6hLcryMMjhYfz54GL --scope justin-gallivans-projects
```

Record owner: Justin, with Codex executing only the approved release/incident
scope. Recheck the serving production deployment before invoking rollback.
This command was inspected, not executed; no live rollback drill is claimed.

[VERIFIED via unchanged schemas/maps and source diff] Pre-release readers can
read data produced by this branch: no field, optionset, migration, storage
format, dependency, environment contract or cron schedule changes. Restoring
old code also restores its earlier protection gaps. Rollback cannot unsend
email, undo confirmed writes or recover a lost HTTP response. Inspect affected
rows and logs before any separately approved repair; never replay delivered
email or confirmed batch saves as a rollback strategy.

## Automated validation and rehearsal

The frozen candidate passed 770 suites / 10,850 tests, webpack build and 59
distinct sequential checks. Independent stage reviews include Stage 1A, which
falls outside Claude's later 1B–6A review range. Claude's supplied review
reported PASS with Low findings; the owner-approved comment/doc follow-up
preserved executable behavior and passed 19 checks, lint and AST equivalence.
These are inherited local receipts, not a new full-suite run in this release.

[VERIFIED via GitHub run `33980411955`] The PR's initial CI independently passed
all 770 suites / 10,850 tests (129.824 seconds), its build, lint and registered
checks at `d76b3bb5`. Semgrep, Gitleaks, Trivy and the Vercel preview checks also
passed. These results are separate from the browser failure described next.

Initial GitHub browser CI at `d76b3bb5` passed 23 of 25 cases; campaign settings
and accepted-reviewer materials actions timed out. Independent investigation
found the existing staff fixture supplied an empty session and null lead-PD
identity, so the real ownership guard correctly denied those actions. The
fixture and owner-gate behavior are unchanged from `origin/main`; this is not
an application regression from the release. The narrow test-fixture correction
at `4576f559` supplies the synthetic lead-PD identity/session, mocks five known
GET reads and matches the materials heading/confirmation already on main.
It retains the real owner gate, non-superuser role and original payload
assertions. Independent review passed the exact test blob
`07ece234cef8d2e54002386915d11785f5880fa6`; no runtime source changed.

[VERIFIED via final Chromium rehearsal and boundary logs] The corrected Mode A
run passed **31/31 cases**: all 25 existing browser scenarios plus six temporary
cases exercising the actual status UI, with zero failures, skips or flaky
cases (17.728 seconds). Status cases cover structured success/failure, foreign
or incomplete identities, legacy denial, malformed JSON and pending/reentrant
duplicate suppression. Refresh failure and stale completion retain their
separate rendered Jest coverage in the prior stage receipts.
The server used the existing production build with outbound networking blocked;
the browser rejected unmocked requests. The final run recorded zero unmocked or
external browser requests and zero server egress attempts. The temporary
server was stopped after validation. This proves isolated browser behavior,
not live Dataverse authorization, persistence or email delivery. ESLint, syntax
and diff checks passed, and the tracked migration manifest remained unchanged.
Local detail: `/tmp/reviewer-lifecycle-release-rehearsal.md` and
`/tmp/reviewer-lifecycle-e2e-fixture-review.md`.

The current PR's head-specific checks are authoritative for publication;
verify them before promotion. The initial CI result above remains tied to its
named revision and is not substituted for the corrected browser rerun in CI.
The PR's automatic Claude job reported success but published no review finding;
that status is not counted as another completed independent code review.

## Remaining release boundary

This is Tier 2 under
[the release strategy](../CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md),
section 4: reviewer Dataverse writes, email bookkeeping and expiry behavior.
The strategy requires staff rehearsal and relevant first-time reviewer
rehearsal, a rollback record, and deliberate main promotion. Section 12 treats
unchecked readiness items as explicit risk acceptance, not implied passes.
Automated browser/Jest coverage does not establish human UAT. No human/naive-user
rehearsal or live rollback drill is claimed by this release record; their
disposition must be explicit before promotion. Campaign-freeze status has not
been independently verified.

After the release checks and owner disposition, the intended production action
is merge PR 149 to `main`, allowing its normal production Git deployment. Verify
the resulting source/deployment association, staff sign-in and a read-only
reviewer path before reporting production success. Do not promote the preview
artifact directly across environment-specific configuration. No live test
record mutation, email send, cron invocation, schema operation or backfill is
included in this publication/rehearsal scope.

## Durable publication reconciliation

Sweep Mode A updates current public-publication claims in the handoff,
approved decisions and stage parent-closure/receipt summaries. Dated independent
reviews retain their original commit and authorization evidence. Local
implementation completion and production release are separate facts. Final
publication searches found no remaining live stale publication block; the old
Stage 1B rejection is retained as explicitly dated history. Eleven documentation
gate/self-test commands passed sequentially on the final edited receipt before
commit. No DEVELOPMENT_LOG milestone is required
at branch publication; a production release requires its own milestone entry.

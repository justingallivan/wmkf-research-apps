---
title: Reviewer Lifecycle — Production Release
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Reviewer lifecycle release

The owner approved publishing/releasing the completed milestone on 2026-09-05
after the public GitHub destination was stated, then explicitly approved
deployment without separate human UAT or a live rollback drill, on the stated
assumption that campaign timing permits. [VERIFIED via GitHub/Vercel metadata and authenticated browser
reads] PR 149 merged to main as `c19a16d8` and reached READY Production on
2026-09-05. The staff read-smoke passed; the exact evidence and accepted limits
are recorded below.

## Published candidate and release scope

[VERIFIED via successful push and `git ls-remote`] Branch
`codex/reviewer-lifecycle-approved-policies` was published to
`justingallivan/wmkf-research-apps` at
`d76b3bb5b82a9defcdf69d7a3c7274df47801320`, with its origin upstream set.
The earlier public-publication approval block is resolved.
[PR 149](https://github.com/justingallivan/wmkf-research-apps/pull/149)
subsequently merged to `main`; the first-publication snapshot remains below.

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
| Pre-release production / rollback reference | `dpl_CxBa3Hc8niE6hLcryMMjhYfz54GL`, commit `90053d11` | READY before release; existing Microsoft session and Workbench request list rendered successfully |
| Released production | `dpl_6tVnMbnSMtqwtss15bEdSzBz4ELj`, commit `c19a16d8` | READY at 2026-09-05 17:40:20.139 UTC; all seven expected aliases attached; post-release staff read-smoke passed |

Candidate URL:
[Vercel preview](https://wmkfresearchapps-3tyv7eql2-justin-gallivans-projects.vercel.app).
Released URL:
[production deployment](https://wmkfresearchapps-mzkwsukcn-justin-gallivans-projects.vercel.app).
Rollback reference URL:
[pre-release deployment](https://wmkfresearchapps-7v9ofudlc-justin-gallivans-projects.vercel.app).
Vercel confirms the production aliases include `applications.wmkeck.org`,
`reviews.wmkeck.org`, `grantees.wmkeck.org`, `submissions.wmkeck.org` and
`wmkfresearch.vercel.app`. The signed-in smoke used the existing Microsoft
session and read the Workbench list; it did not exercise lifecycle writes or
send email. That first smoke was pre-release; the distinct post-release evidence
is recorded under Production promotion below.

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

[VERIFIED via completed GitHub check metadata and full logs] All eight reported
checks passed at final head `7a27d4b1f08625df4ab859cd4e39d4880fbcbd64`.
Jest run `33981112950` passed **770 suites / 10,850 tests**, build, lint and
all **38** individual `check:*` steps in that workflow. Playwright run
`33981112953` passed all **25 stock browser cases**; the six temporary local
status cases remain separate evidence. The other green checks were Semgrep,
Gitleaks, Trivy, the Claude workflow, Vercel and Vercel Preview Comments.
The actual Jest/Playwright checkout was synthetic merge `5fc3ee29`, whose
parents were base `90053d11` and final head `7a27d4b1`; its tree exactly matched
the final head (`2d121b435e741b63e4928182e811043f40f37219`).

The automatic Claude workflow returned SDK success with one permission denial,
but no inspectable review verdict, PR review or inline comment. Its green job
is not another independent-review PASS; the separate local Claude report and
follow-up remain the substantive review evidence. These CI results retain
existing diagnostics and do not prove clean consoles or live-service writes.
Local detail: `/tmp/reviewer-lifecycle-final-ci.md`.

## Owner decision and accepted verification limits

This is Tier 2 under
[the release strategy](../CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md),
section 4: reviewer Dataverse writes, email bookkeeping and expiry behavior.
The strategy requires staff rehearsal and relevant first-time reviewer
rehearsal, a rollback record, and deliberate main promotion. Section 12 treats
unchecked readiness items as explicit risk acceptance, not implied passes.
Automated browser/Jest coverage does not establish human UAT. The owner
explicitly accepted deployment without separate human/naive-user UAT or a live
rollback drill; neither was performed. The owner approved deployment on the
stated assumption that campaign timing permits; no independent calendar
verification was performed. This is a release-specific decision and does not
change the standing release policy.

## Production promotion

[VERIFIED via GitHub merge metadata and exact source-tree comparison]
PR 149 merged on 2026-09-05 at **17:39:40 UTC** as
`c19a16d8687a25226f3accb4059634acb92db073`. The merge tree exactly equals the
tested final head `7a27d4b1`. The checkout was synced to `main` at this merge.
The normal production Git deployment was used, preserving production-specific
configuration; no preview artifact was directly promoted.

[VERIFIED via GitHub workflow metadata at 17:45:52 UTC] All five push-to-main
workflows at exact merge `c19a16d8` also reported SUCCESS: Tests `33981653746`,
E2E `33981653527`, Security Scan `33981653615`, Secret Scanning `33981653733`
and Dependency Scan `33981653543`. These are workflow-status observations;
the detailed test counts above remain tied to the inspected final PR runs.

[VERIFIED via Vercel deployment/alias inspection] Production deployment
`dpl_6tVnMbnSMtqwtss15bEdSzBz4ELj` identifies that exact merge and reached READY
at **17:40:20.139 UTC** with all seven expected aliases attached, including the
five public hosts named above.

[VERIFIED via fresh authenticated browser reads, approximately 17:40–17:42 UTC]
The existing Microsoft-backed staff session resumed, the Workbench request list
rendered, and an existing request's Track Reviewers view loaded four rows with
Materials Sent and Review Received states. No action, send, download or mutation
control was activated. This proves the observed read paths, not live lifecycle
mutation, email delivery, concurrency or a new interactive login challenge.
Personal record details are omitted. Local detail:
`/tmp/reviewer-lifecycle-production-browser-smoke.md`.

[VERIFIED via deployment-scoped log queries] The bounded interval from
**17:40:20.139 to 17:43:00 UTC** returned zero error/warning/fatal/HTTP 5xx rows.
Available telemetry was confirmed by 100 sampled HTTP 200/info requests, reaching
the sample limit. This short observation does not establish every request or
future behavior. No live lifecycle test mutation, email send, cron invocation,
schema operation, backfill or rollback drill was performed as release verification.

## Durable release reconciliation

Sweep Mode A updates current public-publication claims in the handoff,
approved decisions and stage parent-closure/receipt summaries. Dated independent
reviews retain their original commit and authorization evidence. Local
implementation completion and production release are separate facts. Final
publication searches found no remaining live stale publication block; the old
Stage 1B rejection is retained as explicitly dated history. Eleven documentation
gate/self-test commands passed sequentially for the pre-publication documentation
snapshot included in `7a27d4b1`; that proof does not cover this later 13-file
production closure. The production closure updates the current handoff, stage
summaries, decisions, wiki, Atlas and catalog to the verified release and adds
the Session 484 milestone to `DEVELOPMENT_LOG.md`. Frozen stage verification and
independent review bodies retain their original scope; deployment readiness and
the read-smoke do not extend their mocked persistence evidence.

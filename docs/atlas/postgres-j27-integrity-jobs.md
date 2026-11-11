# J27 automatic Integrity Screen jobs

**[BRANCH-BUILT]** Migration 096 defines `j27_integrity_jobs`. The rehearsal is
off by default and has no Production admission. No live migration or screening
is implied by the source.

## Write and read paths

The J27 Initial Assessment dropdown calls `POST /api/workbench/scoring` with
stage `chairs-recommendation` (renamed 2026-11-09 from `first-cut` and
`semi-finalist`), authenticated lead PD or superuser authority, and the
current Dataverse ETag. The decision replaces the scoring decision in the same
`akoya_request.wmkf_phaseistatus` field. There is no separate decision field.
A ready factory run must bind the test request, run ID, and sandbox hostname
before the save. This protects the shared screening history from copied
Production request GUIDs. `CHAIRS_RECOMMENDATION_ENABLED=on` also requires the
existing rationale and test-isolation gates. For a dropdown-only Preview,
`CHAIRS_RECOMMENDATION_REHEARSAL_REQUEST_ID` admits exactly the designated sandbox
request while `AUTOMATIC_INTEGRITY_SCREENING` is explicitly `off`. This path does
not reach the Factory lookup or screen queue. The automatic path still
needs a verified connection to the separate sandbox Factory ledger.

With `AUTOMATIC_INTEGRITY_SCREENING=on`, a changed Yes reserves a row keyed by target
hostname and request GUID and starts a durable Vercel workflow. Only the exact
successful conditional save confirms its reservation. An unconfirmed reservation
cannot start screening. A dispatch or confirmation failure does not prevent
the recommendation from saving. The UI reports the two outcomes separately. Repeated Yes submissions do not start
another screen. A completed automatic screen stays in history if staff revise
their recommendation.

The worker takes a six-minute lease before calling the existing request
Integrity Screen. It rechecks J27, the sandbox factory binding and the
current affirmative status (Recommended Invite or Invited). A No or a
withdrawal before the claim is processed skips paid work. A claim that
might have called a provider is never automatically repeated. Expired
reservations become visible failures and release the manual screen guard.
The worker saves the screening history and job completion in one Postgres
statement fenced by the lease token.

## Simulated Preview rehearsal

The `simulate` mode admits exactly two designated sandbox request IDs in
Preview. The first request can reserve a single workflow run. The second
accepts No without reserving work. The worker uses the existing leases and
screening save path with a fixture engine instead of search and model calls.
Queue, screening history, and alert reads use a restricted rehearsal schema
in the sandbox ledger database, separate from app and Factory tables.
The linked Integrity view identifies the simulated finding.

## Alerts and retention

The Integrity page reads the job state alongside the existing screening
history. Workbench requests alerts for its signed-in user, using the current
Dataverse lead PD assignment and existing app grants. A latest automatic
screen with findings remains visible until staff record an integrity review
or a later screen supersedes it. News contributes a flag only when the
analysis returns `flag_for_review` with identity and conduct excerpts
validated against the cited search result. Clear or inconclusive news
does not create a findings alert. Inconclusive news remains visible as
incomplete, and Retraction Watch can independently contribute a flag.
PubPeer remains manual. The automation does not send emails.

The table stores one bounded job row per target and request, with no person
or evidence data in the job itself. Screening data remains in
`integrity_screenings`. Fresh installations apply the numbered migrations.
**[VERIFIED via sandbox workflow definitions and conditional Dataverse
writes]** The sandbox invite-draft condition is `Invited` (100000003), and
the decline-draft condition is `Not Invited` (100000002). On synthetic J27
Research requests #1000373 and #1000374, saving `Recommended Invite`
(707510005) and `Recommended Do Not Invite` (707510006) respectively
persisted both values. The request-linked background jobs completed and
each request had zero email records after a 68-second observation. This
test covered Dataverse in the sandbox. The Preview dropdown, screen
dispatch, and Production workflow behavior require separate verification.
Production admission and treatment of historical direct-triage No values
require separate review. Real provider use requires explicit authorization.

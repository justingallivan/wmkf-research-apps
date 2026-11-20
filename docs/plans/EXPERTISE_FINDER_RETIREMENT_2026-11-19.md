# Standalone Expertise Finder retirement

Status: **COMPLETE — retired in production; authorized data cleanup verified**.
Owner authorized retirement on November 19 and confirmed the 344 matching-history
records need not be retained. Backend automation remains separate and unverified.

## Scope and invariants

- Remove the app from navigation/home/new grants; retain a small retirement notice
  at its old URL pointing to Admin. Archive all six standalone APIs, the matching/
  proposal-query services, prompt/schema source and their dedicated tests.
- Preserve Admin roster editing, Contact links, numeric identity/bindings, consultant
  feedback and recipient services. Their `expertise-finder` directory name remains
  an implementation path, not an active application dependency.
- Keep the existing Dataverse prompt row as a labeled stored reference for Connor;
  remove the retired app from the seed command and live prompt-size audit. No flow
  is enabled and no paid model request or message is sent.
- Historical app grants remain inert; the executable APIs no longer exist. Do not
  change Connor's unrelated broader permissions or grant Amy app access.
- Only after the retirement deployment is verified, delete the obsolete matching
  rows and the exact private synthetic feedback entry from the migration test.
  Keep the acceptance roster profile inactive, preserving its audited identity.
  Retain the empty history table and frozen Postgres roster for recovery; no schema
  migration or cascading deletion is needed for this bounded data cleanup.

## Evidence and release

[VERIFIED via source search] The only runtime matching/history callers were the
standalone page and its own API/service paths. Shared Admin/feedback/recipient
imports remain live and are deliberately retained. The original history route
filtered by profile ID, while all 344 retained rows had null ownership.

New tests assert the retirement notice, absent API files and inactive registry key.
Existing Admin and consumer tests cover the preserved behavior. The full suite and
relevant gates must pass before deliberate promotion; production must prove old
matching APIs are unavailable before deleting history.

Recovery: revert the retirement code commit to restore routes, but deleted matching
history is intentionally not restored. The roster migration recovery remains the
separate [migration runbook](EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md); it requires
its saved pre-retirement deployment, identity/data reconciliation and FK sequence.

Still external: Connor verifies his actual flow connection and separately implements
backend matching. The app retirement does not certify that replacement flow.

## Build verification

[VERIFIED locally, November 19] Env-file-free production webpack build passed.
The full Jest run passed 1,587 suites and found one stale prompt-group count; that
expectation was corrected for the move to stored reference, and the affected suite
plus retirement/Admin-editor suites passed (35 tests). Earlier focused roster and
consumer coverage passed 243 tests. Lint found only a new test mock's missing display
name; named mock correction and scoped lint passed. Existing warnings remain.
Types, API matrix, Atlas, DAL, route boundaries/lifecycle, prompt-injection, canonical
facts/pointers, doc references/currency, secret scan and memory-router checks passed,
with applicable self-tests. Fresh independent read-only review found one stale Admin
Postgres-mode link; it now gives a configuration message rather than linking to the
retired editor. No unresolved runtime dependency finding.

## Production acceptance — November 19 Pacific / November 20 UTC

[VERIFIED via GitHub, Vercel, signed-in Chrome and production SQL] PR #650 merged
as `6ae809f98`; deployment `dpl_3imy7GjGkrGQQUHh6NEHAbfM2fHG` is Ready.
The production domain displays the retirement notice. Signed-in visits to all six
former APIs return 404; anonymous requests first encounter the normal sign-in guard.
Admin roster reload passed with the active roster, including Amy.

All PR CI checks passed (Tests run `44657934091`), including full Jest, production
build, repository gates and Postgres integration; security scans and CodeQL passed.
The first CI attempt caught a historical document pointer to the archived route;
that pointer was corrected before the successful run.

The guarded SQL transaction deleted exactly 344 matching-history rows and synthetic
feedback ID 9 after verifying its original mutation/request/content and test-request
marker. Readback confirms zero history rows and all seven original feedback IDs
`1,3,4,5,6,7,8`. No table, roster identity, binding or profile was deleted.
A fresh real-service probe confirms exact imported Contact/email preservation,
21 active matching-input profiles, Amy active/lead eligible with future email intact,
and inactive/excluded feedback-author behavior. No matching model call or email sent.

Private receipts: `retirement-cleanup.json`, `retirement-deployment.json`, and
`consumers.json` in the owner-managed production evidence directory named in the
migration execution report. Original migration receipts remain dated snapshots.

Sweep Mode A scope: retirement status, history retention and synthetic acceptance
feedback across current plan, runbook, handoff, Atlas, memory and session pointers.
Historical planning/review/build evidence remains explicitly historical. Backend
flow implementation and Connor's actual connection check remain outside this release.

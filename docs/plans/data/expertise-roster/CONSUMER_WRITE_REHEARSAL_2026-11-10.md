# Roster consumer write rehearsal — November 10, 2026

## Verified scope

[VERIFIED via actual services, pinned local Postgres and sandbox Dataverse]
The owner-authorized continuation used the existing guarded rehearsal transport.
No dependency, schema, server or permission framework was added. Production and
shared Postgres were untouched; no deployment, push, email or inference ran.

- Feedback: created a synthetic roster-authored entry, replayed its mutation to the
  same ID, edited/read it back, created a one-off entry, and read both through list
  and shared-briefing services. Filename identity hydrated. All seven original
  feedback records retained their exact hash. The two new local records remain.
- Staff: John created a synthetic profile, Beth edited it, Jean deactivated it.
  Independent profile and native audit reads confirmed all three actors. This
  used explicit process-local impersonation and the approved sandbox role; it is
  not evidence of independent browser sign-ins. The profile remains inactive and
  unbound, GUID `a48520ac-84dd-f111-84ea-70a8a5b1c1c6`.
- Prompt: the existing seed CLI created only the isolated sandbox
  `expertise-finder.match.roster-v2` row, version 1,
  GUID `3fbfcb6f-84dd-f111-84ea-70a8a59af221`. The actual resolver returned exact
  bundled system/body bytes. A scoped simulated 503 on that read exercised the
  actual bundled fallback and passed the same contract. No legacy prompt write
  occurred; no independent before/after legacy-row hash was captured.
- Formatter: all 39 immutable source rows matched the local legacy formatter
  bytes. The 38 migrated source profiles matched after restoring only John's
  intentional category override for comparison; excluded ID 35 and new Amy were
  accounted for separately. Both inputs used Postgres role/name/ID ordering;
  there were no duplicate role/name groups. This verifies text, not model scoring.

Private receipts (0600) are in
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`:
`feedback-write-verification.json`, `staff-edit-audit-verification.json`,
`prompt-v2-readback.json`, `prompt-v2-fallback-verification.json`, and
`roster-formatter-parity.json`. Never copy that credential-containing directory
into Git.

## Editor repair and review

The live-write preparation exposed a remaining editor gap: the importer already
created inactive profiles atomically, but the editor still used direct inactive
creation. The adapter now uses one existing changeset with a server-generated GUID:
create active, then deactivate. Both operations retain the explicit actor and
refuse service-principal fallback. Existing changeset callers retain their default
fallback behavior. Stable creation-key recovery handles uncertain outcomes.

Fable's first OAuth review found one blocker: an unconfirmed changeset error could
carry HTTP 200 through the route. The route now returns a sanitized retryable 503
for invalid error statuses; valid errors and concurrency conflicts retain their
semantics. Regression tests cover this, inactive recovery, invalid inactive status,
explicit no-fallback, and legacy default fallback.

Fable re-review returned **READY FOR BOUNDED SANDBOX CANARY**. Both review
transcripts are preserved in `EDITOR_FABLE_REVIEW_2026-11-10.md`.
The final regression run passed 247 tests in 26 suites; types, API-route, DAL,
GUID and context gates plus sequential self-tests passed. Final production build
and scoped lint passed. Repair commit: `c69e9335b`.

[VERIFIED via actual editor service and independent Dataverse read] The inactive
canary passed: one changeset returned two confirmed 204 operations; the retained
profile `b0a861e7-467e-4137-903e-c98117cbc075` is inactive (state 1/status 2), with
John as both creator and modifier. Exact replay returned the same GUID and ETag
without a second changeset. Changed values with the same key returned 409.
Receipt: private `inactive-editor-verification.json`; stable input:
`inactive-editor-run.json`. The atomic changeset and final read establish bounded
success; no independent concurrent visibility probe was performed. Underprivileged
403/no-principal-fallback is regression-tested, not a live staff access experiment.
Fable also noted raw genuine 4xx/5xx messages remain a wider-exposure review item.

A final complete adapter census and SQL count verified 45 sandbox profiles
(39 imported plus six retained synthetic profiles), exactly one inactive editor
creation-key match, and nine local feedback records including the two new entries.
Receipt: private `consumer-write-final-census.json`. Import baseline counts remain
historical evidence.

## UI and release limits

React component tests cover feedback, attendee editing, roster editing and v2
no-lead/consultation/warning rendering. Batch UI fixtures were repaired to reflect
server readback and the existing PATCH deactivation contract. These are jsdom tests
with mocked API/auth, not a signed-in browser rehearsal.

The dedicated fixture deliberately lacks the full application/auth schema. Full
browser UAT, independent staff SSO, attachment/upload flows, live linked-Contact
lifecycle cases, full matching persistence, admission/drain, allocator completion
for editor-created profiles, and final cutover/rollback remain release gates.
New synthetic editor profiles remain unbound and excluded from numeric consumers.
No full migration or Production-readiness claim is made.


## Autonomous follow-up — consumer failure paths

[VERIFIED via source trace, 213 tests across six suites, and independent review]
The Workbench suggestion hook previously discarded roster exclusion warnings.
It now retains them, reports selected attendees without a resolvable email, and
passes them through the Staff Deliberations tab into the actual composer dialog.
Warnings do not change recipients or delivery behavior. The existing request
cancellation guard prevents late directory responses crossing request switches.

| Invariant | Evidence |
|---|---|
| Exclusions reach the user choosing recipients | Hook, parent-prop and real composer-dialog tests |
| Missing selected attendees are explicit | Hook test with unavailable numeric roster ID |
| Stale results do not cross requests | Deferred directory response after rerender test |
| Roster outage does not destroy a retryable upload | Finalizer 503 regression preserves Ready registry, retries same document, exactly one upload |

Review found the initial warning placement was behind the modal; the final change
renders it inside `PreSiteDistributionPanel`'s composer body. Independent re-review
confirmed that repair with no remaining blocker in this bounded scope. Types and
final production build passed. Scoped lint reported zero errors and 30 hook
warnings across the affected components.

These are local component/service tests with controlled dependencies. No new live
attachment upload, email, staff sign-in, cutover or rollback occurred. The populated
full-import fixture cannot use the old empty-fixture SQL rehearsal script; its
explicit empty-identity precondition correctly prevents that reuse. Full rollback
with post-cutover edits remains unverified. No new infrastructure was added.

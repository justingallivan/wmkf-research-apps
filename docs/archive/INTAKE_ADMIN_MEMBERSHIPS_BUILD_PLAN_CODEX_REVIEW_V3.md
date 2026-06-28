## Prior NF findings verification

NF-01 [NEW ISSUE INTRODUCED, was MOD]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:203` — v3 now documents the live `IntakeAuditService.log` object signature and explicitly says `payload = null,      // service hashes this to sha256 internally; do NOT precompute payloadDigest` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:214`; the approve/reject example passes `payload: { priorStatus, newStatus, rejectionReason }` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:230`, so the service computes `payload_digest` and no `payloadDigest` leak remains.

NF-02 [MOD]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:150` — v3 explicitly gates writes on `DYNAMICS_IMPERSONATION_ENABLED === 'true'` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:161` and identifies the live 403 fallback at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:154`; it then requires approve/reject to pass `noFallback: true` so a Dataverse impersonation 403 is returned instead of retried as the service principal at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:182` and `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:300`.

NF-03 [MOD]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:188` — v3 states `updateRecord` returns `Promise<void>` and no new ETag at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:190`, then resolves this by requiring a post-write row re-fetch to get the new ETag and fresh projection at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:196` and `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:302`.

NF-04 [MOD]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:239` — v3 now says to use `DynamicsService.queryRecords(entitySet, { filter, expand, top, orderby })` and `Do not use queryAllRecords` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:243`; it also removes continuation-token semantics and directs future growth to keyset pagination at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:245`.

NF-05 [MOD]: PARTIALLY ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:267` — v3 adds `priorDecision` for requested rows with non-null `wmkf_approvedat` and shows `decidedBy`, `decidedAt`, and `rejectionReason` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:270`; however the `priorDecision.status` inference is still ambiguous for revoked/no-reason histories, as documented by v3 itself at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:280`, so see the new findings below.

NF-06 [LOW]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:141` — v3 now gives a single per-route order with `Method gate` first at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:143`, then auth/CSRF at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:144`, matching the approve validation order at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:286`.

NF-07 [NIT]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:224` — v3 uses `actorOid: access.session.user.azureId` and cites the NextAuth session shape at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:225`, rather than `session.azureId`.

NF-08 [LOW]: ADDRESSED — `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:398` — v3 rewrites the applicant-side requested-by write as `wmkf_RequestedBy@odata.bind: '/contacts(<applicant-contactid>)'` and explicitly says not to use the read-only `_wmkf_requestedby_value` shadow field at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:402`.

## New findings in v3

[MODERATE] Re-application status inference cannot distinguish revoked from approved/no-op history
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:280`
The plan says `priorDecision.status` is inferred from `rejectionReason !== null`, which collapses any null-reason prior decision into "revoked or approved-then-re-requested"; an applicant who was approved, later revoked with `wmkf_rejectionreason` still null, then re-applies would not produce a reliable `priorDecision.status` for admin rendering. Fix: make `wmkf_priordecisionstatus` or an equivalent persisted prior-status snapshot part of slice 0 instead of a follow-up.

[MODERATE] Applicant re-application contract contradicts itself for approved rows
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:398`
The cross-slice rule says any existing row with "any disposition" is updated in place and set to `wmkf_approvalstatus: 'requested'` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:401`, but the disposition table says prior `approved` remains `approved` as a no-op at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:413`; if the applicant slice follows the rule literally, approved memberships can be reset into pending and then hit the ambiguous priorDecision path. Fix: move the status-specific branching into the rule itself and state that approved rows do not re-apply or preserve priorDecision fields.

[LOW] Strict impersonation option is not specified at the retry point
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:182`
The plan correctly chooses a `noFallback: true` extension, but the live fallback happens inside `_writeFetch` before `updateRecord` can observe the first 403, while v3 only names the option generically and later passes it through `updateRecord` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:293` and `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:319`. Fix: specify the exact helper shape, e.g. `updateRecord(..., { ifMatch, actingUserSystemId, noFallback: true })` passes a fourth `_writeFetch(..., actingUserSystemId, { noFallback: true })` option and `_writeFetch` skips the retry when that option is set.

[LOW] Staff identity mapping failure uses retryable service-unavailable semantics
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:171`
The plan returns HTTP 503 for `staff_identity_unmapped` at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:171` and groups it with the env-disabled gate at `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:290`, but an authenticated staff account without a Dynamics systemuser mapping is an authorization/identity-precondition failure rather than transient service unavailability. Fix: reserve 503 for global server misconfiguration (`DYNAMICS_IMPERSONATION_ENABLED !== 'true'`) and return 403 for unmapped staff identity.

[NIT] Plan names a nonexistent `retrieveRecord` helper
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:291`
The approve validation step says "single `retrieveRecord`", but the live helper in this repo is `DynamicsService.getRecord`; this is easy to misread when implementing the post-write re-fetch pattern. Fix: rename the planned read/refetch calls to `DynamicsService.getRecord(...)` everywhere in the route specs.

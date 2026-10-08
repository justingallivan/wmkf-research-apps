# Proposal Ranking Production access and privacy receipt

Historical pre-activation checkpoint. Subsequent release/activation:
`docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`.

Date: 2026-10-07 (owner local date). Target: `wmkf.crm.dynamics.com`.
The owner approved facilitator/participant configuration and privacy checks. The app
remains disabled; no source proposals or ranking business rows were written.

## Configuration verified

[VERIFIED via apply and independent fresh-process GET readback]
`scripts/configure-proposal-ranking-d26-access.mjs` resolved the complete D26 pool:
23 requests, 11 SE and 12 MR. Canonical test exclusion and the D26 cutoff remain.
Enabled Dataverse staff identities were matched uniquely to active linked profiles
and the canonical reverse identity resolver before any grant writes.

| Participant | Dataverse system-user ID | Profile ID | Other app grants, unchanged |
|---|---|---:|---:|
| Justin Gallivan | `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7` | 2 | 21 |
| John Sader | `73d32260-aa8b-f111-ab0f-70a8a59cded0` | 18 | 4 |
| Jean Kim | `b53a3bf8-507f-ee11-8179-000d3a341e8f` | 4 | 4 |
| Beth Pruitt | `b6f1cd38-0973-f011-bec3-6045bd0510d4` | 5 | 6 |

All four now have the `proposal-ranking` app grant. The default setting
`proposal_ranking.default_facilitator_systemuser_id` is Beth's verified GUID above.
Existing grant helpers performed additive writes; the conditional settings helper
saved and reread the facilitator. No Postgres profiles were changed.

The command defaults to dry run, requires `--target=production`, and apply requires
`--apply --expected-roster-sha256=67b4eefe2780283c2306c8f2a3f3a19c13767de31b93337d31f81beb9fd984a2`.
That reviewed fingerprint binds the source roster and resolved staff/profile mappings.
The target interlock and dated purpose-specific Production write acknowledgement
remained enabled. All four grants and the setting returned successful readback;
a separate final dry run found no remaining configuration changes.

## Privacy verified and limits

[VERIFIED via GET-only `scripts/probe-proposal-ranking-production-privacy.mjs`]
Before and after configuration, the application identity read all three ranking
collections with HTTP 200 and zero rows. For each of the four staff above, the
CallerObjectId effective-identity query matched that staff member, a complete
nonempty effective-privilege response lacked all three ranking Read privileges,
and all three collection reads returned HTTP 403: **12 of 12 denied**.
HTTP 200 with an empty collection would fail this proof. The provisioned search
status excluded all three ranking tables. Final probe: `passed=true`, completed
2026-10-08T04:43:44.355Z (UTC).

These are effective impersonation and privilege checks, not staff OAuth browser
sessions. Empty tables do not establish populated audit/navigation privacy or the
in-app lifecycle. No synthetic Production fixtures were created.

[VERIFIED via Git source comparison] `origin/main` lacks this branch's
`lib/services/dynamics-explorer/proposal-ranking-privacy.js` and its generic-reader
protections. Promote and deploy those controls before creating live ranking rows.
This comparison is not an inventory of the hosted deployment. Promotion, runtime
activation and the multi-identity walkthrough remain separate owner decisions.
The walkthrough must cover private lists, submission, independent publication,
meeting reordering and full-requested budget totals.

## Review and validation

Luna built both bounded scripts; Sol reviewed them; one subscription-OAuth Opus
review identified a GUID validator defect, corrected before writes with a regression.
Trusted read context, identity-bound fingerprint and duplicate CLI argument rejection
were also corrected. No agent API keys or metered review product were used.
Ten Node script tests and 19 existing grant/settings helper tests pass. Script lint,
Dataverse/OData gates and sequential self-tests pass. Documentation gates are recorded
with the final branch commit. Local logs under `/private/tmp/ranking-access-*.log`,
`/private/tmp/ranking-production-privacy-final.log` and
`/private/tmp/ranking-access-opus-review.txt` are nonportable; this receipt retains
results and limitations.
